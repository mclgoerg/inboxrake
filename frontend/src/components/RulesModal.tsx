import { Archive, CalendarClock, ClipboardList, FileText, FolderInput, Info, MailOpen,
  MoreHorizontal, Pencil, Pin, Play, Plus, Shield, Trash2, TriangleAlert, X } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api, errorText } from "../api";
import { fmtNum } from "../numfmt";
import { getLang, t } from "../i18n";
import { fmtTs, matchGroup, parseFilter } from "../lib";
import type { AppState, Grouping, Rule, RuleScope } from "../types";
import { QueryBuilder } from "./QueryBuilder";
import { Avatar, Button, confirmDialog, EmptyState, Input, LINK_ACCENT, Menu,
  MenuItem, Modal, Notice, PanelHeader, PopupSelect, Segmented, SettingsGroup,
  SettingsRow, Spinner, Tag, useIsPage } from "./ui";

/** The rules section of the docs (cap, report mode, protected senders). */
const RULES_DOCS_URL = "https://inboxrake.com/docs/features/#rules-and-scheduler";

const EMPTY = {
  name: "", scope: "mail" as RuleScope, grouping: "sender" as Grouping,
  query: "", action: "trash",
  dest: "", schedule: "manual" as Rule["schedule"],
  retention: "none" as "none" | "keep_latest" | "older_than_days",
  retentionN: "",
};

/** What a new Junk / Trash purge rule starts with (D8): older than 30 days,
 *  weekly. The server always creates it in report mode. */
const PURGE_DEFAULTS = {
  action: "purge", grouping: "sender" as Grouping, dest: "",
  schedule: "weekly" as Rule["schedule"],
  retention: "older_than_days" as const, retentionN: "30",
};

const isPurge = (scope: RuleScope | undefined) =>
  scope === "junk" || scope === "trash";

function RunSummary({ rule, preview = true }: {
  rule: Rule; preview?: boolean;
}) {
  const r = rule.last_run;
  if (!r) return <span className="text-muted">{t("rule.never_ran")}</span>;
  if (r.pending) return <span className="text-muted">{t("rule.queued", { n: r.queued ?? 0 })}</span>;
  const when = <span className="whitespace-nowrap">
    {t("rule.last_run", { date: fmtTs(r.ts, getLang()) })}</span>;
  // The facts of the run, joined with " · "; a failed run is its status, and
  // its error text stays in full underneath.
  const facts: ReactNode[] = [];
  if (r.error) {
    facts.push(<span key="st" className="text-danger-fg">{t("rule.run_failed")}</span>);
  } else {
    const purge = isPurge(rule.scope);
    const mails = (n: number) => t("n.mails", { n });
    const groups = (n: number) => t("n.groups", { n });
    facts.push(<Fragment key="run">{purge
      ? r.mode === "execute"
        ? t("rule.purge_run_exec", { n: r.acted, matched: r.mails })
        : t("rule.purge_run_report", { n: r.mails, groups: r.groups })
      : r.mode === "execute"
        ? t("rule.run_done", { mails: mails(r.acted), groups: groups(r.groups) })
        : t("rule.run_would", { mails: mails(r.mails), groups: groups(r.groups) })}
    </Fragment>);
    if (!purge && r.mode === "execute" && r.mails !== r.acted)
      facts.push(<Fragment key="matched">{t("rule.run_matched", { n: r.mails })}</Fragment>);
    if (purge && !rule.query.trim())
      facts.push(<Fragment key="all">{t("rule.purge_all_short")}</Fragment>);
    if ((r.unverified ?? 0) > 0)
      facts.push(<Fragment key="unv">{t("rule.purge_unverified", { n: r.unverified ?? 0 })}</Fragment>);
    if (r.capped > 0)
      facts.push(<Fragment key="cap">{t("rule.capped", { n: r.capped })}</Fragment>);
    if (r.skipped_protected > 0)
      facts.push(<span key="prot" className="inline-flex items-center gap-1">
        <Shield size={14} aria-hidden />
        {t("rule.protected_skipped", { n: r.skipped_protected })}</span>);
    if (r.skipped_pinned > 0)
      facts.push(<span key="pin" className="inline-flex items-center gap-1">
        <Pin size={14} aria-hidden />
        {t("rule.pinned_skipped", { n: r.skipped_pinned })}</span>);
  }
  return (
    <>
      {when}
      {facts.map((f, i) => <Fragment key={i}> · {f}</Fragment>)}
      {r.error && (
        <span className="block text-danger-fg">{errorText(r.error)}</span>)}
      {preview && r.preview.length > 0 && (
        <span className="block text-muted">
          {r.preview.map((p) => `${p.label} (${fmtNum(p.count)})`).join(" · ")}
        </span>
      )}
    </>
  );
}

/** A word-sized building block of a rule sentence. */
function Part({ children, tone = "neutral" }: {
  children: ReactNode; tone?: "neutral" | "danger";
}) {
  return (
    <span className={`inline-block max-w-full rounded-control px-2 py-0.5
      type-body font-medium break-words ${tone === "danger" ? "bg-review-bg text-review-fg"
      : "bg-chip text-body"}`}>{children}</span>
  );
}

/** Fills a translated sentence template: each `{name}` becomes the matching
 *  node (a chip, a pop-up), a missing / null one drops out with its spaces.
 *  Every language owns its word order and case in the template itself. */
function Sentence({ template, parts, className = "" }: {
  template: string; parts: Record<string, ReactNode>; className?: string;
}) {
  const out: ReactNode[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push(text.replace(/ +(?=\u00a0)/g, "").replace(/ {2,}/g, " "));
    text = "";
  };
  template.split(/(\{\w+\})/).forEach((seg, i) => {
    const name = /^\{(\w+)\}$/.exec(seg)?.[1];
    if (name === undefined) { text += seg; return; }
    if (parts[name] == null) return;
    flush();
    out.push(<Fragment key={i}>{parts[name]}</Fragment>);
  });
  flush();
  return <span className={className}>{out}</span>;
}

const GROUPING_KEY: Record<string, string> = {
  sender: "Sender", domain: "Domain", subject: "Subject", thread: "Thread" };

const ACTION_ICON: Record<string, ReactNode> = {
  trash: <Trash2 size={18} />, purge: <Trash2 size={18} />,
  archive: <Archive size={18} />, move: <FolderInput size={18} />,
  mark_read: <MailOpen size={18} />,
};

/** The last run of a rule in full: when, report vs execute, the totals, what
 *  was skipped, any error, and the top senders as rows. */
function ReportSheet({ rule, onClose }: { rule: Rule; onClose: () => void }) {
  const r = rule.last_run!;
  return (
    <Modal onClose={onClose} label={t("rule.report_title")}>
      <PanelHeader title={t("rule.report_title")} sub={rule.name}
        onClose={onClose} />
      <div className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2 type-meta text-muted">
          <Tag tone={r.mode === "execute" ? "keep" : "safe"}>
            {t(`mode.${r.mode}`)}</Tag>
        </div>
        <div className="type-body"><RunSummary rule={rule} preview={false} />
        </div>
        {r.preview.length > 0 && (
          <div>
            <div className="mb-1 type-meta text-muted">
              {t("rule.report_senders")}</div>
            <ul className="divide-y divide-line rounded-card bg-panel2">
              {r.preview.map((p) => (
                <li key={p.key} className="flex items-center gap-2 px-3 py-2">
                  <Avatar name={p.label} />
                  <span className="min-w-0 flex-1 truncate type-body">
                    {p.label}</span>
                  <span className="type-body text-muted">{fmtNum(p.count)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** One row of the rule drawer: a label column, then the controls - every
 *  control starts at the same edge. */
function FormRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    // 5.5rem: wide enough for "apply to"; a longer label wraps
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-x-3">
      <span className="py-1.5 type-body text-muted">{label}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** One rule as a card: icon, name + last run, the report / active switch,
 *  the rule read as a sentence, and its actions. */
function RuleCard({ rule, busy, error, onRun, onEdit, onReport, onMode, onDelete }: {
  rule: Rule; busy: boolean; error?: string;
  onRun: () => void; onEdit: () => void; onReport: () => void;
  onMode: (mode: "report" | "execute") => void; onDelete: () => void;
}) {
  const purge = isPurge(rule.scope);
  const needReport = rule.mode === "report" && rule.report_runs < 1;
  const danger = purge || rule.action === "trash";
  return (
    <div className="rounded-card border border-line bg-panel2 p-3 sm:p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span aria-hidden className={`flex size-10 shrink-0 items-center
          justify-center rounded-control ${danger
          ? "bg-review-bg text-review-fg" : "bg-chip text-chiptext"}`}>
          {ACTION_ICON[rule.action] ?? <ClipboardList size={18} />}
        </span>
        <div className="min-w-0 flex-1 basis-40">
          <div className="type-body font-medium">{rule.name}</div>
          <div className="type-meta text-muted"><RunSummary rule={rule} /></div>
        </div>
        {/* On phones the switch gets its own full-width line. */}
        <Segmented value={rule.mode} label={t("rule.f_mode")} equal role="radio"
          className="max-sm:w-full"
          onChange={(m) => m !== rule.mode && onMode(m)}
          options={[
            { value: "report", label: t("rule.seg_report") },
            { value: "execute", label: t("rule.seg_active"),
              disabled: needReport, describedBy: `rule-need-${rule.id}` },
          ]} />
      </div>
      {needReport && (
        <div id={`rule-need-${rule.id}`}
          className="mt-1 text-right type-meta text-muted">
          {t("rule.need_report")}
        </div>
      )}
      <p className="mt-3 type-body leading-9 text-muted">
        <Sentence template={t(purge ? "rule.sent_purge" : "rule.sent_mail")}
          parts={{
            grouping: <Part>{t(GROUPING_KEY[rule.grouping])}</Part>,
            scope: purge ? <Part tone="danger">
              {t(`rule.scope_${rule.scope}`)}</Part> : null,
            filter: rule.query
              ? <code className="inline-block max-w-full rounded-control bg-chip
                  px-2 py-0.5 type-meta text-chiptext
                  break-words">{rule.query}</code>
              : <Part>{t(purge ? "rule.s_all_senders" : "rule.s_everything")}</Part>,
            action: <Part tone={danger ? "danger" : "neutral"}>
              {t(`rule.act_${rule.action}`, { folder: rule.dest })}</Part>,
            retention: rule.keep_latest != null
              ? <>{t("rule.ret_pre")}<Part>
                  {t("rule.ret_keep", { n: rule.keep_latest })}</Part></>
              : rule.older_than_days != null
                ? <>{t("rule.ret_pre")}<Part>
                    {t("rule.ret_older", { n: rule.older_than_days })}</Part></>
                : null,
            schedule: <Part><CalendarClock size={14} aria-hidden
              className="mr-1 inline align-text-bottom" />
              {t(`sched.${rule.schedule}`)}</Part>,
          }} />
      </p>
      {!!rule.filter_invalid?.length && (
        <div className="mt-2 flex items-start gap-1 type-meta text-review-fg">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          {t("rule.filter_invalid", { names: rule.filter_invalid.join(", ") })}
        </div>
      )}
      {rule.mode === "report" && rule.reset_reason && (
        <div className="mt-2 flex items-start gap-1 type-meta text-review-fg">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          {t(`rule.reset_${rule.reset_reason}`)}
        </div>
      )}
      {error && (
        <div role="alert" className="mt-2 type-meta text-danger-fg">{error}</div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t
        border-line pt-3">
        <Button size="sm"
          variant={purge && rule.mode === "report" ? "primary" : "secondary"}
          onClick={onRun} disabled={busy}>
          {busy ? <Spinner /> : <>
            <Play size={14} aria-hidden className="mr-1 inline align-text-bottom" />
            {t(purge && rule.mode === "report"
              ? "rule.run_report_btn" : "rule.run_now")}
          </>}
        </Button>
        {rule.last_run && !rule.last_run.pending && (
          <Button variant="secondary" size="sm" onClick={onReport}>
            <FileText size={14} aria-hidden
              className="mr-1 inline align-text-bottom" />
            {t("rule.see_report")}
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={onEdit}>
          <Pencil size={14} aria-hidden className="mr-1 inline align-text-bottom" />
          {t("Edit")}
        </Button>
        <Menu variant="quiet" icon label={t("rule.more", { name: rule.name })}
          className="ml-auto" trigger={<MoreHorizontal size={18} aria-hidden />}>
          <MenuItem danger onClick={onDelete}>{t("Delete")}</MenuItem>
        </Menu>
      </div>
    </div>
  );
}

export function RulesModal({ state, onClose, onChanged, initialQuery = "" }: {
  state: AppState;
  onClose: () => void;
  onChanged: () => void;
  /** Starts the new-rule form with this filter (e.g. one the AI wrote). */
  initialQuery?: string;
}) {
  const [form, setForm] = useState({ ...EMPTY, query: initialQuery });
  const [editId, setEditId] = useState<string | null>(null);
  // The side panel / sheet with the sentence builder. A filter handed in
  // (e.g. one the AI wrote) opens it straight away.
  const [reportId, setReportId] = useState<string | null>(null);
  const [editing, setEditing] = useState(!!initialQuery);
  const onPage = useIsPage();
  const [busyId, setBusyId] = useState("");
  const [msg, setMsg] = useState("");      // a refused save, in the editor
  // a refused run / mode switch / delete, on that rule's card
  const [cardErr, setCardErr] = useState<{ id: string; text: string } | null>(null);
  // where focus returns when the side panel closes
  const opener = useRef<Element | null>(null);
  const [filterErr, setFilterErr] = useState("");
  // the refusal belongs to the filter text it was given for
  useEffect(() => setFilterErr(""), [form.query, editId]);
  const rules = state.rules ?? [];

  // The effective per-run cap, from the server (purge confirms name it).
  const capRef = useRef<number | null>(null);
  const getCap = async (): Promise<number> => {
    if (capRef.current == null) capRef.current = (await api.rules()).cap;
    return capRef.current;
  };
  useEffect(() => { getCap().catch(() => {}); }, []);

  // Live match count against the current scan, using the SAME filter code
  // the group list uses (the backend port mirrors it).
  const purge = isPurge(form.scope);
  const matchCount = useMemo(() => {
    if (purge) return null;           // the folder is read live on a run
    const groups = Object.values(state.groups?.[form.grouping] ?? {});
    if (!groups.length) return null;
    const f = parseFilter(form.query);
    const matched = groups.filter((g) => matchGroup(g, f));
    const hits = matched.filter((g) => !g.protected);
    // Pinned mails never move (mark_read is non-destructive: exempt).
    const pinned = (g: { pinned: number }) =>
      form.action === "mark_read" ? 0 : g.pinned ?? 0;
    return { groups: hits.length,
             mails: hits.reduce((n, g) => n + g.count - pinned(g), 0),
             skipped: matched.length - hits.length,
             examples: [...hits].sort((a, b) => b.count - a.count).slice(0, 3)
               .map((g) => g.label) };
  }, [state, purge, form.grouping, form.query, form.action]);

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [k]: e.target.value });
  const pick = <K extends keyof typeof form>(k: K) =>
    (v: (typeof form)[K]) => setForm({ ...form, [k]: v });

  const closeEditor = () => {
    setEditing(false); setEditId(null); setForm({ ...EMPTY });
    // the side panel unmounts with its focus: give it back to the opener
    const back = opener.current as HTMLElement | null;
    if (onPage && back?.isConnected) back.focus();
  };
  const openNew = () => {
    opener.current = document.activeElement;
    setEditId(null); setForm({ ...EMPTY }); setEditing(true);
  };

  const setScope = (scope: RuleScope) => {
    if (isPurge(scope) === purge) { setForm({ ...form, scope }); return; }
    // Crossing between the two kinds of rule: everything that differs
    // (action, grouping, age, schedule) switches together.
    setForm(isPurge(scope)
      ? { ...form, scope, ...PURGE_DEFAULTS }
      : { ...form, scope, action: EMPTY.action, retention: "none",
          retentionN: "", schedule: EMPTY.schedule });
  };

  const save = async () => {
    setMsg("");
    setFilterErr("");
    const { retention, retentionN, ...rest } = form;
    const n = Number(retentionN);
    if (purge && !(Number.isInteger(n) && n >= 1 && n <= 36500)) {
      setMsg(t("fp.older_invalid"));
      return;
    }
    const body = {
      ...rest,
      keep_latest: retention === "keep_latest" && n > 0 ? n : null,
      older_than_days: retention === "older_than_days" && n > 0 ? n : null,
    };
    try {
      if (editId) await api.updateRule(editId, body);
      else await api.createRule(body);
      closeEditor();
      onChanged();
    } catch (e: any) {
      // a refused filter is shown next to the filter field
      if (e.code === "rule_filter_invalid"
          || e.code === "rule_filter_too_long") setFilterErr(e.message);
      else setMsg(t("err.generic", { msg: e.message ?? e }));
    }
  };

  /** The danger confirm of a purge rule (execute switch / run): says what
   *  is deleted, how much per run, and - for an empty filter - that it
   *  means ALL senders of the folder. */
  const purgeConfirm = async (rule: Rule, title: string,
                              bodyKey: string): Promise<boolean> => {
    const cap = await getCap();
    return confirmDialog({
      title, tone: "danger", confirmLabel: t("rule.purge_confirm_btn", { cap }),
      body: <>
        <p>{t(bodyKey, { cap, n: cap })}</p>
        {!rule.query.trim() && <p className="mt-2 font-medium">
          {t("rule.purge_all_senders",
            { folder: t(rule.scope === "junk" ? "Junk" : "Trash") })}</p>}
      </> });
  };

  const run = async (rule: Rule) => {
    setCardErr(null);
    try {
      if (rule.mode === "execute" && !(isPurge(rule.scope)
        ? await purgeConfirm(rule,
          t("rule.confirm_execute", { name: rule.name }), "rule.purge_run_body")
        : await confirmDialog({
          title: t("rule.confirm_execute", { name: rule.name }),
          tone: "danger", confirmLabel: t("rule.run_now") }))) return;
    } catch (e: any) {
      setCardErr({ id: rule.id, text: t("err.generic", { msg: e.message ?? e }) });
      return;
    }
    setBusyId(rule.id);
    try {
      await api.runRule(rule.id);
      onChanged();
    } catch (e: any) {
      setCardErr({ id: rule.id, text: t("err.generic", { msg: e.message ?? e }) });
    }
    setBusyId("");
  };

  const toggleMode = async (rule: Rule, mode: "report" | "execute") => {
    setCardErr(null);
    try {
      if (mode === "execute" && !(isPurge(rule.scope)
        ? await purgeConfirm(rule,
          t("rule.enable_title", { name: rule.name }), "rule.purge_enable_body")
        : await confirmDialog({
          title: t("rule.enable_title", { name: rule.name }),
          body: t("rule.enable_body"), tone: "danger",
          confirmLabel: t("rule.enable_execute") }))) return;
      await api.updateRule(rule.id, { mode });
      onChanged();
    } catch (e: any) {
      setCardErr({ id: rule.id, text: t("err.generic", { msg: e.message ?? e }) });
    }
  };

  const del = async (rule: Rule) => {
    if (!await confirmDialog({
      title: t("rule.confirm_delete", { name: rule.name }), tone: "danger",
      confirmLabel: t("Delete") })) return;
    try {
      await api.deleteRule(rule.id);
      if (editId === rule.id) closeEditor();
      onChanged();
    } catch (e: any) {
      setCardErr({ id: rule.id, text: t("err.generic", { msg: e.message ?? e }) });
    }
  };

  const edit = (rule: Rule) => {
    opener.current = document.activeElement;
    setEditId(rule.id);
    setForm({ name: rule.name, scope: rule.scope ?? "mail",
      grouping: rule.grouping, query: rule.query,
      action: rule.action, dest: rule.dest, schedule: rule.schedule,
      retention: rule.keep_latest != null ? "keep_latest"
        : rule.older_than_days != null ? "older_than_days" : "none",
      retentionN: String(rule.keep_latest ?? rule.older_than_days ?? "") });
    setEditing(true);
  };

  const grouped = !onPage;      // phones / tablets: a grouped form
  const nameInput = <Input className="w-full" placeholder={t("rule.name")}
    aria-label={t("rule.f_name")} autoFocus={onPage}
    value={form.name} onChange={set("name")} />;
  const groupingCtl = purge
    ? <Part>{t("Sender")}</Part>
    : <PopupSelect value={form.grouping} onChange={pick("grouping")}
        name={t("rule.f_grouping")} options={(
          ["sender", "domain", "subject", "thread"] as Grouping[])
          .map((g) => ({ value: g, label: t(GROUPING_KEY[g]) }))} />;
  const scopeCtl = <PopupSelect value={form.scope} onChange={setScope}
    name={t("rule.f_scope")} options={[
      { value: "mail", label: t("rule.scope_mail") },
      { value: "junk", label: t("rule.scope_junk") },
      { value: "trash", label: t("rule.scope_trash") }]} />;
  // The builder stays outside the label: its popover holds controls of its own.
  const filterCtl = <>
    <div className="relative flex items-center gap-2">
      <Input className="min-w-0 flex-1"
        placeholder="tag:shipping age:>1y is:noreply-ever …"
        aria-label={t("rule.f_filter")}
        value={form.query} onChange={set("query")}
        aria-invalid={filterErr ? true : undefined} />
      <QueryBuilder value={form.query} senderOnly={purge}
        onChange={(q) => setForm({ ...form, query: q })} />
    </div>
    {filterErr && (
      <div role="alert" className="mt-1 type-meta text-danger-fg">
        {filterErr}
      </div>
    )}
  </>;
  const actionCtl = purge
    ? <PopupSelect value="purge" onChange={() => {}} disabled
        name={t("rule.f_action")}
        options={[{ value: "purge", label: t("rule.act_purge") }]} />
    : <PopupSelect value={form.action} onChange={pick("action")}
        name={t("rule.f_action")} options={[
          { value: "trash", label: t("rule.act_trash") },
          { value: "archive", label: t("rule.act_archive") },
          { value: "move", label: t("rule.act_move_pick") },
          { value: "mark_read", label: t("rule.act_mark_read") }]} />;
  const destCtl = <PopupSelect value={form.dest || null} onChange={pick("dest")}
    name={t("rule.f_dest")} placeholder={t("Move to folder…")}
    options={(state.folders_raw ?? []).map((f, i) =>
      ({ value: f, label: state.folders[i] ?? f }))} />;
  const applyCtl = purge
    ? <Sentence template={t("rule.ed_older")}
        className="flex flex-wrap items-center gap-2 type-body text-muted"
        parts={{ n: <Input className="w-24" type="number" min={1}
          max={36500} aria-label={t("rule.purge_age_label")}
          placeholder={t("retention.n_placeholder")}
          value={form.retentionN} onChange={set("retentionN")} /> }} />
    : <>
        <PopupSelect value={form.retention} onChange={pick("retention")}
          name={t("rule.f_apply")} options={[
            { value: "none", label: t("rule.apply_none") },
            { value: "keep_latest", label: t("rule.apply_keep") },
            { value: "older_than_days", label: t("rule.apply_older") }]} />
        {form.retention !== "none" && (
          <Input className="w-24" type="number" min={1}
            aria-label={t("rule.f_retention_n")}
            placeholder={t("retention.n_placeholder")}
            value={form.retentionN} onChange={set("retentionN")} />
        )}
      </>;
  const scheduleCtl = <PopupSelect value={form.schedule} onChange={pick("schedule")}
    name={t("rule.f_schedule")} options={[
      { value: "manual", label: t("sched.manual") },
      { value: "daily", label: t("sched.daily") },
      { value: "weekly", label: t("sched.weekly") }]} />;

  const panelBox = useRef<HTMLDivElement>(null);
  const editor = (
    <div ref={panelBox} onKeyDown={(e) => {
      // A pop-up menu or a dialog opened from this panel (the filter
      // builder sheet) takes this Esc; only the panel itself closes on it.
      const inner = (e.target as Element).closest('[role="dialog"]');
      if (e.key === "Escape" && !e.defaultPrevented
          && !document.querySelector('[role="menu"]')
          && !(inner && panelBox.current?.contains(inner))) {
        e.preventDefault(); closeEditor();
      }
    }}>
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <h2 className="min-w-0 flex-1 truncate type-heading">
          {editId ? t("rule.edit_title") : t("rule.new_title")}
        </h2>
        <Button variant="secondary" size="icon" label={t("Close")}
          onClick={closeEditor}><X size={18} /></Button>
      </div>
      <div className="space-y-4 p-4 sm:p-5">
        {grouped ? (
          <SettingsGroup padded>{nameInput}</SettingsGroup>
        ) : (
          <FormRow label={t("rule.f_name")}>{nameInput}</FormRow>
        )}
        {purge && (
          <Notice tone="danger" icon={<TriangleAlert size={16} />}>
            {t("rule.purge_warning")}
          </Notice>
        )}
        {grouped ? <>
          <SettingsGroup header={t("rule.grp_which")}
            footnote={purge ? t("rule.purge_filter_help") : undefined}>
            <SettingsRow label={t("rule.row_when")}>{groupingCtl}</SettingsRow>
            <SettingsRow label={t("rule.row_in")}>{scopeCtl}</SettingsRow>
            <SettingsRow label={t("rule.row_matches")} stack>{filterCtl}</SettingsRow>
          </SettingsGroup>
          <SettingsGroup header={t("rule.grp_what")}>
            <SettingsRow label={t("rule.s_then")}>{actionCtl}</SettingsRow>
            {!purge && form.action === "move" && (
              <SettingsRow label={t("rule.f_dest")}>{destCtl}</SettingsRow>)}
            <SettingsRow label={t("rule.s_apply")}>{applyCtl}</SettingsRow>
            <SettingsRow label={t("rule.s_run")}>{scheduleCtl}</SettingsRow>
          </SettingsGroup>
        </> : (
          <div className="space-y-3">
            <FormRow label={t("rule.row_when")}>
              {groupingCtl}
              <span className="type-body text-muted">{t("rule.mid_in")}</span>
              {scopeCtl}
            </FormRow>
            <FormRow label={t("rule.row_matches")}>
              <div className="w-full">
                {filterCtl}
                {purge && (
                  <div className="mt-1 type-meta text-muted">
                    {t("rule.purge_filter_help")}</div>
                )}
              </div>
            </FormRow>
            <FormRow label={t("rule.s_then")}>
              {actionCtl}{!purge && form.action === "move" && destCtl}
            </FormRow>
            <FormRow label={t("rule.s_apply")}>{applyCtl}</FormRow>
            <FormRow label={t("rule.s_run")}>{scheduleCtl}</FormRow>
          </div>
        )}

        {!purge && <div className="rounded-card bg-panel2 p-3" aria-live="polite">
          <div className="type-body font-medium">{t("rule.preview")}</div>
          {matchCount ? <>
            <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
              <PreviewStat n={matchCount.groups} k="rule.pv_groups" />
              <PreviewStat n={matchCount.mails} k="rule.pv_mails" />
              <PreviewStat n={matchCount.skipped} k="rule.pv_skipped" />
            </div>
            {matchCount.examples.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {matchCount.examples.map((ex) => (
                  <span key={ex} className="inline-flex max-w-full items-center
                    gap-1.5 rounded-control bg-chip px-2 py-1 type-meta">
                    <Avatar name={ex} />
                    <span className="truncate">{ex}</span>
                  </span>
                ))}
                {matchCount.groups > matchCount.examples.length && (
                  <span className="rounded-control bg-chip px-2 py-1 type-meta
                    text-muted">
                    {t("rule.pv_more",
                      { n: matchCount.groups - matchCount.examples.length })}
                  </span>
                )}
              </div>
            )}
          </> : (
            <div className="mt-1 type-meta text-muted">
              {t("rule.match_unknown")}
            </div>
          )}
        </div>}

        {!editId && (
          <div>
            <div className="type-body font-medium">{t("rule.start_report")}</div>
            <div className="type-meta text-muted">
              {t("rule.start_report_sub")}
            </div>
          </div>
        )}
        {rules.find((r) => r.id === editId)?.mode === "execute" && (
          <div className="type-meta text-muted">
            {t(purge ? "rule.purge_edit_reset" : "rule.edit_reset")}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={save}>
            {editId ? t("Save") : t("rule.create")}
          </Button>
          <Button variant="secondary" onClick={closeEditor}>{t("Cancel")}</Button>
          {msg && <span role="alert" className="type-meta text-muted">{msg}</span>}
        </div>
      </div>
    </div>
  );

  return (
    <Modal onClose={onClose}>
      <PanelHeader title={<span className="inline-flex items-center gap-2">
        <ClipboardList size={18} /> {t("Rules")}
      </span>} onClose={onClose}
        sub={rules.length ? t("rules.sub", { n: rules.length }) : undefined}
        actions={<Button size="sm" onClick={openNew}>
          <Plus size={16} aria-hidden className="mr-1 inline align-text-bottom" />
          {t("rule.new_btn")}
        </Button>} />
      <div className="lg:flex lg:items-start">
        <div className="min-w-0 flex-1 space-y-4 p-4 sm:p-5">
          <p className="flex items-start gap-2 type-meta text-muted">
            <Info size={16} aria-hidden className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1">{t("rules.help")}</span>
            <a href={RULES_DOCS_URL} target="_blank" rel="noopener noreferrer"
              className={`shrink-0 whitespace-nowrap ${LINK_ACCENT}`}>
              {t("rules.how")}</a>
          </p>
          {rules.map((rule) => (
            <RuleCard key={rule.id} rule={rule} busy={busyId === rule.id}
              error={cardErr?.id === rule.id ? cardErr.text : undefined}
              onRun={() => run(rule)} onEdit={() => edit(rule)}
              onReport={() => setReportId(rule.id)}
              onMode={(m) => toggleMode(rule, m)} onDelete={() => del(rule)} />
          ))}
          {!rules.length && <EmptyState>{t("rules.empty")}</EmptyState>}
        </div>
        {/* >= 1024 (the page): the builder is a side panel next to the
            list; otherwise a full-screen sheet over it. */}
        {editing && onPage && (
          <aside aria-label={editId ? t("rule.edit_title") : t("rule.new_title")}
            className="w-104 shrink-0 border-l border-line xl:w-120">{editor}</aside>
        )}
      </div>
      {rules.some((r) => r.id === reportId && r.last_run) && (
        <ReportSheet rule={rules.find((r) => r.id === reportId)!}
          onClose={() => setReportId(null)} />
      )}
      {editing && !onPage && (
        <Modal full onClose={closeEditor}
          label={editId ? t("rule.edit_title") : t("rule.new_title")}>
          {editor}
        </Modal>
      )}
    </Modal>
  );
}

/** A big number with its (singular / plural) caption. */
function PreviewStat({ n, k }: { n: number; k: string }) {
  return (
    <div>
      <div className="type-title2">{fmtNum(n)}</div>
      <div className="type-meta text-muted">{t(k, { n })}</div>
    </div>
  );
}

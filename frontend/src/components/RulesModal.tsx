import { Archive, BellOff, Bot, CalendarClock, Check, ClipboardList, FileText,
  FolderInput,
  Info, MailOpen, MoreHorizontal, Pencil, Pin, Play, Plus, RefreshCw, Shield,
  ShieldCheck, Trash2, TriangleAlert, WandSparkles, X } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api, errorText } from "../api";
import { fmtNum } from "../numfmt";
import { getLang, t } from "../i18n";
import { fmtTs, matchGroup, parseFilter } from "../lib";
import { habitAsRule } from "../habits";
import { isProposal } from "../proposals";
import type { AppState, CheckupFinding, Grouping, Habit, KeepSafeClass, Rule,
  RuleRun, RuleScope } from "../types";
import { KIND_IDS, kindLabel, kindOnly } from "../kinds";
import { type Recipe, recipeBody, recipeFolder,
  recipeFolderName } from "../recipes";
import { AiFilterPanel } from "./AiFilterPanel";
import { HabitSection } from "./HabitCards";
import { CheckupBadges, type CheckupHost, CheckupSheet, CheckupWhatSheet,
  CompareSheet, RuleCheckupCard, useRuleCheckup } from "./RuleCheckup";
import { QueryBuilder } from "./QueryBuilder";
import { NewRuleModes, type NewRuleMode, RecipeDialog, type RuleAi,
  RecipeStarters } from "./RecipePicker";
import { Avatar, Button, checkDialog, confirmDialog, EmptyState, Input,
  LINK_ACCENT, Menu, MenuItem, Modal, Notice, PanelHeader, PopupSelect, Segmented,
  SettingsGroup, SettingsRow, Spinner, Tag, useIsPage, useMediaQuery,
  useOptionalToast } from "./ui";

/** The rules section of the docs (cap, report mode, protected senders). */
const RULES_DOCS_URL = "https://inboxrake.com/docs/features/#rules-and-scheduler";

const EMPTY = {
  name: "", scope: "mail" as RuleScope, grouping: "sender" as Grouping,
  query: "", action: "trash",
  dest: "", schedule: "manual" as Rule["schedule"],
  retention: "none" as "none" | "keep_latest" | "older_than_days" | "only_kind",
  retentionN: "",
  /** The kind of "only <kind>" (the third retention choice). */
  onlyKind: "ads",
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

/** Mails a run left alone because they look worth keeping (Keep-safe). */
const keptSafeTotal = (r: RuleRun) =>
  Object.values(r.kept_safe ?? {}).reduce((a, n) => a + (n ?? 0), 0);
/** ... and which kinds ("invoices, bookings"), largest first. */
const keptSafeWhat = (r: RuleRun) => (Object.entries(r.kept_safe ?? {}) as
  [KeepSafeClass, number][]).filter(([, n]) => n > 0)
  .sort((a, b) => b[1] - a[1])
  .map(([c]) => t(`keepsafe.short.${c}`)).join(", ");

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
    if (r.read_only)
      facts.push(<Fragment key="ro">{t("rule.run_read_only")}</Fragment>);
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
    if (keptSafeTotal(r) > 0)
      facts.push(<span key="kept" className="inline-flex items-center gap-1
        text-safe-fg">
        <ShieldCheck size={14} aria-hidden />
        {t("keepsafe.rule_kept", { n: keptSafeTotal(r),
          what: keptSafeWhat(r) })}</span>);
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

/** The actions a proposal can carry (its Approve button says what it does). */
const ACTION_VERB: Record<string, true> = {
  trash: true, archive: true, move: true, mark_read: true };

const ACTION_ICON: Record<string, ReactNode> = {
  trash: <Trash2 size={18} />, purge: <Trash2 size={18} />,
  archive: <Archive size={18} />, move: <FolderInput size={18} />,
  mark_read: <MailOpen size={18} />, archive_read: <BellOff size={18} />,
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
        {!r.error && keptSafeTotal(r) > 0 && (
          // the board's report card: moved / skipped / kept safe, side by side
          <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-card bg-panel2
            px-3 py-2.5">
            <div>
              <b className="type-title2 tabular-nums">{fmtNum(
                r.mode === "execute" ? r.acted : r.mails)}</b>
              <div className="type-meta text-muted">{t(r.mode === "execute"
                ? "rule.stat_moved" : "rule.stat_would")}</div>
            </div>
            <div>
              <b className="type-title2 tabular-nums">{fmtNum(
                r.skipped_pinned)}</b>
              <div className="type-meta text-muted">
                {t("rule.stat_skipped")}</div>
            </div>
            <div>
              <b className="type-title2 tabular-nums text-safe-fg">
                {fmtNum(keptSafeTotal(r))}</b>
              <div className="type-meta text-muted">{t("rule.stat_kept",
                { what: keptSafeWhat(r) })}</div>
            </div>
          </div>
        )}
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
    // 7rem: the longest label ("Gruppen nach", "anwenden auf") on one line
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-x-3">
      <span className="py-1.5 type-body text-muted">{label}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** A rule read as a sentence: "When a Sender group matches ... then ...".
 *  `badges`: the Rule checkup's small badges, at the end. */
function RuleSentence({ rule, badges }: { rule: Rule; badges?: ReactNode }) {
  const purge = isPurge(rule.scope);
  const danger = purge || rule.action === "trash";
  return (
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
              : rule.only_kind
                ? <>{t("rule.ret_pre")}<Part>{kindOnly(rule.only_kind)}</Part></>
                : null,
          // the dot travels with the schedule: it never ends a line
          schedule: <span className="whitespace-nowrap">
            <span aria-hidden>{"·\u00a0"}</span>
            <Part><CalendarClock size={14} aria-hidden
              className="mr-1 inline align-text-bottom" />
              {t(`sched.${rule.schedule}`)}</Part></span>,
        }} />
      {badges}
    </p>
  );
}

/** "Claude Code · proposed today, 10:42" - who proposed a rule and when. */
const proposedLine = (rule: Rule): string => rule.proposed_by
  ? t("proposal.by", { name: rule.proposed_by.name,
    when: fmtTs(rule.proposed_by.at, getLang()) }) : "";

/** The proposed rule's report, inline: the four numbers and the top senders
 *  (the last run of a report-mode rule; nothing has moved). */
function ProposalReport({ rule }: { rule: Rule }) {
  const r = rule.last_run;
  if (!r || r.pending) return (
    <p className="mt-3 type-meta text-muted">{t("proposal.no_report")}</p>);
  if (r.error) return (
    <p role="alert" className="mt-3 type-meta text-danger-fg">
      {t("proposal.report_failed")} {errorText(r.error)}</p>);
  const stat = (n: number, caption: string) => (
    <div key={caption}>
      <div className="type-title2 tabular-nums">{fmtNum(n)}</div>
      <div className="type-meta text-muted">{caption}</div>
    </div>
  );
  const unit = rule.grouping === "domain" ? "domains" : "senders";
  return (
    <div className="mt-3 rounded-card bg-panel p-3">
      <div className="type-meta text-muted">
        <span className="font-medium text-body">{t("proposal.report")}</span>
        {" "}{t("proposal.report_sub", { date: fmtTs(r.ts, getLang()) })}
      </div>
      {/* four columns on a phone (captions wrap), a row with room from sm up */}
      <div className="mt-2 grid grid-cols-4 gap-x-3 sm:flex sm:flex-wrap
        sm:gap-x-8 sm:gap-y-2">
        {stat(r.mails, t("proposal.c_mails", { n: r.mails }))}
        {stat(r.groups, t(`proposal.c_${unit}`, { n: r.groups }))}
        {stat(r.skipped_protected, t("proposal.c_protected"))}
        {stat(r.skipped_pinned, t("proposal.c_pinned"))}
      </div>
      {r.preview.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {r.preview.slice(0, 3).map((p) => (
            <span key={p.key} className="inline-flex max-w-full items-center
              gap-1.5 rounded-control bg-chip px-2 py-1 type-meta">
              <Avatar name={p.label} />
              <span className="truncate">{p.label} · {fmtNum(p.count)}</span>
            </span>
          ))}
          {r.groups > Math.min(3, r.preview.length) && (
            <span className="rounded-control bg-chip px-2 py-1 type-meta
              text-muted">
              {t("proposal.more", { n: r.groups - Math.min(3, r.preview.length) })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** A rule an AI assistant proposed, waiting for the user: accent outline,
 *  who proposed it, its report inline and Approve… / Report again / Edit /
 *  Decline. Nothing is moved until the user approves. */
function ProposalCard({ rule, busy, error, badges, onApprove, onAgain, onEdit,
  onDecline }: {
  rule: Rule; busy: boolean; error?: string; badges?: ReactNode;
  onApprove: () => void; onAgain: () => void; onEdit: () => void;
  onDecline: () => void;
}) {
  const phone = useMediaQuery("(max-width: 639px)");
  const r = rule.last_run;
  // the server's gate: no approval without a report of the current definition
  const ready = rule.report_runs >= 1 && !!r && !r.error && !r.pending
    && !rule.filter_invalid?.length;
  const danger = rule.action === "trash";
  return (
    <section aria-label={t("proposal.tag")} data-proposal={rule.id}
      className="rounded-card border border-accent bg-panel2 p-3
        sm:p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span aria-hidden className={`flex size-10 shrink-0 items-center
          justify-center rounded-control ${danger
          ? "bg-review-bg text-review-fg" : "bg-chip text-chiptext"}`}>
          {ACTION_ICON[rule.action] ?? <ClipboardList size={18} />}
        </span>
        <div className="min-w-0 flex-1 basis-40">
          <div className="type-body font-medium">{rule.name}</div>
          <div className="flex items-center gap-1 type-meta text-muted">
            <Bot size={14} aria-hidden className="shrink-0 text-info-fg" />
            <span className="min-w-0 break-words">{proposedLine(rule)}</span>
          </div>
        </div>
        <Tag tone="accent" className="inline-flex items-center gap-1">
          <WandSparkles size={14} aria-hidden />{t("proposal.tag")}
        </Tag>
      </div>
      <RuleSentence rule={rule} badges={badges} />
      <ProposalReport rule={rule} />
      {error && (
        <div role="alert" className="mt-2 type-meta text-danger-fg">{error}</div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onApprove} disabled={busy || !ready}>
          {busy ? <Spinner /> : <>
            <Check size={14} aria-hidden
              className="mr-1 inline align-text-bottom" />
            {t("proposal.approve")}</>}
        </Button>
        {phone ? (
          // phones: Approve… and Decline side by side as on the board; the
          // two quieter actions stay one tap away in the menu
          <Menu variant="quiet" icon label={t("rule.more", { name: rule.name })}
            trigger={<MoreHorizontal size={18} aria-hidden />}>
            <MenuItem onClick={onAgain}>{t("proposal.again")}</MenuItem>
            <MenuItem onClick={onEdit}>{t("Edit")}</MenuItem>
          </Menu>
        ) : <>
          <Button variant="secondary" size="sm" onClick={onAgain} disabled={busy}>
            <RefreshCw size={14} aria-hidden
              className="mr-1 inline align-text-bottom" />
            {t("proposal.again")}
          </Button>
          <Button variant="secondary" size="sm" onClick={onEdit} disabled={busy}>
            <Pencil size={14} aria-hidden
              className="mr-1 inline align-text-bottom" />
            {t("Edit")}
          </Button>
        </>}
        <Button variant="danger-quiet" size="sm" className="ml-auto"
          onClick={onDecline} disabled={busy}>{t("proposal.decline")}</Button>
      </div>
    </section>
  );
}

/** One rule as a card: icon, name + last run, the report / active switch,
 *  the rule read as a sentence, and its actions. */
function RuleCard({ rule, busy, error, fresh, badges, onRun, onEdit, onReport,
  onMode, onDelete, onUnmute }: {
  rule: Rule; busy: boolean; error?: string;
  /** A mute's card has an Unmute button (it deletes the rule, after a
   *  confirm). */
  onUnmute?: () => void;
  /** The Rule checkup's badges for this rule. */
  badges?: ReactNode;
  /** Just added from a recipe: line 2 says so and the report shows inline. */
  fresh?: boolean;
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
          {rule.proposed_by && (
            <div className="flex items-center gap-1 type-meta text-muted">
              <Bot size={14} aria-hidden className="shrink-0 text-info-fg" />
              <span className="min-w-0 break-words">{proposedLine(rule)}</span>
            </div>
          )}
          <div className="type-meta text-muted">
            {fresh ? t(rule.last_run && !rule.last_run.pending
              && !rule.last_run.error ? "recipe.added_ready"
              : "recipe.added") : <RunSummary rule={rule} />}
          </div>
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
      <RuleSentence rule={rule} badges={badges} />
      {fresh && <ProposalReport rule={rule} />}
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
        {onUnmute && (
          <Button variant="secondary" size="sm" className="ml-auto"
            onClick={onUnmute}>{t("mute.unmute")}</Button>
        )}
        <Menu variant="quiet" icon label={t("rule.more", { name: rule.name })}
          className={onUnmute ? "" : "ml-auto"}
          trigger={<MoreHorizontal size={18} aria-hidden />}>
          <MenuItem danger onClick={onDelete}>{t("Delete")}</MenuItem>
        </Menu>
      </div>
    </div>
  );
}

export function RulesModal({ state, onClose, onChanged, initialQuery = "",
  initialRecipe, initialEditId, ai, onShowSenders, onShowMails, habits = [],
  habitFocus, onHabitsChanged }: {
  state: AppState;
  /** "You keep doing this": the suggestions of this account (backend/
   *  habits.py), their card sits after the Rule checkup and before the
   *  rules; `habitFocus` = the one to bring into view ("Automate…", the
   *  Overview line); `onHabitsChanged` after Make it a rule / Not this one. */
  habits?: Habit[];
  habitFocus?: string;
  onHabitsChanged?: (h?: Habit) => void;
  /** The Rule checkup's "Show the N senders" / "Show the N mails": the page
   *  that lists them, narrowed to those (the sender addresses / the finding's
   *  id). */
  onShowSenders?: (keys: string[]) => void;
  onShowMails?: (findingId: string, n: number) => void;
  /** Describe it… (AI is on: enabled; the demo: disabled with its hint);
   *  absent when there is no AI provider. */
  ai?: RuleAi;
  onClose: () => void;
  onChanged: () => void;
  /** Starts the new-rule form with this filter (e.g. one the AI wrote). */
  initialQuery?: string;
  /** Opens New rule > From a recipe with this recipe marked. */
  initialRecipe?: string;
  /** Opens this rule's editor straight away (the Weekly check-in's Edit… on a
   *  Rule checkup finding). */
  initialEditId?: string;
}) {
  const [form, setForm] = useState({ ...EMPTY, query: initialQuery });
  const [editId, setEditId] = useState<string | null>(null);
  // The side panel / sheet with the sentence builder. A filter handed in
  // (e.g. one the AI wrote) opens it straight away.
  const [reportId, setReportId] = useState<string | null>(null);
  const [editing, setEditing] = useState(!!initialQuery);
  // New rule starts in the recipe view; Blank is today's editor, Describe it…
  // the plain-words filter writer.
  const [creating, setCreating] = useState<"recipe" | "describe" | null>(
    initialRecipe ? "recipe" : null);
  // the recipe marked in the dialog it opened with; gone once that is closed
  const [mark, setMark] = useState(initialRecipe);
  // rules added from a recipe in this session (their card says so)
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [starterBusy, setStarterBusy] = useState("");
  // the blank editor was reached from a recipe (the folder fallback)
  const [fromRecipe, setFromRecipe] = useState(false);
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
  const toast = useOptionalToast();
  // Proposals first (oldest first: the one that has waited longest), then the
  // rest in the server's order.
  const rules = useMemo(() => {
    const all = state.rules ?? [];
    return [...all.filter(isProposal).sort((a, b) =>
      (a.proposed_by?.at ?? 0) - (b.proposed_by?.at ?? 0)),
    ...all.filter((r) => !isProposal(r))];
  }, [state.rules]);
  const waiting = rules.filter(isProposal).length;

  // The Rule checkup: findings about the rules together (read-only; every fix
  // is one of the buttons below, which use the editor / confirms of this page).
  const checkup = useRuleCheckup(state);
  const [sheet, setSheet] = useState<{ only?: string } | null>(null);
  const [compare, setCompare] = useState<CheckupFinding | null>(null);
  const [what, setWhat] = useState(false);

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
  // A mute keeps its conversation: the editor shows the rest as it is and lets
  // the name and the schedule change (the server refuses anything else).
  const muteEdit = rules.find((r) => r.id === editId)?.origin === "mute";
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
    setFromRecipe(false);
    // the side panel unmounts with its focus: give it back to the opener
    const back = opener.current as HTMLElement | null;
    if (onPage && back?.isConnected) back.focus();
  };
  const openNew = () => {
    opener.current = document.activeElement;
    setEditId(null); setForm({ ...EMPTY }); setMsg(""); setFromRecipe(false);
    setEditing(false); setCreating("recipe");
  };
  const newMode = (m: NewRuleMode) => {
    setMsg(""); setFromRecipe(false);
    if (m === "blank") {
      setCreating(null);
      if (!editing) { setEditId(null); setForm({ ...EMPTY }); setEditing(true); }
    } else {
      setEditing(false); setEditId(null); setCreating(m);
    }
  };

  /** Add a recipe: an ordinary rule, exactly what the editor's Create would
   *  send (the server starts it in report mode), then its report run once.
   *  Returns the refusal text, or nothing. */
  const addRecipe = async (r: Recipe): Promise<string | void> => {
    const dest = recipeFolder(r, state.folders, state.folders_raw);
    if (r.action === "move" && !dest) {
      // no such folder, and no folder creation path: pick it in the editor
      setCreating(null); setEditId(null);
      setForm({ ...EMPTY, name: t(`recipe.${r.id}.title`), query: r.query,
        action: r.action, schedule: r.schedule });
      setMsg(t("recipe.pick_folder", { folder: recipeFolderName(r) }));
      setFromRecipe(true);
      setEditing(true);
      return;
    }
    let rule: Rule;
    try {
      rule = await api.createRule(recipeBody(r, dest));
    } catch (e: any) {
      return t("err.generic", { msg: e.message ?? e });
    }
    setFresh((s) => new Set(s).add(rule.id));
    setCreating(null);
    try {
      await api.runRule(rule.id);
    } catch (e: any) {
      setCardErr({ id: rule.id,
        text: t("err.generic", { msg: e.message ?? e }) });
    }
    onChanged();
  };
  const addStarter = async (r: Recipe) => {
    setStarterBusy(r.id);
    const text = await addRecipe(r);
    setStarterBusy("");
    if (text) toast?.show(text);
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
    const { retention, retentionN, onlyKind, ...rest } = form;
    const n = Number(retentionN);
    if (purge && !(Number.isInteger(n) && n >= 1 && n <= 36500)) {
      setMsg(t("fp.older_invalid"));
      return;
    }
    const body = {
      ...rest,
      keep_latest: retention === "keep_latest" && n > 0 ? n : null,
      older_than_days: retention === "older_than_days" && n > 0 ? n : null,
      only_kind: retention === "only_kind" ? onlyKind : null,
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

  /** Unmute: deletes the mute's rule after a confirm (what it archived stays
   *  in Archive). */
  const unmute = async (rule: Rule) => {
    if (!await confirmDialog({
      title: t("mute.unmute_title_rule"),
      body: t("mute.unmute_body"), confirmLabel: t("mute.unmute") })) return;
    try {
      await api.deleteRule(rule.id);
      if (editId === rule.id) closeEditor();
      toast?.show(t("toast.unmuted_rule"), { variant: "success" });
      onChanged();
    } catch (e: any) {
      setCardErr({ id: rule.id, text: t("err.generic", { msg: e.message ?? e }) });
    }
  };

  /** Approve a proposal: the destructive-action confirm (what moves, what is
   *  skipped, how it runs; "Run it once now"), then the ordinary report ->
   *  Active switch (the server's gate is unchanged) and, if asked, a run. */
  const approve = async (rule: Rule) => {
    setCardErr(null);
    const r = rule.last_run;
    if (!r) return;
    // a run is capped: what the first run will really act on
    const will = Math.max(0, r.mails - r.capped);
    const bullets: ReactNode[] = [t(`proposal.b_${rule.action}`, {
      mails: t("n.mails", { n: will }),
      groups: t(rule.grouping === "domain" ? "n.domains" : "n.senders",
        { n: r.groups }),
      folder: rule.dest })];
    if (r.capped > 0) {
      const cap = await getCap().catch(() => 500);
      bullets.push(t("proposal.b_capped", { cap }));
    }
    if (r.skipped_protected > 0)
      bullets.push(t("proposal.b_prot", { n: r.skipped_protected }));
    if (r.skipped_pinned > 0)
      bullets.push(t("proposal.b_pin", { n: r.skipped_pinned }));
    bullets.push(t(`proposal.b_runs_${rule.schedule}`));
    const label = will > 0 && rule.action in ACTION_VERB
      ? t(`proposal.ok_${rule.action}`, { n: will, folder: rule.dest })
      : t("proposal.ok_only");
    const { ok, checked } = await checkDialog({
      title: t("proposal.approve_title", { name: rule.name }),
      tone: rule.action === "mark_read" ? "primary" : "danger",
      body: <>
        <p>{t("proposal.approve_body", { by: rule.proposed_by?.name ?? "" })}</p>
        <p className="mt-2">{t("proposal.numbers",
          { date: fmtTs(r.ts, getLang()) })}</p>
      </>,
      bullets, confirmLabel: label,
      check: { label: t("proposal.run_once"),
        checked: rule.schedule === "manual",
        uncheckedLabel: t("proposal.ok_only") } });
    if (!ok) return;
    setBusyId(rule.id);
    try {
      await api.updateRule(rule.id, { mode: "execute" });
    } catch (e: any) {
      setCardErr({ id: rule.id, text: t("err.generic", { msg: e.message ?? e }) });
      setBusyId("");
      return;
    }
    let ran = false;
    if (checked) {
      try {
        await api.runRule(rule.id);
        ran = true;
      } catch (e: any) {
        setCardErr({ id: rule.id,
          text: t("err.generic", { msg: e.message ?? e }) });
      }
    }
    toast?.show(t(ran ? "proposal.approved_run" : "proposal.approved",
      { name: rule.name }), { variant: "success" });
    setBusyId("");
    onChanged();
  };

  const reportAgain = async (rule: Rule) => {
    setCardErr(null);
    setBusyId(rule.id);
    try {
      await api.runRule(rule.id);
      onChanged();
    } catch (e: any) {
      setCardErr({ id: rule.id, text: t("err.generic", { msg: e.message ?? e }) });
    }
    setBusyId("");
  };

  const decline = async (rule: Rule) => {
    if (!await confirmDialog({
      title: t("proposal.decline_title"), body: t("proposal.decline_body"),
      confirmLabel: t("proposal.decline"), tone: "danger" })) return;
    try {
      await api.deleteRule(rule.id);
      if (editId === rule.id) closeEditor();
      toast?.show(t("proposal.declined", { name: rule.name }));
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
        : rule.older_than_days != null ? "older_than_days"
        : rule.only_kind ? "only_kind" : "none",
      retentionN: String(rule.keep_latest ?? rule.older_than_days ?? ""),
      onlyKind: rule.only_kind || EMPTY.onlyKind });
    setEditing(true);
  };

  // The Weekly check-in's Edit… on a finding: that rule's editor, once
  useEffect(() => {
    const rule = initialEditId ? rules.find((r) => r.id === initialEditId)
      : undefined;
    if (rule) edit(rule);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // What the checkup's buttons do: the sheets close, then the page's own
  // editor / confirm / list takes over.
  const checkupHost: CheckupHost = {
    rules,
    onEdit: (rule) => { setSheet(null); setCompare(null); edit(rule); },
    onDelete: (rule) => { void del(rule); },
    onCompare: setCompare,
    onShowSenders: onShowSenders && ((f) => {
      const keys = f.addrs ?? f.senders?.map((s) => s.addr) ?? [];
      if (keys.length) onShowSenders(keys);
    }),
    onShowMails: onShowMails && ((f) => onShowMails(f.id, f.n ?? 0)),
    onIgnore: (f, ignored) => {
      api.ignoreFinding(f.id, ignored).then(checkup.reload)
        .catch((e: any) => toast?.show(t("err.generic",
          { msg: e.message ?? e })));
    },
  };
  const badgesOf = (id: string) => <CheckupBadges checkup={checkup.data}
    ruleId={id} onOpen={(rid) => setSheet({ only: rid })} />;

  // Phones get a grouped form; tablets keep the label column (the filter
  // builder opens as a popover there, which a grouped list would clip).
  const phone = useMediaQuery("(max-width: 639px)");
  const grouped = !onPage && phone;
  // The recipe dialog that led here hands focus back to its opener as it
  // closes (after the autoFocus below): the editor takes it again.
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing && onPage && creating === null) nameRef.current?.focus();
  }, [editing, onPage, creating]);
  const nameInput = <Input ref={nameRef} className="w-full"
    placeholder={t("rule.name")}
    aria-label={t("rule.f_name")} autoFocus={onPage}
    value={form.name} onChange={set("name")} />;
  const groupingCtl = muteEdit ? <Part>{t(GROUPING_KEY.thread)}</Part>
    : purge
    ? <Part>{t("Sender")}</Part>
    : <PopupSelect value={form.grouping} onChange={pick("grouping")}
        name={t("rule.f_grouping")} options={(
          ["sender", "domain", "subject", "thread"] as Grouping[])
          .map((g) => ({ value: g, label: t(GROUPING_KEY[g]) }))} />;
  const scopeCtl = muteEdit ? <Part>{t("rule.scope_mail")}</Part>
    : <PopupSelect value={form.scope} onChange={setScope}
    name={t("rule.f_scope")} options={[
      { value: "mail", label: t("rule.scope_mail") },
      { value: "junk", label: t("rule.scope_junk") },
      { value: "trash", label: t("rule.scope_trash") }]} />;
  // The builder stays outside the label: its popover holds controls of its own.
  const filterCtl = muteEdit ? (
    <code className="inline-block max-w-full break-words rounded-control
      bg-chip px-2 py-1 type-meta text-chiptext">{form.query}</code>
  ) : <>
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
  const actionCtl = muteEdit
    ? <PopupSelect value="archive_read" onChange={() => {}} disabled
        name={t("rule.f_action")}
        options={[{ value: "archive_read",
          label: t("rule.act_archive_read") }]} />
    : purge
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
  const applyCtl = muteEdit
    ? <span className="type-body text-muted">{t("rule.ed_mute")}</span>
    : purge
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
            { value: "older_than_days", label: t("rule.apply_older") },
            { value: "only_kind", label: t("rule.apply_kind") }]} />
        {form.retention === "only_kind" ? (
          <PopupSelect value={form.onlyKind} onChange={pick("onlyKind")}
            name={t("rule.f_kind")}
            options={KIND_IDS.map((k) => ({ value: k, label: kindLabel(k) }))} />
        ) : form.retention !== "none" && (
          <Input className="w-24" type="number" min={1}
            aria-label={t("rule.f_retention_n")}
            placeholder={t("retention.n_placeholder")}
            value={form.retentionN} onChange={set("retentionN")} />
        )}
      </>;
  const scheduleCtl = <PopupSelect value={form.schedule} onChange={pick("schedule")}
    name={t("rule.f_schedule")} options={muteEdit ? [
      { value: "manual", label: t("sched.manual") },
      { value: "scan", label: t("sched.scan") }] : [
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
        {!editId && <NewRuleModes value={fromRecipe ? "recipe" : "blank"}
          onChange={newMode} short ai={ai} />}
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
            <SettingsRow label={t("rule.row_grouped")}>{groupingCtl}</SettingsRow>
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

        {muteEdit && (
          <div className="type-meta text-muted">{t("rule.ed_mute_note")}</div>
        )}
        {!purge && !muteEdit && <div className="rounded-card bg-panel2 p-3"
          aria-live="polite">
          <div className="type-body font-medium">{t("rule.preview")}</div>
          {form.retention === "only_kind" && (
            <p data-testid="kind-preview-hint"
              className="mt-0.5 type-meta text-muted">{t("rule.kind_hint")}</p>
          )}
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
        {!muteEdit && rules.find((r) => r.id === editId)?.mode === "execute" && (
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
    <Modal onClose={onClose} full>
      <PanelHeader title={<span className="inline-flex items-center gap-2">
        <ClipboardList size={18} /> {t("Rules")}
      </span>} onClose={onClose}
        sub={waiting
          ? `${t("n.rules", { n: rules.length })} · ${t("rules.waiting", { n: waiting })}`
          : rules.length ? t("rules.sub", { n: rules.length }) : undefined}
        actions={<Button size="sm" onClick={openNew}>
          <Plus size={16} aria-hidden className="mr-1 inline align-text-bottom" />
          {t("rule.new_btn")}
        </Button>} />
      <div className="lg:flex lg:items-start">
        <div className="min-w-0 flex-1 space-y-4 p-4 sm:p-5">
          {/* phones: the docs link sits under the text, so the text keeps
              the full width */}
          <p className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2 gap-y-1
            type-meta text-muted sm:flex sm:items-start">
            <Info size={16} aria-hidden className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1">{t("rules.help")}</span>
            <a href={RULES_DOCS_URL} target="_blank" rel="noopener noreferrer"
              className={`col-start-2 shrink-0 whitespace-nowrap ${LINK_ACCENT}`}>
              {t("rules.how")}</a>
          </p>
          {rules.filter(isProposal).map((rule) => (
            <ProposalCard key={rule.id} rule={rule} busy={busyId === rule.id}
              error={cardErr?.id === rule.id ? cardErr.text : undefined}
              badges={badgesOf(rule.id)}
              onApprove={() => approve(rule)} onAgain={() => reportAgain(rule)}
              onEdit={() => edit(rule)} onDecline={() => decline(rule)} />
          ))}
          <RuleCheckupCard checkup={checkup.data} host={checkupHost}
            phone={phone} onOpen={() => setSheet({})}
            onWhat={() => setWhat(true)} />
          <HabitSection habits={habits} phone={phone} focusId={habitFocus}
            renderSentence={(h) => <RuleSentence rule={habitAsRule(h)} />}
            onChanged={(h) => { onHabitsChanged?.(h); onChanged(); }} />
          {rules.filter((r) => !isProposal(r)).map((rule) => (
            <RuleCard key={rule.id} rule={rule} busy={busyId === rule.id}
              error={cardErr?.id === rule.id ? cardErr.text : undefined}
              fresh={fresh.has(rule.id)} badges={badgesOf(rule.id)}
              onRun={() => run(rule)} onEdit={() => edit(rule)}
              onReport={() => setReportId(rule.id)}
              onMode={(m) => toggleMode(rule, m)} onDelete={() => del(rule)}
              onUnmute={rule.origin === "mute" ? () => unmute(rule) : undefined} />
          ))}
          {!rules.length && (
            <RecipeStarters state={state} busy={starterBusy}
              onAdd={addStarter} onAll={() => setCreating("recipe")} />)}
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
      {sheet && checkup.data && (
        <CheckupSheet checkup={checkup.data} host={checkupHost}
          only={sheet.only} onClose={() => setSheet(null)} />
      )}
      {compare && (
        <CompareSheet f={compare} host={checkupHost}
          onClose={() => setCompare(null)} />
      )}
      {what && <CheckupWhatSheet onClose={() => setWhat(false)} />}
      {creating === "recipe" && (
        <RecipeDialog state={state} ai={ai} highlight={mark}
          onClose={() => { setMark(undefined); setCreating(null); }}
          onMode={newMode} onAdd={addRecipe} />
      )}
      {creating === "describe" && (
        <AiFilterPanel ruleOnly
          groups={Object.values(state.groups?.sender ?? {})}
          onClose={() => setCreating(null)}
          onApply={() => {}} onSavePreset={() => {}}
          onSaveRule={(q) => {
            setCreating(null); setEditId(null);
            setForm({ ...EMPTY, query: q }); setEditing(true);
          }} />
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

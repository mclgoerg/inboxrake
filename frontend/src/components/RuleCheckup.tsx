import { ChevronRight, FolderX, GitMerge, History, Info, Moon, Shield,
  Split, Stethoscope } from "lucide-react";
import { Fragment, type ReactNode, useCallback, useEffect, useMemo,
  useState } from "react";
import { api } from "../api";
import { fmtAgo, fmtTs } from "../lib";
import { getLang, t } from "../i18n";
import type { AppState, CheckupFinding, CheckupKind, Rule, RuleCheckup }
  from "../types";
import { Avatar, Button, LINK_ACCENT, Modal, Notice, PanelHeader, Tag,
  type TagTone } from "./ui";

/** The checks, in the order they are listed. */
export const CHECK_KINDS: CheckupKind[] = ["conflict", "overlap",
  "dest_missing", "only_protected", "never_matches", "stale_report"];

const KIND_ICON: Record<CheckupKind, ReactNode> = {
  conflict: <Split size={18} aria-hidden />,
  overlap: <GitMerge size={18} aria-hidden />,
  dest_missing: <FolderX size={18} aria-hidden />,
  only_protected: <Shield size={18} aria-hidden />,
  never_matches: <Moon size={18} aria-hidden />,
  stale_report: <History size={18} aria-hidden />,
};

const BADGE_ICON: Record<CheckupKind, ReactNode> = {
  conflict: <Split size={14} />, overlap: <GitMerge size={14} />,
  dest_missing: <FolderX size={14} />, only_protected: <Shield size={14} />,
  never_matches: <Moon size={14} />, stale_report: <History size={14} />,
};

/** Tile + kind word colours: orange for what clashes, red for what is broken,
 *  gray for what is only idle. */
const KIND_TILE: Record<CheckupKind, string> = {
  conflict: "bg-keep-bg text-keep-fg",
  overlap: "bg-review-bg text-review-fg",
  dest_missing: "bg-keep-bg text-keep-fg",
  only_protected: "bg-chip text-muted",
  never_matches: "bg-chip text-muted",
  stale_report: "bg-chip text-muted",
};
const KIND_WORD: Record<CheckupKind, string> = {
  conflict: "text-keep-fg", overlap: "text-review-fg",
  dest_missing: "text-keep-fg", only_protected: "text-muted",
  never_matches: "text-muted", stale_report: "text-muted",
};
const BADGE_TONE: Record<CheckupKind, TagTone> = {
  conflict: "keep", overlap: "review", dest_missing: "keep",
  only_protected: "neutral", never_matches: "neutral", stale_report: "neutral",
};

/** The checkup of the shown account (GET /api/rules/checkup): fetched when
 *  the rules or the scan change - the server looks locally, nothing leaves it.
 *  A failed fetch shows nothing (the rest of the page does not depend on it). */
export function useRuleCheckup(state: AppState): {
  data: RuleCheckup | null; reload: () => void;
} {
  const [data, setData] = useState<RuleCheckup | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  const sig = (state.rules ?? []).map((r) => `${r.id}:${r.mode}:${
    r.edited ?? 0}:${r.last_run?.ts ?? 0}`).join(",");
  useEffect(() => {
    let alive = true;
    // a mail action bumps groups_rev several times in a row: one read after
    // the last of them
    const h = setTimeout(() => {
      api.ruleCheckup().then((r) => { if (alive) setData(r); })
        .catch(() => { /* nothing to show */ });
    }, 250);
    return () => { alive = false; clearTimeout(h); };
  }, [state.account, state.groups_rev, state.scanned_ts, sig, tick]);
  return { data, reload };
}

/** `{name}` slots of a translated template filled with nodes; every language
 *  keeps its own word order. */
function Fill({ template, parts }: {
  template: string; parts: Record<string, ReactNode>;
}) {
  return <>{template.split(/(\{\w+\})/).map((seg, i) => {
    const name = /^\{(\w+)\}$/.exec(seg)?.[1];
    return name === undefined ? seg
      : <Fragment key={i}>{parts[name] ?? ""}</Fragment>;
  })}</>;
}

const bold = (s: string) => <b className="font-semibold">{s}</b>;

// "A, B and C" (no comma before the "and", as the rest of the app writes it)
const names = (list: string[]) => new Intl.ListFormat(
  getLang() === "de" ? "de" : "en-GB",
  { style: "long", type: "conjunction" }).format(list);

/** What a rule does, as its card words it ("move to Trash", "archive"). */
const actLabel = (r: Rule) => t(`rule.act_${r.action}`, { folder: r.dest });

const retLabel = (keep: number | null | undefined,
                  older: number | null | undefined) => keep != null
  ? t("rule.ret_keep", { n: keep }) : t("rule.ret_older", { n: older ?? 0 });

const dateOf = (ts: number | null | undefined) =>
  ts ? fmtTs(ts, getLang(), false) : "";

export interface CheckupHost {
  rules: Rule[];
  onEdit: (rule: Rule) => void;
  onDelete: (rule: Rule) => void;
  onCompare: (f: CheckupFinding) => void;
  /** Absent: the page cannot list them, the button is not offered. */
  onShowSenders?: (f: CheckupFinding) => void;
  onShowMails?: (f: CheckupFinding) => void;
  onIgnore: (f: CheckupFinding, ignored: boolean) => void;
}

/** The finding's sentence: names the rules and the senders and says what
 *  happens today. */
function findingText(f: CheckupFinding, byId: Map<string, Rule>): ReactNode {
  const r = (id: string | undefined) => bold(byId.get(id ?? "")?.name ?? "");
  const first = byId.get(f.rules[0]), second = byId.get(f.rules[1]);
  switch (f.kind) {
    case "conflict":
      return <Fill template={t("checkup.t_conflict")} parts={{
        a: bold(first?.name ?? ""), b: bold(second?.name ?? ""),
        va: first ? actLabel(first) : "", vb: second ? actLabel(second) : "",
        mails: t("n.mails", { n: f.n ?? 0 }) }} />;
    case "overlap": {
      const x = byId.get(f.defeated ?? ""), y = byId.get(f.by ?? "");
      if (f.purge) return <Fill template={t("checkup.t_overlap_purge")}
        parts={{ x: r(f.defeated), y: r(f.by),
          folder: t(f.scope === "junk" ? "Junk" : "Trash"),
          ret: retLabel(null, f.older_than_days),
          retw: retLabel(null, f.winner_days) }} />;
      const rows = (f.senders ?? []).map((s) => s.label);
      const shown = rows.slice(0, 3);
      const rest = (f.senders_total ?? rows.length) - shown.length;
      return <Fill template={t("checkup.t_overlap")} parts={{
        x: r(x?.id), y: r(y?.id),
        senders: names(rest > 0 ? [...shown, t("checkup.more", { n: rest })]
          : shown),
        ret: retLabel(f.keep_latest, f.older_than_days) }} />;
    }
    case "dest_missing": {
      const rule = byId.get(f.rules[0]);
      const key = rule?.mode !== "execute" ? "checkup.t_dest_report"
        : f.due ? "checkup.t_dest_due" : "checkup.t_dest_run";
      return <Fill template={t(key)} parts={{ rule: r(f.rules[0]),
        folder: f.folder ?? "" }} />;
    }
    case "only_protected": {
      const p = f.protected ?? 0, m = f.pinned ?? 0;
      return p && m
        ? <Fill template={t("checkup.t_prot_both")} parts={{
          rule: r(f.rules[0]), p, m }} />
        : <Fill template={t(p ? "checkup.t_prot_senders"
          : "checkup.t_prot_pinned", { n: p || m })}
          parts={{ rule: r(f.rules[0]) }} />;
    }
    case "never_matches":
      return <Fill template={t("checkup.t_never", { n: f.runs ?? 0,
        date: dateOf(f.since) })} parts={{ rule: r(f.rules[0]) }} />;
    case "stale_report":
      return <Fill template={t("checkup.t_stale", { n: f.days ?? 0 })}
        parts={{ rule: r(f.rules[0]) }} />;
  }
}

/** One finding: tile, kind, the sentence and the buttons that fix or
 *  explain it. Nothing here changes a rule by itself. */
function FindingRow({ f, host, byId }: {
  f: CheckupFinding; host: CheckupHost; byId: Map<string, Rule>;
}) {
  const rule = byId.get(f.rules[0]);
  const comparable = f.kind === "overlap" || f.kind === "conflict";
  const senders = f.senders?.length ?? 0;
  return (
    <li data-finding={f.id} data-kind={f.kind}
      className={`flex items-start gap-3 border-t border-line py-3
        first:border-t-0 ${f.ignored ? "opacity-70" : ""}`}>
      <span aria-hidden className={`flex size-10 shrink-0 items-center
        justify-center rounded-control ${KIND_TILE[f.kind]}`}>
        {KIND_ICON[f.kind]}
      </span>
      <div className="min-w-0 flex-1">
        <p className="type-body">
          <b className={`font-semibold ${KIND_WORD[f.kind]}`}>
            {t(`checkup.k_${f.kind}`)}</b>
          {" · "}{findingText(f, byId)}
        </p>
        {f.kind === "dest_missing" && (
          <p className="mt-1 type-meta text-muted">{t("checkup.dest_hint")}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {f.kind === "overlap" && !f.purge && senders > 0
            && host.onShowSenders && (
            <Button variant="secondary" size="sm"
              onClick={() => host.onShowSenders?.(f)}>
              {t("checkup.show_senders", { n: senders })}</Button>
          )}
          {f.kind === "conflict" && (f.n ?? 0) > 0 && host.onShowMails && (
            <Button variant="secondary" size="sm"
              onClick={() => host.onShowMails?.(f)}>
              {t("checkup.show_mails", { n: f.n ?? 0 })}</Button>
          )}
          {comparable && (
            <Button variant="secondary" size="sm"
              onClick={() => host.onCompare(f)}>{t("checkup.compare")}</Button>
          )}
          {!comparable && rule && (
            <Button variant="secondary" size="sm"
              onClick={() => host.onEdit(rule)}>{t("checkup.edit")}</Button>
          )}
          {!comparable && f.kind !== "dest_missing" && rule && (
            <Button variant="secondary" size="sm"
              onClick={() => host.onDelete(rule)}>{t("checkup.delete")}</Button>
          )}
          <Button variant="quiet" size="sm"
            onClick={() => host.onIgnore(f, !f.ignored)}>
            {t(f.ignored ? "checkup.unignore" : "checkup.ignore")}</Button>
        </div>
      </div>
    </li>
  );
}

/** The findings of `checkup` (those that name `only` when given), the ignored
 *  ones behind a "N ignored · Show" toggle, then the checks that found
 *  nothing. */
export function FindingList({ checkup, host, only }: {
  checkup: RuleCheckup; host: CheckupHost; only?: string;
}) {
  const [showIgnored, setShowIgnored] = useState(false);
  const byId = useMemo(() => new Map(host.rules.map((r) => [r.id, r])),
    [host.rules]);
  const mine = checkup.findings.filter((f) => f.rules.every((id) =>
    byId.has(id)) && (!only || f.rules.includes(only)));
  const open = mine.filter((f) => !f.ignored);
  const ignored = mine.filter((f) => f.ignored);
  const clean = CHECK_KINDS.filter((k) => !checkup.findings.some(
    (f) => f.kind === k) && (checkup.analysed || k === "stale_report"));
  return (
    <>
      <ul>
        {open.map((f) => <FindingRow key={f.id} f={f} host={host} byId={byId} />)}
        {showIgnored && ignored.map((f) =>
          <FindingRow key={f.id} f={f} host={host} byId={byId} />)}
      </ul>
      {ignored.length > 0 && (
        <p className="border-t border-line py-2.5 type-meta text-muted">
          {t("checkup.ignored", { n: ignored.length })}{" · "}
          <button type="button" className={`${LINK_ACCENT} coarse:min-h-11`}
            aria-expanded={showIgnored}
            onClick={() => setShowIgnored(!showIgnored)}>
            {t(showIgnored ? "checkup.ignored_hide" : "checkup.ignored_show")}
          </button>
        </p>
      )}
      {!only && (clean.length > 0 || !checkup.analysed) && (
        <p className="border-t border-line py-2.5 type-meta text-muted">
          {clean.length > 0 && t("checkup.also", { what: clean.map(
            (k) => t(`checkup.c_${k}`)).join(", ") })}
          {!checkup.analysed && <>{clean.length > 0 && " "}
            {t("checkup.needs_scan_note")}</>}
        </p>
      )}
    </>
  );
}

/** What the card says about its age. */
const checkedLine = (c: RuleCheckup) => c.scanned_ts
  ? t("checkup.sub_scan", { ago: fmtAgo(c.scanned_ts) || "0m" })
  : t("checkup.sub_now");

/** The Rule checkup on the Rules page (below the assistants' proposals, above
 *  the rule list): a card with the findings on a wide screen, one row that
 *  opens the same list on a phone, one quiet line when all is fine. */
export function RuleCheckupCard({ checkup, host, phone, onOpen, onWhat }: {
  checkup: RuleCheckup | null; host: CheckupHost; phone: boolean;
  onOpen: () => void; onWhat: () => void;
}) {
  if (!checkup || !host.rules.length) return null;
  const byId = new Map(host.rules.map((r) => [r.id, r]));
  const open = checkup.findings.filter((f) => !f.ignored
    && f.rules.every((id) => byId.has(id)));
  if (!open.length) return (
    <div role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1
      type-meta text-muted">
      <Stethoscope size={16} aria-hidden className="shrink-0" />
      <span>{t(checkup.needs_scan ? "checkup.needs_scan" : "checkup.all_fine")}
      </span>
      {checkup.findings.some((f) => f.ignored) && (
        <button type="button" className={`${LINK_ACCENT} coarse:min-h-11`}
          onClick={onOpen}>
          {t("checkup.ignored", { n: checkup.findings.filter(
            (f) => f.ignored).length })}</button>
      )}
      <button type="button" className={`${LINK_ACCENT} coarse:min-h-11`}
        onClick={onWhat}>{t("checkup.what")}</button>
    </div>
  );
  const kinds = CHECK_KINDS.filter((k) => open.some((f) => f.kind === k));
  const tile = (
    <span aria-hidden className="flex size-10 shrink-0 items-center
      justify-center rounded-control bg-new-bg text-new-fg">
      <Stethoscope size={18} />
    </span>
  );
  if (phone) return (
    <button type="button" data-testid="checkup-row" onClick={onOpen}
      className="flex min-h-11 w-full items-center gap-3 rounded-card border
        border-line bg-panel2 p-3 text-left">
      {tile}
      <span className="min-w-0 flex-1">
        <span className="block type-body font-medium">
          {t("checkup.sheet_title")}</span>
        <span className="block type-meta text-muted">
          {t("checkup.phone_sub", { n: open.length, kinds: kinds.map(
            (k) => t(`checkup.s_${k}`)).join(", ") })}</span>
      </span>
      <ChevronRight size={18} aria-hidden className="shrink-0 text-faint" />
    </button>
  );
  return (
    <section aria-label={t("checkup.sheet_title")} data-testid="checkup-card"
      className="rounded-card border border-line bg-panel2 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-3 pb-1">
        {tile}
        <div className="min-w-0 flex-1 basis-40">
          <h3 className="type-body font-medium">
            {t("checkup.title", { n: open.length })}</h3>
          <div className="type-meta text-muted">{checkedLine(checkup)}</div>
        </div>
        <button type="button" className={`${LINK_ACCENT} type-meta
          coarse:min-h-11`} onClick={onWhat}>{t("checkup.what")}</button>
      </div>
      <FindingList checkup={checkup} host={host} />
    </section>
  );
}

/** The same list on its own sheet: a phone's row opens it, so does a rule's
 *  badge (then only that rule's findings). */
export function CheckupSheet({ checkup, host, only, onClose }: {
  checkup: RuleCheckup; host: CheckupHost; only?: string; onClose: () => void;
}) {
  const rule = host.rules.find((r) => r.id === only);
  return (
    <Modal onClose={onClose} label={t("checkup.sheet_title")}>
      <PanelHeader title={t("checkup.sheet_title")}
        sub={rule?.name ?? checkedLine(checkup)} onClose={onClose} />
      <div className="px-4 py-2 sm:px-5">
        <FindingList checkup={checkup} host={host} only={only} />
      </div>
    </Modal>
  );
}

/** "What it checks": the six checks in words. */
export function CheckupWhatSheet({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} label={t("checkup.what_title")}>
      <PanelHeader title={t("checkup.what_title")} onClose={onClose} />
      <div className="space-y-3 p-4 sm:p-5">
        <p className="type-body text-muted">{t("checkup.what_intro")}</p>
        <ul className="space-y-2">
          {CHECK_KINDS.map((k) => (
            <li key={k} className="flex items-start gap-3">
              <span aria-hidden className={`flex size-7 shrink-0 items-center
                justify-center rounded-control ${KIND_TILE[k]}`}>
                {KIND_ICON[k]}</span>
              <span className="type-body">{t(`checkup.w_${k}`)}</span>
            </li>
          ))}
        </ul>
        <p className="type-meta text-muted">{t("checkup.w_real")}</p>
      </div>
    </Modal>
  );
}

/** Two rules side by side: how many senders (or mails) only one reaches and
 *  how many both do, the ones in common, and what to do about it. Each Edit…
 *  opens that rule in today's editor. */
export function CompareSheet({ f, host, onClose }: {
  f: CheckupFinding; host: CheckupHost; onClose: () => void;
}) {
  const a = host.rules.find((r) => r.id === f.rules[0]);
  const b = host.rules.find((r) => r.id === f.rules[1]);
  if (!a || !b) return null;
  const cmp = f.compare;
  const senders = f.senders ?? [];
  const mails = f.kind === "conflict";
  const n = mails ? f.n ?? 0 : cmp?.both ?? 0;
  const unit = (k: number) => t(cmp?.unit === "mails" ? "n.mails" : "n.senders",
    { n: k });
  const max = Math.max(1, cmp?.only_a ?? 0, cmp?.both ?? 0, cmp?.only_b ?? 0);
  const x = host.rules.find((r) => r.id === f.defeated) ?? a;
  const y = host.rules.find((r) => r.id === f.by) ?? b;
  const first = host.rules.find((r) => r.id === f.first) ?? a;
  const bar = (label: string, k: number, tone: string) => (
    <div className="flex items-center gap-3 type-meta">
      <span className="w-2/5 min-w-0 truncate sm:w-48">{label}</span>
      {/* the bar's length is its share of the biggest count */}
      <div className="h-2 min-w-0 flex-1 rounded-full bg-chip">
        <div className={`h-2 rounded-full ${tone}`}
          style={{ width: `${(100 * k) / max}%` }} />
      </div>
      <b className="w-20 shrink-0 text-right font-semibold">{unit(k)}</b>
    </div>
  );
  return (
    <Modal onClose={onClose} label={t("checkup.compare")}>
      <PanelHeader onClose={onClose} sub={`${a.name} · ${b.name}`}
        title={f.purge ? t("checkup.cmp_title_purge")
          : t(mails ? "checkup.cmp_title_mails" : "checkup.cmp_title_senders",
            { n })} />
      <div className="space-y-3 p-4 sm:p-5">
        {cmp && (
          <div className="space-y-1.5">
            {bar(t("checkup.cmp_only", { name: a.name }), cmp.only_a,
              "bg-accent")}
            {bar(t("checkup.cmp_both"), cmp.both, "bg-review-fg")}
            {bar(t("checkup.cmp_only", { name: b.name }), cmp.only_b,
              "bg-info-fg")}
          </div>
        )}
        {senders.length > 0 && (
          <ul className="divide-y divide-line rounded-card bg-panel2">
            {senders.map((s) => (
              <li key={s.addr} className="flex items-center gap-3 px-3 py-2">
                <Avatar name={s.label} size="md" />
                <span className="min-w-0 flex-1 truncate type-body">
                  {s.label}</span>
                <span className="shrink-0 type-meta text-muted">
                  {s.n > 0 && <>{t(mails ? "n.mails" : "checkup.left",
                    { n: s.n })}{" · "}</>}
                  {t("checkup.last", { date: dateOf(s.last) })}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Notice icon={<Info size={16} aria-hidden />}>
          {f.kind === "conflict"
            ? <Fill template={t("checkup.cmp_note_conflict")}
              parts={{ first: bold(first.name) }} />
            : <Fill template={t("checkup.cmp_note_overlap")}
              parts={{ x: bold(x.name), y: bold(y.name) }} />}
          {f.purge && <> {t("checkup.cmp_note_purge")}</>}
        </Notice>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={() => host.onEdit(a)}>
            {t("checkup.edit_rule", { name: a.name })}</Button>
          <Button variant="secondary" size="sm" onClick={() => host.onEdit(b)}>
            {t("checkup.edit_rule", { name: b.name })}</Button>
          <Button variant="secondary" size="sm" className="ml-auto"
            onClick={onClose}>{t("Close")}</Button>
        </div>
      </div>
    </Modal>
  );
}

/** The small badges at the end of a rule's sentence ("overlaps 1", "folder
 *  gone"): each opens the rule's findings. */
export function CheckupBadges({ checkup, ruleId, onOpen }: {
  checkup: RuleCheckup | null; ruleId: string;
  onOpen: (ruleId: string) => void;
}) {
  if (!checkup) return null;
  const mine = checkup.findings.filter((f) => !f.ignored
    && f.rules.includes(ruleId));
  return <>{CHECK_KINDS.map((k) => {
    const n = mine.filter((f) => f.kind === k).length;
    if (!n) return null;
    const label = t(`checkup.b_${k}`, { n });
    return (
      <button key={k} type="button" data-badge={k}
        aria-label={t("checkup.badge_open", { what: label })}
        className="ml-2.5 inline-flex cursor-pointer items-center align-middle
          coarse:min-h-11" onClick={() => onOpen(ruleId)}>
        <Tag tone={BADGE_TONE[k]} className="inline-flex items-center gap-1">
          <span aria-hidden className="inline-flex">{BADGE_ICON[k]}</span>
          {label}
        </Tag>
      </button>
    );
  })}</>;
}

/** The chip above a list that was opened from a finding: what it is
 *  narrowed to, and the way back to everything. */
export function CheckupChip({ n, mails, onClear, className = "" }: {
  n: number; mails: boolean; onClear: () => void; className?: string;
}) {
  return (
    <div data-testid="checkup-chip" className={`flex flex-wrap items-center
      gap-x-3 gap-y-1 type-meta text-muted ${className}`}>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-chip
        px-2 py-0.5 text-body">
        <Stethoscope size={14} aria-hidden />
        {t(mails ? "checkup.chip_mails" : "checkup.chip_senders", { n })}
      </span>
      <button type="button" className={`${LINK_ACCENT} coarse:min-h-11`}
        onClick={onClear}>
        {t(mails ? "checkup.chip_clear_mails" : "checkup.chip_clear_senders")}
      </button>
    </div>
  );
}

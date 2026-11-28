/* The steps of the Weekly check-in (WeeklyCheckin.tsx walks through them).
 *
 * Nothing new happens inside a step: each one hosts a place's own list and its
 * own actions, and every action is the existing one - the app's confirmed
 * Block / Trash / Unsubscribe (`CheckinActions`), the Mail past its date move
 * (ExpiredSheet's hooks), Waiting for a reply's Remind me / No answer needed,
 * the Rule checkup's findings (RuleCheckup's list) and the Junk page's Not
 * junk / Block / Trash (junkMoves.ts). So each keeps its confirm, its Undo
 * and its Activity entry. A step only tells the shell what the person
 * confirmed (`tally`), for the closing card.
 *
 * The rows of a step are the ones that were there when it opened: a sender you
 * just blocked or trashed stays in its row, with what happened to it. */

import { Ban, Check, ChevronDown, Inbox, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { nowDate } from "../clock";
import { getLang, t } from "../i18n";
import { junkBlock, junkMove } from "../junkMoves";
import { fmtSize, fmtTs, matchGroup, parseFilter } from "../lib";
import { canUnsub } from "../triage";
import type { CheckinPlace, CheckupFinding, ExpiredResp, Group, Rule,
  RuleCheckup, SenderGroup, TrashResp, UndoIdent, WaitingItem }
  from "../types";
import { remindTimes, shortName, tomorrowLabel, weekdayName, whenText,
  daysText } from "../waiting";
import type { Did } from "../checkin";
import { ExpiredKept, ExpiredLead, ExpiredList, useExpiredMove,
  useExpiredPick } from "./ExpiredSheet";
import { CompareSheet, FindingList, type CheckupHost }
  from "./RuleCheckup";
import { Avatar, Button, confirmDialog, LINK_ACCENT, Loading, Menu, MenuItem,
  Notice, Tag, useToast } from "./ui";

/** Where a step sends the person when its own list is not enough: the shell
 *  closes (keeping the place) and the app opens that page. */
export type CheckinTarget =
  | { to: "senders"; query: string }
  | { to: "subset"; keys: string[] }
  | { to: "all"; query: string }
  | { to: "kept"; n: number }
  | { to: "mails"; id: string; n: number }
  | { to: "rules"; edit?: string }
  | { to: "waiting" }
  | { to: "junk" };

/** The app's own, already confirmed actions - never re-implemented here. */
export interface CheckinActions {
  /** Block the sender (the confirm, the rule); true once blocked. */
  blockGroup: (g: Group) => Promise<boolean>;
  /** Move the sender's mails to Trash (the confirm, Keep-safe, Undo toast);
   *  resolves how many mails were queued (what the move really takes: pinned
   *  and kept-safe mails are not in it), or null when it did not go ahead. */
  trashGroup: (g: Group) => Promise<number | null>;
  /** The unsubscribe sheet of one sender. */
  unsubscribe: (g: Group) => void;
  /** Block a bare address (Junk). */
  blockAddress: (addr: string) => Promise<boolean>;
  /** Protect these senders. */
  protect: (addrs: string[]) => Promise<boolean>;
  /** The confirmed Undo of a recorded move. */
  undo: (entry: UndoIdent) => void | Promise<void>;
  /** Something changed: the app refreshes its numbers. */
  changed: () => void;
}

export interface StepEnv {
  /** The sender groups of this account, live. */
  groups: Record<string, Group>;
  /** Senders that have a Block rule. */
  blockedKeys: ReadonlySet<string>;
  rules: Rule[];
  /** The `in:` window of Overview's Last week card ("7d", "90min"). */
  window: string;
  phone: boolean;
  actions: CheckinActions;
  navigate: (to: CheckinTarget) => void;
  /** More things done, for the closing card. */
  tally: (more: Partial<Did>) => void;
}

/** Rows a step lists before it points at the full page. */
const LIMIT = 8;

/* --------------------------------- shared --------------------------------- */

/** The box a step's rows sit in. */
function RowBox({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <ul data-testid={testId} className="divide-y divide-line rounded-card
      border border-line">{children}</ul>
  );
}

/** One row: who, what, then its tag and buttons (under the text on a phone). */
function Row({ name, title, sub, tag, children, testId }: {
  name: string; title: ReactNode; sub: ReactNode; tag?: ReactNode;
  children?: ReactNode; testId?: string;
}) {
  return (
    <li data-testid={testId} className="flex flex-wrap items-center gap-x-3
      gap-y-2 px-3 py-2.5">
      <Avatar name={name} size="md" />
      <div className="min-w-0 flex-1 basis-40">
        <div className="truncate type-body font-medium">{title}</div>
        <div className="type-meta text-muted">{sub}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2 max-sm:basis-full
        max-sm:pl-12">
        {tag}{children}
      </div>
    </li>
  );
}

/** "Show all N in Senders"-style link under a list. */
function MoreLink({ children, onClick }: {
  children: ReactNode; onClick: () => void;
}) {
  return (
    <p className="type-meta">
      <button type="button" onClick={onClick}
        className={`${LINK_ACCENT} coarse:min-h-11`}>{children}</button>
    </p>
  );
}

function Empty() {
  return (
    <p data-testid="checkin-empty" className="flex items-center gap-2
      rounded-card bg-safe-bg px-3 py-3 type-body text-safe-fg">
      <Check size={16} aria-hidden className="shrink-0" />
      {t("checkin.step_empty")}
    </p>
  );
}

/** A row's label for assistive tech: "Block…: Sender". */
const act = (action: string, who: string) =>
  t("checkin.row_action", { action, who });

/* ----------------------- new senders / still mailing ---------------------- */

const shortDate = (epoch: number): string =>
  epoch ? fmtTs(epoch, getLang(), false) : "";

/** New senders (Keep / Unsubscribe… / Block…) and the senders that kept
 *  mailing after you unsubscribed (Block… / Trash…): the same lists as
 *  Senders › `is:new` / `is:still-mailing` over the Last week window. */
export function SenderStep({ kind, env }: {
  kind: "new" | "still"; env: StepEnv;
}) {
  const query = `is:${kind === "new" ? "new" : "still-mailing"} in:${
    env.window}`;
  // the rows as they were when the step opened (a trashed sender may leave the
  // live list; its row stays, with what happened)
  const [rows] = useState<Group[]>(() => {
    const f = parseFilter(query);
    const list = Object.values(env.groups).filter((g) => matchGroup(g, f));
    return list.sort(kind === "new" ? (a, b) => b.count - a.count
      : (a, b) => (b.still_mailing?.n ?? 0) - (a.still_mailing?.n ?? 0)
        || b.count - a.count);
  });
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const [trashed, setTrashed] = useState<ReadonlySet<string>>(new Set());
  const [unsubs, setUnsubs] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const add = (s: ReadonlySet<string>, k: string) => new Set([...s, k]);

  // an unsubscribe that ran to the end counts once
  const counted = useRef(new Set<string>());
  useEffect(() => {
    for (const key of unsubs) {
      if (!counted.current.has(key)
          && env.groups[key]?.unsubscribed?.status === "done") {
        counted.current.add(key);
        env.tally({ unsubscribed: 1 });
      }
    }
  }, [env.groups, unsubs]);          // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };
  const block = (g: Group) => run(async () => {
    if (await env.actions.blockGroup(g)) env.tally({ blocked: 1 });
  });
  const trash = (g: Group) => run(async () => {
    const went = await env.actions.trashGroup(g);
    if (went !== null) {
      setTrashed((s) => add(s, g.key));
      env.tally({ trashed: went });
    }
  });

  if (!rows.length) return <Empty />;
  const shown = rows.slice(0, LIMIT);
  return (<>
    <RowBox testId={`checkin-${kind}`}>
      {shown.map((g) => {
        const live = env.groups[g.key] ?? g;
        const blocked = env.blockedKeys.has(g.key);
        const unsubDone = live.unsubscribed?.status === "done";
        const tag = blocked ? t("checkin.r_blocked")
          : trashed.has(g.key) ? t("checkin.r_trashed")
          : kept.has(g.key) ? t("checkin.r_kept")
          : kind === "new" && unsubDone ? t("checkin.r_unsub") : null;
        const date = shortDate(kind === "new" ? live.new_ts ?? 0
          : live.still_mailing?.since_ts ?? 0);
        const mails = t("n.mails", { n: kind === "new" ? live.count
          : live.still_mailing?.n ?? 0 });
        // an unknown date leaves just the count
        const sub = !date ? mails : t(kind === "new" ? "checkin.new_sub"
          : "checkin.still_sub", { date, mails });
        return (
          <Row key={g.key} name={g.label} title={g.label}
            sub={sub}
            tag={tag && <Tag tone={blocked ? "keep" : "safe"}>{tag}</Tag>}
            testId="checkin-row">
            {kind === "new" && !kept.has(g.key) && !tag && (
              <Button size="sm" variant="secondary" disabled={busy}
                aria-label={act(t("checkin.keep"), g.label)}
                onClick={() => setKept((s) => add(s, g.key))}>
                {t("checkin.keep")}</Button>
            )}
            {kind === "new" && canUnsub(live) && !unsubDone && (
              <Button size="sm" variant="secondary" disabled={busy}
                aria-label={act(t("checkin.unsubscribe"), g.label)}
                onClick={() => {
                  setUnsubs((s) => add(s, g.key));
                  env.actions.unsubscribe(live);
                }}>{t("checkin.unsubscribe")}</Button>
            )}
            {!blocked && (
              <Button size="sm" variant="secondary" disabled={busy}
                aria-label={act(t("checkin.block"), g.label)}
                onClick={() => void block(live)}>
                <Ban size={14} aria-hidden className="mr-1 inline
                  align-text-bottom" />{t("checkin.block")}</Button>
            )}
            {kind === "still" && !trashed.has(g.key) && (
              <Button size="sm" variant="secondary" disabled={busy}
                aria-label={act(t("checkin.trash"), g.label)}
                onClick={() => void trash(live)}>
                <Trash2 size={14} aria-hidden className="mr-1 inline
                  align-text-bottom" />{t("checkin.trash")}</Button>
            )}
          </Row>
        );
      })}
    </RowBox>
    {rows.length > shown.length && (
      <MoreLink onClick={() => env.navigate({ to: "senders", query })}>
        {t("checkin.show_all_senders", { n: rows.length })}</MoreLink>
    )}
  </>);
}

/* ------------------------------ mail past its date ------------------------ */

function PastBody({ data, env }: { data: ExpiredResp; env: StepEnv }) {
  const { reasons, off, chosen, n, toggle } = useExpiredPick(data);
  const [moved, setMoved] = useState(0);
  const { move, busy } = useExpiredMove(chosen, env.actions.changed);
  if (!reasons.length) return <Empty />;
  const go = async () => {
    const went = await move();
    if (went > 0) {
      setMoved((m) => m + went);
      env.tally({ trashedPast: went });
    }
  };
  return (<>
    <ExpiredLead phone={env.phone} />
    <ExpiredList reasons={reasons} off={off} toggle={toggle}
      phone={env.phone} />
    <ExpiredKept kept={data.kept} phone={env.phone}
      onShowKept={() => env.navigate({ to: "kept", n: data.kept })} />
    {moved > 0 && (
      <Notice tone="neutral" icon={<Check size={16} aria-hidden />}>
        {t("checkin.past_moved", { n: moved })}</Notice>
    )}
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled={!n || busy || moved > 0} onClick={() => void go()}>
        {t("past.move", { n })}</Button>
      <button type="button" className={`${LINK_ACCENT} coarse:min-h-11`}
        onClick={() => env.navigate({ to: "all", query: "is:expired" })}>
        {t("past.open_all")}</button>
    </div>
  </>);
}

/** Mail past its date: the sheet's reasons with their ticks and its own
 *  "Move N to Trash…" (the per-mail Trash step: confirm, Undo, Activity). */
export function PastStep({ env }: { env: StepEnv }) {
  const [data, setData] = useState<ExpiredResp | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => api.expired())
      .then((d) => live && setData(d), () => live && setFailed(true));
    return () => { live = false; };
  }, []);
  if (failed) return <Notice tone="warn">{t("overview.load_failed")}</Notice>;
  if (!data) return <Loading label={t("loading…")} />;
  return <PastBody data={data} env={env} />;
}

/* -------------------------------- replies overdue ------------------------- */

/** Replies overdue: the mails you sent that nobody answered, overdue ones;
 *  Remind me (a reminder, a push) and No answer needed (with Undo), as on the
 *  Waiting for a reply page. */
export function WaitingStep({ env }: { env: StepEnv }) {
  const toast = useToast();
  const [items, setItems] = useState<WaitingItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => api.waiting())
      .then((r) => live && setItems(r.items
        .filter((i) => i.state === "open" && i.overdue)
        .sort((a, b) => b.age - a.age)), () => live && setFailed(true));
    return () => { live = false; };
  }, []);
  if (failed) return <Notice tone="warn">{t("overview.load_failed")}</Notice>;
  if (!items) return <Loading label={t("loading…")} />;
  if (!items.length) return <Empty />;
  const fail = (e: any) => toast.show(t("err.generic",
    { msg: e?.message ?? String(e) }), { variant: "error" });
  const remind = async (it: WaitingItem, at: number) => {
    setBusy(true);
    try {
      await api.waitingRemind(it.id, at);
      const when = whenText(at, nowDate());
      setDone((d) => ({ ...d, [it.id]: t("waiting.rem_set", { when }) }));
      env.tally({ reminders: 1 });
      toast.show(t("waiting.toast_remind", { name: shortName(it.person.name),
        when }), { variant: "success" });
      env.actions.changed();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const noNeed = async (it: WaitingItem) => {
    setBusy(true);
    try {
      await api.waitingNeeded(it.id, true);
      setDone((d) => ({ ...d, [it.id]: t("waiting.notice_needed") }));
      env.tally({ noAnswer: 1 });
      toast.show(t("waiting.toast_needed",
        { name: shortName(it.person.name) }), { action: {
        label: t("Undo"), onClick: () => {
          void api.waitingNeeded(it.id, false).then(() => {
            setDone((d) => { const n = { ...d }; delete n[it.id]; return n; });
            env.actions.changed();
          }).catch(fail);
        } } });
      env.actions.changed();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const times = remindTimes(nowDate());
  const shown = items.slice(0, LIMIT);
  return (<>
    <RowBox testId="checkin-waiting">
      {shown.map((it) => (
        <Row key={it.id} name={it.person.name} title={it.person.name}
          testId="checkin-row"
          sub={`${it.subject || t("(no subject)")} · ${daysText(it.days)}`}
          tag={done[it.id] && <Tag tone="safe">{done[it.id]}</Tag>}>
          {!done[it.id] && (<>
            <Menu variant="secondary" triggerSize="sm" label={t(
              "waiting.remind")} disabled={busy}
              trigger={<>{t("waiting.remind")}
                <ChevronDown size={14} aria-hidden className="ml-1 inline" />
              </>}>
              <MenuItem onClick={() => void remind(it, times.tomorrow)}>
                {tomorrowLabel(times.tomorrow)}</MenuItem>
              {times.monday !== null && (
                <MenuItem onClick={() => void remind(it, times.monday!)}>
                  {weekdayName(times.monday)}</MenuItem>
              )}
              <MenuItem onClick={() => void remind(it, times.week)}>
                {t("waiting.rem_week")}</MenuItem>
            </Menu>
            <Button size="sm" variant="secondary" disabled={busy}
              aria-label={act(t("waiting.no_need"), it.person.name)}
              onClick={() => void noNeed(it)}>{t("waiting.no_need")}</Button>
          </>)}
        </Row>
      ))}
    </RowBox>
    {items.length > shown.length && (
      <MoreLink onClick={() => env.navigate({ to: "waiting" })}>
        {t("checkin.open_waiting", { n: items.length })}</MoreLink>
    )}
  </>);
}

/* ---------------------------------- rule checkup -------------------------- */

/** Rule checkup: the findings of the Rules page, with the same buttons -
 *  Edit… opens that rule's editor, Delete… its confirm, Compare, Show the N
 *  senders, Ignore. Nothing changes by itself. */
export function RulesStep({ env }: { env: StepEnv }) {
  const toast = useToast();
  const [checkup, setCheckup] = useState<RuleCheckup | null>(null);
  const [failed, setFailed] = useState(false);
  const [compare, setCompare] = useState<CheckupFinding | null>(null);
  const load = () => Promise.resolve().then(() => api.ruleCheckup())
    .then(setCheckup, () => setFailed(true));
  useEffect(() => { void load(); }, []);     // eslint-disable-line react-hooks/exhaustive-deps
  if (failed) return <Notice tone="warn">{t("overview.load_failed")}</Notice>;
  if (!checkup) return <Loading label={t("loading…")} />;
  const fail = (e: any) => toast.show(t("err.generic",
    { msg: e?.message ?? String(e) }), { variant: "error" });
  const host: CheckupHost = {
    rules: env.rules,
    onEdit: (rule) => env.navigate({ to: "rules", edit: rule.id }),
    onDelete: async (rule) => {
      if (!await confirmDialog({
        title: t("rule.confirm_delete", { name: rule.name }), tone: "danger",
        confirmLabel: t("Delete") })) return;
      try {
        await api.deleteRule(rule.id);
        env.tally({ rules: 1 });
        env.actions.changed();
        await load();
      } catch (e) { fail(e); }
    },
    onCompare: setCompare,
    onShowSenders: (f) => {
      const keys = f.addrs ?? f.senders?.map((s) => s.addr) ?? [];
      if (keys.length) env.navigate({ to: "subset", keys });
    },
    onShowMails: (f) => env.navigate({ to: "mails", id: f.id, n: f.n ?? 0 }),
    onIgnore: (f, ignored) => {
      api.ignoreFinding(f.id, ignored).then(() => {
        if (ignored) env.tally({ rules: 1 });
        return load();
      }).catch(fail);
    },
  };
  const open = checkup.findings.filter((f) => !f.ignored
    && f.rules.every((id) => env.rules.some((r) => r.id === id)));
  return (<>
    {!open.length && <Empty />}
    <div data-testid="checkin-rules">
      <FindingList checkup={checkup} host={host} />
    </div>
    {compare && (
      <CompareSheet f={compare} host={host} onClose={() => setCompare(null)} />
    )}
  </>);
}

/* ------------------------------------ Junk -------------------------------- */

/** Junk waiting: the senders in your Junk folder with the Junk page's Not
 *  junk (back to the Inbox, Undo, then Protect), Block and Trash. */
export function JunkStep({ env }: { env: StepEnv }) {
  const toast = useToast();
  const [list, setList] = useState<TrashResp | null>(null);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const load = () => Promise.resolve().then(() => api.foldersPanel("junk"))
    .then((l) => { setList(l); setFailed(false); }, () => setFailed(true));
  useEffect(() => { void load(); }, []);     // eslint-disable-line react-hooks/exhaustive-deps
  const known = useMemo(() => new Set(Object.values(env.groups)
    .filter((g) => g.replied).map((g) => g.key)), [env.groups]);
  if (failed) return <Notice tone="warn">{t("overview.load_failed")}</Notice>;
  if (!list) return <Loading label={t("loading…")} />;
  const senders = [...(list.senders ?? [])].sort((a, b) => b.count - a.count);
  if (!senders.length) return <Empty />;
  const ctx = { uv: list.uv, toast, protect: env.actions.protect,
    undo: async (entry: UndoIdent) => {
      await env.actions.undo(entry);
      await load();                          // the mails are back in Junk
    } };
  const fail = (e: any) => toast.show(t("err.generic",
    { msg: e?.message ?? String(e) }), { variant: "error" });
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const mark = (g: SenderGroup, text: string) =>
    setDone((d) => ({ ...d, [g.addr]: text }));
  const notJunk = (g: SenderGroup) => run(async () => {
    const r = await junkMove(ctx, "not_junk", g.uids);
    if (!r) return;
    mark(g, t("checkin.r_not_junk"));
    env.tally({ notJunk: r.moved });
    env.actions.changed();
  });
  const trash = (g: SenderGroup) => run(async () => {
    const r = await junkMove(ctx, "trash", g.uids);
    if (!r) return;
    mark(g, t("checkin.r_trashed"));
    env.tally({ trashed: r.moved });
    env.actions.changed();
  });
  const block = (g: SenderGroup) => run(async () => {
    const out = await junkBlock(g, { folder: list.folder,
      block: env.actions.blockAddress });
    if (!out.blocked) return;
    env.tally({ blocked: 1 });
    mark(g, t("checkin.r_blocked"));
    if (out.error !== undefined) { fail(out.error); return; }
    if (out.uids.length) {
      const r = await junkMove(ctx, "trash", out.uids);
      if (r) {
        env.tally({ trashed: r.moved });
        mark(g, `${t("checkin.r_blocked")} · ${t("checkin.r_trashed")}`);
      }
    }
    env.actions.changed();
  });
  const shown = senders.slice(0, LIMIT);
  return (<>
    <RowBox testId="checkin-junk">
      {shown.map((g) => (
        <Row key={g.addr} name={g.addr} title={g.addr} testId="checkin-row"
          sub={[t("n.mails", { n: g.count }), fmtSize(g.size),
            known.has(g.addr) ? t("fp.replied_before") : ""]
            .filter(Boolean).join(" · ")}
          tag={done[g.addr] && <Tag tone="safe">{done[g.addr]}</Tag>}>
          {!done[g.addr] && (<>
            <Button size="sm" variant={known.has(g.addr) ? "tinted"
              : "secondary"} disabled={busy}
              aria-label={act(t("fp.not_junk"), g.addr)}
              onClick={() => void notJunk(g)}>
              <Inbox size={14} aria-hidden className="mr-1 inline
                align-text-bottom" />{t("fp.not_junk")}</Button>
            <Button size="sm" variant="secondary" disabled={busy}
              aria-label={act(t("checkin.block"), g.addr)}
              onClick={() => void block(g)}>
              <Ban size={14} aria-hidden className="mr-1 inline
                align-text-bottom" />{t("checkin.block")}</Button>
            <Button size="sm" variant="secondary" disabled={busy}
              aria-label={act(t("Trash"), g.addr)}
              onClick={() => void trash(g)}>
              <Trash2 size={14} aria-hidden className="mr-1 inline
                align-text-bottom" />{t("Trash")}</Button>
          </>)}
        </Row>
      ))}
    </RowBox>
    {senders.length > shown.length && (
      <MoreLink onClick={() => env.navigate({ to: "junk" })}>
        {t("checkin.open_junk", { n: senders.length })}</MoreLink>
    )}
  </>);
}

/** The body of one place. */
export function StepBody({ place, env }: { place: CheckinPlace; env: StepEnv }) {
  switch (place) {
    case "new": return <SenderStep kind="new" env={env} />;
    case "still": return <SenderStep kind="still" env={env} />;
    case "past": return <PastStep env={env} />;
    case "waiting": return <WaitingStep env={env} />;
    case "rules": return <RulesStep env={env} />;
    case "junk": return <JunkStep env={env} />;
  }
}

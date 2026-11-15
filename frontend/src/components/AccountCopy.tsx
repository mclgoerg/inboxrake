import { ArrowLeft, ArrowLeftRight, ArrowRight, CalendarCheck, Check, ChevronsUpDown,
  Copy, FolderPlus, HardDrive, Info, Inbox, KeyRound, Newspaper, Package, Pause, Pin, Play,
  Shield, ShieldCheck, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState,
  type ReactNode } from "react";
import { api, errorText } from "../api";
import { fmtSize, fmtSizeGb } from "../lib";
import { t } from "../i18n";
import { fmtNum } from "../numfmt";
import type { Config, CopyJob, CopyKindId, CopyPlan } from "../types";
import { AccountCopyTell } from "./AccountCopyTell";
import { AccountAvatar, Button, Checkbox, EmptyState, IconTile, Input, Loading,
  Menu, MenuItem, Modal, Notice, PanelHeader, ProgressBar, SectionLabel,
  Spinner, useIsPage, type TagTone } from "./ui";

/** Move to another account: copy what matters from one account to another
 *  (backend/accountcopy.py). Three steps - What to bring, Copy, Tell them -
 *  one page: a tool page from 1024 px, a full-screen page below. Both
 *  accounts are named explicitly (never "the active one"); the copy runs on
 *  the server and this page only follows it. Nothing is ever deleted. */

type Step = "bring" | "copy" | "tell";

const KIND_ORDER: CopyKindId[] = ["replied", "orders", "accounts",
  "appointments", "protected", "pinned", "newsletter", "other"];

const KIND_ICON: Record<CopyKindId, ReactNode> = {
  replied: <Users size={16} />, orders: <Package size={16} />,
  accounts: <KeyRound size={16} />, appointments: <CalendarCheck size={16} />,
  protected: <Shield size={16} />, pinned: <Pin size={16} />,
  newsletter: <Newspaper size={16} />, other: <Inbox size={16} />,
};
const KIND_TONE: Record<CopyKindId, TagTone> = {
  replied: "safe", orders: "info", accounts: "neutral", appointments: "safe",
  protected: "safe", pinned: "review", newsletter: "attach", other: "neutral",
};
const kindLabel = (k: CopyKindId): string =>
  t(k === "pinned" ? "copy.kind.pinned" : `smart.kind.${k}`);

const POLL_MS = 1500;

/** What the target's server says about the folder name typed: it exists (the
 *  mails are added to it) or it is one the server uses for something else. */
type FolderState = { exists: boolean; reserved: boolean };

/** "about 6 min left" - minutes, then hours; under a minute says so. */
export function etaText(sec: number | null): string {
  if (sec === null) return "";
  if (sec < 60) return t("copy.eta_less");
  const min = Math.ceil(sec / 60);
  return min > 90 ? t("copy.eta_hours", { n: Math.round(min / 60) })
    : t("copy.eta", { n: min });
}

/** The three steps, as buttons (a step that cannot be reached yet is
 *  disabled); labels show for every step from 640 px, for the current one
 *  below it. */
function Steps({ step, reach, done, onStep }: {
  step: Step; reach: Record<Step, boolean>; done: Record<Step, boolean>;
  onStep: (s: Step) => void;
}) {
  const names: Step[] = ["bring", "copy", "tell"];
  return (
    <nav aria-label={t("copy.steps")}>
      <ol className="flex items-center gap-1.5 sm:gap-2">
        {names.map((s, i) => (
          <li key={s} className="flex items-center gap-1.5 sm:gap-2">
            {i > 0 && <span aria-hidden className="hidden h-px w-5 bg-line
              sm:block" />}
            <button type="button" disabled={!reach[s]}
              aria-current={step === s ? "step" : undefined}
              onClick={() => onStep(s)}
              className={`inline-flex min-h-8 min-w-8 coarse:min-h-11
                coarse:min-w-11 items-center justify-center gap-1.5
                rounded-full pr-1 type-meta disabled:cursor-not-allowed
                ${step === s ? "font-semibold text-body" : "text-muted"}`}>
              <span aria-hidden className={`grid size-5.5 shrink-0
                place-items-center rounded-full type-caption
                ${step === s ? "bg-accent text-on-accent"
                  : done[s] ? "bg-safe-bg text-safe-fg"
                  : "bg-chip text-muted"}`}>
                {done[s] && step !== s ? <Check size={14} /> : i + 1}
              </span>
              <span className={step === s ? "" : "max-sm:sr-only"}>
                {t(`copy.step.${s}`)}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** One account of the pair: its avatar, a picker for the name, the address
 *  and what is in it (the source) or the new folder (the target). */
function AccountBox({ label, name, names, taken, address, children, onPick,
  disabled }: {
  label: string; name: string; names: string[]; taken: string;
  address: string; children: ReactNode; onPick: (n: string) => void;
  disabled: boolean;
}) {
  const face = <span className="truncate">{name}</span>;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 rounded-card
      bg-panel2 p-3">
      <AccountAvatar name={name} size="md" />
      <div className="min-w-0 flex-1">
        {disabled ? (
          <div className="flex min-h-8 items-center type-heading">{face}</div>
        ) : (
          <Menu label={`${label} ${name}`} align="left" className="-ml-1"
            triggerClass="flex min-h-8 coarse:min-h-11 w-full items-center
              justify-between gap-2 rounded-control px-1 text-left type-heading
              hover:bg-chip"
            trigger={<>{face}<ChevronsUpDown size={14} aria-hidden
              className="shrink-0 text-muted" /></>}>
            {names.map((n) => (
              <MenuItem key={n} active={n === name} disabled={n === taken}
                onClick={() => onPick(n)}>{n}</MenuItem>
            ))}
          </Menu>
        )}
        <div className="truncate type-meta text-muted">{address}</div>
        <div className="type-meta text-muted">{children}</div>
      </div>
    </div>
  );
}

/** The summary of a copy that is not started: how much comes along, what
 *  stays, the four notes and the button. */
function Summary({ plan, bring, free, folder, busy, folderOk, blocked,
  onStart }: {
  plan: CopyPlan; bring: { mails: number; size: number };
  free: number | null | undefined; folder: FolderState; busy: boolean;
  folderOk: boolean; blocked: string; onStart: () => void;
}) {
  const total = plan.source.size;
  const frac = total > 0 ? Math.min(100, (100 * bring.size) / total) : 0;
  const tight = typeof free === "number" && bring.size > free;
  const notes: { icon: ReactNode; text: string; warn?: boolean }[] = [
    { icon: <Check size={14} />, text: t("copy.note_flags") },
    ...(folder.exists ? [{ icon: <FolderPlus size={14} />,
      text: t("copy.note_exists", { name: plan.target.name }) }] : []),
    { icon: <Copy size={14} />,
      text: t("copy.note_dups", { name: plan.target.name }) },
    ...(typeof free === "number" ? [{ icon: <HardDrive size={14} />,
      warn: tight,
      text: t(tight ? "copy.note_free_short" : "copy.note_free",
        { name: plan.target.name, free: fmtSizeGb(free) }) }] : []),
    { icon: <ShieldCheck size={14} />,
      text: t("copy.note_safe", { name: plan.source.name }) },
  ];
  return (
    <section aria-label={t("copy.you_bring")}
      className="rounded-card border border-line bg-panel p-4 lg:sticky
        lg:top-4 lg:self-start">
      <div className="type-meta text-muted">{t("copy.you_bring")}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="type-largetitle tabular-nums">
          {fmtNum(bring.mails)}</span>
        <span className="type-body text-muted">
          {t("copy.unit_mails", { n: bring.mails,
            size: fmtSizeGb(bring.size) })}</span>
      </div>
      <ProgressBar className="mt-3" value={frac} max={100}
        label={t("copy.you_bring")} />
      <div className="mt-2 flex flex-wrap gap-x-4 type-meta text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-1.5 rounded-full bg-accent" />
          {t("copy.legend_bring", { size: fmtSizeGb(bring.size) })}</span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-1.5 rounded-full bg-chip" />
          {t("copy.legend_leave",
            { size: fmtSizeGb(Math.max(0, total - bring.size)) })}</span>
      </div>
      <ul className="mt-3 space-y-2 border-t border-line pt-3 type-body">
        {notes.map((n) => (
          <li key={n.text} className={`flex items-start gap-2
            ${n.warn ? "text-review-fg" : ""}`}>
            <span aria-hidden className="mt-0.5 shrink-0">{n.icon}</span>
            <span className="min-w-0">{n.text}</span>
          </li>
        ))}
      </ul>
      {blocked && <p className="mt-3 type-meta text-muted">{blocked}</p>}
      <GoButton className="mt-3 max-lg:hidden" bring={bring} busy={busy}
        off={!!blocked || bring.mails === 0 || !folderOk} onStart={onStart} />
    </section>
  );
}

/** "Copy N mails": in the summary card from 1024 px, in a bar under the page
 *  below it (the button stays in reach while the list scrolls). */
function GoButton({ bring, busy, off, onStart, className = "" }: {
  bring: { mails: number }; busy: boolean; off: boolean;
  onStart: () => void; className?: string;
}) {
  return (
    <Button className={`w-full ${className}`} disabled={off || busy}
      onClick={onStart}>
      {busy ? <Spinner className="text-on-accent" /> : (
        <ArrowLeftRight size={14} aria-hidden
          className="mr-1.5 inline align-text-bottom" />)}
      {t("copy.go", { n: bring.mails })}
    </Button>
  );
}

/** What the running (or stopped) copy looks like: progress with Pause /
 *  Cancel, the stop with its reason, or the Done card. */
function CopyState({ job, onPause, onResume, onCancel, onTell, onMore,
  onRest, busy }: {
  job: CopyJob; onPause: () => void; onResume: () => void;
  onCancel: () => void; onTell: () => void; onMore: () => void;
  onRest: () => void; busy: boolean;
}) {
  const sizeDone = fmtSizeGb(job.bytes_done);
  const progress = (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span className="type-largetitle tabular-nums">
        {fmtNum(job.processed)}</span>
      <span className="type-body text-muted">
        {t("copy.progress", { total: fmtNum(job.total), done: sizeDone,
          all: fmtSizeGb(job.bytes_total) })}</span>
      {job.status === "running" && job.eta_s !== null && (
        <span className="type-meta text-muted sm:ml-auto">
          {etaText(job.eta_s)}</span>
      )}
    </div>
  );
  if (job.status === "done") {
    const parts: string[] = [
      job.failed === 0 && job.unchecked === 0 && !job.unsure
        ? t("copy.done_all_checked") : "",
      job.unchecked > 0 ? t("copy.done_unchecked", { n: job.unchecked }) : "",
      job.unsure > 0 ? t("copy.done_unsure", { n: job.unsure }) : "",
      // "nothing new" says it in the title
      job.skipped > 0 && job.copied > 0
        ? t("copy.done_skipped", { n: job.skipped }) : "",
      job.too_large > 0 ? t("copy.done_big", { n: job.too_large }) : "",
      job.missing > 0 ? t("copy.done_missing",
        { n: job.missing, name: job.source }) : "",
    ].filter(Boolean);
    return (
      <section className="rounded-card border border-line bg-panel p-4">
        <div className="flex items-start gap-3">
          <span aria-hidden className="grid size-9 shrink-0 place-items-center
            rounded-full bg-safe-bg text-safe-fg"><Check size={18} /></span>
          <div className="min-w-0">
            <h2 className="type-heading">
              {job.copied > 0
                ? t("copy.done_title", { n: job.copied, name: job.target,
                  folder: job.folder })
                : t("copy.done_nothing_new", { n: job.skipped,
                  name: job.target })}</h2>
            <p className="type-meta text-muted">{parts.join(" · ")}</p>
          </div>
        </div>
        {(job.failed > 0 || job.unsure > 0) && (
          <Notice tone="warn" className="mt-3"
            icon={<Info size={16} />}>
            <div>{job.failed > 0 ? t("copy.done_failed", { n: job.failed })
              : t("copy.done_unsure", { n: job.unsure })}</div>
            <Button variant="tinted" size="sm" className="mt-1.5"
              disabled={busy} onClick={onRest}>{t("copy.copy_rest")}</Button>
          </Notice>
        )}
        <Notice className="mt-3" icon={<Info size={16} />}>
          {t("copy.originals", { name: job.source })}</Notice>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={onTell}>{t("copy.tell_btn")}</Button>
          <Button variant="secondary" onClick={onMore}>
            {t("copy.copy_more")}</Button>
        </div>
      </section>
    );
  }
  if (job.status === "cancelled") {
    return (
      <section className="rounded-card border border-line bg-panel p-4">
        <Notice icon={<Info size={16} />}>
          {t("copy.cancelled", { n: job.copied })}</Notice>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={onMore}>{t("copy.start_over")}</Button>
        </div>
      </section>
    );
  }
  if (job.status === "error" && job.error.startsWith("copy_same_mailbox")) {
    // nothing to resume: the two accounts are one mailbox
    return (
      <section className="rounded-card border border-line bg-panel p-4">
        <Notice tone="danger" role="alert">
          <div className="font-medium">{t("copy.failed_title")}</div>
          {errorText(job.error)}
        </Notice>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={onMore}>{t("copy.start_over")}</Button>
        </div>
      </section>
    );
  }
  return (
    <section className="rounded-card border border-line bg-panel p-4">
      {job.status === "error" && (
        <Notice tone="danger" role="alert" className="mb-3">
          <div className="font-medium">{t("copy.failed_title")}</div>
          {errorText(job.error)}
        </Notice>
      )}
      {job.status === "paused" && (
        <div className="mb-1 type-heading">{t("copy.paused")}</div>
      )}
      {progress}
      <ProgressBar className="mt-3" value={job.processed} max={job.total}
        label={t("copy.step.copy")} />
      <p className="mt-3 type-meta text-muted">
        {job.status === "paused" ? t("copy.paused_hint")
          : t("copy.running_hint", { name: job.target })}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {job.status === "running" ? (
          <Button variant="secondary" disabled={busy} onClick={onPause}>
            <Pause size={14} aria-hidden
              className="mr-1.5 inline align-text-bottom" />
            {t("copy.pause")}</Button>
        ) : (
          <Button disabled={busy} onClick={onResume}>
            <Play size={14} aria-hidden
              className="mr-1.5 inline align-text-bottom" />
            {t("copy.resume")}</Button>
        )}
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          {t("copy.cancel")}</Button>
      </div>
    </section>
  );
}

export function AccountCopyPanel({ cfg, from: startFrom, onClose,
  onReviewUnsubs }: {
  cfg: Config;
  /** The account the page opened from (Settings > account). */
  from: string;
  onClose: () => void;
  /** "Review N unsubscribes": the app opens its unsubscribe review for
   *  these senders of `account`. */
  onReviewUnsubs: (account: string, keys: string[]) => void;
}) {
  const names = useMemo(() => Object.keys(cfg.accounts), [cfg.accounts]);
  const [from, setFrom] = useState(
    names.includes(startFrom) ? startFrom : names[0] ?? "");
  const [to, setTo] = useState(() => names.find((n) => n !== from) ?? "");
  const [plan, setPlan] = useState<CopyPlan | null>(null);
  const [planErr, setPlanErr] = useState("");
  const [ticked, setTicked] = useState<Set<CopyKindId>>(new Set());
  const [folder, setFolder] = useState("");
  const [free, setFree] = useState<number | null | undefined>(undefined);
  const [folderState, setFolderState] =
    useState<FolderState>({ exists: false, reserved: false });
  const [job, setJob] = useState<CopyJob | null | undefined>(undefined);
  const [step, setStep] = useState<Step>("bring");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const alive = useRef(true);
  const seen = useRef(false);        // the first status decided the step

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const live = job?.status === "running" || job?.status === "paused";

  // The copy job (one per user): read once, then followed while it runs.
  const loadJob = useCallback(async () => {
    try {
      const { job: j } = await api.copyStatus();
      if (!alive.current) return;
      setJob(j);
      if (!seen.current) {
        seen.current = true;
        if (j) {
          setStep("copy");
          if (names.includes(j.source)) setFrom(j.source);
          if (names.includes(j.target)) setTo(j.target);
        }
      }
    } catch (e: any) {
      if (alive.current) { setJob(null); setErr(String(e.message ?? e)); }
    }
  }, [names]);
  useEffect(() => { void loadJob(); }, [loadJob]);
  useEffect(() => {
    if (job?.status !== "running") return;
    const h = setInterval(() => void loadJob(), POLL_MS);
    return () => clearInterval(h);
  }, [job?.status, loadJob]);

  // What the chosen pair offers. A new source resets the ticks and the name.
  const planFor = useRef("");
  useEffect(() => {
    if (!from || !to || from === to) { setPlan(null); return; }
    let stale = false;
    const load = () => api.copyPlan(from, to).then((p) => {
      if (stale) return;
      setPlan(p);
      setPlanErr("");
      if (planFor.current !== from) {
        planFor.current = from;
        setTicked(new Set(p.kinds.filter((k) => k.default).map((k) => k.id)));
        setFolder(t("copy.default_folder", { name: from }));
      }
    }).catch((e: any) => {
      if (!stale) { setPlan(null); setPlanErr(String(e.message ?? e)); }
    });
    void load();
    // a scan of the source is running: follow it
    const h = setInterval(() => { if (!stale) void load(); }, 4000);
    return () => { stale = true; clearInterval(h); };
  }, [from, to, job?.status === "done"]);   // eslint-disable-line react-hooks/exhaustive-deps
  // The target's free space and what its server says about the folder name
  // (asked a moment after the last keystroke).
  useEffect(() => {
    if (!to) return;
    let stale = false;
    const h = setTimeout(() => {
      api.copySpace(to, folder.trim()).then((r) => {
        if (stale) return;
        setFree(r.free);
        setFolderState({ exists: !!r.exists, reserved: !!r.reserved });
      }).catch(() => { if (!stale) setFree(null); });
    }, 350);
    return () => { stale = true; clearTimeout(h); };
  }, [to, folder]);
  useEffect(() => { setFree(undefined); }, [to]);

  const bring = useMemo(() => {
    if (!plan) return { mails: 0, size: 0 };
    const mask = [...ticked].reduce((m, k) => m | plan.bits[k], 0);
    return plan.combos.reduce((a, c) => c.mask & mask
      ? { mails: a.mails + c.mails, size: a.size + c.size } : a,
      { mails: 0, size: 0 });
  }, [plan, ticked]);

  const act = async (fn: () => Promise<{ job: CopyJob | null }>,
                     then?: () => void) => {
    setBusy(true);
    setErr("");
    try {
      const r = await fn();
      if (!alive.current) return;
      setJob(r.job);
      then?.();
    } catch (e: any) {
      if (alive.current) setErr(String(e.message ?? e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const start = (kinds: CopyKindId[], name: string, a = from, b = to) =>
    act(() => api.copyStart(a, b, kinds, name), () => setStep("copy"));

  const scanSource = async () => {
    try { await api.scan(from); } catch (e: any) { setErr(String(e.message ?? e)); }
    setPlan((p) => p && { ...p, scanning: true });
  };

  const pair = job ? { from: job.source, to: job.target } : { from, to };
  const folderOk = folder.trim().length > 0;
  const blocked = live ? t("copy.busy")
    : folderState.reserved ? t("ferr.copy_folder_reserved", { folder: folder.trim() })
    : plan && !plan.scanned ? ""
    : plan && bring.mails === 0 ? t("copy.nothing") : "";
  const reach: Record<Step, boolean> = {
    bring: true, copy: !!job, tell: !!pair.from && !!pair.to
      && pair.from !== pair.to };
  const doneStep: Record<Step, boolean> = {
    bring: !!job, copy: job?.status === "done", tell: false };
  const tellAddress = cfg.accounts[pair.to]?.user ?? "";

  const toggle = (k: CopyKindId) => setTicked((s) => {
    const next = new Set(s);
    if (!next.delete(k)) next.add(k);
    return next;
  });

  const bringBody = !plan ? (planErr ? (
    <Notice tone="danger" role="alert">{planErr}</Notice>
  ) : names.length < 2 ? (
    <EmptyState title={t("copy.entry_need_two")} />
  ) : <Loading />) : (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="min-w-0">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch
          sm:gap-3">
          <AccountBox label={t("copy.from")} name={from} names={names}
            taken={to} address={plan.source.address}
            disabled={live || busy} onPick={(n) => { setFrom(n); }}>
            {t("n.mails", { n: plan.source.mails })} ·{" "}
            {fmtSizeGb(plan.source.size)}
          </AccountBox>
          <span aria-hidden className="grid place-items-center text-accent
            max-sm:-my-0.5 max-sm:rotate-90 sm:self-center">
            <ArrowRight size={18} /></span>
          <AccountBox label={t("copy.to")} name={to} names={names}
            taken={from} address={plan.target.address}
            disabled={live || busy} onPick={(n) => setTo(n)}>
            <div className="flex items-center gap-2">
              <span className="shrink-0">{t("copy.into_folder")}</span>
              <Input value={folder} aria-label={t("copy.folder_name")}
                maxLength={100} disabled={live || busy}
                onChange={(e) => setFolder(e.target.value)}
                className="min-w-0 flex-1 font-semibold text-body" />
            </div>
          </AccountBox>
        </div>
        {!plan.scanned && (
          <Notice tone="warn" className="mt-3" icon={<Info size={16} />}>
            <div>{plan.scanning
              ? t("copy.scanning", { name: from })
              : t("copy.scan_first", { name: from })}</div>
            {!plan.scanning && (
              <Button variant="tinted" size="sm" className="mt-1.5"
                onClick={scanSource}>{t("copy.scan_now")}</Button>
            )}
          </Notice>
        )}
        <SectionLabel className="mt-4 mb-1.5 px-1">
          {t("copy.kinds")}</SectionLabel>
        <ul className="divide-y divide-line overflow-hidden rounded-card
          border border-line bg-panel">
          {KIND_ORDER.map((id) => {
            const k = plan.kinds.find((x) => x.id === id);
            if (!k) return null;
            const left = !k.default && !ticked.has(id);
            return (
              <li key={id}>
                <Checkbox checked={ticked.has(id)} disabled={live}
                  onChange={() => toggle(id)}
                  className="w-full px-3 py-1.5"
                  label={
                    <span className="flex min-w-0 items-center gap-3">
                      <IconTile tone={KIND_TONE[id]}>{KIND_ICON[id]}</IconTile>
                      <span className="min-w-0 flex-1 sm:flex sm:items-baseline
                        sm:gap-2">
                        <span className="block truncate">{kindLabel(id)}</span>
                        {left && <span className="block type-meta text-faint">
                          {t("copy.leave_behind")}</span>}
                      </span>
                      <span className="shrink-0 text-right type-meta
                        tabular-nums text-muted sm:flex sm:gap-6">
                        <span className="block sm:w-24">
                          {t("n.mails", { n: k.mails })}</span>
                        <span className="block sm:w-16">
                          {fmtSize(k.size)}</span>
                      </span>
                    </span>} />
              </li>
            );
          })}
        </ul>
        <p className="mt-2 px-1 type-meta text-muted">{t("copy.kinds_note")}</p>
      </div>
      <Summary plan={plan} bring={bring} free={free} folder={folderState}
        busy={busy} folderOk={folderOk && !folderState.reserved}
        blocked={blocked}
        onStart={() => void start([...ticked], folder)} />
    </div>
  );

  const copyBody = job === undefined ? <Loading /> : !job ? (
    <EmptyState title={t("copy.step.copy")} />
  ) : (
    <div className="max-w-2xl">
      <CopyState job={job} busy={busy}
        onPause={() => void act(api.copyPause)}
        onResume={() => void act(api.copyResume)}
        onCancel={() => void act(api.copyCancel)}
        onTell={() => setStep("tell")}
        onMore={() => void act(api.copyDismiss, () => setStep("bring"))}
        onRest={() => void start(job.kinds, job.folder, job.source,
          job.target)} />
    </div>
  );

  const tellStep = step === "tell";
  // From 1024 px this is a page whose sidebar does not lead back to the
  // account's settings: a back button says where it goes. Below, the header's
  // back link already names Settings.
  const asPage = useIsPage();
  // The steps sit in the page header from 1024 px; below it (where the header
  // is the large title with its back link) they open the page's body.
  const stepsEl = <Steps step={step} reach={reach} done={doneStep}
    onStep={setStep} />;
  return (
    <Modal onClose={onClose} size="lg">
      <PanelHeader
        title={tellStep ? t("copy.tell_title") : t("copy.title")}
        sub={tellStep ? t("copy.tell_sub", { address: tellAddress })
          : t("copy.sub")}
        actions={asPage ? stepsEl : undefined}
        closeLabel={asPage ? t("nav.back_to", { page: t("Settings") })
          : undefined}
        closeIcon={asPage ? <ArrowLeft size={18} /> : undefined}
        onClose={onClose} />
      <div data-scroll-id="panel"
        className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        {!asPage && <div className="mb-3">{stepsEl}</div>}
        {err && <Notice tone="danger" role="alert" className="mb-3"
          onClose={() => setErr("")}>{err}</Notice>}
        {step === "bring" && bringBody}
        {step === "copy" && copyBody}
        {step === "tell" && (
          <AccountCopyTell source={pair.from} target={pair.to}
            onReviewUnsubs={onReviewUnsubs} />
        )}
      </div>
      {step === "bring" && plan && (
        <div className="shrink-0 border-t border-line bg-panel px-4 pt-3
          pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5 lg:hidden">
          <GoButton bring={bring} busy={busy} onStart={() =>
            void start([...ticked], folder)}
            off={!!blocked || bring.mails === 0 || !folderOk} />
        </div>
      )}
    </Modal>
  );
}

import { CircleCheck, CircleMinus, Copy, Lock, Pin, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, mailKey } from "../api";
import { fmtAgo, fmtSize } from "../lib";
import { t } from "../i18n";
import { confirmTrashMails, itemsOf } from "../mailActions";
import type { DupKind, DupSet, DupSummary, Mail } from "../types";
import { DuplicateCompare, gapLabel } from "./DuplicateCompare";
import { MessageView } from "./MailList";
import { Avatar, Button, Checkbox, EmptyState, Loading, Modal, PanelHeader,
  Segmented, ShortDate, Tag, Toolbar, useMediaQuery, useOptionalToast } from "./ui";

const KINDS: DupKind[] = ["identical", "versions", "possible"];

type Lists = Record<DupKind, DupSet[]> & { sum: DupSummary | null };

/** The versions and possible lists and the summary are a bonus: their
 *  failure must not hide the identical list (or keep a stale selection
 *  alive). */
const soft = <T,>(fn: () => Promise<T>, fallback: T): Promise<T> =>
  Promise.resolve().then(fn).catch(() => fallback);

const loadAll = async (): Promise<Lists> => {
  const identical = await api.duplicates();
  const [versions, possible, sum] = await Promise.all([
    soft(() => api.duplicateVersions(), [] as DupSet[]),
    soft(() => api.possibleDuplicates(), [] as DupSet[]),
    soft(() => api.duplicatesSummary(), null)]);
  return { identical, versions, possible, sum };
};

/** The one-tap plan: the older copies of every identical set, except sets
 *  the backend would refuse as a whole (a pinned copy / a protected sender). */
const planOf = (sets: DupSet[]) => {
  const open = sets.filter((s) => !s.locked);
  return { items: open.flatMap((s) => s.mails.slice(1)),
    wasted: open.reduce((n, s) => n + s.wasted, 0),
    locked: sets.length - open.length };
};

/** Duplicate finder: one number and one button for the identical copies
 *  ("Remove N copies" = every identical set but its newest copy, moved to
 *  Trash through the SAME confirm / protected / pinned / undo path as
 *  "Trash selected" - only the selection is made for you), "Review each" =
 *  the manual selection mode, and a Compare sheet for versions and possible
 *  double-sends, which are never pre-marked. "Keep all" hides a set you
 *  checked (remembered per account, restorable). */
export function DuplicatesPanel({ onClose, onDeleted, scannedTs, reloadKey }: {
  onClose: () => void;
  onDeleted: () => void;
  /** When the scan the lists come from finished (epoch seconds). */
  scannedTs?: number | null;
  /** The lists are fetched again whenever this changes (a new scan, an Undo
   *  elsewhere in the app): the page may stay open while the index moves. */
  reloadKey?: string | number;
}) {
  const [lists, setLists] = useState<Lists | null>(null);
  const [error, setError] = useState("");
  const [seg, setSeg] = useState<DupKind | null>(null);
  const [review, setReview] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [view, setView] = useState<Mail | null>(null);
  const [compare, setCompare] = useState<{ kind: DupKind; key: string } | null>(null);
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(false);
  const toast = useOptionalToast();
  const keptToast = useRef<number | null>(null);
  const wide = useMediaQuery("(min-width: 640px)");

  const sets = lists?.identical ?? [];

  // New lists from the server: a ticked mail that is no longer listed (moved,
  // hidden, a set that changed) drops out of the "Review each" selection.
  const applyLists = (l: Lists) => {
    setLists(l);
    const listed = new Set<string>();
    KINDS.forEach((k) => l[k].forEach((s) => s.mails.forEach((m) =>
      listed.add(mailKey(m)))));
    setSel((prev) => prev.size === 0 || [...prev].every((k) => listed.has(k))
      ? prev : new Set([...prev].filter((k) => listed.has(k))));
  };

  useEffect(() => {
    if (!working) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const state = await api.state();
        if (!alive) return;
        if (state.delete.status === "running") {
          timer = setTimeout(poll, 800);
          return;
        }
        const next = await loadAll();
        if (!alive) return;
        applyLists(next);
        setSel(new Set());
        setNote(state.delete.error ? t("err.generic", { msg: state.delete.error }) : "");
        setWorking(false);
        onDeleted();
      } catch (e: any) {
        if (!alive) return;
        setNote(t("err.generic", { msg: e.message ?? e }));
        setWorking(false);
      }
    };
    timer = setTimeout(poll, 800);
    return () => { alive = false; clearTimeout(timer); };
  }, [working]);

  useEffect(() => {
    let alive = true;
    loadAll()
      .then((l) => alive && applyLists(l))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => { alive = false; };
  }, []);

  // The index moved under an open page (new scan, Undo): show what is true.
  const firstKey = useRef(true);
  useEffect(() => {
    if (firstKey.current) { firstKey.current = false; return; }
    let alive = true;
    loadAll().then((l) => alive && applyLists(l)).catch(() => {});
    return () => { alive = false; };
  }, [reloadKey]);

  // What a segment says it holds: the summary's full count (no 200 cap),
  // else what was listed.
  const count = (k: DupKind): number => {
    const sum = lists?.sum;
    return sum ? { identical: sum.sets, versions: sum.versions,
      possible: sum.possible }[k] : lists?.[k].length ?? 0;
  };
  const first = KINDS.find((k) => count(k) > 0) ?? "identical";
  const active: DupKind = seg && count(seg) > 0 ? seg : first;
  const dismissed = lists?.sum?.dismissed ?? 0;
  const empty = !!lists && KINDS.every((k) => lists[k].length === 0);

  const plan = useMemo(() => planOf(sets), [sets]);
  const capped = !!lists?.sum && lists.sum.sets > sets.length;

  const toggle = (k: string) => {
    if (working) return;
    const next = new Set(sel);
    next.has(k) ? next.delete(k) : next.add(k);
    setSel(next);
  };

  // Mails inside a set arrive newest-first: in every identical set select
  // everything but [0] (and untick [0], so one copy always stays). Rows the
  // user ticked in the other two sections keep their state.
  const selectAllButNewest = () => {
    const next = new Set(sel);
    sets.forEach((s) => s.mails.forEach((m, i) =>
      i === 0 ? next.delete(mailKey(m)) : next.add(mailKey(m))));
    setSel(next);
  };

  // Every way of removing mails ends here: the existing move-to-Trash call
  // (the backend refuses pinned / protected mails, records the audit entry
  // and the undo), then the same background-job polling as before.
  const trashItems = async (items: [string, number][]) => {
    try {
      await api.deleteMessages(items, "trash");
      setWorking(true);
      setNote(t("note.background", { verb: t("Move to Trash") }));
      onDeleted();
    } catch (e: any) {
      setNote(t("err.generic", { msg: e.message ?? e }));
    }
  };

  const trashSelected = async () => {
    if (!lists || sel.size === 0 || working) return;
    // exactly what is listed AND ticked: that is what the confirm counts
    const items: [string, number][] = [];
    KINDS.forEach((k) => lists[k].forEach((s) => s.mails.forEach((m) => {
      if (sel.has(mailKey(m))) items.push([m.folder, m.uid]);
    })));
    if (items.length === 0) return;
    if (!await confirmTrashMails(items.length)) return;
    await trashItems(items);
  };

  // The selection is taken from the server's answer of this moment, not
  // from what the page showed when it was opened: if it changed meanwhile,
  // the page updates and the confirm names the new count.
  const removeCopies = async () => {
    if (working || plan.items.length === 0) return;
    // No fresh answer, no move: the backend does not know which copy is the
    // newest of a set, nor which sets the user chose to keep.
    let now: ReturnType<typeof planOf>;
    try {
      const fresh = await loadAll();
      applyLists(fresh);
      now = planOf(fresh.identical);
    } catch (e: any) {
      setNote(t("err.generic", { msg: e.message ?? e }));
      return;
    }
    if (now.items.length === 0) { setNote(t("dups.gone")); return; }
    if (!await confirmTrashMails(now.items.length)) return;
    await trashItems(itemsOf(now.items));
  };

  const trashOlder = async (s: DupSet) => {
    if (working) return;
    const items = itemsOf(s.mails.slice(1));
    if (!await confirmTrashMails(items.length)) return;
    setCompare(null);
    await trashItems(items);
  };

  const refresh = async () => {
    try { applyLists(await loadAll()); }
    catch (e: any) { setNote(t("err.generic", { msg: e.message ?? e })); }
  };

  const restore = async (set?: { kind: DupKind; key: string }) => {
    // "Show hidden" makes an earlier "Hidden - Undo" toast meaningless.
    if (!set && keptToast.current != null) toast?.dismiss(keptToast.current);
    try { await api.restoreDuplicates(set); }
    catch (e: any) { setNote(t("err.generic", { msg: e.message ?? e })); return; }
    await refresh();
  };

  const keepAll = async (kind: DupKind, s: DupSet) => {
    if (working) return;
    try { await api.dismissDuplicates(kind, s.key); }
    catch (e: any) { setNote(t("err.generic", { msg: e.message ?? e })); return; }
    setCompare(null);
    setSel((prev) => {
      const next = new Set(prev);
      s.mails.forEach((m) => next.delete(mailKey(m)));
      return next;
    });
    await refresh();
    keptToast.current = toast?.show(t("dups.kept_toast"), { action: {
      label: t("Undo"), onClick: () => restore({ kind, key: s.key }) } }) ?? null;
  };

  const openMail = (m: Mail) => { setCompare(null); setView(m); };

  const toggleReview = () => {
    if (review) setSel(new Set());
    setReview(!review);
  };

  const reviewButton = (
    <Button variant={review ? "tinted" : "secondary"} disabled={working}
      onClick={toggleReview}>
      {review ? t("dups.review_done") : t("dups.review_each")}
    </Button>
  );

  const row = (kind: DupKind, s: DupSet, m: Mail, i: number,
    largest: number) => {
    const subject = m.subject || t("(no subject)");
    const mark = kind === "identical" && !s.locked
      ? (i === 0 ? "keep" : "remove") : null;
    return (
      <li key={mailKey(m)} className="flex items-stretch rounded-control
        bg-panel2">
        {review && (
          <Checkbox round checked={sel.has(mailKey(m))} className="pl-1"
            onChange={() => toggle(mailKey(m))}
            aria-label={t("select.named", { subject })} />
        )}
        <button type="button" onClick={() => setView(m)}
          className="flex min-h-9 coarse:min-h-11 min-w-0 flex-1 cursor-pointer
            items-center gap-2 px-2 py-1.5 text-left">
          {m.pinned && (
            <>
              <Pin size={14} aria-hidden className="shrink-0 text-muted" />
              <span className="sr-only">{t("dups.locked_pinned")}</span>
            </>
          )}
          {mark === "keep" && <CircleCheck size={16} aria-hidden
            className="shrink-0 text-safe-fg" />}
          {mark === "remove" && <CircleMinus size={16} aria-hidden
            className="shrink-0 text-danger-fg" />}
          {!m.seen && (
            <>
              <span aria-hidden className="inline-block size-2 shrink-0
                rounded-full bg-accent" />
              <span className="sr-only">{t("unread")}</span>
            </>
          )}
          <span className="min-w-0 truncate type-body font-semibold">
            {m.folder}</span>
          <ShortDate iso={m.date || ""} time
            className="type-meta text-muted" />
          {kind !== "identical" && (
            <span className="type-meta text-muted tabular-nums">
              {fmtSize(m.size)}</span>
          )}
          <span className="ml-auto flex shrink-0 items-center">
            {mark === "keep" && <span className="type-caption text-safe-fg">
              {t("dups.keep_tag")}</span>}
            {mark === "remove" && <span className="type-caption
              text-danger-fg">{t("dups.remove_tag")}</span>}
            {i === largest && <Tag>{t("dups.largest")}</Tag>}
          </span>
        </button>
      </li>
    );
  };

  const card = (kind: DupKind, s: DupSet) => {
    const head = s.mails[0];
    const subject = head.subject || t("(no subject)");
    // tag a copy only when it is strictly larger than every other one
    const top = Math.max(...s.mails.map((m) => m.size));
    const largest = kind === "versions"
      && s.mails.filter((m) => m.size === top).length === 1
      ? s.mails.findIndex((m) => m.size === top) : -1;
    const sizes = s.mails.map((m) => m.size);
    const [lo, hi] = [Math.min(...sizes), Math.max(...sizes)];
    const span = Math.max(...s.mails.map((m) => m.ts))
      - Math.min(...s.mails.map((m) => m.ts));
    const meta = [head.addr, ...(kind === "possible"
      ? [t("dups.poss_meta", { n: s.mails.length, gap: gapLabel(span) }),
        lo === hi ? t("dups.each", { size: fmtSize(lo) })
          : `${fmtSize(lo)} - ${fmtSize(hi)}`]
      : [`×${s.mails.length}`])].join(" · ");
    return (
      <div key={s.key} role="group" aria-label={subject}
        className="rounded-card bg-panel p-3 sm:p-4">
        <div className="flex items-start gap-3">
          <Avatar name={head.addr || "?"} size="md" />
          {/* phones: the buttons sit under the text; from sm on, at its right */}
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row
            sm:items-start sm:gap-3">
            <div className="min-w-0 flex-1">
              <div className="truncate type-body font-semibold">{subject}</div>
              <div className="break-words type-meta text-muted">{meta}</div>
              {((kind === "identical" && !s.locked) || s.locked) && (
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {kind === "identical" && !s.locked && (
                    <Tag tone="safe">{t("dups.wasted",
                      { size: fmtSize(s.wasted) })}</Tag>
                  )}
                  {s.locked && (
                    <Tag tone="review"
                      className="inline-flex items-center gap-1">
                      <Lock size={14} aria-hidden />
                      {t(`dups.locked_${s.locked}`)}
                    </Tag>
                  )}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {kind !== "identical" && (
                <Button size="sm" variant="tinted"
                  aria-label={t("dups.compare_named", { subject })}
                  onClick={() => setCompare({ kind, key: s.key })}>
                  {t("dups.compare")}
                </Button>
              )}
              <Button size="sm" variant="secondary" disabled={working}
                aria-label={t("dups.keep_all_named", { subject })}
                onClick={() => keepAll(kind, s)}>
                {t("dups.keep_all")}
              </Button>
            </div>
          </div>
        </div>
        <ul className="mt-2 space-y-1">
          {s.mails.map((m, i) => row(kind, s, m, i, largest))}
        </ul>
      </div>
    );
  };

  const showHidden = dismissed > 0 && (
    <Button variant="quiet" size="sm" disabled={working}
      onClick={() => restore()}>
      {t("dups.show_hidden", { n: dismissed })}
    </Button>
  );

  const cmpSet = compare && lists
    ? lists[compare.kind].find((s) => s.key === compare.key) : undefined;
  const ago = fmtAgo(scannedTs);

  return (
    <Modal onClose={onClose} size="lg"
      full={!!view || !lists || !empty || dismissed > 0}>
      <PanelHeader
        title={<span className="inline-flex items-center gap-2">
          <Copy size={18} /> {t("Duplicates")}
        </span>}
        sub={[t("dups.sub"), ago ? t("dups.from_scan", { ago }) : ""]
          .filter(Boolean).join(" · ")}
        onClose={onClose}
      />

      {view ? (
        <MessageView mail={view} onBack={() => setView(null)} />
      ) : (
        <>
          {(review || note) && (
            <Toolbar>
              {review && sets.length > 0 && (
                <Button variant="secondary" disabled={working}
                  onClick={selectAllButNewest}>
                  {t("dups.keep_newest")}
                </Button>
              )}
              {review && sel.size > 0 && (
                <Button variant="danger" disabled={working}
                  onClick={trashSelected}>
                  {t("Trash selected")} ({sel.size})
                </Button>
              )}
              {note && <span className="type-meta text-muted">{note}</span>}
            </Toolbar>
          )}
          <div data-scroll-id="panel"
            className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 pb-4 sm:p-5">
            {error && <div className="type-body text-danger-fg">{error}</div>}
            {!lists && !error && <Loading />}
            {empty && (
              dismissed > 0 ? (
                <EmptyState icon={<Copy size={18} />} title={t("dups.all_kept")}
                  hint={t("dups.all_kept_hint", { n: dismissed })}
                  action={showHidden} />
              ) : (
                <EmptyState icon={<Copy size={18} />} title={t("dups.none")}
                  hint={t("dups.none_hint")} />
              )
            )}
            {sets.length > 0 && (
              <section aria-label={t("dups.hero_label")}
                className="rounded-card bg-panel p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
                  <div className="min-w-0 flex-1 basis-72">
                    {plan.items.length > 0 ? (
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="type-largetitle tabular-nums">
                          {fmtSize(plan.wasted)}</span>
                        <span className="type-meta text-muted">
                          {t("dups.can_go")} - {t("dups.hero_copies",
                            { n: plan.items.length })}
                        </span>
                      </div>
                    ) : (
                      <div className="type-title2">{t("dups.hero_none")}</div>
                    )}
                    <p className="mt-1 type-meta text-muted">
                      {t("dups.hero_hint")}</p>
                    {plan.locked > 0 && (
                      <p className="mt-1 type-meta text-muted">
                        {t("dups.locked_left", { n: plan.locked })}</p>
                    )}
                    {capped && (
                      <p className="mt-1 type-meta text-muted">
                        {t("dups.capped", { n: sets.length })}</p>
                    )}
                  </div>
                  <div className="flex w-full flex-col-reverse gap-2
                    sm:w-auto sm:flex-row sm:items-center">
                    {reviewButton}
                    {plan.items.length > 0 && (
                      <Button disabled={working} onClick={removeCopies}>
                        <Trash2 size={16} aria-hidden
                          className="mr-1.5 inline align-text-bottom" />
                        {t("dups.remove_n", { n: plan.items.length })}
                      </Button>
                    )}
                  </div>
                </div>
              </section>
            )}
            {!!lists && !empty && (
              <>
                <div className="flex flex-wrap items-center justify-between
                  gap-x-4 gap-y-2">
                  <Segmented<DupKind> equal fill={!wide}
                    label={t("dups.seg_label")} value={active}
                    onChange={setSeg}
                    options={KINDS.map((k) => ({ value: k,
                      disabled: count(k) === 0,
                      label: <>{t(`dups.seg_${k}`)}{" "}
                        <span className="type-caption text-muted">
                          {count(k)}</span></> }))} />
                  <div className="flex items-center gap-2">
                    {sets.length === 0 && reviewButton}
                    {showHidden}
                    <span className="hidden type-meta text-muted sm:inline">
                      {t("dups.sorted")}</span>
                  </div>
                </div>
                {active !== "identical" && (
                  <p className="type-meta text-muted">
                    {t(`dups.${active}_hint`)}</p>
                )}
                <div data-testid={`${active}-dups`}
                  className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  {lists[active].map((s) => card(active, s))}
                </div>
              </>
            )}
          </div>
        </>
      )}
      {cmpSet && compare && !view && (
        <DuplicateCompare set={cmpSet} kind={compare.kind} busy={working}
          onClose={() => setCompare(null)} onOpen={openMail}
          onTrashOlder={() => trashOlder(cmpSet)}
          onKeepAll={() => keepAll(compare.kind, cmpSet)} />
      )}
    </Modal>
  );
}

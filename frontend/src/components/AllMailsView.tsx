import { Archive, FolderInput, MailOpen, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, mailKey } from "../api";
import { forMail } from "../mailAccount";
import { t } from "../i18n";
import { actionVerb, itemsOf, planMailAction } from "../mailActions";
import type { AppState, Mail } from "../types";
import { AcrossMailsConfirm } from "./AcrossActions";
import type { AcrossAction } from "../acrossLists";
import { AccountChips } from "./AllAccountsOverview";
import { AcrossPages } from "./AllSendersView";
import { FilterField } from "./FilterMenu";
import { FolderPicker } from "./FolderPicker";
import { MailRows, MessageView } from "./MailList";
import { NotNow, NotNowSheet } from "./NotNow";
import { useSnooze } from "./snoozeContext";
import { NO_HOST, ReaderHostProvider, type ReaderActions } from "./MailReader";
import { QueryBuilder } from "./QueryBuilder";
import { SlotChip } from "./RhythmCard";
import type { ArrivalSlot } from "../rhythm";
import { SortControl } from "./SortControl";
import { BarButton, BulkBar, Button, EmptyState, FILTER_ROW, Input, LINK, Loading, Modal,
  useMediaQuery, useToast }
  from "./ui";

type MailSort = "date" | "size" | "sender";
const SORTS: { k: MailSort; label: string }[] = [
  { k: "date", label: "mails.sort_date" },
  { k: "size", label: "mails.sort_size" },
  { k: "sender", label: "mails.sort_sender" },
];
const PAGE = 100;
// Sender reads A→Z first; date and size biggest/newest first.
const naturalDir = (k: MailSort): "asc" | "desc" =>
  k === "sender" ? "asc" : "desc";

/** The flat "All mails" view: every scanned mail of the account in one
 *  paged, sorted, filterable list (GET /api/mails - the scan index, no IMAP
 *  traffic). Rows are the search panel's MailRows; selection drives the
 *  same delete_messages actions (with the same pinned-mail confirm flow) as
 *  the group detail view. */
export function AllMailsView({ state, onChanged, toolbarSlot, initialQuery = "",
  initialSlot = null, across }: {
  /** The account's state (absent across accounts: `across.follow` stands for
   *  it). */
  state?: AppState;
  /** All accounts: the list over every account of the workspace. Rows carry
   *  their account; a selection acts through the multi-account confirm, one
   *  step per account. Moving to a folder is per account (a folder of one
   *  account means nothing in another), so the bar has no Move here. */
  across?: {
    /** The accounts' own order. */
    names: string[];
    exists: (account: string) => boolean;
    onOpenActivity: (account: string) => void;
    onPage: (p: "senders" | "all") => void;
    /** Changes whenever any account's data did (a scan, a finished move). */
    follow: string;
  };
  /** The filter the list opens with (e.g. `in:7d` from the Overview). */
  initialQuery?: string;
  /** The arrival slot it opens with (a cell of "When mail arrives"). */
  initialSlot?: ArrivalSlot | null;
  onChanged: () => void;
  /** Where the filter + sort row is rendered (App's row B, so the toolbar
   *  keeps its place when switching tabs). Inline when omitted; null =
   *  slot not mounted yet (render nothing). */
  toolbarSlot?: HTMLElement | null;
}) {
  const [q, setQ] = useState(initialQuery);
  const [dq, setDq] = useState(initialQuery);       // debounced q
  const [slot, setSlot] = useState<ArrivalSlot | null>(initialSlot);
  useEffect(() => setSlot(initialSlot), [initialSlot]);
  const [sortK, setSortK] = useState<MailSort>(() => {
    const k = localStorage.getItem("pmc_mails_sort") as MailSort | null;
    return k && SORTS.some((o) => o.k === k) ? k : "date";
  });
  const [dir, setDir] = useState<"asc" | "desc">(() => {
    const d = localStorage.getItem("pmc_mails_dir");
    return d === "asc" || d === "desc" ? d : "desc";
  });
  const [mails, setMails] = useState<Mail[]>([]);
  const [total, setTotal] = useState(0);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [view, setView] = useState<Mail | null>(null);
  const toast = useToast();
  const snooze = useSnooze();
  const [snoozing, setSnoozing] = useState<Mail | null>(null);
  const phone = useMediaQuery("(width < 48rem)");
  const filterRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [moveDest, setMoveDest] = useState("");
  // All accounts: the account chip above the list, and the selection action
  // whose confirm is open (what it was asked for stays as it was drawn).
  const [only, setOnly] = useState<string | null>(null);
  const [acting, setActing] = useState<{ mails: Mail[];
    action: AcrossAction } | null>(null);
  // What the list on screen was loaded for: a rescan/deletion (groups_rev)
  // refreshes in place, keeping as many pages as were loaded; a new
  // query or sort starts over at the first page.
  const loaded = useRef({ key: "", count: 0 });

  useEffect(() => {
    localStorage.setItem("pmc_mails_sort", sortK);
    localStorage.setItem("pmc_mails_dir", dir);
  }, [sortK, dir]);

  useEffect(() => {
    const h = setTimeout(() => setDq(q.trim()), 250);
    return () => clearTimeout(h);
  }, [q]);

  useEffect(() => {
    if (!sel.size) setMoveDest("");
  }, [sel.size]);

  const fetchKey = `${dq}\u0000${sortK}\u0000${dir}\u0000${
    slot ? JSON.stringify(slot) : ""}\u0000${only ?? ""}`;
  // What a scan, a delete or a restore changed: the list reads again.
  const rev = across ? across.follow
    : `${state!.groups_rev}\u0000${state!.account}`;
  const read = (offset: number, limit: number) =>
    (across ? api.accountsMails : api.mails)({ offset, limit, sort: sortK,
      dir, q: dq, ...(slot && { slot }), ...(across && only && { only }) });
  useEffect(() => {
    let alive = true;     // a slow response for a previous query is dropped
    const sameQuery = loaded.current.key === fetchKey;
    const limit = sameQuery
      ? Math.min(Math.max(loaded.current.count, PAGE), 1000) : PAGE;
    if (!sameQuery) setLoading(true);
    read(0, limit)
      .then((r) => {
        if (!alive) return;
        loaded.current = { key: fetchKey, count: r.mails.length };
        setMails(r.mails);
        setTotal(r.total);
        setIgnored(r.ignored);
        setError("");
        const present = new Set(r.mails.map(mailKey));
        setSel((s) => new Set([...s].filter((k) => present.has(k))));
      })
      .catch((e) => alive && setError(String(e.message ?? e)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // rev: a scan finished or a delete/restore patched the index.
  }, [fetchKey, rev]);

  const latestKey = useRef(fetchKey);
  latestKey.current = fetchKey;
  const loadMore = async () => {
    const startKey = fetchKey;
    setMore(true);
    try {
      const r = await read(mails.length, PAGE);
      // A newer filter / sort replaced the list meanwhile: this page belongs
      // to the old one.
      if (latestKey.current !== startKey) { setMore(false); return; }
      const have = new Set(mails.map(mailKey));
      const next = [...mails, ...r.mails.filter((m) => !have.has(mailKey(m)))];
      loaded.current = { key: fetchKey, count: next.length };
      setMails(next);
      setTotal(r.total);
    } catch (e: any) {
      if (latestKey.current === startKey) setError(String(e.message ?? e));
    }
    setMore(false);
  };

  const toggle = (k: string) => {
    const next = new Set(sel);
    next.has(k) ? next.delete(k) : next.add(k);
    setSel(next);
  };

  const togglePin = async (m: Mail, pinned = !m.pinned): Promise<boolean> => {
    try {
      await forMail(m, () => api.pin(m.folder, m.uid, pinned));
      setMails((cur) => cur.map((x) =>
        mailKey(x) === mailKey(m) ? { ...x, pinned } : x));
      // A freshly pinned mail drops out of the selection: it must not stay
      // ticked unnoticed.
      if (pinned && sel.has(mailKey(m))) {
        const next = new Set(sel);
        next.delete(mailKey(m));
        setSel(next);
      }
      return true;
    } catch (e: any) {
      toast.show(`${t("pin.error")}: ${e.message ?? e}`,
        { variant: "error" });
      return false;
    }
  };

  const act = (action: string, dest = "") =>
    actOn(mails.filter((m) => sel.has(mailKey(m))), action, dest);

  // `chosen` is the ticked mails (the bar) or the one mail of a row swipe:
  // both take the same pinned-mail warning, confirm and background job.
  // Resolves true when the job was queued (the reader closes after that).
  // `single`: the reader's one mail - only it leaves the selection.
  const actOn = async (chosen: Mail[], action: string, dest = "",
      single = false) => {
    if (!chosen.length) return false;
    if (across) {
      // One step per account, each asked and run in the multi-account
      // confirm; the list follows when it is done.
      setActing({ mails: chosen, action: action as AcrossAction });
      return false;
    }
    const verb = actionVerb(action, dest);
    const plan = await planMailAction(chosen, action, verb);
    if (plan.kind === "cancelled") return false;
    if (plan.kind === "all_pinned") {
      toast.show(t("toast.all_pinned"));
      return false;
    }
    if (plan.kind === "error") {
      toast.show(t("err.generic", { msg: (plan.error as Error)?.message
        ?? String(plan.error) }), { variant: "error" });
      return false;
    }
    const { acting, force, protectedNow } = plan;
    const keys = new Set(acting.map(mailKey));
    // mails the keep-safe box just protected stay, now shown as protected
    if (protectedNow.length) {
      const kept = new Set(protectedNow.map(mailKey));
      setMails((cur) => cur.map((m) =>
        kept.has(mailKey(m)) ? { ...m, pinned: true } : m));
    }
    setBusy(true);
    try {
      await api.deleteMessages(itemsOf(acting), action, dest, force);
      if (action === "mark_read") {
        setMails((cur) => cur.map((m) =>
          keys.has(mailKey(m)) ? { ...m, seen: true } : m));
      } else {
        setMails((cur) => cur.filter((m) => !keys.has(mailKey(m))));
        setTotal((n) => Math.max(0, n - keys.size));
      }
      setSel(single ? (cur) => new Set([...cur].filter((k) => !keys.has(k)))
        : new Set());
      // Short-lived: the result toast (App) follows when the job ends.
      toast.show(t("note.background", { verb }), { duration: 3000 });
      onChanged();
      setBusy(false);
      return true;
    } catch (e: any) {
      toast.show(t("err.generic", { msg: e.message ?? e }),
        { variant: "error" });
    }
    setBusy(false);
    return false;
  };

  // The reader's toolbar: the same confirm / pinned flow as the bar, and the
  // reader closes once the mail is on its way out.
  // (`view` is a snapshot: the pin state is read live from the list)
  const liveOf = (m: Mail) => mails.find((x) => mailKey(x) === mailKey(m)) ?? m;
  const readerActions: ReaderActions = {
    trash: async (m) => {
      if (await actOn([liveOf(m)], "trash", "", true)) setView(null);
    },
    ...(across ? {} : { move: async (m: Mail, dest: string) => {
      const ok = await actOn([liveOf(m)], "move", dest, true);
      if (ok) setView(null);
      return ok;
    } }),
    pin: (m, pinned) => togglePin(liveOf(m), pinned),
    snooze: async (m, until) => {
      const ok = await snooze.mails([[m.folder, m.uid]], until);
      if (ok) {
        setView(null);
        setMails((cur) => cur.filter((x) => mailKey(x) !== mailKey(m)));
        setTotal((n) => Math.max(0, n - 1));
        onChanged();
      }
      return ok;
    },
  };
  // The ticked mails wait until `until` (the server leaves pinned ones).
  const snoozeSelected = async (until: number) => {
    const chosen = mails.filter((m) => sel.has(mailKey(m)));
    if (!chosen.length) return;
    if (await snooze.mails(itemsOf(chosen), until)) {
      setMails((cur) => cur.filter((m) => !sel.has(mailKey(m)) || !!m.pinned));
      setTotal((n) => Math.max(0, n - chosen.filter((m) => !m.pinned).length));
      setSel(new Set());
      onChanged();
    }
  };

  const onAction = (v: string) => {
    if (v === "move") setMoveDest("?");   // reveal the folder picker
    else if (v) act(v);
  };

  const selectAll = () => setSel(sel.size === mails.length
    ? new Set() : new Set(mails.map(mailKey)));
  const selectLabel = sel.size === mails.length
    ? t("Clear selection") : t("mails.select_loaded", { n: mails.length });
  const sortControl = (
    <SortControl options={SORTS} value={sortK} dir={dir} plain={phone}
      onValue={(k) => { setSortK(k); setDir(naturalDir(k)); }}
      onDir={setDir} />
  );
  // Phones follow the Senders toolbar: the field with its magnifier and the
  // filter builder inside, the counts as the subtitle, plain accent icons.
  const filterControls = phone ? (<>
      <div className="relative min-w-0 flex-1 basis-full">
        <FilterField value={q} onChange={setQ} token={null}
          inputRef={filterRef} placeholder={t("mails.filter")}
          hint={t("mails.filter_tip")}
          builder={<QueryBuilder value={q} onChange={setQ} plain mailOnly
            label={t("qb.title")} />} />
      </div>
      <div className="min-w-0 flex-1 type-meta text-muted">
        <div className="min-h-5">{loading && !mails.length ? ""
          : t("mails.count", { n: mails.length, total })}</div>
        {mails.length > 0 && (
          <button className={`${LINK} coarse:min-h-11`} onClick={selectAll}>
            {selectLabel}
          </button>
        )}
      </div>
      {sortControl}
  </>) : (<>
      <div className="relative min-w-0 flex-1 md:min-w-70">
        <Input className="w-full pr-9 coarse:pr-10" value={q}
          placeholder={t("mails.filter")}
          title={t("mails.filter_tip")}
          onChange={(e) => setQ(e.target.value)} />
        {!!q && (
          <span className="absolute inset-y-0 right-0 flex items-center">
            <Button variant="quiet" size="icon" label={t("Clear filter")}
              className="text-muted hover:text-body"
              onClick={() => setQ("")}>
              <X size={16} />
            </Button>
          </span>
        )}
      </div>
      {sortControl}
  </>);
  const filterRow = <div className={FILTER_ROW}>{filterControls}</div>;

  // The mails of an account whose step ran leave the list (their move runs in
  // the background); the reader closes if its mail was one of them.
  const actedOn = (acted: Mail[]) => {
    const gone = new Set(acted.map(mailKey));
    const mark = acting?.action === "mark_read";
    setMails((cur) => mark
      ? cur.map((m) => gone.has(mailKey(m)) ? { ...m, seen: true } : m)
      : cur.filter((m) => !gone.has(mailKey(m))));
    if (!mark) setTotal((n) => Math.max(0, n - gone.size));
    setSel((cur) => new Set([...cur].filter((k) => !gone.has(k))));
    if (!mark && view && gone.has(mailKey(view))) setView(null);
    onChanged();
  };

  const body = (
    <div>
      {across && phone && (
        <AcrossPages page="all" onPage={across.onPage} />
      )}
      {toolbarSlot !== null && (toolbarSlot
        ? createPortal(filterControls, toolbarSlot) : filterRow)}
      {across && (
        <div className="mb-2">
          <AccountChips names={across.names} selected={only}
            onSelect={setOnly} />
        </div>
      )}
      {!phone && (
        <div className="mb-2 flex min-h-5 flex-wrap items-center gap-x-3
          type-meta text-muted">
          <span>{loading && !mails.length ? ""
            : t("mails.count", { n: mails.length, total })}</span>
          {mails.length > 0 && (
            <button className={LINK} onClick={selectAll}>{selectLabel}</button>
          )}
        </div>
      )}
      {slot && <SlotChip slot={slot} onClear={() => setSlot(null)} />}
      {ignored.length > 0 && (
        <p className="mb-2 type-meta text-muted">
          {t("mails.ignored", { list: ignored.join(" ") })}
        </p>
      )}

      {error && <div className="p-4 type-body text-danger-fg">{error}</div>}
      {loading && !mails.length && !error && (
        <div aria-busy>
          <ul aria-hidden className="pmc-loading">
            {Array.from({ length: 8 }, (_, i) => (
              <li key={i} className="flex items-center gap-3 border-b
                border-line/60 px-3 py-3 md:px-2 md:py-2.5">
                <span className="size-6 shrink-0 rounded-full bg-panel2" />
                <span className="min-w-0 flex-1 space-y-2">
                  <span className="block h-3.5 w-3/4 rounded-control bg-panel2" />
                  <span className="block h-3 w-1/2 rounded-control bg-panel2" />
                </span>
              </li>
            ))}
          </ul>
          <Loading className="py-6" />
        </div>
      )}
      {!loading && !error && mails.length === 0 && (
        <EmptyState>
          {dq || slot ? t("mails.none") : t("No scan yet - hit “Scan”.")}
        </EmptyState>
      )}
      <MailRows mails={mails} sel={sel} onToggle={toggle} onOpen={setView}
        onPin={togglePin} detailed paged
        // (the bar's buttons are disabled while a move runs: so is a swipe)
        swipe={{ bg: "bg-surface",
          trash: (m) => { if (!busy) void actOn([m], "trash"); },
          read: (m) => { if (!busy) void actOn([m], "mark_read"); },
          snooze: (m) => { if (!busy) setSnoozing(m); } }} />
      {snoozing && (
        <NotNowSheet scope="mail" n={1}
          who={snoozing.subject || t("(no subject)")}
          onSnooze={(until) => readerActions.snooze!(snoozing, until)}
          onClose={() => setSnoozing(null)} />
      )}
      {mails.length < total && (
        <div className="py-3 text-center">
          <Button variant="secondary" disabled={more} onClick={loadMore}>
            {t("mails.load_more", { n: Math.min(PAGE, total - mails.length) })}
          </Button>
        </div>
      )}
      {sel.size > 0 && (
        <BulkBar
          summary={t("detail.n_selected", { n: sel.size })}
          onClear={() => setSel(new Set())}
          actions={(
            <>
              <BarButton icon={<Archive size={16} aria-hidden />}
                disabled={busy} onClick={() => onAction("archive")}>
                {t("Archive")}
              </BarButton>
              {!across && (
                <BarButton icon={<FolderInput size={16} aria-hidden />}
                  disabled={busy} data-bar-move=""
                  onClick={() => onAction("move")}>
                  {t("bar.move")}
                </BarButton>
              )}
              <BarButton icon={<MailOpen size={16} aria-hidden />}
                disabled={busy} onClick={() => onAction("mark_read")}>
                {t("Mark read")}
              </BarButton>
              <NotNow look="bar" scope="selected" n={sel.size}
                who={t("nav.all_mail")} disabled={busy}
                onSnooze={snoozeSelected} />
            </>
          )}
          primary={
            <Button variant="danger" size="sm" disabled={busy}
              className="min-h-9 whitespace-nowrap rounded-full"
              onClick={() => act("trash")}>
              {t("Trash selected")} ({sel.size})
            </Button>
          } />
      )}
      {!across && moveDest === "?" && sel.size > 0 && (
        <FolderPicker count={sel.size} folders={state!.folders_raw ?? []}
          labels={state!.folders} account={state!.account}
          onPick={(f) => act("move", f)}
          onClose={() => setMoveDest("")} />
      )}

      {view && (
        // The reader owns the history entry (MessageView), not this shell.
        <Modal onClose={() => setView(null)} fit backLayer={false}>
          <MessageView mail={view} onBack={() => setView(null)}
            actions={readerActions} backLabel={t("nav.all_mail")}
            nav={{ list: mails, onOpen: setView }} />
        </Modal>
      )}
      {acting && across && (
        <AcrossMailsConfirm mails={acting.mails} action={acting.action}
          order={across.names} exists={across.exists}
          onOpenActivity={(a) => { setActing(null); across.onOpenActivity(a); }}
          onChanged={actedOn} onClose={() => setActing(null)} />
      )}
    </div>
  );
  // The app's own reader host belongs to ONE account: across accounts the
  // reader reads (and pins, and trashes through the confirm), nothing more.
  return across
    ? <ReaderHostProvider value={NO_HOST}>{body}</ReaderHostProvider> : body;
}

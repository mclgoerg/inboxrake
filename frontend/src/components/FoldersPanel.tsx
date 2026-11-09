import { Ban, Inbox, RefreshCw, Search, ShieldAlert, Trash2, TriangleAlert,
  Undo2, UserCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { accountGuard } from "../accountGuard";
import { nowDate } from "../clock";
import { api, fmtSize, mailKey } from "../api";
import { getLang, t } from "../i18n";
import { fmtDate } from "../lib";
import type { AppState, FolderRole, Mail, PurgeSelect, SenderGroup, TrashResp,
  UndoIdent }
  from "../types";
import { MessageView } from "./MailList";
import type { ReaderActions } from "./MailReader";
import { TrashCard } from "./TrashCard";
import { Avatar, Button, Checkbox, confirmDialog, EmptyState, IconTile, Input,
  Loading, MailRow, Modal, Notice, PanelHeader, promptDialog, PopupSelect, Segmented,
  Spinner, Tag, Toolbar, useMediaQuery, useToast } from "./ui";

type Grouping = "sender" | "mails";

/** Phone-sized touch height for the toolbar's pop-up buttons. */
const TALL = "max-sm:min-h-11 max-sm:coarse:min-h-11";

/** The Trash and Junk pages (one component, the route picks the folder; each
 *  is one tap away from the sidebar and the Clean up tiles). Live contents
 *  (also mail that arrived or was deleted elsewhere), search, Select mode,
 *  and per-folder actions. Trash: the size card with "Empty automatically"
 *  (`TrashCard`), a Restore button per mail (to the Inbox; Select mode
 *  keeps "Restore to…"), "Delete older than…" / "Empty Trash" in the bottom
 *  bar. Junk: by sender with Not junk / Block / Trash per row, the "senders
 *  you know" banner, "Not junk" (to the Inbox, undoable, then offers
 *  Protect). Both folders also get the irreversible "Delete permanently…"
 *  (selection / sender / older than N days / Empty): always counted live on
 *  the server first, confirmed with the counts, and sent back as the counted
 *  UIDVALIDITY + exact UIDs. */
export function FoldersPanel({ state, initialRole = "trash", onClose,
  onChanged, onEmptyTrash, onUndo, onProtect, onBlock, blockedSenders,
  onChooseFolder }: {
  state: AppState;
  /** The folder this page shows; follows the route when it changes. */
  initialRole?: FolderRole;
  onClose: () => void;
  onChanged: () => void;
  /** The shared "Empty Trash" flow (confirm + permanent delete), given the
   *  live total this panel just listed; resolves true once emptied. */
  onEmptyTrash: (listing: TrashResp) => Promise<boolean>;
  /** Undo the recorded move (the App's confirmed undo). */
  onUndo: (entry: UndoIdent) => void;
  /** Protect these senders (the App's one-tap protect). */
  onProtect: (addrs: string[]) => Promise<boolean>;
  /** Block one sender address (the App's confirmed Block); resolves true
   *  once blocked. Without it the Junk rows have no Block button. */
  onBlock?: (addr: string) => Promise<boolean>;
  /** Addresses that already have a block rule (shown as "Blocked"). */
  blockedSenders?: ReadonlySet<string>;
  /** Open the account's folder setting (where the ambiguous role is
   *  chosen); without it the notice has no button. */
  onChooseFolder?: () => void;
}) {
  const toast = useToast();
  const wide = useMediaQuery("(min-width: 640px)");   // phones: own full row
  const [role, setRole] = useState<FolderRole>(initialRole);
  const [list, setList] = useState<TrashResp | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  // Junk is reviewed by sender (rescue false alarms), Trash as a mail list
  const [grouping, setGrouping] = useState<Grouping>(
    initialRole === "junk" ? "sender" : "mails");
  const [selecting, setSelecting] = useState(false);
  // `selRaw` may still hold mails a search / view / filter hides; everything
  // that acts or counts uses `sel`, the part of it you can actually see.
  const [selRaw, setSel] = useState<Set<number>>(new Set());
  const [knownOnly, setKnownOnly] = useState(false);
  const [view, setView] = useState<Mail | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // Only the newest request may land (switching Junk | Trash quickly).
  const req = useRef(0);
  const load = (r: FolderRole = role) => {
    const mine = ++req.current;
    setList(null);
    setError("");
    setSel(new Set());
    api.foldersPanel(r)
      .then((l) => { if (mine === req.current) setList(l); })
      .catch((e) => {
        if (mine === req.current) setError(String(e.message ?? e));
      });
  };
  useEffect(() => load(role), [role]);
  const switchRole = (r: FolderRole) => {
    setRole(r); setQ(""); setNote(""); setSearching(false);
    setSelecting(false); setKnownOnly(false);
    setGrouping(r === "junk" ? "sender" : "mails");
  };
  useEffect(() => {
    if (initialRole !== role) switchRole(initialRole);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRole]);

  // Senders you replied to (main index): a Junk sender among them is
  // probably a false alarm.
  const known = useMemo(() => new Set(
    role === "junk"
      ? Object.values(state.groups?.sender ?? {})
        .filter((g) => g.replied).map((g) => g.key)
      : []), [role, state.groups]);
  const knownSenders = useMemo(
    () => (list?.senders ?? []).filter((g) => known.has(g.addr)),
    [list, known]);
  // the mail the Restore button sends to
  const inbox = (state.folders_raw ?? []).find((f) => /^inbox$/i.test(f));

  // on only while there is still someone to show (no flash of "no match")
  const onlyKnown = knownOnly && knownSenders.length > 0;
  const needle = q.trim().toLowerCase();
  const shownMails = useMemo(() => {
    if (!list) return null;
    return list.mails.filter((m) =>
      (!onlyKnown || known.has(m.addr))
      && (!needle || m.subject.toLowerCase().includes(needle)
        || m.addr.includes(needle)));
  }, [list, needle, onlyKnown, known]);
  const shownSenders = useMemo(() => {
    if (!list) return null;
    return (list.senders ?? []).filter((g) =>
      (!onlyKnown || known.has(g.addr)) && (!needle || g.addr.includes(needle)));
  }, [list, needle, onlyKnown, known]);
  const shown = grouping === "sender" ? shownSenders : shownMails;

  const sel = useMemo(() => {
    if (!shown) return selRaw;
    const visible = new Set<number>(grouping === "sender"
      ? (shownSenders ?? []).flatMap((g) => g.uids)
      : (shownMails ?? []).map((m) => m.uid));
    const keep = [...selRaw].filter((u) => visible.has(u));
    return keep.length === selRaw.size ? selRaw : new Set(keep);
  }, [selRaw, shown, grouping, shownSenders, shownMails]);
  // a hidden mail never comes back ticked when the filter is cleared
  useEffect(() => { if (sel !== selRaw) setSel(sel); }, [sel, selRaw]);
  // the "senders you know" filter ends with the last known sender
  useEffect(() => {
    if (knownOnly && list && knownSenders.length === 0) setKnownOnly(false);
  }, [knownOnly, list, knownSenders]);

  const toggle = (uids: number[]) => {
    const next = new Set(sel);
    const all = uids.every((u) => next.has(u));
    for (const u of uids) all ? next.delete(u) : next.add(u);
    setSel(next);
  };
  const endSelect = () => { setSelecting(false); setSel(new Set()); };

  const dropped = (uids: Set<number>, n: number) => {
    setList((l) => l && {
      ...l, total: l.total - n,
      mails: l.mails.filter((m) => !uids.has(m.uid)),
      senders: (l.senders ?? []).map((g) => {
        const uidList = g.uids.filter((u) => !uids.has(u));
        const gone = g.uids.length - uidList.length;
        if (!gone) return g;
        // the size card follows: exact for mails of the listing, the sender's
        // average for the few beyond its newest 1000
        const known = new Map(l.mails.map((m) => [m.uid, m.size]));
        const freed = g.uids.filter((u) => uids.has(u)).reduce(
          (sum, u) => sum + (known.get(u) ?? g.size / g.uids.length), 0);
        return { ...g, uids: uidList, count: g.count - gone,
          size: Math.max(0, Math.round(g.size - freed)) };
      }).filter((g) => g.count > 0),
    });
    setSel(new Set());
  };

  // The page's toast is the result: the backend's notice of the same move
  // (shown while the rescan runs) would otherwise stay above the app until
  // dismissed. The "..._rescan" variants ask the user to act and stay.
  const clearMoveNotice = () => {
    api.clearNotice(["junk_rescued", "trash_restored"]).catch(() => {});
  };

  const restore = async (dest: string, uids: number[] = [...sel],
                         toRow = false) => {
    if (!list || !dest || uids.length === 0) return;
    setBusy(true);
    setNote("");
    try {
      const r = await api.trashRestore(uids, dest, list.uv);
      const msg = t(r.rescan ? "trash.restored_refreshing"
        : "trash.restored", { n: r.restored });
      if (toRow) toast.show(msg, { variant: "success" });
      else setNote(msg);
      dropped(new Set(uids), r.restored);
      clearMoveNotice();
      onChanged();
    } catch (e: any) {
      const msg = t("err.generic", { msg: e.message ?? e });
      if (toRow) toast.show(msg, { variant: "error" });
      else setNote(msg);
    }
    setBusy(false);
  };

  // Junk -> Inbox ("Not junk", the primary action) or -> Trash. Both are
  // plain undoable moves; nothing is protected or blocked silently.
  const moveJunk = async (action: "not_junk" | "trash",
                          uids: number[] = [...sel]): Promise<boolean> => {
    if (!list || uids.length === 0) return false;
    setBusy(true);
    setNote("");
    try {
      let r;
      try {
        r = await api.folderMove("junk", action, uids, list.uv);
      } catch (e: any) {
        // protected senders / pinned mails need an explicit yes (same as
        // every other Trash move)
        if (action !== "trash" || !e.code) throw e;
        if (!await confirmDialog({
          title: t("fp.confirm_protected_title"),
          body: String(e.message), tone: "danger",
          confirmLabel: t("fp.confirm_protected_btn") })) {
          setBusy(false);
          return false;
        }
        r = await api.folderMove("junk", action, uids, list.uv, true);
      }
      dropped(new Set(uids), r.moved);
      const undo = r.undo ? { label: t("Undo"),
        onClick: () => onUndo(r.undo!) } : undefined;
      if (action === "not_junk") {
        toast.show(t("fp.not_junk_done", { n: r.moved }), {
          variant: "success", action: undo, duration: 12000,
          action2: r.senders.length ? {
            label: t("fp.protect_sender", { n: r.senders.length }),
            onClick: () => { void onProtect(r.senders); },
          } : undefined,
        });
      } else {
        toast.show(t("toast.moved_trash", { n: r.moved }),
          { variant: "success", action: undo });
      }
      clearMoveNotice();
      onChanged();
      setBusy(false);
      return true;
    } catch (e: any) {
      setNote(t("err.generic", { msg: e.message ?? e }));
    }
    setBusy(false);
    return false;
  };

  // Permanent delete: the live count (fresh server listing, protected /
  // pinned mails already skipped there) -> a danger confirm showing the
  // counts -> the delete of exactly the counted UIDs. Nothing happens
  // without the confirm.
  const purge = async (select: PurgeSelect) => {
    // The count and the confirm are about the account shown when it started.
    const switched = accountGuard();
    setBusy(true);
    setNote("");
    try {
      const folder = role === "junk" ? t("Junk") : t("Trash");
      const c = await api.purgePreview(role, select);
      setBusy(false);
      if (switched()) return;
      if (c.count === 0) {
        const skipped = [
          c.skipped_protected > 0
            && t("fp.purge_b_protected", { n: c.skipped_protected }),
          c.skipped_pinned > 0
            && t("fp.purge_b_pinned", { n: c.skipped_pinned }),
        ].filter(Boolean).join("; ");
        toast.show(skipped ? t("fp.purge_none_skipped", { skipped })
          : t("fp.purge_none"));
        return;
      }
      const everything = "everything" in select;
      const bullets = [t("fp.purge_b_delete", { n: c.count })];
      if (c.skipped_protected > 0) {
        bullets.push(t("fp.purge_b_protected", { n: c.skipped_protected }));
      }
      if (c.skipped_pinned > 0) {
        bullets.push(t("fp.purge_b_pinned", { n: c.skipped_pinned }));
      }
      const scope = "older_than_days" in select
        ? t("fp.purge_scope_older", { n: select.older_than_days }) + " "
        : "";
      if (!await confirmDialog({
        title: t(everything ? "fp.purge_title_empty" : "fp.purge_title",
          { folder }),
        body: scope + t(c.via_trash ? "fp.purge_body_junk"
          : "fp.purge_body_trash"),
        bullets, tone: "danger",
        confirmLabel: t("fp.purge_btn", { n: c.count }) })) return;
      if (switched()) return;
      setBusy(true);
      // role + folder + uv + UIDs: exactly what the count read
      const r = await api.purge(c.role, c.uids, c.uv, c.folder,
        c.trash_folder);
      const skipped = r.skipped_protected + r.skipped_pinned;
      if (r.unverified > 0) {
        // Junk mails moved to Trash that could not be matched with
        // certainty: nothing was deleted permanently for them
        toast.show(t("fp.purge_unverified", { n: r.unverified }), {
          variant: "error", duration: 0,
          action: r.undo ? { label: t("Undo"),
            onClick: () => onUndo(r.undo!) } : undefined });
      }
      if (r.deleted > 0) {
        toast.show(t(skipped ? "fp.purged_skipped" : "fp.purged",
          { n: r.deleted, k: skipped }), { variant: "success" });
      } else if (r.unverified === 0) {
        toast.show(t("fp.purge_nothing_left"));       // all of them vanished
      }
      load();
      onChanged();
    } catch (e: any) {
      const msg = t("err.generic", { msg: e.message ?? e });
      setNote(msg);
      toast.show(msg, { variant: "error" });
    }
    setBusy(false);
  };

  // The selection as a purge request: whole sender rows -> those senders
  // (the server then counts all their mails live), else the exact UIDs.
  const purgeSelection = () => {
    if (!list || sel.size === 0) return;
    const whole = (list.senders ?? []).filter((g) =>
      g.uids.every((u) => sel.has(u)));
    const covered = new Set(whole.flatMap((g) => g.uids));
    if (grouping === "sender" && whole.length > 0
        && covered.size === sel.size && [...sel].every((u) => covered.has(u))) {
      void purge({ senders: whole.map((g) => g.addr) });
    } else {
      void purge({ uids: [...sel] });
    }
  };

  // Block only creates the block rule; the sender's mail already in Junk
  // stays unless you say so (the same second question as the group Block).
  const blockRow = async (g: SenderGroup) => {
    if (!onBlock || !await onBlock(g.addr)) return;
    if (await confirmDialog({
      title: t("fp.block_trash", { n: g.uids.length }), tone: "danger",
      cancelLabel: t("fp.block_keep"),
      confirmLabel: t("confirm.btn_n",
        { verb: t("fp.to_trash"), n: g.uids.length }) })) {
      await moveJunk("trash", g.uids);
    }
  };

  const purgeOlder = async () => {
    const v = await promptDialog({
      title: t("fp.older_title"), label: t("fp.older_label"),
      initial: "30", confirmLabel: t("fp.older_btn"),
      validate: (x) => /^\d{1,5}$/.test(x.trim()) && Number(x) >= 1
        && Number(x) <= 36500
        ? null : t("fp.older_invalid") });
    if (v !== null) void purge({ older_than_days: Number(v) });
  };

  const junk = role === "junk";
  // Several folders could be this role (or, on Junk, the Trash a permanent
  // delete goes through): saying so now beats failing after the click
  const unclear = list?.ambiguous ?? [];
  const blocked = unclear.length > 0;
  // what the disabled delete buttons point at: a visible reason beside them
  // (the notice above scrolls away on a phone)
  const describedBy = blocked ? "fp-ambiguous-reason" : undefined;
  // The reader's Trash on a Junk mail: the same move (and protected-sender
  // confirm) as the row's Trash. Trash has nothing to move a mail to.
  const readerActions: ReaderActions | undefined = junk ? {
    trash: async (m) => { if (await moveJunk("trash", [m.uid])) setView(null); },
  } : undefined;
  const title = junk ? t("Junk") : t("Trash");
  const hasRows = !!list && list.total > 0;
  const rowBtn = "max-sm:min-h-11 max-sm:coarse:min-h-11";
  return (
    <Modal onClose={onClose} size="lg" full>
      <PanelHeader
        title={title}
        sub={list
          ? junk ? t("fp.junk_sub", { n: list.total })
            : list.total > list.mails.length
              ? `${t("n.mails", { n: list.total })} (${t("trash.newest_shown",
                { n: list.mails.length })})`
              : undefined
          : t("loading…")}
        actions={<>
          <Button variant="secondary" size="icon" label={t("Search")}
            aria-pressed={searching}
            onClick={() => { if (searching) setQ(""); setSearching(!searching); }}>
            <Search size={18} />
          </Button>
          <Button variant="secondary" size="icon" label={t("Refresh")}
            onClick={() => load()}><RefreshCw size={18} /></Button>
        </>}
        onClose={onClose}
      />

      {view ? (
        <MessageView mail={view} onBack={() => setView(null)}
          actions={readerActions} backLabel={junk ? t("Junk") : t("Trash")}
          nav={shownMails ? { list: shownMails, onOpen: setView } : undefined} />
      ) : (
        <>
          <div data-scroll-id="panel" className="min-h-0 flex-1 overflow-y-auto
            px-4 pb-4 pt-3">
            {blocked && (
              <Notice tone="warn" className="mb-3"
                icon={<TriangleAlert size={16} />}>
                <div id="fp-ambiguous">
                  {unclear.length > 1
                    ? t("fp.ambiguous_both", {
                      role: t(`role.${unclear[0].role}`),
                      folders: unclear[0].choices.join(", "),
                      role2: t(`role.${unclear[1].role}`),
                      folders2: unclear[1].choices.join(", ") })
                    : t("fp.ambiguous", { role: t(`role.${unclear[0].role}`),
                      folders: unclear[0].choices.join(", ") })}
                </div>
                {onChooseFolder && (
                  <Button size="sm" variant="secondary" className="mt-2"
                    onClick={onChooseFolder}>
                    {t("fp.ambiguous_choose")}
                  </Button>
                )}
              </Notice>
            )}
            {!junk && (
              <TrashCard list={list} rules={state.rules ?? []}
                onChanged={onChanged} />
            )}
            {junk && knownSenders.length > 0 && (
              <div className="mb-3 flex items-center gap-3 rounded-card
                bg-safe-bg p-3">
                <IconTile tone="safe"><UserCheck size={16} /></IconTile>
                <div className="min-w-0 flex-1">
                  <div className="type-body font-semibold">
                    {t("fp.known_title", { n: knownSenders.length })}
                  </div>
                  <div className="type-meta text-muted">{t("fp.known_sub")}</div>
                </div>
                <Button size="sm" variant="secondary" aria-pressed={knownOnly}
                  onClick={() => setKnownOnly(!knownOnly)}>
                  {t(knownOnly ? "fp.known_all" : "fp.known_show")}
                </Button>
              </div>
            )}
            {hasRows && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Segmented value={grouping} label={t("fp.grouping")}
                  tall={!wide} equal onChange={setGrouping}
                  options={junk ? [
                    { value: "sender", label: t("fp.by_sender") },
                    { value: "mails", label: t("fp.mails") },
                  ] : [
                    { value: "mails", label: t("fp.mails") },
                    { value: "sender", label: t("fp.by_sender") },
                  ]} />
                <span className="flex-1" />
                <Button variant="plain" size="sm"
                  onClick={() => selecting ? endSelect() : setSelecting(true)}>
                  {t(selecting ? "select.done" : "select.enter")}
                </Button>
              </div>
            )}
            {searching && (
              <Input autoFocus className="mb-2 w-full"
                aria-label={t("Search")} placeholder={t("search.placeholder")}
                value={q} onChange={(e) => setQ(e.target.value)} />
            )}
            {hasRows && selecting && (
              <Toolbar className="mb-2 rounded-card border">
                {sel.size === 0 && (
                  <span className="type-meta text-muted">
                    {t("select.enter")}
                  </span>
                )}
                {sel.size > 0 && !junk && (
                  <>
                    <PopupSelect<string> disabled={busy}
                      triggerClass={TALL}
                      placeholder={`${t("trash.restore_to")} (${sel.size})`}
                      onChange={(dest) => restore(dest)}
                      options={(state.folders_raw ?? []).map((f, i) => ({
                        value: f, label: state.folders[i] ?? f }))} />
                    <PopupSelect<string> disabled={busy || blocked}
                      triggerClass={TALL}
                      placeholder={t("fp.action")}
                      onChange={() => purgeSelection()}
                      options={[{ value: "delete",
                        label: t("fp.delete_permanently") }]} />
                  </>
                )}
                {sel.size > 0 && junk && (
                  <>
                    <Button disabled={busy} className={rowBtn}
                      onClick={() => moveJunk("not_junk")}>
                      {t("fp.not_junk")} ({sel.size})
                    </Button>
                    <PopupSelect<string> disabled={busy} triggerClass={TALL}
                      placeholder={t("fp.action")}
                      onChange={(v) => {
                        if (v === "trash") void moveJunk("trash");
                        if (v === "delete") purgeSelection();
                      }}
                      options={[
                        { value: "trash", label: t("fp.to_trash") },
                        { value: "delete", label: t("fp.delete_permanently"),
                          disabled: blocked },
                      ]} />
                  </>
                )}
              </Toolbar>
            )}
            {busy && <div className="mb-2"><Spinner /></div>}
            {note && <p className="mb-2 type-meta text-muted">{note}</p>}
            {error && <div className="p-4 type-body text-danger-fg">{error}</div>}
            {!shown && !error && <Loading />}
            {shown && shown.length === 0 && (
              <EmptyState
                icon={junk ? <ShieldAlert size={18} /> : <Trash2 size={18} />}
                title={t(list?.mails.length ? "trash.no_match"
                  : junk ? "fp.junk_empty" : "trash.empty")}
                hint={list?.mails.length ? undefined
                  : t(junk ? "fp.junk_empty_hint" : "trash.empty_hint")} />
            )}
            {shown && shown.length > 0 && (
              <div className="overflow-hidden rounded-card border border-line
                bg-panel">
                {grouping === "sender"
                  ? shownSenders?.map((g: SenderGroup) => junk ? (
                    <JunkSenderRow key={g.addr} g={g} busy={busy}
                      known={known.has(g.addr)} selecting={selecting}
                      checked={g.uids.every((u) => sel.has(u))}
                      blocked={blockedSenders?.has(g.addr) ?? false}
                      canBlock={!!onBlock}
                      onToggle={() => toggle(g.uids)}
                      onOpen={() => {
                        setQ(g.addr); setSearching(true); setGrouping("mails");
                      }}
                      onNotJunk={() => void moveJunk("not_junk", g.uids)}
                      onTrash={() => void moveJunk("trash", g.uids)}
                      onBlock={() => void blockRow(g)} />
                  ) : (
                    <MailRow key={g.addr}
                      checked={g.uids.every((u) => sel.has(u))}
                      onToggle={selecting ? () => toggle(g.uids) : undefined}
                      onOpen={() => {
                        setQ(g.addr); setSearching(true); setGrouping("mails");
                      }}
                      unread={g.unread > 0} subject={g.addr}
                      dateIso={g.date || ""}
                      selectLabel={t("select.named", { subject: g.addr })}
                      meta={[t("n.mails", { n: g.count }), fmtSize(g.size)]
                        .join(" · ")} />
                  ))
                  : shownMails?.map((m) => (
                    <MailRow key={mailKey(m)} checked={sel.has(m.uid)}
                      onToggle={selecting ? () => toggle([m.uid]) : undefined}
                      onOpen={() => setView(m)}
                      unread={!m.seen} subject={m.subject || t("(no subject)")}
                      dateIso={m.date || ""}
                      selectLabel={t("select.named",
                        { subject: m.subject || t("(no subject)") })}
                      meta={[m.addr, fmtSize(m.size)].join(" · ")}
                      trailing={!junk && inbox && !selecting ? (
                        <span>
                          <Button size="sm" variant="tinted" disabled={busy}
                            aria-label={t("fp.row_action", {
                              action: t("fp.restore"),
                              who: m.subject || t("(no subject)") })}
                            onClick={() => void restore(inbox, [m.uid], true)}>
                            <Undo2 size={14} className="mr-1 inline align-text-bottom" />
                            {t("fp.restore")}
                          </Button>
                        </span>
                      ) : undefined} />
                  ))}
              </div>
            )}
            {junk && hasRows && (
              <p className="mt-3 px-1 type-meta text-muted">
                {t("fp.not_junk_note")}
              </p>
            )}
          </div>
          {list && list.total > 0 && (
            <div className="grid grid-cols-2 gap-2 border-t border-line px-4
              py-2 max-sm:pb-[calc(0.5rem+env(safe-area-inset-bottom))]
              sm:flex sm:justify-end">
              {blocked && (
                <p id="fp-ambiguous-reason" className="col-span-2 type-meta
                  text-muted sm:mr-auto sm:self-center">
                  {t("fp.ambiguous_hint")}
                </p>
              )}
              <Button variant="secondary" disabled={busy || blocked}
                className={rowBtn} aria-describedby={describedBy}
                onClick={() => void purgeOlder()}>
                {t("fp.older")}
              </Button>
              {junk ? (
                <Button variant="danger-tint" disabled={busy || blocked}
                  className={rowBtn} aria-describedby={describedBy}
                    onClick={() => void purge({ everything: true })}>
                  {t("fp.empty_junk", { n: list.total })}
                </Button>
              ) : (
                <Button variant="danger-tint" disabled={busy || blocked}
                  className={rowBtn} aria-describedby={describedBy}
                    onClick={async () => {
                    if (await onEmptyTrash(list)) load();
                  }}>
                  {t("fp.empty_trash", { n: list.total })}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

/** One sender of the Junk page: who, how much, since when, and the three
 *  things you do with it - Not junk (back to the inbox), Block, Trash. In
 *  Select mode the row is a checkbox instead and the page's bar acts. */
function JunkSenderRow({ g, known, blocked, canBlock, busy, selecting, checked,
  onToggle, onOpen, onNotJunk, onTrash, onBlock }: {
  g: SenderGroup; known: boolean; blocked: boolean; canBlock: boolean;
  busy: boolean; selecting: boolean; checked: boolean;
  onToggle: () => void; onOpen: () => void;
  onNotJunk: () => void; onTrash: () => void; onBlock: () => void;
}) {
  const first = g.first_date
    ? fmtDate(g.first_date, nowDate(), { lang: getLang() }) : "";
  const meta = [t("n.mails", { n: g.count }), fmtSize(g.size),
    known ? t("fp.replied_before")
      : first ? t("fp.first_seen", { date: first }) : ""]
    .filter(Boolean).join(" · ");
  const act = (action: string) => t("fp.row_action", { action, who: g.addr });
  return (
    <div className="flex items-start gap-3 border-b border-line/60 px-3 py-3
      last:border-b-0">
      {selecting && (
        <Checkbox round checked={checked} onChange={onToggle}
          className="mt-1.5"
          aria-label={t("select.named", { subject: g.addr })} />
      )}
      <Avatar name={g.addr} size="md" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={onOpen}
            className="min-w-0 cursor-pointer truncate text-left type-body
              font-semibold hover:underline">{g.addr}</button>
          {known && <Tag tone="info" className="shrink-0">
            {t("fp.known_tag")}</Tag>}
        </div>
        <div className="type-meta text-muted">{meta}</div>
        {!selecting && (
          // Block / Trash are icon-only below sm so the three fit one line at
          // 390 (the aria-labels name them)
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant={known ? "tinted" : "secondary"}
              disabled={busy} aria-label={act(t("fp.not_junk"))}
              onClick={onNotJunk}>
              <Inbox size={14} className="mr-1 inline align-text-bottom" />{t("fp.not_junk")}
            </Button>
            {blocked ? (
              <Tag tone="keep" className="self-center">{t("fp.blocked")}</Tag>
            ) : canBlock && (
              <Button size="sm" variant="secondary" disabled={busy}
                aria-label={act(t("fp.block"))} title={t("fp.block")}
                onClick={onBlock}>
                <Ban size={14} className="inline align-text-bottom sm:mr-1" />
                <span className="sr-only sm:not-sr-only">{t("fp.block")}</span>
              </Button>
            )}
            <Button size="sm" variant="secondary" disabled={busy}
              aria-label={act(t("Trash"))} title={t("Trash")}
              onClick={onTrash}>
              <Trash2 size={14} className="inline align-text-bottom sm:mr-1" />
              <span className="sr-only sm:not-sr-only">{t("Trash")}</span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

import { Copy, Eye, File, FileArchive, FileText, Film, Image as ImageIcon,
  LayoutGrid, List, Music, Paperclip, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, fmtSize, mailKey } from "../api";
import { nowMs } from "../clock";
import { t } from "../i18n";
import { confirmTrashMails } from "../mailActions";
import type { AppState, AttKind, AttMail, AttSummary, Mail } from "../types";
import { MessageView } from "./MailList";
import type { ReaderActions } from "./MailReader";
import { BarButton, BulkBar, Button, Checkbox, EmptyState, Loading, Modal,
  PanelHeader, PopupSelect, Segmented, ShortDate, Spinner } from "./ui";

/** Look of each kind of file: icon + the token pair of its tile and its bar
 *  segment (colour is never the only signal - every use also prints the
 *  kind's name or extension). */
const KIND: Record<AttKind, { icon: ReactNode; tile: string; fill: string }> = {
  pdf: { icon: <FileText size={18} aria-hidden />,
    tile: "bg-keep-bg text-keep-fg", fill: "bg-keep-fg" },
  images: { icon: <ImageIcon size={18} aria-hidden />,
    tile: "bg-info-bg text-info-fg", fill: "bg-info-fg" },
  video: { icon: <Film size={18} aria-hidden />,
    tile: "bg-attach-bg text-attach-fg", fill: "bg-attach-fg" },
  audio: { icon: <Music size={18} aria-hidden />,
    tile: "bg-safe-bg text-safe-fg", fill: "bg-safe-fg" },
  archives: { icon: <FileArchive size={18} aria-hidden />,
    tile: "bg-review-bg text-review-fg", fill: "bg-review-fg" },
  documents: { icon: <FileText size={18} aria-hidden />,
    tile: "bg-new-bg text-new-fg", fill: "bg-new-fg" },
  other: { icon: <File size={18} aria-hidden />,
    tile: "bg-chip text-muted", fill: "bg-faint" },
};
const kindName = (k: AttKind) => t(`atts.kind.${k}`);

/** One file as a tile: the same (name, size) in several mails is ONE tile
 *  that stands for all of them. */
interface FileTile {
  key: string; name: string; ext: string; size: number; kind: AttKind;
  copies: number; mails: AttMail[];
}

const PAGE = 60;
/** The list endpoint returns at most this many mails (largest first). */
const LIST_CAP = 2000;
const VIEW_KEY = "pmc_atts_view";
const AGES = [0, 1, 2, 5];

/** Attachment explorer: lazy BODYSTRUCTURE analysis, then the mailbox's
 *  files by kind (bar), repeats, and one tile per file. IMAP cannot strip
 *  single attachments, so selecting a file selects its MAIL(S) and the
 *  action moves the whole mail to Trash (reversible, as everywhere). */
export function AttachmentsPanel({ state, onClose, onDeleted, isStale }: {
  state: AppState;
  onClose: () => void;
  onDeleted: () => void;
  /** True once the account this page was opened for is no longer the active
   *  one: a confirm that outlives the page must then send nothing. */
  isStale?: () => boolean;
}) {
  const [mails, setMails] = useState<AttMail[] | null>(null);
  const [summary, setSummary] = useState<AttSummary | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [view, setView] = useState<Mail | null>(null);
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<AttKind | "all">("all");
  const [age, setAge] = useState(0);
  const [repeatsOnly, setRepeatsOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [layout, setLayout] = useState<"grid" | "list">(() =>
    localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid");
  // Covers the gap between clicking Analyze and the next state update, so
  // there is feedback within a blink even before the job reports progress.
  const [starting, setStarting] = useState(false);

  const atts = state.atts;
  const running = starting || atts?.status === "running";

  const loadSummary = () => api.attachmentsSummary().then(setSummary)
    .catch(() => { /* the bar is a bonus; the tiles still work */ });

  // When the analysis finishes (state tick), load the result list.
  useEffect(() => {
    if (!starting && atts?.status === "done" && mails === null) {
      api.attachments().then(setMails).catch((e) =>
        setNote(t("err.generic", { msg: e.message ?? e })));
      loadSummary();
    }
  }, [starting, atts?.status, mails]);

  // A delete runs in the background and patches the index when it ends:
  // refresh the whole-mailbox numbers then.
  const wasDeleting = useRef(false);
  useEffect(() => {
    const now = state.delete?.status === "running";
    if (wasDeleting.current && !now && mails !== null) loadSummary();
    wasDeleting.current = now;
  }, [state.delete?.status]);

  const analyze = async () => {
    setNote("");
    setStarting(true);
    try {
      await api.startAttachments();
      await onDeleted();   // pull fresh state: job now shows as running
      setMails(null);      // ready for the fresh list once it's done
      setSummary(null);
      setSel(new Set());
    } catch (e: any) {
      setNote(t("err.generic", { msg: e.message ?? e }));
    }
    setStarting(false);
  };

  const cancel = async () => {
    try { await api.cancel("atts"); } catch { /* too late */ }
  };

  const tiles = useMemo<FileTile[]>(() => {
    const by = new Map<string, FileTile>();
    for (const m of mails ?? []) {
      for (const a of m.atts) {
        const key = `${a.name.toLowerCase()}\0${a.size}`;
        let tile = by.get(key);
        if (!tile) {
          tile = { key, name: a.name, ext: a.ext, size: a.size,
            kind: a.kind, copies: a.copies, mails: [] };
          by.set(key, tile);
        }
        if (!tile.mails.includes(m)) tile.mails.push(m);
      }
    }
    return [...by.values()].sort((a, b) => b.size - a.size);
  }, [mails]);

  const visible = useMemo(() => {
    const cutoff = age ? nowMs() / 1000 - age * 365 * 86400 : 0;
    return tiles.filter((f) =>
      (kind === "all" || f.kind === kind)
      && (!repeatsOnly || f.mails.length > 1)
      // a file is "older" when even its newest mail is
      && (!cutoff || Math.max(...f.mails.map((m) => m.ts || 0)) < cutoff));
  }, [tiles, kind, age, repeatsOnly]);

  // What is on screen is one page of the visible tiles ("Show more" grows
  // it). A selection only covers rendered tiles: a filter change starts from
  // the top again and drops every selected mail that no rendered tile stands
  // for (nothing hidden, not even behind "Show more", is ever selected).
  const page = useMemo(() => visible.slice(0, shown), [visible, shown]);
  const pageKeys = useMemo(() => new Set(
    page.flatMap((f) => f.mails.map(mailKey))), [page]);
  const visibleKeys = useMemo(() => new Set(
    visible.flatMap((f) => f.mails.map(mailKey))), [visible]);
  useEffect(() => { setShown(PAGE); }, [visibleKeys]);
  useEffect(() => {
    setSel((s) => {
      const keep = [...s].filter((k) => pageKeys.has(k));
      return keep.length === s.size ? s : new Set(keep);
    });
  }, [pageKeys]);

  const setLayoutKeep = (v: "grid" | "list") => {
    setLayout(v);
    localStorage.setItem(VIEW_KEY, v);
  };

  const fileSel = (f: FileTile) => f.mails.every((m) => sel.has(mailKey(m)));
  const toggle = (f: FileTile) => {
    const next = new Set(sel);
    const on = fileSel(f);
    for (const m of f.mails) on ? next.delete(mailKey(m)) : next.add(mailKey(m));
    setSel(next);
  };

  // Only mails of rendered tiles can be acted on.
  const chosen = (mails ?? []).filter((m) =>
    sel.has(mailKey(m)) && pageKeys.has(mailKey(m)));
  const chosenSize = chosen.reduce((n, m) => n + m.size, 0);

  // Resolves true when the mails are on their way to Trash.
  const trashMails = async (go: AttMail[], subject?: string):
      Promise<boolean> => {
    if (!mails || go.length === 0) return false;
    if (!await confirmTrashMails(go.length,
      subject ?? (go.length === 1 ? go[0].subject ?? "" : undefined)))
      return false;
    // the confirm can outlive this page: mail ids belong to one account
    if (isStale?.()) return false;
    try {
      const items = go.map((m) => [m.folder, m.uid] as [string, number]);
      await api.deleteMessages(items, "trash");
      const gone = new Set(go.map(mailKey));
      setMails(mails.filter((m) => !gone.has(mailKey(m))));
      setSel((cur) => new Set([...cur].filter((k) => !gone.has(k))));
      setNote(t("note.background", { verb: t("Move to Trash") }));
      onDeleted();
      return true;
    } catch (e: any) {
      setNote(t("err.generic", { msg: e.message ?? e }));
      return false;
    }
  };
  const trash = () => trashMails(chosen);
  // The reader's Trash: the same confirm and call for the one open mail.
  const readerActions: ReaderActions = {
    trash: async (m) => {
      const one = (mails ?? []).find((x) => mailKey(x) === mailKey(m));
      if (one && await trashMails([one], one.subject)) setView(null);
    },
  };

  // An empty panel (nothing analyzed yet / nothing found) shrinks to its
  // message; a list keeps the fixed height.
  const emptyPanel = mails?.length === 0
    || (!mails && atts?.status !== "done");

  const total = summary?.total ?? 0;
  const kinds = summary?.kinds ?? [];
  const repeats = summary?.repeats;

  return (
    <Modal onClose={onClose} size="lg" full={!!view || running || !emptyPanel}>
      <PanelHeader
        title={<span className="inline-flex items-center gap-2">
          <Paperclip size={18} /> {t("Attachments")}
        </span>}
        sub={atts?.status === "done"
          ? t("atts.summary", { n: atts.mails, size: fmtSize(atts.size) })
          : running ? t("atts.hint") : ""}
        actions={running ? (
          <Button variant="secondary" onClick={cancel}>
            <Spinner /> {starting ? t("Starting…") : atts.progress}{" "}
            - {t("cancel")}
          </Button>
        ) : (
          <Button variant="secondary" onClick={analyze}
            disabled={state.status !== "done"}>
            {atts?.status === "done" ? t("atts.reanalyze") : t("atts.analyze")}
          </Button>
        )}
        onClose={onClose}
      />

      {view ? (
        <MessageView mail={view} onBack={() => setView(null)}
          actions={readerActions} backLabel={t("Attachments")}
          nav={{ onOpen: setView, list: [...new Map(visible.flatMap((f) =>
            f.mails).map((m) => [mailKey(m), m])).values()] }} />
      ) : (
        <>
          {(atts?.status === "error" || note) && (
            <div className="flex flex-wrap items-center gap-2 px-4 pt-2">
              {atts?.status === "error" && (
                <span className="type-meta text-danger-fg">{atts.error}</span>
              )}
              {note && <span className="type-meta text-muted">{note}</span>}
            </div>
          )}
          <div data-scroll-id="panel"
            className="min-h-0 flex-1 overflow-y-auto px-4 pb-24 pt-3">
            {!mails && !running && atts?.status !== "done" && (
              <EmptyState icon={<Paperclip size={18} />}
                title={t("atts.not_analyzed")} hint={t("atts.intro")} />
            )}
            {running && (
              <Loading label={starting ? t("Starting…") : atts.progress} />
            )}
            {!running && atts?.status === "done" && mails === null && (
              <Loading />
            )}
            {mails && mails.length === 0 && (
              <EmptyState icon={<Paperclip size={18} />}
                title={t("atts.none")} hint={t("atts.none_hint")} />
            )}
            {mails && mails.length > 0 && (
              <>
                <div className="mb-3 grid gap-3 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                  {kinds.length > 0 && (
                    <div className="rounded-card border border-line bg-panel p-4">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="type-title">{fmtSize(total)}</span>
                        <span className="type-meta text-muted">
                          {t("atts.by_kind")}
                        </span>
                      </div>
                      <div role="img" className="mt-2 flex h-3 gap-0.5
                        overflow-hidden rounded-full"
                        aria-label={kinds.map((k) =>
                          `${kindName(k.kind)} ${fmtSize(k.bytes)}`).join(", ")}>
                        {kinds.map((k) => (
                          <span key={k.kind} className={KIND[k.kind].fill}
                            // segment width = its share of the bytes
                            style={{ width: `${(100 * k.bytes) / (total || 1)}%` }} />
                        ))}
                      </div>
                      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1
                        type-meta text-muted">
                        {kinds.map((k) => (
                          <li key={k.kind} className="flex items-center gap-1.5">
                            <span aria-hidden
                              className={`size-2 rounded-full ${KIND[k.kind].fill}`} />
                            {kindName(k.kind)}{" "}
                            <b className="font-semibold text-body">
                              {fmtSize(k.bytes)}</b>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {repeats && repeats.files > 0 && (
                    <div className="flex items-center gap-3 rounded-card
                      border border-line bg-panel p-4">
                      <span aria-hidden className="grid size-10 shrink-0
                        place-items-center rounded-control bg-chip text-muted">
                        <Copy size={18} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="type-body font-semibold">
                          {t("atts.repeats_title")}
                        </div>
                        <div className="type-meta text-muted">
                          {t("atts.repeats_sub", { n: repeats.files,
                            size: fmtSize(repeats.bytes) })}
                        </div>
                      </div>
                      <Button variant="secondary" aria-pressed={repeatsOnly}
                        onClick={() => setRepeatsOnly(!repeatsOnly)}>
                        {repeatsOnly ? t("atts.repeats_all")
                          : t("atts.repeats_show")}
                      </Button>
                    </div>
                  )}
                </div>

                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <div className="max-w-full overflow-x-auto">
                    <Segmented<AttKind | "all"> label={t("atts.kind_filter")}
                      value={kind} onChange={setKind} role="radio"
                      options={[{ value: "all", label: t("All") },
                        ...kinds.map((k) => ({
                          value: k.kind, label: kindName(k.kind) }))]} />
                  </div>
                  <PopupSelect<string> label={t("atts.older")}
                    value={String(age)} onChange={(v) => setAge(Number(v))}
                    options={AGES.map((n) => ({ value: String(n),
                      label: n ? t("atts.age_n", { n }) : t("atts.age_any") }))} />
                  <Segmented<"grid" | "list"> label={t("atts.view")}
                    value={layout} onChange={setLayoutKeep} role="radio"
                    className="ml-auto"
                    options={[
                      { value: "grid", label: <LayoutGrid size={16}
                        aria-label={t("atts.view_grid")} /> },
                      { value: "list", label: <List size={16}
                        aria-label={t("atts.view_list")} /> }]} />
                </div>

                {mails.length >= LIST_CAP && (
                  <p className="mb-3 type-meta text-muted">
                    {t("atts.capped", { n: LIST_CAP })}
                  </p>
                )}
                {visible.length === 0 ? (
                  <EmptyState icon={<Paperclip size={18} />}
                    title={t("atts.no_match")} hint={t("atts.no_match_hint")} />
                ) : (
                  <ul className={layout === "grid"
                    ? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
                    : "divide-y divide-line overflow-hidden rounded-card border border-line bg-panel"}>
                    {page.map((f) => (
                      <FileItem key={f.key} f={f} list={layout === "list"}
                        on={fileSel(f)} onToggle={() => toggle(f)} />
                    ))}
                  </ul>
                )}
                {visible.length > shown && (
                  <div className="py-3 text-center">
                    <Button variant="secondary"
                      onClick={() => setShown(shown + PAGE)}>
                      {t("atts.more", { n: Math.min(PAGE, visible.length - shown) })}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
          {chosen.length > 0 && (
            <BulkBar
              summary={<>
                <span className="block truncate font-semibold text-body">
                  {t("atts.sel", { n: chosen.length, size: fmtSize(chosenSize) })}
                </span>
                <span className="block whitespace-normal">
                  {t("atts.sel_note")}
                </span>
              </>}
              onClear={() => setSel(new Set())}
              actions={
                <BarButton icon={<Eye size={16} aria-hidden />}
                  disabled={chosen.length !== 1}
                  title={chosen.length !== 1 ? t("atts.open_one") : undefined}
                  onClick={() => setView(chosen[0])}>
                  {t("atts.open")}
                </BarButton>}
              primary={
                <Button variant="danger" size="sm"
                  className="inline-flex min-h-9 items-center gap-1.5
                    whitespace-nowrap rounded-full"
                  onClick={trash}>
                  <Trash2 size={16} aria-hidden />
                  {t("Move to Trash")}
                </Button>} />
          )}
        </>
      )}
    </Modal>
  );
}

/** One file: a tile (grid) or a row (list) with a round check. The whole
 *  card toggles; the check is the keyboard / screen-reader control. */
function FileItem({ f, list, on, onToggle }: {
  f: FileTile; list: boolean; on: boolean; onToggle: () => void;
}) {
  const k = KIND[f.kind];
  const m = f.mails[0];
  const label = t("atts.select_file", { name: f.name });
  const badge = f.mails.length > 1 && (
    <span className="inline-flex items-center gap-1 type-meta font-medium
      text-review-fg">
      <Copy size={14} aria-hidden />{t("atts.in_mails", { n: f.mails.length })}
    </span>);
  const sub = [fmtSize(f.size), m.addr].join(" · ");
  const subject = m.subject || t("(no subject)");
  const when = <ShortDate iso={m.date || ""} />;
  const ext = (f.ext || "file").toUpperCase();
  if (list) {
    return (
      <li onClick={onToggle}
        className={`flex cursor-pointer items-center gap-3 px-3 py-2
          ${on ? "bg-accent-tint" : "hover:bg-chip"}`}>
        <Checkbox round checked={on} onChange={onToggle} aria-label={label}
          onClick={(e) => e.stopPropagation()} />
        <span aria-hidden className={`grid size-9 shrink-0 place-items-center
          rounded-control ${k.tile}`}>{k.icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate type-body font-medium">{f.name}</span>
          <span className="block truncate type-meta text-muted">
            {subject} · {sub}
          </span>
        </span>
        <span className="shrink-0 type-meta text-muted">
          {badge || when}
        </span>
      </li>
    );
  }
  return (
    <li onClick={onToggle} title={`${subject} · ${f.name}`}
      className={`relative cursor-pointer rounded-card border bg-panel p-2
        ${on ? "border-accent" : "border-line hover:bg-chip"}`}>
      <div className={`relative grid h-20 place-items-center rounded-control
        ${k.tile}`}>
        {/* positioned by the wrapper: Checkbox's own `relative` would beat
            an `absolute` class, leaving the disc centred in the tile */}
        <span className="absolute left-0 top-0">
          <Checkbox round checked={on} onChange={onToggle} aria-label={label}
            onClick={(e) => e.stopPropagation()} />
        </span>
        <div className="grid justify-items-center gap-0.5" aria-hidden>
          {k.icon}
          <span className="type-meta font-semibold">{ext}</span>
        </div>
      </div>
      <div className="mt-2 min-w-0 px-1">
        <div className="truncate type-body font-medium">{f.name}</div>
        <div className="truncate type-meta text-muted">{sub}</div>
        <div className="type-meta text-muted">{badge || when}</div>
      </div>
    </li>
  );
}

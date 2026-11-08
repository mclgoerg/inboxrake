import { Briefcase, Building2, CalendarDays, Download, Eraser, LifeBuoy,
  MoreHorizontal, Newspaper, Package, Pencil, Upload, ShieldCheck, Sparkles,
  SquareCheck, Tag as TagIcon, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, saveBlob } from "../api";
import { t } from "../i18n";
import { FILE_KINDS, filedKindName, keptMessage } from "../smart";
import type { KnowledgeEntry, KnowledgeList, KnowledgeStored } from "../types";
import { Avatar, Button, Checkbox, confirmDialog, EmptyState, Input, Loading,
  Menu, MenuGroup, MenuItem, Segmented, Select, SettingsGroup, Tag, useToast } from "./ui";

/* "What Inboxrake knows about your senders" (Settings > Senders): everything
 * the user filed in Smart - by sender address or company - and the AI answers
 * they kept. A searchable list grouped by Smart group (like iOS settings) with
 * an All / By you / AI / Unused segment, inline edit of the group, forget (also
 * several at once), and a "..." menu for the rare actions: download / upload
 * of just this knowledge, "Remove unused" and keep / forget of AI answers.
 * Every change applies at once on the server, so there is nothing to Save. */

type Seg = "all" | "user" | "ai" | "unused";
/** What the list is sorted by (`key` = A-Z by name, the default). */
export type SortBy = "key" | "kind" | "src" | "senders" | "status" | "ts";
type Dir = "asc" | "desc";
const SORT_KEYS: SortBy[] = ["key", "status", "kind", "src", "senders", "ts"];
// Picking a key: biggest / newest first; the rest A-Z.
const FIRST_DIR: Record<SortBy, Dir> = { key: "asc", kind: "asc", src: "asc",
  senders: "desc", status: "asc", ts: "desc" };
const SORT_STORE = "pmc_know_sort";
const DIR_STORE = "pmc_know_dir";
const PAGE = 50;
const NOTE_MAX = 200;

const isCompany = (e: KnowledgeEntry) => e.key.startsWith("co:");
const nameOf = (e: KnowledgeEntry) => e.key.slice(e.key.indexOf(":") + 1);
/** The status as one plain sentence. */
export function statusText(e: KnowledgeEntry): string {
  if (e.status === "no_effect" || e.status === "inactive"
      || e.status === "inert") {
    return t(`know.status.${e.status}`, { why: t(`know.reason.${e.reason}`) });
  }
  return t(`know.status.${e.status}`);
}
const STATUS_TONE: Record<string, "safe" | "review" | "keep" | "neutral"> = {
  active: "safe", no_effect: "review", inactive: "review", inert: "keep",
  unused: "neutral", unknown: "neutral" };
// "Needs a look" first: entries that do nothing sort before the active ones.
const STATUS_ORDER: Record<string, number> = { inert: 0, inactive: 1,
  unused: 2, no_effect: 3, unknown: 4, active: 5 };

/** Sort within a group; ties fall back to A-Z. */
export function sortEntries(list: KnowledgeEntry[], by: SortBy = "key",
    dir: Dir = "asc"): KnowledgeEntry[] {
  const sign = dir === "asc" ? 1 : -1;
  const cmp = (a: KnowledgeEntry, b: KnowledgeEntry): number => {
    switch (by) {
      case "kind": return filedKindName(a.kind).localeCompare(filedKindName(b.kind));
      case "src": return a.src.localeCompare(b.src);
      case "senders": return a.senders - b.senders;
      case "status": return (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
      case "ts": return a.ts - b.ts;
      default: return nameOf(a).localeCompare(nameOf(b));
    }
  };
  return [...list].sort((a, b) => sign * cmp(a, b)
    || nameOf(a).localeCompare(nameOf(b)) || a.key.localeCompare(b.key));
}

/** The entries of one segment of the segment control. */
export function inSegment(e: KnowledgeEntry, seg: Seg): boolean {
  return seg === "all" || (seg === "unused" ? e.status === "unused"
    : e.src === seg);
}

const KIND_ICON: Record<string, typeof Package> = { orders: Package,
  appointments: CalendarDays, jobs: Briefcase, support: LifeBuoy,
  accounts: ShieldCheck, newsletter: Newspaper, individuals: Users,
  other: Users };

/** Entries grouped by Smart group in Smart's own order (the fixed kinds,
 *  then the user's categories, then anything else), each group sorted. */
export function groupEntries(list: KnowledgeEntry[], by_: SortBy = "key",
    dir: Dir = "asc"): { kind: string; entries: KnowledgeEntry[] }[] {
  const by = new Map<string, KnowledgeEntry[]>();
  for (const e of sortEntries(list, by_, dir)) {
    by.set(e.kind, [...(by.get(e.kind) ?? []), e]);
  }
  const rank = (k: string) => {
    const i = (FILE_KINDS as readonly string[]).indexOf(k);
    return i >= 0 ? i : k.startsWith("cat:") ? FILE_KINDS.length : FILE_KINDS.length + 1;
  };
  const groups = [...by.entries()].map(([kind, entries]) => ({ kind, entries }));
  // "Filed under" orders the groups themselves, by name
  if (by_ === "kind") {
    return groups.sort((a, b) => (dir === "asc" ? 1 : -1)
      * filedKindName(a.kind).localeCompare(filedKindName(b.kind)));
  }
  return groups.sort((a, b) => rank(a.kind) - rank(b.kind)
    || filedKindName(a.kind).localeCompare(filedKindName(b.kind)));
}

/** Free-text search over the address / company, the kind, the note and the
 *  source (every word must hit). */
export function filterEntries(list: KnowledgeEntry[], query: string):
    KnowledgeEntry[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((e) => {
    const hay = `${nameOf(e)} ${filedKindName(e.kind)} ${e.note} `
      + `${e.src === "ai" ? t("know.src_ai") : t("know.src_user")} `
      + `${isCompany(e) ? t("know.company") : ""}`;
    return words.every((w) => hay.toLowerCase().includes(w));
  });
}

export function KnowledgeSettings({ aiAnswers, onChanged }: {
  aiAnswers: number;               // AI answers of the active account that apply now
  onChanged: () => void;           // Smart rows may have moved: refresh the app
}) {
  const toast = useToast();
  const [data, setData] = useState<KnowledgeList | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [seg, setSeg] = useState<Seg>("all");
  const [sortBy, setSortBy] = useState<SortBy>(() => {
    const k = localStorage.getItem(SORT_STORE) as SortBy | null;
    return k && SORT_KEYS.includes(k) ? k : "key";
  });
  const [dir, setDir] = useState<Dir>(() => {
    const d = localStorage.getItem(DIR_STORE);
    return d === "asc" || d === "desc" ? d : "asc";
  });
  useEffect(() => {
    localStorage.setItem(SORT_STORE, sortBy);
    localStorage.setItem(DIR_STORE, dir);
  }, [sortBy, dir]);
  const [selecting, setSelecting] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ kind: "", note: "" });
  const [busy, setBusy] = useState(false);
  const upload = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.knowledge();
      setData(r);
      setError("");
      // selection follows the entries that still exist
      setSel((cur) => {
        const keys = new Set(r.entries.map((e) => e.key));
        const kept = [...cur].filter((k) => keys.has(k));
        return kept.length === cur.size ? cur : new Set(kept);
      });
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const entries = data?.entries ?? [];
  const list = useMemo(
    () => sortEntries(filterEntries(entries, query)
      .filter((e) => inSegment(e, seg)), sortBy, dir),
    [entries, query, seg, sortBy, dir]);
  useEffect(() => { setShown(PAGE); }, [query, seg, sortBy, dir]);
  const unused = entries.filter((e) => e.status === "unused");
  const kept = entries.filter((e) => e.src === "ai");
  // the kept AI answers, counted in the senders they decide right now (the
  // unit used everywhere around AI sorting)
  const keptSenders = kept.reduce((n, e) => n + e.filed, 0);
  const categories = data?.categories ?? [];

  /** Run a change, then reload and tell the app. */
  const act = async (task: () => Promise<void>) => {
    setBusy(true);
    try { await task(); }
    catch (e: any) { toast.show(String(e.message ?? e), { variant: "error" }); }
    finally { setBusy(false); await load(); onChanged(); }
  };
  const restore = (previous: Record<string, KnowledgeStored | null>) =>
    act(async () => {
      const back = Object.entries(previous).filter(([, v]) => v)
        .map(([key, v]) => ({ key, ...v! }));
      const gone = Object.entries(previous).filter(([, v]) => !v)
        .map(([key]) => key);
      await api.knowledgePut({ entries: back.length ? back : undefined,
        remove: gone.length ? gone : undefined });
      toast.show(t("know.undone"), { variant: "info" });
    });
  const remove = (keys: string[]) => act(async () => {
    const r = await api.knowledgePut({ remove: keys });
    setSel(new Set());
    toast.show(t("know.deleted", { n: keys.length }), { variant: "success",
      action: { label: t("Undo"), onClick: () => restore(r.previous) } });
  });
  const removeSelected = async () => {
    const keys = selKeys;
    if (!await confirmDialog({
      title: t("know.delete_title", { n: keys.length }),
      body: t("know.delete_body"), confirmLabel: t("know.delete_go",
        { n: keys.length }), tone: "danger" })) return;
    remove(keys);
  };
  const startEdit = (e: KnowledgeEntry) => {
    setEditing(e.key);
    setDraft({ kind: e.kind, note: e.note });
  };
  const saveEdit = (e: KnowledgeEntry) => act(async () => {
    // Choosing another kind is the user's own filing; editing only the note
    // keeps who filed it (a kept AI answer stays one).
    const changed = draft.kind !== e.kind;
    const r = await api.knowledgePut({ entries: [{ key: e.key,
      kind: draft.kind, note: draft.note,
      ...(changed ? {} : { src: e.src }) }] });
    setEditing(null);
    toast.show(t("know.saved"), { variant: "success",
      action: { label: t("Undo"), onClick: () => restore(r.previous) } });
  });
  const removeUnused = async () => {
    if (!await confirmDialog({
      title: t("know.unused_title", { n: unused.length }),
      body: t("know.unused_body"),
      confirmLabel: t("know.unused_go", { n: unused.length }),
      tone: "danger" })) return;
    act(async () => {
      const r = await api.knowledgeRemoveUnused();
      toast.show(t("know.unused_done", { n: r.removed }), { variant: "success" });
    });
  };
  const keepAll = async () => {
    if (!await confirmDialog({
      title: t("know.keep_title", { n: aiAnswers }),
      bullets: [t("know.keep_b_rules"), t("know.keep_b_clearer"),
        t("know.keep_b_only"), t("know.keep_b_account")],
      confirmLabel: t("know.keep_go", { n: aiAnswers }) })) return;
    act(async () => {
      const r = await api.knowledgeKeepAi();
      toast.show(keptMessage(r), { variant: r.senders ? "success" : "info" });
    });
  };
  const forgetKept = async () => {
    if (!await confirmDialog({
      title: keptSenders
        ? t("know.forget_title", { n: keptSenders })
        : t("know.forget_title_unused", { n: kept.length }),
      bullets: [t("know.forget_b_back"), t("know.forget_b_own"),
        t("know.forget_b_gone")],
      confirmLabel: keptSenders
        ? t("know.forget_go", { n: keptSenders })
        : t("know.forget_go_unused", { n: kept.length }),
      tone: "danger" })) return;
    act(async () => {
      const r = await api.knowledgeForgetAi();
      toast.show(keptSenders
        ? t("know.forgot", { n: keptSenders })
        : t("know.forgot_unused", { n: r.forgotten }), { variant: "success" });
    });
  };
  const download = () => {
    const section = { version: 1, entries: Object.fromEntries(
      entries.map((e) => [e.key, { kind: e.kind, src: e.src, ts: e.ts,
        note: e.note }])) };
    saveBlob("inboxrake-sender-knowledge.json",
      new Blob([JSON.stringify(section, null, 1)],
        { type: "application/json" }));
  };
  const onUpload = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    let section: any;
    try {
      const body = JSON.parse(await file.text());
      section = body?.knowledge ?? body;      // this file, or a full backup
    } catch { section = null; }
    const n = section && typeof section.entries === "object"
      && section.entries && !Array.isArray(section.entries)
      ? Object.keys(section.entries).length : 0;
    if (!n) { toast.show(t("know.upload_bad"), { variant: "error" }); return; }
    if (!await confirmDialog({ title: t("know.upload_title"),
      bullets: [t("know.upload_b_n", { n }), t("know.upload_b_merge"),
        t("know.upload_b_rest")],
      confirmLabel: t("know.upload_go") })) return;
    act(async () => {
      const r = await api.knowledgeImport(section);
      toast.show(t("know.uploaded", { n: r.knowledge }), { variant: "success" });
    });
  };

  const toggle = (k: string) => setSel((cur) => {
    const next = new Set(cur);
    next.has(k) ? next.delete(k) : next.add(k);
    return next;
  });
  const visible = useMemo(() => list.slice(0, shown), [list, shown]);
  const allShown = visible.length > 0 && visible.every((e) => sel.has(e.key));
  // Only what the search currently shows counts as selected: a bulk action
  // never reaches an entry the user cannot see.
  const shownKeys = useMemo(() => new Set(visible.map((e) => e.key)),
    [visible]);
  const selKeys = [...sel].filter((k) => shownKeys.has(k));
  // a search / segment / sort change drops what left the screen
  useEffect(() => {
    setSel((cur) => {
      const kept = [...cur].filter((k) => shownKeys.has(k));
      return kept.length === cur.size ? cur : new Set(kept);
    });
  }, [shownKeys]);

  // ---- one entry ---------------------------------------------------------
  const editor = (e: KnowledgeEntry) => (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <Select value={draft.kind}
        className="min-w-0 basis-full sm:basis-auto sm:flex-none"
        aria-label={t("know.kind_label")}
        onChange={(ev) => setDraft({ ...draft, kind: ev.target.value })}>
        {FILE_KINDS.map((k) => (
          <option key={k} value={k}>{filedKindName(k)}</option>
        ))}
        {categories.map((c) => (
          <option key={c} value={`cat:${c}`}>{filedKindName(`cat:${c}`)}</option>
        ))}
        {![...FILE_KINDS as readonly string[], ...categories.map((c) => `cat:${c}`)]
          .includes(draft.kind) && (
          <option value={draft.kind}>{filedKindName(draft.kind)}</option>
        )}
      </Select>
      <Input className="min-w-0 basis-full sm:basis-0 sm:flex-1" maxLength={NOTE_MAX}
        value={draft.note} aria-label={t("know.note_label")}
        placeholder={t("know.note_placeholder")}
        onChange={(ev) => setDraft({ ...draft, note: ev.target.value })} />
      <Button size="sm" disabled={busy} onClick={() => saveEdit(e)}>
        {t("Save")}
      </Button>
      <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>
        {t("Cancel")}
      </Button>
    </div>
  );
  /** "In effect · 12 mails" / what is wrong, in the status's tone. */
  const statusLine = (e: KnowledgeEntry) => (
    <span className={`block type-meta ${e.status === "active" ? "text-muted"
      : "text-review-fg"}`}>
      {e.status === "active"
        ? [t("know.status.active"),
          ...(isCompany(e) ? [t("n.senders", { n: e.filed })] : []),
          t("n.mails", { n: e.mails })].join(" · ")
        : statusText(e)}
      {isCompany(e) && e.status !== "active" && e.senders > 0 && (
        <> · {t("n.senders", { n: e.senders })}</>
      )}
      {e.note && <span className="text-muted"> · {e.note}</span>}
    </span>
  );
  const entryRow = (e: KnowledgeEntry) => (
    <div key={e.key} data-entry={e.key}
      className="flex items-center gap-3 px-3 py-2.5">
      {selecting && (
        <Checkbox round checked={sel.has(e.key)} className="shrink-0"
          aria-label={t("know.select", { name: nameOf(e) })}
          onChange={() => toggle(e.key)} />
      )}
      <Avatar name={nameOf(e)} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 type-body">
          <span className="truncate" title={nameOf(e)}>{nameOf(e)}</span>
          {isCompany(e) && <Building2 size={14} aria-label={t("know.company")}
            className="shrink-0 text-muted" />}
        </div>
        {editing === e.key ? editor(e) : statusLine(e)}
      </div>
      <Tag tone={e.src === "user" ? "info" : "safe"} className="shrink-0">
        {e.src === "user" ? t("know.src_user") : t("know.src_ai")}
      </Tag>
      <Menu variant="quiet" icon label={t("know.row_menu", { name: nameOf(e) })}
        trigger={<MoreHorizontal size={16} />}>
        <MenuItem onClick={() => startEdit(e)} disabled={busy}>
          {t("know.change_group")}
        </MenuItem>
        <MenuItem danger disabled={busy} onClick={() => remove([e.key])}>
          {t("know.forget")}
        </MenuItem>
      </Menu>
    </div>
  );

  const unscanned = data?.unscanned.length ?? 0;
  const canRemoveUnused = !!data?.complete && unused.length > 0;
  const segCount = (s: Seg) => entries.filter((e) => inSegment(e, s)).length;

  return (
    <>
      <div className="mb-6 space-y-3">
      <p className="px-1 type-meta text-muted">{t("know.table_help")}</p>
      {!data && !error && <Loading />}
      {error && (
        <p role="alert" className="type-meta text-danger-fg">
          {t("know.load_error", { msg: error })}
        </p>
      )}

      {data && (
        <>
          <div className="flex items-center gap-2">
            <Input type="search" className="min-w-0 flex-1"
              value={query} placeholder={t("know.search")}
              aria-label={t("know.search")}
              onChange={(ev) => setQuery(ev.target.value)} />
            <Menu variant="secondary" icon label={t("know.more_menu")}
              trigger={<MoreHorizontal size={16} />}>
              <MenuGroup label={t("sort.by")}>
                {SORT_KEYS.map((k) => (
                  <MenuItem key={k} active={sortBy === k} onClick={() => {
                    if (k !== sortBy) { setSortBy(k); setDir(FIRST_DIR[k]); }
                  }}>{t(`know.sort.${k}`)}</MenuItem>
                ))}
              </MenuGroup>
              <MenuGroup label={t("sort.order")}>
                {(["desc", "asc"] as Dir[]).map((d) => (
                  <MenuItem key={d} active={dir === d}
                    onClick={() => setDir(d)}>{d === "asc" ? t("sort.ascending") : t("sort.descending")}</MenuItem>
                ))}
              </MenuGroup>
              <MenuGroup label={t("know.menu_list")}>
              <MenuItem disabled={!entries.length} onClick={download}>
                <span>
                  <Download size={14} aria-hidden className="mr-2 inline" />
                  {t("know.download")}
                </span>
                {/* wraps: the privacy hint must be readable in full */}
                <span className="block whitespace-normal type-meta text-muted">
                  {t("know.download_tip")}
                </span>
              </MenuItem>
              <MenuItem disabled={busy} onClick={() => upload.current?.click()}>
                <Upload size={14} aria-hidden className="mr-2 inline" />
                {t("know.upload")}
              </MenuItem>
              <MenuItem disabled={!entries.length}
                onClick={() => setSelecting(true)}>
                <SquareCheck size={14} aria-hidden className="mr-2 inline" />
                {t("know.select_mode")}
              </MenuItem>
              <MenuItem disabled={busy || !canRemoveUnused}
                onClick={removeUnused}>
                <Eraser size={14} aria-hidden className="mr-2 inline" />
                {t("know.unused_btn", { n: unused.length })}
              </MenuItem>
              <MenuItem disabled={busy || aiAnswers === 0} onClick={keepAll}>
                <Sparkles size={14} aria-hidden className="mr-2 inline" />
                {t("know.keep_all")}
              </MenuItem>
              <MenuItem disabled={busy || kept.length === 0}
                onClick={forgetKept}>
                <Sparkles size={14} aria-hidden className="mr-2 inline" />
                {keptSenders
                  ? t("know.forget_btn", { n: keptSenders })
                  : t("know.forget_btn_unused", { n: kept.length })}
              </MenuItem>
              </MenuGroup>
            </Menu>
            <input ref={upload} type="file" accept="application/json"
              className="hidden" aria-label={t("know.upload")}
              onChange={onUpload} />
          </div>
          <Segmented<Seg> value={seg} onChange={setSeg} role="radio" fill equal
            label={t("know.seg_label")}
            options={[
              { value: "all", label: t("know.seg_all", { n: segCount("all") }) },
              { value: "user", label: t("know.seg_user", { n: segCount("user") }) },
              { value: "ai", label: t("know.seg_ai", { n: segCount("ai") }) },
              { value: "unused", label: t("know.seg_unused",
                { n: segCount("unused") }) }]} />
          {!data.complete && (
            <p className="type-meta text-muted">
              {t("know.unused_blocked", { n: unscanned })}
            </p>
          )}

          {(selecting || selKeys.length > 0) && (
            <div className="flex flex-wrap items-center gap-2 rounded-card
              bg-panel2 px-3 py-2 type-meta">
              <Checkbox checked={allShown} label={t("know.select_all")}
                onChange={(ev) => setSel(new Set(ev.target.checked
                  ? [...sel, ...visible.map((e) => e.key)]
                  : [...sel].filter((k) => !visible.some((e) => e.key === k))))} />
              <span>{t("know.selected", { n: selKeys.length })}</span>
              <Button variant="danger" size="sm" disabled={busy || !selKeys.length}
                onClick={removeSelected}>
                {t("know.delete_sel", { n: selKeys.length })}
              </Button>
              <button type="button" className="cursor-pointer underline"
                onClick={() => { setSel(new Set()); setSelecting(false); }}>
                {t("Clear selection")}</button>
            </div>
          )}
        </>
      )}
      </div>

      {data && (entries.length === 0 ? (
        <EmptyState title={t("know.empty_title")} hint={t("know.empty_hint")} />
      ) : list.length === 0 ? (
        <p className="p-2 type-body text-muted">{t("know.none")}</p>
      ) : (
        groupEntries(visible, sortBy, dir).map((g) => (
          <SettingsGroup key={g.kind} header={
            <span className="flex items-center gap-2 type-body font-semibold
              text-body">
              <span aria-hidden className="flex size-7 items-center
                justify-center rounded-control bg-chip text-muted">
                {(() => { const I = g.kind.startsWith("cat:") ? TagIcon
                  : KIND_ICON[g.kind] ?? Users; return <I size={14} />; })()}
              </span>
              {filedKindName(g.kind)}
              <span className="font-normal text-muted">{g.entries.length}</span>
            </span>}>
            {g.entries.map(entryRow)}
          </SettingsGroup>
        ))
      ))}
      {data && list.length > visible.length && (
        <div className="mb-6 text-center">
          <Button variant="secondary" size="sm"
            onClick={() => setShown(shown + PAGE)}>
            {t("know.more", { n: list.length - visible.length })}
          </Button>
        </div>
      )}
    </>
  );
}

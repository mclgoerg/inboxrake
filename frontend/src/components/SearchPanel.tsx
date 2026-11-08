import { ArrowUpLeft, ChevronRight, Clock, Hourglass, Mail as MailIcon, Paperclip,
  Reply, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, fmtSize, mailKey } from "../api";
import { nowDate, nowMs } from "../clock";
import { t } from "../i18n";
import { matchGroup, olderThan, parseFilter } from "../lib";
import { confirmTrashMails } from "../mailActions";
import type { Group, Mail, SearchNote } from "../types";
import { MailRows, MessageView } from "./MailList";
import { Avatar, Button, EmptyState, Modal, PanelHeader, SectionLabel,
  Segmented, Select, Spinner } from "./ui";

const RECENT_KEY = "pmc_recent_searches";
const RECENT_MAX = 8;
const SENDER_MAX = 5;

type Scope = "meta" | "body";
type When = "any" | "30d" | "year" | "old";

/** Last searches on this device (localStorage only, never sent anywhere). */
const loadRecent = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v)
      ? v.filter((x) => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch { return []; }
};
const saveRecent = (list: string[]) => {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* private mode */ }
};

/** The "Try" presets: ready-made filter-box queries on the Senders page,
 *  each with its live count from the loaded sender groups (same parser and
 *  matcher as the filter box). A preset whose count is 0 - or whose data is
 *  missing, e.g. attachments not analysed - is hidden. */
const TRY: { id: string; query: string; unit: "mails" | "senders"; prefix?: string;
  icon: ReactNode }[] = [
  { id: "att", query: "att:>1m", unit: "mails",
    prefix: "search.try_att_prefix", icon: <Paperclip size={18} /> },
  { id: "unread", query: "unread:>90 age:>1y", unit: "mails",
    icon: <MailIcon size={18} /> },
  { id: "replied", query: "is:replied", unit: "senders",
    icon: <Reply size={18} /> },
  { id: "old", query: "age:>5y", unit: "mails",
    icon: <Hourglass size={18} /> },
];

/** Wraps every occurrence of a search term in `<mark>`. */
const highlighter = (terms: string[]) => (text: string): ReactNode => {
  const ts = terms.filter(Boolean);
  if (!ts.length || !text) return text;
  const re = new RegExp(`(${ts.map((x) =>
    x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  const low = new Set(ts.map((x) => x.toLowerCase()));
  return text.split(re).map((part, i) => low.has(part.toLowerCase())
    ? <mark key={i} className="rounded-sm bg-accent-tint text-inherit">
      {part}</mark>
    : part);
};

const inWindow = (m: Mail, when: When): boolean => {
  if (when === "any") return true;
  if (when === "30d") return m.ts > nowMs() / 1000 - 30 * 86400;
  if (when === "year") {
    return (m.date || "").startsWith(String(nowDate().getFullYear()));
  }
  return olderThan(m, 12);
};

export function SearchPanel({ bodySearch = false, bodyMode = "server",
  groups, onClose, onDeleted, onOpenSender, onOpenFiltered }: {
  /** The account's body_search mode is "server" or "local": the "Also mail
   *  text" scope is on offer (otherwise it is disabled, with the reason). */
  bodySearch?: boolean;
  bodyMode?: "server" | "local";
  /** Loaded sender groups: senders matching the query are listed above the
   *  mails, and the "Try" counts come from them. */
  groups?: Record<string, Group>;
  onClose: () => void;
  onDeleted: () => void;
  onOpenSender?: (g: Group) => void;
  /** "Try": the Senders page with this filter-box query. */
  onOpenFiltered?: (query: string) => void;
}) {
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<Scope>("meta");
  const [res, setRes] = useState<{ q: string; mails: Mail[];
    notes: SearchNote[] } | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<Mail | null>(null);
  const [when, setWhen] = useState<When>("any");
  const [folder, setFolder] = useState("");
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const seq = useRef(0);
  // What the last search asked for, so the pause after Enter (or a Recent
  // tap) does not run it a second time and drop the selection.
  const last = useRef("");
  const input = useRef<HTMLInputElement>(null);

  /** Remembers a search the user stood behind (never a half-typed prefix). */
  const commit = (query: string) => {
    const s = query.trim();
    if (s.length < 2) return;
    setRecent((cur) => {
      const next = [s, ...cur.filter((x) => x.toLowerCase()
        !== s.toLowerCase())].slice(0, RECENT_MAX);
      saveRecent(next);
      return next;
    });
  };

  const run = async (query: string, body: boolean, remember = false) => {
    const s = query.trim();
    if (s.length < 2) return;
    const mine = ++seq.current;
    last.current = `${body}:${s}`;
    setBusy(true);
    setNote("");
    try {
      const r = await api.search(s, body);
      if (mine !== seq.current) return;   // a newer search superseded this one
      setRes({ q: s, mails: r.mails, notes: r.notes });
      setSel(new Set());
      setNote(r.mails.length === 500
        ? t("Showing the newest 500 matches.") : "");
      if (remember && r.mails.length > 0) commit(s);
    } catch (e: any) {
      if (mine !== seq.current) return;
      setRes(null);
      setNote(t("err.generic", { msg: e.message ?? e }));
    }
    setBusy(false);
  };

  // Results while typing: metadata search after a short pause. Mail-text
  // search asks the mail server, so it only runs on Enter / when picked.
  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) {
      seq.current++;
      last.current = "";
      setRes(null);
      setBusy(false);
      setNote("");
      return;
    }
    if (scope === "body") return;
    const h = setTimeout(() => {
      if (last.current !== `false:${s}`) run(s, false);
    }, 250);
    return () => clearTimeout(h);
  }, [q, scope]);   // eslint-disable-line react-hooks/exhaustive-deps

  // A query that stays put for ~2 s with hits counts as committed.
  useEffect(() => {
    if (!res || res.mails.length === 0 || res.q !== q.trim()) return;
    const h = setTimeout(() => commit(res.q), 2000);
    return () => clearTimeout(h);
  }, [res, q]);   // eslint-disable-line react-hooks/exhaustive-deps

  const pickScope = (v: Scope) => {
    setScope(v);
    if (v === "body") run(q, true, true);
  };
  const bodyOn = bodySearch && scope === "body";

  const toggle = (k: string) => {
    const next = new Set(sel);
    next.has(k) ? next.delete(k) : next.add(k);
    setSel(next);
    commit(res?.q ?? "");
  };

  const mails = useMemo(() => (res?.mails ?? []).filter((m) =>
    inWindow(m, when) && (!folder || m.folder === folder)), [res, when, folder]);
  // Selection and actions only ever cover what the list shows.
  const visible = useMemo(() => new Set(mails.map(mailKey)), [mails]);
  const picked = useMemo(
    () => [...sel].filter((k) => visible.has(k)), [sel, visible]);
  useEffect(() => {
    if (picked.length !== sel.size) setSel(new Set(picked));
  }, [picked, sel]);
  const folders = useMemo(
    () => [...new Set((res?.mails ?? []).map((m) => m.folder))].sort(),
    [res]);
  useEffect(() => {
    if (folder && !folders.includes(folder)) setFolder("");
  }, [folders, folder]);

  const terms = res ? res.q.toLowerCase().split(/\s+/).filter(Boolean) : [];
  const mark = useMemo(() => highlighter(terms), [res?.q]);   // eslint-disable-line react-hooks/exhaustive-deps

  const senders = useMemo(() => {
    if (!res || !groups || terms.length === 0) return [];
    return Object.values(groups)
      .filter((g) => terms.every((x) => g.key.includes(x)
        || g.label.toLowerCase().includes(x)))
      .sort((a, b) => b.count - a.count).slice(0, SENDER_MAX);
  }, [res?.q, groups]);   // eslint-disable-line react-hooks/exhaustive-deps

  const tries = useMemo(() => TRY.map((p) => {
    const f = parseFilter(p.query);
    const hit = Object.values(groups ?? {}).filter((g) => matchGroup(g, f));
    const n = hit.reduce((a, g) => a + g.count, 0);
    return { ...p, s: hit.length, n };
  }).filter((p) => p.s > 0), [groups]);

  const trashSelected = async () => {
    const go = new Set(picked);
    if (!res || go.size === 0) return;
    if (!await confirmTrashMails(go.size)) return;
    try {
      const items = mails.filter((m) => go.has(mailKey(m)))
        .map((m) => [m.folder, m.uid] as [string, number]);
      await api.deleteMessages(items);
      setRes({ ...res, mails: res.mails.filter((m) => !go.has(mailKey(m))) });
      setSel(new Set());
      setNote(t("note.background", { verb: t("Move to Trash") }));
      onDeleted();
    } catch (e: any) {
      setNote(t("err.generic", { msg: e.message ?? e }));
    }
  };

  const allSelected = mails.length > 0
    && mails.every((m) => visible.has(mailKey(m)) && sel.has(mailKey(m)));
  const typed = q.trim().length >= 2;
  const reason = bodySearch ? undefined : "search.body_off";
  const moreText = bodySearch && scope === "meta" && !!res && (
    <p className="px-4 pt-3 type-meta text-muted">
      {t("search.more_hint")}{" "}
      <button type="button" className="text-accent hover:underline"
        onClick={() => pickScope("body")}>
        {t("search.more_action")}
      </button>
      {" - "}{t(bodyMode === "local"
        ? "search.more_local" : "search.more_server")}
    </p>
  );

  return (
    <Modal onClose={onClose} size="lg" full>
      <PanelHeader
        title={<span className="inline-flex items-center gap-2">
          <Search size={18} /> {t("Search")}
        </span>}
        sub={res ? `${mails.length} ${t("matches")}` : ""}
        onClose={onClose}
      />

      {view && <MessageView mail={view} onBack={() => setView(null)} />}
      {/* Stays mounted behind a mail so Back keeps the scroll position. */}
      {(
        <div data-scroll-id="panel"
          className={`min-h-0 flex-1 overflow-y-auto pb-4
            ${view ? "hidden" : ""}`}>
          <div className="mx-auto w-full max-w-3xl">
            <div className="px-4 pt-4">
              <div className="relative">
                <Search size={18} aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2
                    -translate-y-1/2 text-muted" />
                <input ref={input} autoFocus type="search" value={q}
                  aria-label={t("Search")}
                  className="min-h-12 w-full rounded-card border border-line
                    bg-panel2 pl-11 pr-11 type-heading focus:border-accent
                    [&::-webkit-search-cancel-button]:appearance-none"
                  placeholder={bodyOn
                    ? t("search.placeholder_body") : t("search.placeholder")}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") run(q, bodyOn, true);
                  }} />
                {busy && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2">
                    <Spinner />
                  </span>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Segmented<Scope> value={scope} label={t("search.scope")}
                  role="radio" onChange={pickScope}
                  options={[
                    { value: "meta", label: t("search.scope_meta") },
                    { value: "body", label: t("search.scope_body"),
                      disabled: !bodySearch,
                      describedBy: reason ? "search-body-off" : undefined },
                  ]} />
                {typed && !!res?.mails.length && (
                  <span className="ml-auto flex flex-wrap gap-2">
                    <Select aria-label={t("search.time")} value={when}
                      onChange={(e) => setWhen(e.target.value as When)}>
                      <option value="any">{t("search.time_any")}</option>
                      <option value="30d">{t("search.time_30d")}</option>
                      <option value="year">{t("search.time_year")}</option>
                      <option value="old">{t("search.time_old")}</option>
                    </Select>
                    <Select aria-label={t("search.folder")} value={folder}
                      onChange={(e) => setFolder(e.target.value)}>
                      <option value="">{t("search.folder_all")}</option>
                      {folders.map((f) => <option key={f}>{f}</option>)}
                    </Select>
                  </span>
                )}
              </div>
              {reason && (
                <p id="search-body-off"
                  className="mt-2 type-meta text-muted">{t(reason)}</p>
              )}
              {bodyOn && (
                <p className="mt-2 type-meta text-muted">
                  {t(bodyMode === "local"
                    ? "search.body_hint_local" : "search.body_hint")}
                </p>
              )}
              {note && (
                <p role="status" className="mt-2 type-meta text-muted">
                  {note}
                </p>
              )}
              {res?.notes.map((n) => (
                <p key={n.key + JSON.stringify(n.params)}
                  className="mt-2 type-meta text-muted">
                  {t(`search.note.${n.key}`, n.params)}
                </p>
              ))}
            </div>

            {!typed && (
              <>
                {recent.length > 0 && (
                  <section className="px-4 pt-5">
                    <div className="mb-1 flex items-center justify-between">
                      <SectionLabel>{t("search.recent")}</SectionLabel>
                      <button type="button"
                        className="type-meta text-accent hover:underline
                          coarse:min-h-11"
                        onClick={() => { setRecent([]); saveRecent([]); }}>
                        {t("search.recent_clear")}
                      </button>
                    </div>
                    <ul className="rounded-card border border-line bg-panel">
                      {recent.map((r) => (
                        <li key={r} className="border-b border-line/60
                          last:border-b-0">
                          <button type="button"
                            className="flex min-h-11 w-full items-center
                              gap-3 px-3 text-left type-body hover:bg-panel2"
                            onClick={() => { setQ(r); input.current?.focus(); }}>
                            <Clock size={16} aria-hidden
                              className="shrink-0 text-muted" />
                            <span className="min-w-0 flex-1 truncate">{r}</span>
                            <ArrowUpLeft size={16} aria-hidden
                              className="shrink-0 text-faint" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {tries.length > 0 && onOpenFiltered && (
                  <section className="px-4 pt-5">
                    <SectionLabel className="mb-1">{t("search.try")}</SectionLabel>
                    <ul className="rounded-card border border-line bg-panel">
                      {tries.map((p) => (
                        <li key={p.id} className="border-b border-line/60
                          last:border-b-0">
                          <button type="button"
                            className="flex min-h-12 w-full items-center
                              gap-3 px-3 py-2 text-left hover:bg-panel2"
                            onClick={() => onOpenFiltered(p.query)}>
                            <span aria-hidden className="flex size-9
                              shrink-0 items-center justify-center
                              rounded-control bg-accent-tint text-accent">
                              {p.icon}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate type-body
                                font-medium">{t(`search.try_${p.id}`)}</span>
                              <span className="block truncate type-meta
                                text-muted">
                                {[p.prefix && t(p.prefix),
                                  t("search.try_senders", { n: p.s }),
                                  p.unit === "mails"
                                  && t("search.try_mails", { n: p.n })]
                                  .filter(Boolean).join(" · ")}
                              </span>
                            </span>
                            <ChevronRight size={16} aria-hidden
                              className="shrink-0 text-faint" />
                          </button>
                        </li>
                      ))}
                    </ul>
                    <p className="px-1 pt-2 type-meta text-muted">
                      {t("search.try_note")}
                    </p>
                  </section>
                )}
                {!recent.length && !(tries.length && onOpenFiltered) && (
                  <EmptyState icon={<Search size={18} />}
                    title={t("search.empty_title")}
                    hint={t("search.empty_hint")} />
                )}
              </>
            )}

            {typed && res && senders.length > 0 && (
              <section className="px-4 pt-5">
                <SectionLabel className="mb-1">
                  {t("search.senders")} · {senders.length}
                </SectionLabel>
                <ul className="rounded-card border border-line bg-panel">
                  {senders.map((g) => (
                    <li key={g.key} className="border-b border-line/60
                      last:border-b-0">
                      <button type="button" disabled={!onOpenSender}
                        className="flex min-h-14 w-full items-center gap-3
                          px-3 py-2 text-left hover:bg-panel2"
                        onClick={() => { commit(res?.q ?? ""); onOpenSender?.(g); }}>
                        <Avatar name={g.label || g.key} size="md" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate type-body
                            font-medium">{mark(g.label || g.key)}</span>
                          <span className="block truncate type-meta
                            text-muted">{mark(g.key)}</span>
                        </span>
                        <span className="shrink-0 type-meta text-muted
                          tabular-nums">
                          {t("search.sender_stats",
                            { n: g.count, size: fmtSize(g.size) })}
                        </span>
                        <ChevronRight size={16} aria-hidden
                          className="shrink-0 text-faint" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {typed && res && mails.length > 0 && (
              <section className="pt-5">
                <div className="mb-1 flex flex-wrap items-center gap-2 px-4">
                  <SectionLabel>
                    {t("search.mails")} · {mails.length}
                  </SectionLabel>
                  <span className="ml-auto flex items-center gap-3">
                    {picked.length > 0 && (
                      <Button variant="danger" size="sm"
                        onClick={trashSelected}>
                        {t("Trash selected")} ({picked.length})
                      </Button>
                    )}
                    <button type="button"
                      className="type-meta text-accent hover:underline
                        coarse:min-h-11"
                      onClick={() => setSel(allSelected ? new Set()
                        : new Set(mails.map(mailKey)))}>
                      {allSelected ? t("search.select_none")
                        : t("search.select_all", { n: mails.length })}
                    </button>
                  </span>
                </div>
                <div className="mx-4 overflow-hidden rounded-card border
                  border-line bg-panel">
                  <MailRows mails={mails} sel={new Set(picked)} onToggle={toggle}
                    onOpen={(m) => { commit(res?.q ?? ""); setView(m); }} mark={mark} />
                </div>
              </section>
            )}

            {typed && res && mails.length === 0 && (
              <EmptyState icon={<Search size={18} />}
                title={t("search.none")} hint={t("search.none_hint")} />
            )}
            {typed && moreText}
          </div>
        </div>
      )}
    </Modal>
  );
}

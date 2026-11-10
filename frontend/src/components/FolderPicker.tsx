import { Archive, Check, Clock, Folder, Inbox, Search } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { t } from "../i18n";
import { fmtNum } from "../numfmt";
import { fmtAgo } from "../lib";
import { nowMs } from "../clock";
import { useLayer } from "../backStack";
import { useSidebar } from "../nav";
import type { FoldersResp, Rule } from "../types";
import { Button, Input, Modal, SettingsGroup, SettingsRow, Switch,
  useOptionalToast } from "./ui";

/** One row of the folder tree. `raw` is null for a parent the server does
 *  not offer as a target (it only exists to nest its children). */
export interface FolderNode {
  raw: string | null;
  name: string;           // last path part
  path: string;           // full readable path, parts joined by " / "
  depth: number;
  count?: number;
}

interface Built { raw: string | null; name: string; count?: number;
  kids: Built[] }

/** The offered folders as a depth-first list: the hierarchy comes from each
 *  folder's own delimiter (`delims`, by raw name) applied to its readable
 *  name (`labels[i]`, else the raw name). Server order is kept; a folder
 *  without a delimiter is a root. `counts` is mails per raw folder. */
export function buildFolderTree(folders: string[], labels: string[],
  delims: Record<string, string | null | undefined> = {},
  counts: Record<string, number> = {}): FolderNode[] {
  const roots: Built[] = [];
  folders.forEach((raw, i) => {
    const label = labels[i] || raw;
    const d = delims[raw];
    const parts = (d ? label.split(d) : [label]).filter(Boolean);
    if (!parts.length) parts.push(label);
    let level = roots;
    let node: Built | undefined;
    for (const part of parts) {
      node = level.find((n) => n.name === part);
      if (!node) { node = { raw: null, name: part, kids: [] }; level.push(node); }
      level = node.kids;
    }
    node!.raw = raw;
    node!.count = counts[raw];
  });
  const out: FolderNode[] = [];
  const walk = (list: Built[], depth: number, trail: string[]) => {
    for (const n of list) {
      const path = [...trail, n.name];
      out.push({ raw: n.raw, name: n.name, path: path.join(" / "), depth,
        count: n.count });
      walk(n.kids, depth + 1, path);
    }
  };
  walk(roots, 0, []);
  return out;
}

/** Folders whose path contains `q` (case-insensitive), selectable ones only. */
export const searchFolders = (nodes: FolderNode[], q: string): FolderNode[] => {
  const needle = q.trim().toLowerCase();
  return nodes.filter((n) => n.raw !== null
    && (!needle || n.path.toLowerCase().includes(needle)));
};

/* Recently used targets: per account, newest first, in localStorage. */
const RECENT_MAX = 5;
const SUGGEST_RECENT = 3;
const recentKey = (account: string) => `pmc_move_recent:${account}`;
export interface Recent { raw: string; ts: number }
export function loadRecent(account: string): Recent[] {
  try {
    const v = JSON.parse(localStorage.getItem(recentKey(account)) ?? "[]");
    return Array.isArray(v) ? v.filter((r) => r && typeof r.raw === "string"
      && typeof r.ts === "number") : [];
  } catch { return []; }
}
export function rememberRecent(account: string, raw: string): void {
  const next = [{ raw, ts: Math.floor(nowMs() / 1000) },
    ...loadRecent(account).filter((r) => r.raw !== raw)].slice(0, RECENT_MAX);
  try { localStorage.setItem(recentKey(account), JSON.stringify(next)); }
  catch { /* private mode: suggestions are a convenience */ }
}

/** The filter a "move rule" gets: one sender (`from:`) or one domain. */
export interface MoveRuleTarget {
  kind: "sender" | "domain";
  value: string;
  label: string;
}

/** What a call site passes down so the picker can name folders, scope its
 *  recents to the account and link to Rules. */
export interface PickEnv {
  labels?: string[];
  account: string;
  onOpenRules?: () => void;
}

// The control the user last pressed: Safari does not focus a button on click,
// so `document.activeElement` alone cannot say where to anchor the popover.
let lastPressed: Element | null = null;
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", (e) => {
    lastPressed = (e.target as Element | null)?.closest?.("button") ?? null;
  }, true);
}
const openerNow = (): Element | null => {
  const a = document.activeElement;
  return a && a !== document.body ? a
    : lastPressed?.isConnected ? lastPressed : a;
};

const POP_W = 380;   // popover width (px), as in the mockup

/** Folder chooser for "Move N mails": a bottom sheet below 1024 px, a popover
 *  at the control that opened it from there on (both own a history entry).
 *  Lists exactly `folders` (the raw names the Move select offered), as a
 *  searchable tree with mail counts, plus Suggested (the Archive folder and
 *  the last few used here). Picking a folder only selects it; Move runs
 *  `onPick(raw)` (the caller's existing move path: confirm, undo, ...).
 *  With `rule` (one sender / domain is moved) an optional switch also creates
 *  a move rule for it - never armed (report mode) - after the move went
 *  through. */
export function FolderPicker({ count, folders, labels = [], account, onPick,
  onClose, rule, onOpenRules, restore = false }: {
  count: number;
  folders: string[];
  /** Readable names, parallel to `folders`. */
  labels?: string[];
  account: string;
  onPick: (dest: string) => Promise<boolean | void> | void;
  onClose: () => void;
  rule?: MoveRuleTarget;
  onOpenRules?: () => void;
  /** Wording for putting mails back (Trash -> a folder): "Restore N mails". */
  restore?: boolean;
}) {
  const wide = useSidebar();
  const toast = useOptionalToast();
  const [info, setInfo] = useState<FoldersResp | null>(null);
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const [always, setAlways] = useState(false);
  const opener = useRef<Element | null>(openerNow());
  const pop = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top?: number; bottom?: number;
    left: number; maxH: number } | null>(null);

  useEffect(() => {
    let live = true;
    api.folders(account || undefined).then((r) => { if (live) setInfo(r); })
      .catch(() => { /* flat list without counts */ });
    return () => { live = false; };
  }, [account]);

  const delims = useMemo(() => Object.fromEntries(
    (info?.folders ?? []).map((f) => [f.raw, f.delim])), [info]);
  const tree = useMemo(() => buildFolderTree(folders, labels, delims,
    info?.mail_counts), [folders, labels, delims, info]);
  const byRaw = useMemo(() => new Map(
    tree.filter((n) => n.raw !== null).map((n) => [n.raw!, n])), [tree]);

  const archive = info?.special?.find((s) => s.role === "archive")?.raw;
  const suggested = useMemo(() => {
    const out: { raw: string; sub: string; kind: "archive" | "recent" }[] = [];
    if (archive && byRaw.has(archive)) {
      out.push({ raw: archive, sub: t("folder.archive_hint"),
        kind: "archive" });
    }
    for (const r of loadRecent(account)) {
      if (out.length >= 1 + SUGGEST_RECENT) break;
      if (!byRaw.has(r.raw) || out.some((o) => o.raw === r.raw)) continue;
      const ago = fmtAgo(r.ts);
      out.push({ raw: r.raw, kind: "recent",
        sub: ago ? t("folder.used_ago", { ago }) : t("folder.used") });
    }
    return out;
  }, [archive, byRaw, account]);

  const searching = q.trim() !== "";
  const hits = useMemo(() => searching ? searchFolders(tree, q) : [], [tree, q]);

  const close = () => {
    onClose();
    const el = opener.current as HTMLElement | null;
    if (el?.isConnected) el.focus?.({ preventScroll: true });
  };
  const commit = () => {
    if (chosen === null) return;
    const dest = chosen;
    const target = rule && always ? rule : null;
    const destName = byRaw.get(dest)?.path ?? dest;
    onClose();
    // A folder counts as used only once the move went through (a declined
    // confirm or a failure does not return true).
    Promise.resolve(onPick(dest)).then(async (ok) => {
      if (ok !== true) return;
      rememberRecent(account, dest);
      if (!target) return;
      try {
        await api.createRule({
          name: t("folder.rule_name", { label: target.label, dest: destName }),
          scope: "mail", grouping: target.kind,
          query: `${target.kind === "sender" ? "from" : "domain"}:${target.value}`,
          action: "move", dest, schedule: "manual", account,
        } as Partial<Rule>);
        toast?.show(t("folder.rule_made", { label: target.label }), {
          variant: "success",
          action: onOpenRules ? { label: t("folder.open_rules"),
            onClick: onOpenRules } : undefined });
      } catch (e: any) {
        toast?.show(t("folder.rule_failed", { msg: e?.message ?? String(e) }),
          { variant: "error" });
      }
    });
  };

  // Popover: against the opener (below it, or above when that has more room),
  // inside the viewport. Phones use the Modal sheet instead.
  useLayoutEffect(() => {
    if (!wide) return;
    const place_ = () => {
      const el = opener.current as HTMLElement | null;
      const r = el?.isConnected && el !== document.body
        ? el.getBoundingClientRect() : null;
      const vw = window.innerWidth, vh = window.innerHeight;
      const edge = 8;
      const left = Math.max(edge, Math.min(r ? r.left : (vw - POP_W) / 2,
        vw - POP_W - edge));
      if (!r) { setPlace({ top: 64, left, maxH: vh - 96 }); return; }
      const down = vh - r.bottom - edge - 4, up = r.top - edge - 4;
      // 520: about what the list wants; prefer the side that fits it.
      if (down >= 520 || down >= up) {
        setPlace({ top: r.bottom + 4, left, maxH: Math.max(down, 240) });
      } else {
        setPlace({ bottom: vh - r.top + 4, left, maxH: Math.max(up, 240) });
      }
    };
    place_();
    window.addEventListener("resize", place_);
    return () => window.removeEventListener("resize", place_);
  }, [wide]);
  useLayer(wide, close);
  useEffect(() => {
    if (!wide) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
      // Tab wraps inside the popover; an open Modal behind it (the sender
      // detail) must not pull focus back into itself.
      if (e.key === "Tab" && pop.current?.contains(e.target as Node)) {
        e.stopPropagation();
        const stops = [...pop.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input")];
        const at = stops.indexOf(document.activeElement as HTMLElement);
        if (stops.length && (e.shiftKey ? at <= 0 : at === stops.length - 1)) {
          e.preventDefault();
          stops[e.shiftKey ? stops.length - 1 : 0].focus();
        }
      }
      // The popover is modal in effect (an outside press closes it): the
      // app's list shortcuts (x, #, Enter...) must not act on the group
      // behind it while it is open - whatever has focus (a click on its
      // title leaves it on <body>). Only Tab from outside is left to the
      // dialog behind.
      if (e.key !== "Tab" || pop.current?.contains(e.target as Node))
        e.stopPropagation();
    };
    // An outside press only closes the popover: the click that follows it must
    // not also hit whatever lay underneath (same idea as the swipe-row tap).
    const onDoc = (e: MouseEvent) => {
      if (pop.current?.contains(e.target as Node)) return;
      const eat = (c: Event) => { c.stopPropagation(); c.preventDefault(); };
      document.addEventListener("click", eat, { capture: true, once: true });
      setTimeout(() => document.removeEventListener("click", eat, true), 600);
      close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [wide]);

  const onListKey = (e: ReactKeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const root = e.currentTarget as HTMLElement;
    const rows = [...root.querySelectorAll<HTMLElement>("[data-folder-row]")];
    const i = rows.indexOf(document.activeElement as HTMLElement);
    const to = rows[e.key === "ArrowDown" ? Math.min(i + 1, rows.length - 1)
      : i <= 0 ? -1 : i - 1];
    e.preventDefault();
    if (to) to.focus();
    else root.querySelector<HTMLElement>("input")?.focus();
  };

  const row = (raw: string, key: string, icon: ReactNode, name: string,
    opts: { sub?: string; depth?: number; count?: number } = {}) => {
    const on = chosen === raw;
    return (
      <button key={key} type="button" data-folder-row="" aria-pressed={on}
        onClick={() => setChosen(raw)}
        style={opts.depth ? { paddingLeft: `${1 + opts.depth * 1.5}rem` }
          : undefined}
        className={`flex min-h-11 w-full items-center gap-3 px-4 py-1.5
          text-left transition-colors hover:bg-panel2 ${on ? "bg-accent-tint" : ""}`}>
        <span aria-hidden className="shrink-0 text-muted">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate type-body">{name}</span>
          {opts.sub && (
            <span className="block truncate type-meta text-muted">
              {opts.sub}
            </span>
          )}
        </span>
        {opts.count !== undefined && (
          <span className="shrink-0 type-body tabular-nums text-muted">
            {fmtNum(opts.count)}
          </span>
        )}
        {on && <Check size={16} aria-hidden className="shrink-0 text-accent" />}
      </button>
    );
  };
  const iconOf = (raw: string, name: string) =>
    raw === archive ? <Archive size={18} />
    : raw.toUpperCase() === "INBOX" || name.toUpperCase() === "INBOX"
      ? <Inbox size={18} /> : <Folder size={18} />;
  const nameOf = (n: FolderNode) =>
    n.depth === 0 && n.name.toUpperCase() === "INBOX" ? t("Inbox") : n.name;

  const title = t(restore ? "folder.restore_title" : "folder.title",
    { n: count });
  const action = t(restore ? "folder.restore_btn" : "Move");
  const body = (
    <div onKeyDown={onListKey} className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pb-2">
        <div className="relative">
          <Search size={16} aria-hidden className="pointer-events-none
            absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input autoFocus={wide} value={q} className="w-full pl-9"
            placeholder={t("folder.find")} aria-label={t("folder.find")}
            onChange={(e) => { setQ(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && hits.length === 1) {
                e.preventDefault();
                setChosen(hits[0].raw);
              }
            }} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
        {searching ? (
          hits.length ? (
            <SettingsGroup>
              {hits.map((n) => row(n.raw!, n.raw!, iconOf(n.raw!, n.name),
                n.path, { count: n.count }))}
            </SettingsGroup>
          ) : (
            <p className="py-6 text-center type-body text-muted">
              {t("folder.none")}
            </p>
          )
        ) : (
          <>
            {suggested.length > 0 && (
              <SettingsGroup header={t("folder.suggested")}>
                {suggested.map((s) => row(s.raw, `s:${s.raw}`,
                  s.kind === "archive" ? <Archive size={18} />
                    : <Clock size={18} />,
                  byRaw.get(s.raw)?.name ?? s.raw,
                  { sub: s.sub, count: byRaw.get(s.raw)?.count }))}
              </SettingsGroup>
            )}
            <SettingsGroup header={t("folder.all")}>
              {tree.map((n) => n.raw !== null
                ? row(n.raw, n.raw, iconOf(n.raw, n.name), nameOf(n),
                  { depth: n.depth, count: n.count })
                : (
                  <div key={`p:${n.path}`}
                    style={n.depth ? { paddingLeft: `${1 + n.depth * 1.5}rem` }
                      : undefined}
                    className="flex min-h-11 items-center gap-3 px-4 py-1.5
                      text-muted">
                    <Folder size={18} aria-hidden />
                    <span className="truncate type-body">{n.name}</span>
                  </div>
                ))}
            </SettingsGroup>
          </>
        )}
        {rule && (
          <SettingsGroup className="mb-0">
            <SettingsRow label={t("folder.always", { label: rule.label })}
              sub={t("folder.always_sub")}>
              <Switch checked={always} onChange={setAlways} />
            </SettingsRow>
          </SettingsGroup>
        )}
      </div>
    </div>
  );

  if (!wide) {
    return (
      <Modal size="sm" label={title} onClose={close}>
        <div className="flex min-h-0 flex-1 flex-col pb-2">
          <div className="flex items-center justify-between gap-2 px-4 pb-3">
            <Button variant="plain" onClick={close}>{t("Cancel")}</Button>
            <h2 className="min-w-0 text-center type-heading">{title}</h2>
            <Button variant="plain" disabled={chosen === null}
              onClick={commit}>{action}</Button>
          </div>
          {body}
        </div>
      </Modal>
    );
  }
  return createPortal(
    <div ref={pop} role="dialog" aria-label={title}
      style={{ position: "fixed", top: place?.top, bottom: place?.bottom,
        left: place?.left ?? 0, width: POP_W, maxHeight: place?.maxH,
        opacity: place ? 1 : 0 }}
      className="z-(--z-modal) flex flex-col overflow-hidden rounded-card
        border border-line bg-panel pt-3 shadow-popover">
      <div className="flex items-center justify-between gap-2 px-4 pb-3">
        <h2 className="min-w-0 truncate type-heading">{title}</h2>
        <Button size="sm" disabled={chosen === null} onClick={commit}>
          {action}
        </Button>
      </div>
      {body}
    </div>, document.body);
}

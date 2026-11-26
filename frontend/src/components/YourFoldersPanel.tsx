import { ChevronRight, Copy, FolderPlus, FolderTree, FolderX, Lock, Moon }
  from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmtSize } from "../api";
import { t } from "../i18n";
import { fmtNum } from "../numfmt";
import { renameRecent } from "./FolderPicker";
import { useSplitPane } from "../splitPane";
import { dayMonth } from "../subscriptions";
import type { FolderHint, FolderRule, YourFolderRow, YourFoldersResp }
  from "../types";
import { rememberFolders } from "../yourFoldersCache";
import { folderFilter, folderLabel, leafName, mergeTargets, quietSince,
  renameNotes, ruleSentences, anyActive, unreadPct } from "../yourFolders";
import { FolderMerge, type MergeAnswer } from "./FolderMerge";
import { FolderPane, folderIcon } from "./FolderPane";
import { Button, EmptyState, IconTile, Loading, Modal, Notice, PanelHeader,
  Tag, confirmDialog, customDialog, promptDialog, useIsPage, useMediaQuery,
  useToast, type TagTone } from "./ui";

const HINT_ICON = { look: Copy, empty: FolderX, stale: Moon } as const;
/** Why the emptied folder of a "then delete" merge stayed (server codes). */
const KEPT: Record<string, string> = { children: "yf.kept_children",
  rules: "yf.kept_rules", folder_not_empty: "yf.kept_not_empty" };
const HINT_TONE: Record<FolderHint, TagTone> = {
  look: "info", empty: "neutral", stale: "review" };

/** The chip of a row (one, the most telling): empty, look-alike, quiet, or why
 *  the scan did not read it. */
function Chip({ row }: { row: YourFolderRow }) {
  const kind: FolderHint | null = row.hints.includes("empty") ? "empty"
    : row.hints.includes("look") ? "look"
    : row.hints.includes("stale") ? "stale" : null;
  if (kind) {
    const Icon = HINT_ICON[kind];
    return (
      <Tag tone={HINT_TONE[kind]} className="whitespace-nowrap">
        <span className="inline-flex items-center gap-1"><Icon size={14}
          aria-hidden />{t(`yf.chip.${kind}`, { year: quietSince(row) ?? "" })}
        </span>
      </Tag>
    );
  }
  if (!row.scanned) {
    return (
      <Tag className="whitespace-nowrap">
        {row.off === "pattern"
          ? t("yf.chip.pattern", { pattern: row.pattern })
          : t("yf.chip.off")}
      </Tag>
    );
  }
  return null;
}

/** Your folders (Clean up, after Trash): every folder of the account with
 *  mails, size, newest mail and the rules that use it (from the last scan -
 *  a folder the scan did not read is listed without numbers), hints for
 *  look-alike names, empty folders and folders gone quiet, and the four
 *  operations on the server: merge into another folder (one step with Undo),
 *  rename, delete an empty folder, New folder. Inbox, Archive, Sent, Drafts,
 *  Junk, Trash, a provider's own folders and labels are locked as the server
 *  says (backend/yourfolders.py) - nothing is decided here. */
export function YourFoldersPanel({ account, scannedTs, hasSender, onClose,
  onChanged, onOpenAllMail, onOpenSender, onSettings }: {
  account: string;
  /** The last finished scan: the list is fetched again. */
  scannedTs?: number | null;
  /** Mail from this address was scanned: it has a sender page. */
  hasSender: (addr: string) => boolean;
  onClose: () => void;
  /** The folder list changed (a folder was made / renamed / merged / deleted). */
  onChanged: () => void;
  /** Open All mail with this filter. */
  onOpenAllMail: (query: string) => void;
  onOpenSender: (addr: string) => void;
  /** Settings > Account (the folders to scan live there too). */
  onSettings: () => void;
}) {
  const [data, setData] = useState<YourFoldersResp | null>(null);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [paneOff, setPaneOff] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<FolderHint | null>(null);
  const split = useSplitPane();
  const phone = useMediaQuery("(max-width: 767px)");
  const onPage = useIsPage();
  const toast = useToast();
  const alive = useRef(true);
  const card = onPage ? "bg-panel" : "bg-panel2";

  const load = useCallback(async () => {
    try {
      const d = await api.yourFolders(account);
      if (!alive.current) return;
      rememberFolders(account, scannedTs, d);
      setData(d);
      setError("");
    } catch (e: any) {
      if (alive.current) setError(String(e.message ?? e));
    }
  }, [account, scannedTs]);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => { alive.current = false; };
  }, [load, scannedTs]);

  const fail = (e: any) =>
    toast.show(String(e?.message ?? e), { variant: "error" });

  const rows = data?.rows ?? [];
  const shown = hint ? rows.filter((r) => r.hints.includes(hint)) : rows;
  const cur = rows.find((r) => r.raw === sel)
    ?? (split && !paneOff ? shown[0] : undefined);
  const twin = cur?.twin ? rows.find((r) => r.raw === cur.twin) ?? null : null;
  const serverBusy = !!data?.busy;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); }
    catch (e) { fail(e); }
    finally { if (alive.current) setBusy(false); }
  };
  const changed = async () => { await load(); onChanged(); };

  // ---- the operations -------------------------------------------------
  const create = () => run(async () => {
    const name = await promptDialog({ title: t("yf.create_title"),
      label: t("yf.create_label"), confirmLabel: t("yf.create_btn"),
      validate: (v) => v.trim() ? null : t("yf.name_required") });
    if (name === null) return;
    const r = await api.createFolder(name.trim(), account);
    toast.show(t("yf.created", { name: r.name }), { variant: "success" });
    setSel(r.raw);
    setPaneOff(false);
    await changed();
  });

  const rename = (row: YourFolderRow) => run(async () => {
    const leaf = leafName(row);
    // a name that is taken is said in the prompt, which keeps what was typed
    const parent = row.name.slice(0, row.name.length - leaf.length);
    const taken = new Set([...rows.map((r) => r.name),
      ...(data?.special ?? []).map((s) => s.name)]
      .map((n) => n.toLowerCase()));
    taken.delete(row.name.toLowerCase());   // only the case differs: its own
    const asked = await promptDialog({ title: t("yf.rename_title",
      { name: row.name }), label: t("yf.rename_label"), initial: leaf,
    confirmLabel: t("yf.rename_btn"),
    validate: (v) => !v.trim() ? t("yf.name_required")
      : v.trim() !== leaf && taken.has((parent + v.trim()).toLowerCase())
        ? t("ferr.folder_exists", { folder: parent + v.trim() }) : null });
    const typed = asked?.trim();
    if (!typed || typed === leaf) return;
    const chk = await api.folderCheck({ op: "rename", folder: row.raw,
      name: typed }, account);
    const rules: FolderRule[] = chk.rules ?? [];
    const to = chk.new_name ?? typed;
    // a rename that changes nothing else needs no second question
    const bullets = [...ruleSentences(rules, to), ...renameNotes(chk)];
    if (bullets.length && !await confirmDialog({
      title: t("yf.rename_confirm", { name: row.name, to }), bullets,
      footnote: anyActive(rules) ? t("yf.rules_tail") : undefined,
      confirmLabel: t("yf.rename_btn"), tone: "primary" })) return;
    const r = await api.renameFolder(row.raw, typed, rules.map((x) => x.id),
      account);
    renameRecent(account, row.raw, r.raw);
    toast.show(t("yf.renamed", { to: r.name }), { variant: "success" });
    setSel(r.raw);
    await changed();
  });

  const merge = (row: YourFolderRow) => run(async () => {
    const targets = mergeTargets(rows, row);
    const answer = await customDialog<MergeAnswer>((done) => (
      <FolderMerge row={row} targets={targets} account={account}
        onResult={done} />));
    if (!answer) return;
    const { check: c } = answer;
    const target = targets.find((r) => r.raw === answer.target);
    const r = await api.mergeFolder({ folder: row.raw, target: answer.target,
      uv: c.uv ?? 0, max_uid: c.max_uid ?? 0, delete_after: answer.deleteAfter,
      rules: (c.rules ?? []).map((x) => x.id) }, account);
    const to = target ? folderLabel(target) : r.target ?? answer.target;
    const kept = answer.deleteAfter && !r.deleted ? r.kept : "";
    const text = [t(r.deleted ? "yf.merged_deleted" : "yf.merged",
      { n: r.moved, target: to, name: row.name }),
    kept ? t(KEPT[kept] ?? "yf.kept_other", { name: row.name }) : ""]
      .filter(Boolean).join(" ");
    const ident = r.undo;
    toast.show(text, { variant: "success",
      action: ident ? { label: t("Undo"), onClick: () => {
        api.undo(-1, ident, account).then(async (u) => {
          toast.show(t("yf.undone", { n: u.restored, name: row.name }),
            { variant: "success" });
          await changed();
        }).catch(fail);
      } } : undefined });
    if (r.deleted) { setSel(answer.target); setSheet(false); }
    await changed();
  });

  const del = (row: YourFolderRow) => run(async () => {
    // the server counts the mail in it right now: the page's numbers are
    // from the last scan
    const chk = await api.folderCheck({ op: "delete", folder: row.raw },
      account);
    if (!await confirmDialog({ title: t("yf.delete_title",
      { name: row.name }), body: t("yf.delete_body"),
    confirmLabel: t("yf.delete"), tone: "danger" })) return;
    await api.deleteFolder(row.raw, chk.uv ?? 0, account);
    toast.show(t("yf.deleted", { name: row.name }), { variant: "success" });
    setSel(null);
    setSheet(false);
    await changed();
  });

  const scan = (row: YourFolderRow, on: boolean) => run(async () => {
    const cfg = await api.getConfig();
    const now: string[] = cfg.accounts?.[account]?.excluded_folders ?? [];
    const next = on ? now.filter((x) => x !== row.raw && x !== row.name)
      : [...now.filter((x) => x !== row.raw), row.raw];
    await api.saveConfig({ account, excluded_folders: next });
    toast.show(t(on ? "yf.scan_saved_on" : "yf.scan_saved_off",
      { name: row.name }), { variant: "success" });
    await load();
  });

  const pick = (row: YourFolderRow) => {
    setSel(row.raw);
    setPaneOff(false);
    if (!split) setSheet(true);
  };

  const pane = (row: YourFolderRow) => (
    <FolderPane row={row} twin={twin} busy={busy || serverBusy}
      scanOn={row.off === null}
      onClose={split ? () => { setPaneOff(true); setSel(null); } : undefined}
      onMerge={() => void merge(row)} onRename={() => void rename(row)}
      onDelete={() => void del(row)}
      onOpenMail={() => { setSheet(false); onOpenAllMail(folderFilter(row.name)); }}
      onScan={(on) => void scan(row, on)}
      onSender={(addr) => { setSheet(false); onOpenSender(addr); }}
      hasSender={hasSender}
      onSettings={() => { setSheet(false); onSettings(); }} />
  );

  // ---- the page -----------------------------------------------------
  const tot = data?.totals;
  const sub = tot ? [
    t("yf.sub_scanned", { n: tot.scanned }),
    t("n.mails", { n: tot.mails }),
    fmtSize(tot.size),
    ...(tot.not_scanned > 0 ? [t("yf.sub_off", { n: tot.not_scanned })] : []),
  ].join(" · ") : "";

  const hintCards = data && data.hints.length > 0 && (
    <ul className={`divide-y divide-line overflow-hidden rounded-card ${card}`}>
      {data.hints.map((h) => {
        const named = h.folders.map((raw) => rows.find((r) => r.raw === raw))
          .filter((r): r is YourFolderRow => !!r);
        const Icon = HINT_ICON[h.kind];
        const detail = h.kind === "stale" && named.length === 1
          ? t("yf.hint.stale_detail", { name: folderLabel(named[0]),
            mails: t("n.mails", { n: named[0].mails ?? 0 }),
            pct: unreadPct(named[0]), year: quietSince(named[0]) ?? "" })
          : named.map(folderLabel).join(", ");
        const title = t(`yf.hint.${h.kind}`, { n: h.folders.length });
        return (
          <li key={h.kind}>
            <button type="button" aria-pressed={hint === h.kind}
              aria-label={`${title}. ${t("yf.hint.open")}`}
              onClick={() => { setHint(hint === h.kind ? null : h.kind);
                setPaneOff(false); }}
              className={`flex min-h-12 w-full cursor-pointer items-center
                gap-3 px-3 py-2 text-left hover:bg-panel2
                ${hint === h.kind ? "bg-accent-tint" : ""}`}>
              <IconTile tone={HINT_TONE[h.kind]}>
                <Icon size={16} aria-hidden /></IconTile>
              <span className="min-w-0 flex-1">
                <span className="block type-body font-semibold">{title}</span>
                <span className="block truncate type-meta text-muted">
                  {detail}</span>
              </span>
              <ChevronRight size={16} aria-hidden className="shrink-0
                text-faint" />
            </button>
          </li>
        );
      })}
    </ul>
  );

  const numbers = (r: YourFolderRow) => r.mails !== null;
  const wideRow = (r: YourFolderRow) => {
    const selected = split && cur?.raw === r.raw;
    return (
      <button type="button" onClick={() => pick(r)}
        aria-current={selected ? "true" : undefined}
        className={`flex min-h-12 w-full cursor-pointer items-center gap-3
          px-4 py-1.5 text-left ${selected ? "bg-panel2 shadow-open-edge"
          : "hover:bg-panel2"}`}>
        <span className="shrink-0 text-muted">{folderIcon(r, true)}</span>
        {/* the chip goes below a long name instead of cutting it */}
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2
          gap-y-0.5">
          <span className={`min-w-0 max-w-full truncate type-body font-medium
            ${numbers(r) ? "" : "text-muted"}`}>{folderLabel(r)}</span>
          {r.lock && (
            <Lock size={14} aria-label={t("yf.locked")} className="shrink-0
              text-faint" />
          )}
          <Chip row={r} />
        </span>
        <span className="w-16 shrink-0 text-right type-body font-semibold
          tabular-nums">{numbers(r) ? fmtNum(r.mails!) : "-"}</span>
        <span className="w-20 shrink-0 text-right type-meta text-muted
          tabular-nums">{numbers(r) ? fmtSize(r.size ?? 0) : "-"}</span>
        <span className="w-24 shrink-0 text-right type-meta text-muted">
          {r.newest ? dayMonth(r.newest) : "-"}</span>
        <span className="w-20 shrink-0 text-right type-meta text-muted">
          {r.used_by.length ? t("n.rules", { n: r.used_by.length }) : ""}</span>
      </button>
    );
  };
  const phoneRow = (r: YourFolderRow) => (
    <button type="button" onClick={() => pick(r)}
      className="flex min-h-16 w-full cursor-pointer items-center gap-3 px-3
        py-2.5 text-left hover:bg-panel2">
      <span className="shrink-0 text-muted">{folderIcon(r)}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={`truncate type-body-mobile font-medium
            ${numbers(r) ? "" : "text-muted"}`}>{folderLabel(r)}</span>
          {r.lock && <Lock size={14} aria-label={t("yf.locked")}
            className="shrink-0 text-faint" />}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1
          type-meta text-muted">
          {numbers(r) ? (
            <span>{[t("n.mails", { n: r.mails! }), fmtSize(r.size ?? 0),
              r.newest ? dayMonth(r.newest) : ""].filter(Boolean)
              .join(" · ")}</span>
          ) : null}
          <Chip row={r} />
          {r.used_by.length > 0 && (
            <span>{t("n.rules", { n: r.used_by.length })}</span>
          )}
        </span>
      </span>
      <ChevronRight size={16} aria-hidden className="shrink-0 text-faint" />
    </button>
  );

  const table = (
    <div className={`overflow-hidden rounded-card ${card}`}>
      {!phone && (
        <div className="flex items-center gap-3 border-b border-line px-4
          py-2 type-caption text-muted">
          <span className="w-4 shrink-0" />
          <span className="min-w-0 flex-1">{t("yf.col.folder")}</span>
          <span className="w-16 shrink-0 text-right">{t("yf.col.mails")}</span>
          <span className="w-20 shrink-0 text-right">{t("yf.col.size")}</span>
          <span className="w-24 shrink-0 text-right">{t("yf.col.newest")}</span>
          <span className="w-20 shrink-0 text-right">{t("yf.col.used")}</span>
        </div>
      )}
      <ul>
        {shown.map((r) => (
          <li key={r.raw} data-testid="folder-row"
            className="border-t border-line first:border-0">
            {phone ? phoneRow(r) : wideRow(r)}
          </li>
        ))}
      </ul>
      {/* one flow of text: the lock never stands alone on a phone line */}
      <p className="border-t border-line px-4 py-2.5 type-meta text-muted">
        <Lock size={14} aria-hidden className="mr-1.5 inline align-text-bottom" />
        {t("yf.footer")}{" "}
        <button type="button" onClick={onSettings}
          className="inline-flex cursor-pointer items-center align-middle
            text-accent underline coarse:min-h-11">
          {t("yf.footer_link")}</button>
      </p>
    </div>
  );

  const newBtn = (
    <Button variant="secondary" disabled={busy} onClick={() => void create()}>
      <span className="inline-flex items-center gap-1.5">
        <FolderPlus size={16} aria-hidden />{t("yf.new")}</span>
    </Button>
  );

  const content = () => {
    if (!data) {
      return error ? (
        <div className="flex items-center gap-3 p-4 type-body text-muted">
          <span>{t("yf.load_failed")}</span>
          <Button variant="quiet" size="sm"
            onClick={() => void load()}>{t("tab.retry")}</Button>
        </div>
      ) : <Loading />;
    }
    return (
      <div className={split && !paneOff && cur
        ? "grid min-h-full grid-cols-[minmax(0,1fr)_24rem] 2xl:grid-cols-[minmax(0,1fr)_28rem]"
        : ""}>
        <div className="min-w-0 space-y-4 p-4 sm:p-5">
          {phone && <div className="flex">{newBtn}</div>}
          {data.busy && (
            <Notice tone="warn">{t(`ferr.${data.busy}`)}</Notice>
          )}
          {!data.scanned && <Notice>{t("yf.scan_first")}</Notice>}
          {hintCards}
          {hint && (
            <div className="flex items-center gap-2 type-meta text-muted">
              <span>{t("yf.hint.filter", { what: t(`yf.hint.${hint}`,
                { n: shown.length }) })}</span>
              <Button variant="quiet" size="sm"
                onClick={() => setHint(null)}>{t("yf.hint.clear")}</Button>
            </div>
          )}
          {shown.length === 0 ? (
            <EmptyState icon={<FolderTree size={18} />}
              title={t("yf.hint.empty", { n: 0 })} />
          ) : table}
        </div>
        {split && !paneOff && cur && (
          <aside aria-label={t("yf.pane.title")} data-testid="folder-pane"
            className="min-w-0 border-l border-line">
            <div className="sticky top-0 h-[calc(100dvh-5rem)] overflow-y-auto">
              {pane(cur)}
            </div>
          </aside>
        )}
      </div>
    );
  };

  return (
    <Modal onClose={onClose} size="lg" full>
      <PanelHeader
        title={<span className="inline-flex items-center gap-2">
          <FolderTree size={18} /> {t("yf.menu")}
        </span>}
        sub={sub}
        actions={!phone ? newBtn : undefined}
        onClose={onClose} />
      <div data-scroll-id="panel" className="min-h-0 flex-1 overflow-y-auto
        max-sm:pb-[env(safe-area-inset-bottom)]">
        {content()}
      </div>
      {sheet && !split && cur && (
        <Modal size="md" onClose={() => setSheet(false)} label={folderLabel(cur)}>
          <PanelHeader title={t("yf.pane.title")}
            onClose={() => setSheet(false)} />
          <div className="min-h-0 flex-1 overflow-y-auto">{pane(cur)}</div>
        </Modal>
      )}
    </Modal>
  );
}

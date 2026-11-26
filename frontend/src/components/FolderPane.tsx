import { Archive, Copy, FolderOpen, FolderPen, FolderX, GitMerge, Info,
  ListChecks, Moon, Inbox, X, Folder as FolderIcon } from "lucide-react";
import type { ReactNode } from "react";
import { fmtSize } from "../api";
import { t } from "../i18n";
import { dayMonth } from "../subscriptions";
import type { FolderWhy, YourFolderRow } from "../types";
import { quietSince, unreadPct, whyText } from "../yourFolders";
import { Avatar, Button, IconTile, Notice, Switch } from "./ui";

/** A pane button: icon and label on one line (a `Button` is a plain block). */
const ROW_BTN = "inline-flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap";

const SECTION = "type-caption font-semibold uppercase text-muted";

/** The folder icon of a row: the inbox, the archive, any other. */
export const folderIcon = (row: Pick<YourFolderRow, "lock" | "role">,
  small = false): ReactNode =>
  small ? (
    row.lock === "inbox" ? <Inbox size={16} aria-hidden />
      : row.role === "archive" ? <Archive size={16} aria-hidden />
      : <FolderIcon size={16} aria-hidden />
  ) : row.lock === "inbox" ? <Inbox size={18} aria-hidden />
    : row.role === "archive" ? <Archive size={18} aria-hidden />
    : <FolderIcon size={18} aria-hidden />;

/** The pane of one folder (beside the list from 1280 px, a sheet below): what
 *  it holds, what looks wrong about it, the four operations (each off with
 *  its reason in words), its scan switch, the rules that use it and the
 *  senders with most mail in it. */
export function FolderPane({ row, twin, busy, scanOn, onClose, onMerge,
  onRename, onDelete, onOpenMail, onScan, onSender, hasSender, onSettings }: {
  row: YourFolderRow;
  /** the folder it looks like (a row of the page), if any */
  twin: YourFolderRow | null;
  /** a folder operation is running / the server is busy */
  busy: boolean;
  /** whether the scan includes this folder right now (the switch) */
  scanOn: boolean;
  onClose?: () => void;
  onMerge: () => void;
  onRename: () => void;
  onDelete: () => void;
  onOpenMail: () => void;
  onScan: (on: boolean) => void;
  onSender: (addr: string) => void;
  hasSender: (addr: string) => boolean;
  onSettings: () => void;
}) {
  const numbers = row.mails !== null;
  const meta = numbers
    ? t("yf.pane.meta", { mails: t("n.mails", { n: row.mails! }),
      size: fmtSize(row.size ?? 0),
      date: row.newest ? dayMonth(row.newest) : "-" })
    : t("yf.pane.meta_off");
  const year = quietSince(row);
  // the reasons, in words (a disabled button must not stand alone)
  const reasons: FolderWhy[] = [];
  for (const why of [row.can.rename, row.can.merge, row.can.delete]) {
    if (why && why !== "not_empty" && !reasons.includes(why)) reasons.push(why);
  }
  const off = (why: FolderWhy | null) => busy || !!why;
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <IconTile tone="info">{folderIcon(row)}</IconTile>
        <div className="min-w-0 flex-1">
          <div className="truncate type-title2" title={row.name}>{row.name}</div>
          <div className="type-meta text-muted">{meta}</div>
        </div>
        {onClose && (
          <Button variant="secondary" size="icon" label={t("yf.pane.close")}
            onClick={onClose}><X size={16} /></Button>
        )}
      </div>

      {/* every reason the page has to look at this folder, the look-alike
          first (it is the one Merge answers) */}
      {row.hints.includes("look") && twin && (
        <Notice icon={<Copy size={16} aria-hidden />}>
          {t("yf.pane.look", { name: twin.name, n: twin.mails ?? 0 })}
        </Notice>
      )}
      {row.hints.includes("empty") && (
        <Notice icon={<Info size={16} aria-hidden />}>
          {t("yf.pane.empty")}</Notice>
      )}
      {row.hints.includes("stale") && year && (
        <Notice tone="warn" icon={<Moon size={16} aria-hidden />}>
          {t("yf.pane.stale", { year, pct: unreadPct(row),
            mails: t("n.mails", { n: row.mails ?? 0 }) })}
        </Notice>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant={row.hints.includes("look") && !off(row.can.merge)
          ? "primary" : "secondary"} disabled={off(row.can.merge)}
          onClick={onMerge}>
          <span className={ROW_BTN}><GitMerge size={16} aria-hidden />
            {t("yf.merge")}</span>
        </Button>
        <Button variant="secondary" disabled={off(row.can.rename)}
          onClick={onRename}>
          <span className={ROW_BTN}><FolderPen size={16} aria-hidden />
            {t("yf.rename")}</span>
        </Button>
        <Button variant="secondary" disabled={!numbers || !row.mails}
          onClick={onOpenMail}>
          <span className={ROW_BTN}><FolderOpen size={16} aria-hidden />
            {t("yf.open")}</span>
        </Button>
        <Button variant="secondary" disabled={off(row.can.delete)}
          onClick={onDelete}>
          <span className={ROW_BTN}><FolderX size={16} aria-hidden />
            {t("yf.delete")}</span>
        </Button>
      </div>
      <div className="-mt-2 space-y-1 type-meta text-muted">
        {reasons.map((why) => <p key={why}>{whyText(why)}</p>)}
        {!reasons.length && <p>{t("yf.delete_hint")}</p>}
      </div>

      <div className="flex items-center gap-3 rounded-control bg-panel2
        px-3 py-2">
        <span id="yf-scan-label" className="min-w-0 flex-1 type-body">
          {t("yf.scan")}
          {row.off === "pattern" && (
            <span className="block type-meta text-muted">
              {t("yf.scan_pattern", { pattern: row.pattern })}{" "}
              <button type="button" onClick={onSettings}
                className="cursor-pointer text-accent underline">
                {t("yf.footer_link")}</button>
            </span>
          )}
        </span>
        <Switch checked={scanOn} onChange={onScan}
          disabled={busy || row.off === "pattern"}
          aria-labelledby="yf-scan-label" />
      </div>

      <section aria-label={t("yf.pane.used")} className="space-y-1.5">
        <h3 className={SECTION}>{t("yf.pane.used")}</h3>
        {row.used_by.length === 0 ? (
          <p className="type-meta text-muted">{t("yf.pane.no_rules")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {row.used_by.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2">
                <IconTile><ListChecks size={14} aria-hidden /></IconTile>
                <span className="min-w-0 flex-1 truncate type-body">
                  {r.name}</span>
                <span className="shrink-0 type-meta text-muted">
                  {t(r.mode === "execute" ? "rule.seg_active"
                    : "rule.seg_report")}
                  {r.schedule ? ` · ${t(`sched.${r.schedule}`)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {row.top.length > 0 && (
        <section aria-label={t("yf.pane.top")} className="space-y-1.5">
          <h3 className={SECTION}>{t("yf.pane.top")}</h3>
          <ul className="divide-y divide-line">
            {row.top.map((s) => (
              <li key={s.addr}>
                <button type="button" disabled={!hasSender(s.addr)}
                  onClick={() => onSender(s.addr)}
                  className="flex min-h-11 w-full items-center gap-3 py-1.5
                    text-left enabled:cursor-pointer enabled:hover:bg-panel2">
                  <Avatar name={s.label} size="sm" />
                  <span className="min-w-0 flex-1 truncate type-body">
                    {s.label}</span>
                  <span className="shrink-0 type-meta tabular-nums
                    text-muted">{s.n}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

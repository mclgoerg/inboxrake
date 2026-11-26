import { t } from "./i18n";
import type { FolderCheck, FolderRule, FolderWhy, YourFolderRow,
  YourFoldersResp } from "./types";

/* Pure helpers of the Your folders page (backend/yourfolders.py is the
 * authority: the page only shows what it says and asks it again before it
 * acts). */

/** The last part of a folder's readable path ("Receipts" of "Work/Receipts"):
 *  what Rename edits - a folder stays below its parent. */
export const leafName = (row: Pick<YourFolderRow, "name" | "delim">): string =>
  row.delim ? row.name.split(row.delim).pop() ?? row.name : row.name;

/** The All mail filter that shows exactly this folder (`folder:"..."` is the
 *  whole name; a quote in the name cannot be written, the plain word then
 *  matches by containing). */
export const folderFilter = (name: string): string =>
  name.includes("\"") ? `folder:${name.replace(/\s+/g, "")}`
    : `folder:"${name}"`;

/** The year of a folder's newest mail ("quiet since 2021"). */
export const quietSince = (row: Pick<YourFolderRow, "newest">): number | null =>
  row.newest ? new Date(row.newest * 1000).getFullYear() : null;

/** Percent of a folder's mails that are unread (0 when unknown). */
export const unreadPct = (row: Pick<YourFolderRow, "mails" | "unread">):
    number =>
  row.mails && row.unread ? Math.round(100 * row.unread / row.mails) : 0;

/** The folders a merge may go into: any other ordinary folder, the Archive
 *  folder and the inbox - never a special folder, a label or a folder
 *  Inboxrake cannot move into (the server refuses those too). The folder it
 *  looks like first, then the rest by mails. */
export function mergeTargets(rows: YourFolderRow[], from: YourFolderRow):
    YourFolderRow[] {
  const ok = rows.filter((r) => r.raw !== from.raw && !r.label
    && (!r.lock || r.lock === "inbox" || r.role === "archive"));
  return ok.sort((a, b) => Number(b.raw === from.twin)
    - Number(a.raw === from.twin) || (b.mails ?? -1) - (a.mails ?? -1)
    || a.name.localeCompare(b.name));
}

/** What each of the rules a rename / merge changes will do, in a sentence:
 *  an Active one goes back to Report only (as every change of a target
 *  does), one in Report only just points elsewhere. */
export const ruleSentences = (rules: FolderRule[], to: string): string[] =>
  rules.map((r) => t(r.mode === "execute" ? "yf.rule_active"
    : "yf.rule_report", { rule: r.name, to }));

/** Whether any of the rules is Active (then the "switch it on again" line). */
export const anyActive = (rules: FolderRule[] | undefined): boolean =>
  !!rules?.some((r) => r.mode === "execute");

/** The things to tidy: one per hint card. */
export const tidyCount = (data: YourFoldersResp | null): number =>
  data?.hints.length ?? 0;

/** The text of the reason an operation is off (a `FolderWhy` code). */
export const whyText = (why: FolderWhy): string => t(`yf.why.${why}`);

/** What the rename / merge confirm tells besides the rules. */
export const renameNotes = (chk: FolderCheck): string[] => [
  ...(chk.children ? [t("yf.rename_children", { n: chk.children })] : []),
  ...(chk.stops_scanning ? [t("yf.rename_pattern")] : []),
];

/* Your documents: the small pure helpers of the page and of its Insights card
 * (the numbers come from backend/documents.py; nothing is decided here). */

import { fmtSize } from "./lib";
import { getLang, t } from "./i18n";
import type { DocKind, DocRow, DocsSummary, DocYear, Mail } from "./types";

/** The kinds, in the order the page shows them. */
export const DOC_KINDS: readonly DocKind[] = ["invoices", "contracts",
  "bookings", "tax"];

/** The newest year that has documents (the page opens on it), else null. */
export const latestYear = (s: DocsSummary | null): number | null =>
  s?.years.length ? s.years[s.years.length - 1].year : null;

export const yearOf = (s: DocsSummary | null, year: number | null):
    DocYear | null => s?.years.find((y) => y.year === year) ?? null;

/** "policy.pdf · 1.2 MB · terms.pdf · 380 KB": the files of a row as the
 *  mail's meta line shows them. */
export const filesLine = (r: DocRow): string =>
  r.files.map((f) => `${f.name} · ${fmtSize(f.size)}`).join(" · ");

/** The row as the mail reader wants it. A mail without a Message-ID cannot be
 *  pinned: its `pinned` stays unset, so the reader offers no pin. */
export const mailOf = (r: DocRow): Mail => ({
  uid: r.uid, folder: r.folder, date: r.date, ts: r.ts, subject: r.subject,
  addr: r.addr, size: r.size, seen: r.seen, ai: null,
  ...(r.pinnable ? { pinned: r.pinned } : {}),
});

/** "312 documents in 214 mails" for one year. */
export const yearLine = (y: DocYear): string =>
  t("docs.sub", { files: t("docs.n_files", { n: y.files }),
    mails: t("n.mails", { n: y.mails }), year: y.year });

/** "24 Nov" / "3. Nov.": a row's day, without the year (the page shows one
 *  year at a time). */
export const dayShort = (ts: number): string =>
  new Date(ts * 1000).toLocaleDateString(
    getLang() === "de" ? "de-DE" : "en-GB", { day: "numeric", month: "short" });

/* Your documents: the small pure helpers of the page and of its Insights card
 * (the numbers come from backend/documents.py; nothing is decided here). */

import { api } from "./api";
import { fmtSize } from "./lib";
import { getLang, t } from "./i18n";
import type { DocKind, DocRow, DocsPlan, DocsSummary, DocYear, Mail }
  from "./types";

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

/** What a whole year's download came to: the sum of the parts that were
 *  saved. */
export interface YearResult {
  /** how many downloads the plan made of it */
  parts: number;
  /** how many of them were saved (fewer when it was stopped or failed) */
  done: number;
  mails: number; files: number; skipped: number; pinned: number;
  /** stopped by the user after a part, or ended by a failure after one */
  stopped?: boolean;
}

/** One run of "Download 2026...": the plan, the next part to fetch, what the
 *  parts saved so far and whether the user asked to stop. A failed part leaves
 *  it as it is, so asking again goes on at that part (the earlier ones are not
 *  saved twice); a plan the server no longer knows starts over. */
export interface YearRun {
  plan: DocsPlan | null;
  next: number;
  total: YearResult;
  stop: boolean;
  /** some part kept mails safe (the list must be read again) */
  pinnedAny: boolean;
}

const none = (parts = 0): YearResult => ({ parts, done: 0, mails: 0, files: 0,
  skipped: 0, pinned: 0 });

export const newRun = (): YearRun => ({ plan: null, next: 1, total: none(),
  stop: false, pinnedAny: false });

/** What an unfinished run has saved (to be said), else null: nothing was saved
 *  and nothing pinned. */
export const partial = (run: YearRun): YearResult | null =>
  run.total.done > 0 || run.pinnedAny ? { ...run.total, stopped: true } : null;

/** Download a year's documents: ask the server for the plan (how many
 *  downloads, and the digest each names), then fetch each part in turn. A part
 *  that fails throws (the earlier ones are saved; `run` goes on at it); `run.stop`
 *  ends the run after the part that is being fetched. */
export async function downloadYear(year: number,
    answer: { kinds: DocKind[]; index: boolean; pin: boolean },
    progress: (part: number, of: number) => void,
    run: YearRun = newRun()): Promise<YearResult> {
  if (!run.plan) {
    run.plan = await api.documentsPlan(year, answer.kinds);
    run.next = 1;
    run.total = none(run.plan.parts);
  }
  const plan = run.plan;
  try {
    for (; run.next <= plan.parts; run.next++) {
      if (run.stop && run.next > 1) break;
      progress(run.next, plan.parts);
      const r = await api.downloadDocumentsZip({ year, kinds: plan.kinds,
        part: run.next, parts: plan.parts, plan: plan.plan, index: answer.index,
        pin: answer.pin, lang: getLang() });
      run.total.mails += r.mails;
      run.total.files += r.files;
      run.total.skipped += r.skipped;
      run.total.pinned += r.pinned;
      run.total.done = run.next;
      if (r.pinned) run.pinnedAny = true;
    }
  } catch (e: any) {
    // the list changed under the plan: the next ask makes a new one
    if (e?.code === "docs_changed") run.plan = null;
    throw e;
  }
  return { ...run.total, stopped: run.next <= plan.parts };
}

/** The toast after a year was saved: what is in it, how many downloads it was
 *  when it was more than one (or how far it got), what could not be read, what
 *  was kept safe. */
export const savedText = (year: number, r: YearResult): string => {
  const what = { year, n: r.done, of: r.parts,
    files: t("docs.zip_files", { n: r.files }),
    mails: t("n.mails", { n: r.mails }) };
  const cut = r.done < r.parts;
  return t(cut ? "docs.zip_done_stopped" : "docs.zip_done", what)
    + (!cut && r.parts > 1 ? t("docs.zip_done_parts", { n: r.parts }) : "")
    + (r.skipped ? t("docs.zip_done_skipped", { n: r.skipped }) : "")
    + (r.pinned ? t("docs.zip_done_pinned", { n: r.pinned }) : "");
};

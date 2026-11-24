/* Sender grades (backend/grades.py computes them; this is the UI's side):
 * the sort value, the Statistics numbers and the thresholds that "How grades
 * work" prints. Pure, so it is unit-testable. */

import { GRADE_LETTERS } from "./lib";
import type { Group, GradeLetter } from "./types";

/** The thresholds of the six checks, as the backend applies them
 *  (backend/grades.py; tests/test_grades.py compares the two). They fill the
 *  numbers of "How grades work". */
export const GRADE_RULES = {
  minMails: 3,
  readOkPct: 30, readBadBelowPct: 10,
  oftenOkPerWeek: 2, oftenBadPerWeek: 7,
  trackBadPct: 50,
  bulkMails: 10,
  sizeOkKb: 200, sizeBadMb: 1,
};

/** Sort value: 0 = A ... 4 = F, so "descending" reads worst first. A row
 *  without a grade sorts as the best, which never happens in the Sender
 *  grouping (the only one that offers the sort). */
export const gradeRank = (g: Group): number =>
  g.grade ? GRADE_LETTERS.indexOf(g.grade.letter) : 0;

export interface GradeStats {
  counts: Record<GradeLetter, number>;
  graded: number;
  /** Senders graded D or F, their share of all graded mail (whole percent). */
  weak: number;
  weakMailPct: number;
}

/** How the senders spread over A-F and how much mail D and F send; null
 *  while nothing is graded (no scan yet, or an older backend). */
export function gradeStats(senders: Iterable<Group>): GradeStats | null {
  const counts: Record<GradeLetter, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  let graded = 0, mails = 0, weakMails = 0, weak = 0;
  for (const g of senders) {
    if (!g.grade) continue;
    graded++;
    mails += g.count;
    counts[g.grade.letter]++;
    if (g.grade.letter === "D" || g.grade.letter === "F") {
      weak++;
      weakMails += g.count;
    }
  }
  if (!graded) return null;
  return { counts, graded, weak,
    weakMailPct: mails ? Math.round(100 * weakMails / mails) : 0 };
}

import { expect, test } from "vitest";
import { GRADE_RULES, gradeRank, gradeStats } from "./grades";
import { gradedGroup } from "./gradeTestUtil";
import { GRADE_LETTERS } from "./lib";

test("the letters run best to worst and rank 0 (A) to 4 (F)", () => {
  expect(GRADE_LETTERS).toEqual(["A", "B", "C", "D", "F"]);
  expect(GRADE_LETTERS.map((l) => gradeRank(gradedGroup("a@x", "A", l))))
    .toEqual([0, 1, 2, 3, 4]);
  expect(gradeRank({ ...gradedGroup("a@x", "A", "A"), grade: undefined }))
    .toBe(0);
});

test("the thresholds printed on How grades work are the backend's", () => {
  // tests/test_grades.py reads these numbers out of this file
  expect(GRADE_RULES).toEqual({ minMails: 3, readOkPct: 30,
    readBadBelowPct: 10, oftenOkPerWeek: 2, oftenBadPerWeek: 7,
    trackBadPct: 50, bulkMails: 10, sizeOkKb: 200, sizeBadMb: 1 });
});

test("gradeStats counts every letter and the mail the D and F senders send",
  () => {
    const rows = [
      gradedGroup("a@x", "A", "A", { count: 10 }),
      gradedGroup("b@x", "B", "B", { count: 20 }),
      gradedGroup("c@x", "C", "C", { count: 30 }),
      gradedGroup("d@x", "D", "D", { count: 25 }),
      gradedGroup("f@x", "F", "F", { count: 15 }),
    ];
    const s = gradeStats(rows)!;
    expect(s.counts).toEqual({ A: 1, B: 1, C: 1, D: 1, F: 1 });
    expect(s.graded).toBe(5);
    expect(s.weak).toBe(2);
    expect(s.weakMailPct).toBe(40);            // (25 + 15) of 100 mails
  });

test("gradeStats skips ungraded rows and says null when nothing is graded",
  () => {
    const bare = { ...gradedGroup("a@x", "A", "A"), grade: undefined };
    expect(gradeStats([bare])).toBeNull();
    expect(gradeStats([])).toBeNull();
    expect(gradeStats([bare, gradedGroup("d@x", "D", "D", { count: 4 })])!
      .graded).toBe(1);
  });

test("no D or F sender: no weak share", () => {
  const s = gradeStats([gradedGroup("a@x", "A", "A")])!;
  expect(s.weak).toBe(0);
  expect(s.weakMailPct).toBe(0);
});

import type { GradeCheck, GradeLetter, GradePattern, Group, GroupGrade }
  from "./types";

/** The six checks of the board's example sender: a loud, tracking sender with
 *  one-click unsubscribe that the user never unsubscribed from. */
export const loudChecks = (): GradeCheck[] => [
  { id: "open", v: "bad", read: 2, total: 96, pct: 2, months: 6 },
  { id: "often", v: "bad", per_week: 28.7, rank: 94 },
  { id: "tracking", v: "bad", kind: "both", checked: 96, pct: 94,
    pixel_pct: 94, click_pct: 40 },
  { id: "unsub", v: "ok", kind: "post" },
  { id: "stops", v: "neutral", kind: "never" },
  { id: "size", v: "ok", avg: 87040, att: 0 },
];

export const mkGrade = (letter: GradeLetter, over: Partial<GroupGrade> = {}):
  GroupGrade => ({ letter, points: 0, pattern: "mixed" as GradePattern,
  checks: loudChecks(), ...over });

/** A Sender row (the shape App's tests use) with a grade. */
export const gradedGroup = (key: string, label: string, letter: GradeLetter,
  over: Partial<Group> = {}): Group => ({
  key, label, sub: key, count: 12, size: 12000, unread: 2,
  first: "2024-01-01", last: "2025-01-01", tags: [], samples: [], bulk: false,
  unsub: false, ai: null, ratings: null, protected: false, replied: false,
  att_size: 0, unsubscribed: null, new: false, pinned: 0, engagement: 50,
  grade: mkGrade(letter), ...over,
});

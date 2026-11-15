// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { getLang, setLang } from "./i18n";
import { DE } from "./locales/de";
import { EN } from "./locales/en";
import { atText, dayKind, dayLabel, defaultBoundary, pointId, pointMoment,
  senderLine, sessionSlice, sessionTitle, timeOf, whenText, whereText }
  from "./timemachine";
import type { Group, TmSession, TmStep } from "./types";

afterEach(() => setLang("en"));

/** Counts glue number and unit with a no-break space: compare as plain text. */
const plain = (s: string) => s.replace(/\u00a0/g, " ");

const step = (id: string, ts: number, over: Partial<TmStep> = {}): TmStep => ({
  id, ts, action: "trash", actor: "user", count: 3, bytes: 0, label: "",
  outcome: "ok", status: "back", ...over });

// newest first, like the API
const at = (h: number, m = 0) => Math.floor(
  new Date(2026, 10, 15, h, m).getTime() / 1000);
const steps = [
  step("e", at(14, 31), { action: "empty_trash", status: "cant",
    reason: "deleted" }),
  step("d", at(14, 28)),
  step("c", at(14, 22), { action: "archive" }),
  step("b", at(14, 15), { action: "unsubscribe", status: "stays" }),
  step("a", at(14, 12)),
  step("z", at(11, 2), { status: "undone" }),
];
const session: TmSession = { start: at(14, 12), end: at(14, 31), steps: 5,
  mails: 100, first: "a", last: "e" };

test("a session's steps are a slice of the newest-first list", () => {
  expect(sessionSlice(steps, session)).toEqual([0, 5]);
  expect(sessionSlice(steps, { ...session, start: at(11, 0), end: at(11, 5) }))
    .toEqual([5, 6]);
  expect(sessionSlice(steps, { ...session, start: 1, end: 2 })).toEqual([0, 0]);
});

test("the line starts just below the newest step that can come back", () => {
  expect(defaultBoundary(steps, 0, 5)).toBe(2);       // below "d"
  // nothing there to bring back: the line sits on top
  const none = steps.map((s) => ({ ...s, status: "stays" as const }));
  expect(defaultBoundary(none, 0, 5)).toBe(0);
});

test("the point's moment is the middle of the two steps around the line", () => {
  expect(pointMoment(steps, 4, at(15))).toBe(Math.floor((at(14, 12) + at(14, 15)) / 2));
  expect(pointMoment(steps, 0, at(15))).toBe(at(15));        // nothing above
  // below the very last step: a minute before it
  expect(pointMoment(steps, 6, at(15))).toBe(at(11, 2) - 60);
});

test("the id sent for a line is the newest step that stays", () => {
  expect(pointId(steps, 0)).toBe("e");
  expect(pointId(steps, 4)).toBe("a");
  expect(pointId(steps, 6)).toBe("");                        // before all
});

test("times are 24 h in both languages", () => {
  expect(timeOf(at(14, 5))).toBe("14:05");
  setLang("de");
  expect(timeOf(at(9, 7))).toBe("09:07");
});

test("a moment is today, yesterday or a date", () => {
  const now = new Date(2026, 10, 15, 16, 0);
  expect(dayKind(at(14, 10), now)).toBe("today");
  expect(dayKind(at(14, 10) - 86400, now)).toBe("yesterday");
  expect(dayKind(at(14, 10) - 5 * 86400, now)).toBe("date");
  expect(whenText(at(14, 10), now)).toBe("today, 14:10");
  expect(atText(at(14, 10), now)).toBe("at 14:10");
  expect(atText(at(14, 10) - 86400, now)).toBe("yesterday at 14:10");
  expect(whenText(at(14, 10) - 5 * 86400, now)).toMatch(/^10 Nov, 14:10$/);
  expect(dayLabel(at(14, 10), now)).toBe("Today");
  expect(sessionTitle(session, now)).toBe("Today, 14:12 - 14:31");
});

test("a moment in German reads as German", () => {
  setLang("de");
  expect(getLang()).toBe("de");
  const now = new Date(2026, 10, 15, 16, 0);
  expect(whenText(at(14, 10), now)).toBe("heute, 14:10 Uhr");
  expect(atText(at(14, 10) - 86400, now)).toBe("gestern um 14:10 Uhr");
  expect(atText(at(14, 10) - 5 * 86400, now)).toMatch(/^am 10\. Nov\.? um 14:10 Uhr$/);
});

test("a step's senders: the first two by name, then +N", () => {
  const groups = { "a@x.example": { label: "Gadget Weekly" } } as unknown as
    Record<string, Group>;
  const s = step("s", 1, { senders: [{ addr: "a@x.example", n: 5 },
    { addr: "b@x.example", n: 3 }, { addr: "c@x.example", n: 1 }],
  senders_total: 6 });
  expect(senderLine(s, groups)).toBe("Gadget Weekly, b@x.example +4");
  expect(senderLine({ ...s, senders_total: 2, senders: s.senders!.slice(0, 2) },
    groups)).toBe("Gadget Weekly, b@x.example");
  expect(senderLine(step("n", 1), groups)).toBe("");
});

test("where the mails go: three folders at most, then 'N more'", () => {
  const f = (name: string, mails: number) => ({ folder: name, name, mails });
  const name = (_raw: string, n: string) => n;
  expect(plain(whereText([f("Inbox", 790), f("News", 40)], name)))
    .toBe("790 mails back to Inbox, 40 to News");
  expect(plain(whereText(
    [f("A", 5), f("B", 4), f("C", 3), f("D", 2), f("E", 1)], name)))
    .toBe("5 mails back to A, 4 to B, 3 to C, 2 more folders");
  expect(plain(whereText([f("A", 1)], name))).toBe("1 mail back to A");
});

test("every Time machine string exists in both languages", () => {
  const mine = (d: Record<string, string>) => Object.keys(d).filter((k) =>
    k.startsWith("tm.") || k.startsWith("activity.view")
    || ["audit.h.restore", "audit.act.restore", "audit.h.rule_paused",
      "audit.act.rule_paused", "undo.restore", "undo.all_in_activity",
      "ferr.unknown_point"].some((p) => k === p || k === `${p}_one`)).sort();
  expect(mine(EN).length).toBeGreaterThan(100);
  expect(mine(DE)).toEqual(mine(EN));
  // German is German: not the English text copied over
  const same = mine(EN).filter((k) => EN[k] === DE[k]);
  expect(same).toEqual(["tm.session_range"]);
});

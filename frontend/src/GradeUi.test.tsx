// @vitest-environment jsdom
/* Sender grade UI: the badge, the report card (the six checks with value,
 * note and verdict, the replied floor), "How grades work" and the Statistics
 * card - in English and German. */

import { cleanup, fireEvent, render, screen, within } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { checkText, GradeBadge, GradeCard, GradesCard, GradeHelp }
  from "./components/GradeUi";
import { gradedGroup, loudChecks, mkGrade } from "./gradeTestUtil";
import { gradeStats } from "./grades";
import { setLang, t } from "./i18n";
import type { GradeCheck } from "./types";

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  fmtSize: (n: number) => `${Math.round(n / 1024)} KB`,
}));

afterEach(() => { cleanup(); setLang("en"); });

const check = (id: GradeCheck["id"], over: Partial<GradeCheck>): GradeCheck =>
  ({ ...loudChecks().find((c) => c.id === id)!, ...over });

test("the badge is the letter, named 'Grade D', one tone per grade", () => {
  const tones = { A: "safe", B: "new", C: "info", D: "review", F: "keep" };
  for (const [letter, tone] of Object.entries(tones)) {
    const { unmount } = render(<GradeBadge letter={letter as "A"} />);
    const badge = screen.getByRole("img", { name: `Grade ${letter}` });
    expect(badge.textContent).toBe(letter);
    expect(badge.className).toContain(`bg-${tone}-bg text-${tone}-fg`);
    unmount();
  }
  render(<GradeBadge letter="D" size="lg" />);
  expect(screen.getByRole("img", { name: "Grade D" }).className)
    .toContain("size-16");
  setLang("de");
  cleanup();
  render(<GradeBadge letter="B" />);
  expect(screen.getByRole("img", { name: "Note B" })).toBeTruthy();
});

test("the report card: grade, sentence, six checks with value and verdict",
  () => {
    render(<GradeCard g={gradedGroup("deals@dealsdaily.example", "Deals Daily",
      "D", { grade: mkGrade("D", { pattern: "loud" }) })} />);
    expect(screen.getByRole("heading", { name: "Grade D · loud and ignored" }))
      .toBeTruthy();
    expect(screen.getByText(
      "It mails you often, and you almost never open it.")).toBeTruthy();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(6);
    const row = (label: string) =>
      rows.find((r) => within(r).queryByText(label))!;
    expect(row("You open their mail").textContent).toContain("2%");
    expect(row("You open their mail").textContent)
      .toContain("2 of 96 in 6 months");
    expect(within(row("You open their mail")).getByRole("img",
      { name: "Bad sign" })).toBeTruthy();
    expect(row("How often").textContent).toContain("4.1 a day");
    expect(row("How often").textContent)
      .toContain("More often than 9 of 10 senders");
    expect(row("Tracking").textContent).toContain("pixel + links");
    expect(row("Tracking").textContent)
      .toContain("A tracking pixel in 94% of mails");
    expect(row("Unsubscribe").textContent).toContain("one click");
    expect(within(row("Unsubscribe")).getByRole("img", { name: "Good sign" }))
      .toBeTruthy();
    expect(row("Stops when asked").textContent).toContain("not tested");
    expect(within(row("Stops when asked")).getByRole("img",
      { name: "No effect" })).toBeTruthy();
    expect(row("Mail size").textContent).toContain("85 KB");
    expect(screen.getByText(/The grade only uses what Inboxrake already knows/))
      .toBeTruthy();
  });

test("the floor says why a sender you write to is not graded lower", () => {
  const { rerender } = render(<GradeCard g={gradedGroup("a@x", "A", "C",
    { grade: mkGrade("C", { floor: true }) })} />);
  expect(screen.getByText(/never drops below C/)).toBeTruthy();
  rerender(<GradeCard g={gradedGroup("a@x", "A", "C")} />);
  expect(screen.queryByText(/never drops below C/)).toBeNull();
});

test("a row without a grade renders no card", () => {
  const { container } = render(<GradeCard
    g={{ ...gradedGroup("a@x", "A", "A"), grade: undefined }} />);
  expect(container.innerHTML).toBe("");
});

test("every sentence pattern has its words in both languages", () => {
  for (const lang of ["en", "de"] as const) {
    setLang(lang);
    for (const p of ["loud", "quiet", "tracks", "mixed"]) {
      for (const key of [`grade.pattern.${p}`, `grade.line.${p}`]) {
        expect(t(key)).not.toBe(key);
      }
    }
  }
  setLang("de");
  expect(t("grade.pattern.loud")).toBe("laut und ignoriert");
  expect(t("grade.pattern.quiet")).toBe("leise und nützlich");
  expect(t("grade.pattern.tracks")).toBe("verfolgt dich, aber du liest es");
});

test("the card in German", () => {
  setLang("de");
  render(<GradeCard g={gradedGroup("a@x", "A", "D", {
    grade: mkGrade("D", { pattern: "loud", floor: true }) })} />);
  expect(screen.getByRole("heading", { name: "Note D · laut und ignoriert" }))
    .toBeTruthy();
  expect(screen.getByText("Du öffnest die Mails")).toBeTruthy();
  expect(screen.getByText("Hört auf, wenn du es verlangst")).toBeTruthy();
  expect(screen.getByText(/deshalb fällt die Note nie unter C/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "So entsteht die Note" }))
    .toBeTruthy();
  expect(screen.getAllByRole("img", { name: "Schlechtes Zeichen" }).length)
    .toBeGreaterThan(0);
});

test("checkText words every case of every check", () => {
  // open
  expect(checkText({ id: "open", v: "neutral", total: 2 })).toMatchObject(
    { value: "too few mails", note: "Fewer than 3 mails - too early to tell." });
  expect(checkText(check("open", { months: 1, read: 3, total: 10, pct: 30 }))
    .note).toBe("3 of 10 in 1 month");
  expect(checkText(check("open", { months: 0 })).note)
    .toBe("2 of 96 mails read");
  // often: the unit follows the rate
  const often = (per_week: number | undefined, rank?: number) =>
    checkText({ id: "often", v: "ok", per_week, rank });
  expect(often(28.7).value).toBe("4.1 a day");
  expect(often(2).value).toBe("2 a week");
  expect(often(0.5).value).toBe("2.2 a month");
  expect(often(undefined).value).toBe("too few mails");
  expect(often(3, 50).note).toBe("More often than 5 of 10 senders");
  expect(often(3, 100).note).toBe("More often than 9 of 10 senders");
  expect(often(3, 49).note).toBe("Less often than most senders");
  expect(often(3).note).toBe("Over the period it has been mailing");
  // tracking
  const track = (over: Partial<GradeCheck>) =>
    checkText({ id: "tracking", v: "bad", ...over });
  expect(track({ kind: "unchecked", v: "neutral" })).toMatchObject({
    value: "not checked", note: "Needs the local mail index" });
  expect(track({ kind: "none", v: "ok", checked: 8 })).toMatchObject({
    value: "none", note: "No tracker found in 8 checked mails" });
  expect(track({ kind: "none", v: "ok", checked: 1 }).note)
    .toBe("No tracker found in the 1 checked mail");
  expect(track({ kind: "links", click_pct: 40 })).toMatchObject({
    value: "links", note: "Click tracking in 40% of mails" });
  expect(track({ kind: "pixel", pixel_pct: 60 })).toMatchObject({
    value: "pixel", note: "A tracking pixel in 60% of mails" });
  // unsubscribe
  for (const [kind, value] of [["post", "one click"], ["link", "link only"],
    ["none", "none"]]) {
    expect(checkText({ id: "unsub", v: "ok", kind }).value).toBe(value);
  }
  // stops
  expect(checkText({ id: "stops", v: "bad", kind: "still", n: 4 })).toMatchObject(
    { value: "still mailing", note: "4 mails arrived after you unsubscribed" });
  expect(checkText({ id: "stops", v: "bad", kind: "still", n: 1 }).note)
    .toBe("1 mail arrived after you unsubscribed");
  expect(checkText({ id: "stops", v: "ok", kind: "stopped" }).value)
    .toBe("stopped");
  expect(checkText({ id: "stops", v: "neutral", kind: "open" }).value)
    .toBe("not finished");
  // size
  expect(checkText({ id: "size", v: "ok", avg: 2048, att: 0 })).toMatchObject(
    { value: "2 KB", note: "Average per mail" });
  expect(checkText({ id: "size", v: "bad", avg: 2048, att: 5120 }).note)
    .toBe("Average per mail, 5 KB in attachments");
});

test("How grades work: the six checks with their numbers, then the rules",
  () => {
    const onClose = vi.fn();
    render(<GradeHelp onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "How grades work" }))
      .toBeTruthy();
    for (const label of ["You open their mail", "How often", "Tracking",
      "Unsubscribe", "Stops when asked", "Mail size"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText("You read 30% or more of its mails")).toBeTruthy();
    expect(screen.getByText("You read less than 10%")).toBeTruthy();
    expect(screen.getByText("2 mails a week or fewer")).toBeTruthy();
    expect(screen.getByText("More than 7 mails a week")).toBeTruthy();
    expect(screen.getByText(
      "Trackers in 50% of its mails or more (needs the local mail index)"))
      .toBeTruthy();
    expect(screen.getByText(/Still mailing after you unsubscribed \(counts double\)/))
      .toBeTruthy();
    expect(screen.getByText("Average up to 200 KB per mail")).toBeTruthy();
    expect(screen.getByText("Average over 1 MB per mail")).toBeTruthy();
    expect(screen.getByText(/A: 3 or more · B: 2 · C: 0 to 1 · D: -1 to -2 · F: -3 or less/))
      .toBeTruthy();
    expect(screen.getByText(/A sender you write to never gets below C/))
      .toBeTruthy();
    expect(screen.getByText(/no AI, nothing leaves the server/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });

test("How grades work opens from the card and closes again", () => {
  render(<GradeCard g={gradedGroup("a@x", "A", "D")} />);
  fireEvent.click(screen.getByRole("button", { name: "How grades work" }));
  expect(screen.getByRole("dialog", { name: "How grades work" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("How grades work in German", () => {
  setLang("de");
  render(<GradeHelp onClose={() => {}} />);
  expect(screen.getByRole("dialog", { name: "So entsteht die Note" }))
    .toBeTruthy();
  expect(screen.getByText(/Du liest 30\s%\soder mehr seiner Mails/))
    .toBeTruthy();
  expect(screen.getByText(/Ein Absender, dem du schreibst, bekommt nie weniger als C/))
    .toBeTruthy();
});

const rows = () => [
  gradedGroup("a@x", "A", "A", { count: 31 }),
  gradedGroup("b@x", "B", "B", { count: 42 }),
  gradedGroup("c@x", "C", "C", { count: 38 }),
  gradedGroup("d@x", "D", "D", { count: 27 }),
  gradedGroup("f@x", "F", "F", { count: 9 }),
];

test("the Statistics card: the A-F bar with counts and the share D and F send",
  () => {
    const onShow = vi.fn();
    render(<GradesCard stats={gradeStats(rows())!} onShow={onShow} />);
    expect(screen.getByRole("img", { name:
      "Your senders' grades: A 1, B 1, C 1, D 1, F 1" })).toBeTruthy();
    expect(screen.getByText("5 senders")).toBeTruthy();
    expect(screen.getByText(
      "The 2 senders graded D or F send 24% of your mail.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show them" }));
    expect(onShow).toHaveBeenCalledTimes(1);
  });

test("one weak sender reads in the singular, none says so and has no link",
  () => {
    const one = [gradedGroup("a@x", "A", "A"),
      gradedGroup("d@x", "D", "D", { count: 12 })];
    const { unmount } = render(<GradesCard stats={gradeStats(one)!}
      onShow={() => {}} />);
    expect(screen.getByText(
      "The 1 sender graded D or F sends 50% of your mail.")).toBeTruthy();
    unmount();
    render(<GradesCard stats={gradeStats([gradedGroup("a@x", "A", "A")])!}
      onShow={() => {}} />);
    expect(screen.getByText("No sender is graded D or F.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show them" })).toBeNull();
  });

test("the Statistics card in German", () => {
  setLang("de");
  render(<GradesCard stats={gradeStats(rows())!} onShow={() => {}} />);
  expect(screen.getByText(
    /Die 2 Absender mit Note D oder F schicken 24\s%\sdeiner Mails\./))
    .toBeTruthy();
  expect(screen.getByRole("button", { name: "Diese anzeigen" })).toBeTruthy();
});

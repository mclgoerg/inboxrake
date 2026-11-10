// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { dayHeading, groupByDate, monthHeading } from "./dayGroups";
import { setLang } from "./i18n";

afterEach(() => setLang("en"));

describe("groupByDate", () => {
  const mails = [
    { d: "2026-09-20T14:13:00" }, { d: "2026-09-12" }, { d: "2026-08-28" },
    { d: "" },
  ];
  it("groups consecutive mails by month", () => {
    const g = groupByDate(mails, (m) => m.d, 7);
    expect(g.map((x) => [x.key, x.items.length])).toEqual(
      [["2026-09", 2], ["2026-08", 1], ["", 1]]);
  });
  it("groups consecutive mails by day", () => {
    const g = groupByDate(mails, (m) => m.d, 10);
    expect(g.map((x) => x.key)).toEqual(
      ["2026-09-20", "2026-09-12", "2026-08-28", ""]);
  });
});

describe("headings", () => {
  const now = new Date(2026, 10, 9, 12, 0);
  it("names the month in the app language", () => {
    expect(monthHeading("2026-09")).toBe("September 2026");
    setLang("de");
    expect(monthHeading("2026-03")).toBe("März 2026");
    expect(monthHeading("")).toBe("");
  });
  it("says Today and Yesterday, else the short date", () => {
    expect(dayHeading("2026-11-09", now)).toBe("Today");
    expect(dayHeading("2026-11-08", now)).toBe("Yesterday");
    expect(dayHeading("2026-10-01", now)).toBe("1 Oct");
    expect(dayHeading("2025-10-01", now)).toBe("1 Oct 2025");
    setLang("de");
    expect(dayHeading("2026-11-09", now)).toBe("Heute");
    expect(dayHeading("2026-11-08", now)).toBe("Gestern");
  });
  it("is empty for a mail without a date", () => {
    expect(dayHeading("", now)).toBe("");
  });
});

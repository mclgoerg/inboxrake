// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { setLang, t } from "./i18n";
import { fmtSize, fmtSizeGb, fmtUsd } from "./lib";
import { decimalToInput, fmtNum, fmtPct, inputToDecimal, isBadDecimal, NBSP,
  parseDecimal, parseNum, setNumFormat, type NumFormat,
} from "./numfmt";

afterEach(() => { setNumFormat("auto"); setLang("en"); });

describe("number format", () => {
  it("follows the language by default", () => {
    expect(fmtNum(1732)).toBe("1,732");
    expect(fmtSize(11.3 * 1048576)).toBe("11.3\u00a0MB");
    setLang("de");
    expect(fmtNum(1732)).toBe("1.732");
    expect(fmtSize(11.3 * 1048576)).toBe("11,3\u00a0MB");
    expect(fmtSizeGb(2.5 * 1073741824)).toBe("2,5\u00a0GB");
    expect(fmtUsd(0.5)).toBe("$0,50");
  });

  it("never splits a size from its unit", () => {
    expect(fmtSize(500)).toBe(`500${NBSP}B`);
    expect(fmtSize(2048)).toBe(`2${NBSP}KB`);
    expect(fmtSizeGb(3 * 1073741824)).toBe(`3.0${NBSP}GB`);
    for (const s of [fmtSize(7), fmtSize(5e5), fmtSize(5e8), fmtSizeGb(5e10)])
      expect(s).not.toMatch(/ /);
  });

  it("writes percentages per style: 30% in English, 30 % in German", () => {
    expect(fmtPct(30)).toBe("30%");
    setLang("de");
    expect(fmtPct(30)).toBe(`30${NBSP}%`);
    expect(fmtPct(12.5, { max: 1 })).toBe(`12,5${NBSP}%`);
    setNumFormat("en");
    expect(fmtPct(30)).toBe("30%");
    setNumFormat("space");
    expect(fmtPct(1500)).toBe(`1\u202f500${NBSP}%`);
  });

  it("gives nothing for a missing or non-finite percentage", () => {
    expect(fmtPct(NaN)).toBe("");
    expect(fmtPct(Infinity)).toBe("");
    expect(fmtPct(undefined as unknown as number)).toBe("");
    expect(fmtPct(0)).toBe("0%");
  });

  it("keeps a count and its unit together in the locale strings", () => {
    expect(t("n.mails", { n: 60 })).toBe(`60${NBSP}mails`);
    setLang("de");
    expect(t("n.mails", { n: 60 })).toBe(`60${NBSP}Mails`);
    expect(t("n.mails", { n: 1 })).toBe(`1${NBSP}Mail`);
  });

  it("can be pinned independent of the language", () => {
    setLang("de");
    setNumFormat("en");
    expect(fmtNum(1234.5, { digits: 1 })).toBe("1,234.5");
    setNumFormat("space");
    expect(fmtNum(1234.5, { digits: 1 })).toBe("1\u202f234,5");
    setNumFormat("de");
    setLang("en");
    expect(fmtNum(1234.5, { digits: 1 })).toBe("1.234,5");
  });

  it("formats numeric t() params but not years", () => {
    setLang("de");
    expect(t("tab.year_stories", { year: 2025, n: 1500 }))
      .toBe("2025 in 1.500\u00a0Geschichten");
  });

  it("parses what the chosen format allows", () => {
    expect(parseNum("1,234.5")).toBe(1234.5);
    expect(parseNum("0,5")).toBe(0.5);
    expect(parseNum("abc")).toBeNaN();
    setNumFormat("de");
    expect(parseNum("1.234,5")).toBe(1234.5);
    expect(parseNum("0,5")).toBe(0.5);
    expect(parseNum("2.5")).toBe(2.5);
    expect(parseNum("")).toBeNaN();
  });

  it("round-trips decimal inputs", () => {
    setNumFormat("de");
    expect(decimalToInput("0.5")).toBe("0,5");
    expect(inputToDecimal("0,5")).toBe("0.5");
    expect(inputToDecimal("")).toBe("");
    expect(inputToDecimal("x")).toBe("x");
  });

  it("parses decimal input without any grouping, in every style", () => {
    for (const style of ["auto", "en", "de", "space"] as NumFormat[]) {
      setNumFormat(style);
      expect(parseDecimal("0.075")).toBe(0.075);
      expect(parseDecimal("0,075")).toBe(0.075);
      expect(parseDecimal("1.500")).toBe(1.5);
      expect(parseDecimal("1,5")).toBe(1.5);
      expect(parseDecimal("12")).toBe(12);
      expect(inputToDecimal("1.500")).toBe("1.5");
    }
  });

  it("flags text that is no non-negative decimal", () => {
    for (const bad of ["abc", "-2", "1.2.3", "1,2,3", "0.5x"]) {
      expect(isBadDecimal(inputToDecimal(bad))).toBe(true);
    }
    expect(isBadDecimal("")).toBe(false);
    expect(isBadDecimal("0.5")).toBe(false);
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { setLang, t } from "./i18n";
import { fmtSize, fmtSizeGb, fmtUsd } from "./lib";
import { decimalToInput, fmtNum, inputToDecimal, parseNum, setNumFormat,
} from "./numfmt";

afterEach(() => { setNumFormat("auto"); setLang("en"); });

describe("number format", () => {
  it("follows the language by default", () => {
    expect(fmtNum(1732)).toBe("1,732");
    expect(fmtSize(11.3 * 1048576)).toBe("11.3 MB");
    setLang("de");
    expect(fmtNum(1732)).toBe("1.732");
    expect(fmtSize(11.3 * 1048576)).toBe("11,3 MB");
    expect(fmtSizeGb(2.5 * 1073741824)).toBe("2,5 GB");
    expect(fmtUsd(0.5)).toBe("$0,50");
  });

  it("can be pinned independent of the language", () => {
    setLang("de");
    setNumFormat("en");
    expect(fmtNum(1234.5, { digits: 1 })).toBe("1,234.5");
    setNumFormat("space");
    expect(fmtNum(1234.5, { digits: 1 })).toBe("1 234,5");
    setNumFormat("de");
    setLang("en");
    expect(fmtNum(1234.5, { digits: 1 })).toBe("1.234,5");
  });

  it("formats numeric t() params but not years", () => {
    setLang("de");
    expect(t("tab.year_stories", { year: 2025, n: 1500 }))
      .toBe("2025 in 1.500 Geschichten");
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
});

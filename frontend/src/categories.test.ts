// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { categoryHues, categoryName } from "./categories";
import { setLang } from "./i18n";

afterEach(() => setLang("en"));

test("built-in and automatic categories are translated", () => {
  expect(["newsletter", "automated", "shipping", "finance", "shopping",
    "social", "travel", "dev/cloud", "other"].map(categoryName)).toEqual([
    "Newsletters", "Notifications", "Shipping", "Finance", "Shopping",
    "Social", "Travel", "Dev / cloud", "Other"]);
  setLang("de");
  expect(categoryName("shipping")).toBe("Versand");
  expect(categoryName("dev/cloud")).toBe("Entwicklung & Cloud");
});

test("a category of your own keeps its name, capitalised", () => {
  expect(categoryName("insurance")).toBe("Insurance");
  setLang("de");
  expect(categoryName("kids' school")).toBe("Kids' school");
});

test("the same category has the same hue on every chart", () => {
  const a = categoryHues(["newsletter", "shopping", "automated"]);
  const b = categoryHues(["shipping", "shopping", "newsletter", "finance"]);
  expect(a).toEqual([0, 1, 2]);
  expect(b).toEqual([4, 1, 0, 3]);
});

test("other categories take a hue nobody else in the chart has", () => {
  const keys = ["newsletter", "shopping", "automated", "finance", "travel",
    "dev/cloud", "insurance"];
  const h = categoryHues(keys);
  // the six well-known + the others never repeat a hue until the palette
  // runs out
  expect(new Set(h.slice(0, 6)).size).toBe(6);
  expect(h.slice(0, 4)).toEqual([0, 1, 2, 3]);
  const few = categoryHues(["travel", "insurance", "shipping"]);
  expect(few[2]).toBe(4);
  expect(new Set(few).size).toBe(3);
  expect(categoryHues(["insurance"])).toEqual(categoryHues(["insurance"]));
});

test("a category named like an Object member is just a name", () => {
  for (const k of ["constructor", "valueOf", "toString", "__proto__"]) {
    expect(categoryName(k)).toBe(k.charAt(0).toUpperCase() + k.slice(1));
  }
  const h = categoryHues(["constructor", "valueOf", "newsletter"]);
  expect(h[2]).toBe(0);
  expect(h.every((x) => Number.isInteger(x) && x >= 0 && x < 6)).toBe(true);
  expect(new Set(h).size).toBe(3);
});

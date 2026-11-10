// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { SpaceTiles } from "./components/SpaceTiles";
import { TONE_BAR, TONE_BG, TONE_FILL, TONE_TEXT } from "./components/spaceUi";
import { buildDomains, labelFits } from "./spacemap";
import type { Group } from "./types";

afterEach(cleanup);

const MB = 1048576;
const g = (key: string, size: number): Group => ({
  key, label: key, sub: key, count: 10, size, unread: 0, first: "2020-01-01",
  last: "2026-01-01", tags: [], samples: [], bulk: false, unsub: false,
  ai: null, ratings: null, protected: false, replied: false, att_size: 0,
  unsubscribed: null, new: false, pinned: 0, engagement: 50,
});

// jsdom has no layout: the map falls back to a 600 px wide box
const tiles = () => {
  const level = buildDomains(Object.fromEntries(
    [["a@alpha-archive.example", 400], ["b@bravo-archive.example", 400],
      ["c@charlie-archive.example", 60], ["d@delta-archive.example", 40],
      ["e@echo-archive.example", 30], ["f@foxtrot-archive.example", 20]]
      .map(([k, s]) => [k as string, g(k as string, (s as number) * MB)])));
  render(<SpaceTiles level={level} by="engagement" wide sel={new Set()}
    selecting={false} focusId={null} domainLevel={false} onPress={() => {}} />);
  return screen.getAllByRole("button").map((b) => ({
    el: b, w: parseFloat(b.style.width), h: parseFloat(b.style.height) }));
};

test("a tile too narrow for its name carries no label, a wide one does", () => {
  const all = tiles();
  const mid = all.filter((x) => x.w >= 56 && x.w < 88 && x.h >= 30);
  expect(mid.length).toBeGreaterThan(0);          // the band the rule is for
  for (const x of mid) expect(x.el.querySelector("span")).toBeNull();
  const wide = all.filter((x) => x.w >= 120 && x.h >= 52);
  expect(wide.length).toBeGreaterThan(0);
  for (const x of wide) expect(x.el.querySelector("span")).not.toBeNull();
  // whatever label is shown fits its tile
  for (const x of all.filter((t) => t.el.querySelector("span.truncate"))) {
    const text = x.el.querySelector("span.truncate")!.textContent!;
    if (x.w < 120) expect(labelFits(text, x.w)).toBe(true);
  }
});

test("tones: every tone is a real fill, 'keep' is calm (red means Trash)", () => {
  const css = (o: Record<string, string>) => Object.values(o).join(" ");
  for (const o of [TONE_BG, TONE_BAR, TONE_FILL]) {
    // high engagement / recent mail was card grey and looked empty
    expect(o.quiet).toMatch(/calm/);
    expect(css(o)).not.toMatch(/keep-/);
  }
  expect(TONE_TEXT.keep).toBe("text-info-fg");
  expect(TONE_BG.keep).toContain("bg-info-bg");
});

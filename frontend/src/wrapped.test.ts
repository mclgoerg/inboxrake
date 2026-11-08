import { expect, test } from "vitest";
import type { WrappedResp } from "./types";
import { buildSummarySvg, maskAddr, type SummaryStrings } from "./wrapped";

const data: WrappedResp = {
  year: 2026, partial: false, years: [2025, 2026],
  received: { mails: 1234, bytes: 1, senders: 5, read: 100, new_senders: 2 },
  top_senders: [
    { label: "Ann Example", addr: "ann@shop.example", mails: 40, bytes: 9 },
    { label: "Bob <&>", addr: "bob@news.example", mails: 30, bytes: 9 }],
  by_month: Array(12).fill(0), by_weekday: Array(7).fill(0),
  by_hour: Array(24).fill(0),
  loudest_month: null, busiest_weekday: null, busiest_hour: null,
  biggest: null, ghosts: { count: 0, top: [] },
  cleanup: { trashed: 0, archived: 0, purged: 0, freed_bytes: 0,
    unsubscribes: 0, rule_runs: 0, top_rule: null },
};
const str: SummaryStrings = {
  title: "Your year in mail 2026", lead: "You received",
  big: "1,234", unit: "mails in 2026", note: "Based on the mail in my mailbox now",
  stats: [{ value: "5", label: "senders" }], topTitle: "Loudest senders",
  topRows: ["40 mails", "30 mails"], footer: "Inboxrake",
};
const pal = { bg: "#000", panel: "#111", line: "#222", body: "#fff",
  muted: "#aaa", accent: "#c80" };

test("maskAddr keeps the first letter and the last domain label only", () => {
  expect(maskAddr("ann@shop.example")).toBe("a...@...example");
  expect(maskAddr("x@a.b.example")).toBe("x...@...example");
  expect(maskAddr("odd")).toBe("o...");
});

test("the summary SVG masks sender names by default", () => {
  const svg = buildSummarySvg(data, str, pal, false);
  expect(svg).not.toContain("ann@shop.example");
  expect(svg).not.toContain("shop");
  expect(svg).not.toContain("Ann Example");
  expect(svg).not.toContain("bob@news.example");
  expect(svg).toContain("a...@...example");
  expect(svg).toContain("1,234");
});

test("names appear only when toggled on, XML-escaped", () => {
  const svg = buildSummarySvg(data, str, pal, true);
  expect(svg).toContain("Ann Example");
  expect(svg).toContain("Bob &lt;&amp;&gt;");
  expect(svg).not.toContain("a...@...example");
  expect(svg.startsWith("<svg")).toBe(true);
});

test("the SVG carries translated strings as given (German)", () => {
  const de = { ...str, title: "Dein Jahr in Mails 2026",
    topTitle: "Lauteste Absender" };
  const svg = buildSummarySvg(data, de, pal, false);
  expect(svg).toContain("Dein Jahr in Mails 2026");
  expect(svg).toContain("Lauteste Absender");
});

test("control characters in names never reach the SVG", () => {
  const d = { ...data, top_senders: [{ ...data.top_senders[0],
    label: "An\u0000n\u0008 \u001FX" }] };
  const svg = buildSummarySvg(d, str, pal, true);
  expect(svg).toContain("Ann X");
  expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(svg)).toBe(false);
});

test("the month bars never overlap the text above them", () => {
  const d = { ...data, by_month: [3, 9, 4, 1, 0, 2, 5, 7, 8, 1, 2, 6] };
  const svg = buildSummarySvg(d, str, pal, true);
  const bars = [...svg.matchAll(/<rect x="\d+" y="([\d.]+)" width="63" height="([\d.]+)"/g)]
    .map((m) => [Number(m[1]), Number(m[1]) + Number(m[2])]);
  expect(bars).toHaveLength(12);
  const texts = [...svg.matchAll(/<text x="\d+" y="(\d+)" font-size="(\d+)"/g)]
    .map((m) => [Number(m[1]) - Number(m[2]), Number(m[1])]);
  const top = Math.min(...bars.map((b) => b[0]));
  const bottom = Math.max(...bars.map((b) => b[1]));
  for (const [a, b] of texts) {
    expect(b <= top || a >= bottom).toBe(true);
  }
  // tiles start below the bars
  const tiles = [...svg.matchAll(/<rect x="\d+" y="(\d+)" width="420"/g)];
  for (const m of tiles) expect(Number(m[1])).toBeGreaterThanOrEqual(bottom);
});

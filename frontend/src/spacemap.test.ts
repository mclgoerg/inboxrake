import { describe, expect, test } from "vitest";
import { MAX_TILES, buildDomains, childTiles, dominantVerdict, fmtBig, heatOf,
  labelLevel, levelTiles, monthsSince, openedPct, pct, senderIndex, shortName,
  soleSender, tickState, toggleItem, toneOf, toneSums } from "./spacemap";
import type { Group } from "./types";

const MB = 1048576;
const g = (key: string, size: number, over: Partial<Group> = {}): Group => ({
  key, label: key, sub: key, count: 10, size, unread: 0, first: "2020-01-01",
  last: "2026-01-01", tags: [], samples: [], bulk: false, unsub: false,
  ai: null, ratings: null, protected: false, replied: false, att_size: 0,
  unsubscribed: null, new: false, pinned: 0, engagement: 50, ...over,
});
const groups = (...gs: Group[]) => Object.fromEntries(gs.map((x) => [x.key, x]));

describe("buildDomains", () => {
  test("folds senders into domains, biggest first, sums sizes and counts", () => {
    const d = buildDomains(groups(
      g("a@big.example", 30 * MB), g("b@big.example", 50 * MB),
      g("c@small.example", 5 * MB, { count: 3 })));
    expect(d.map((x) => x.label)).toEqual(["big.example", "small.example"]);
    expect(d[0].size).toBe(80 * MB);
    expect(d[0].count).toBe(20);
    expect(d[0].children.map((c) => c.label))
      .toEqual(["b@big.example", "a@big.example"]);
    expect(d[0].keys.sort()).toEqual(["a@big.example", "b@big.example"]);
  });

  test("protected senders count in the size but never in the keys", () => {
    const [d] = buildDomains(groups(
      g("a@x.example", 10 * MB), g("p@x.example", 40 * MB, { protected: true })));
    expect(d.size).toBe(50 * MB);
    expect(d.keys).toEqual(["a@x.example"]);
    expect(d.protectedSenders).toBe(1);
  });

  test("zero-size senders have no area and are left out", () => {
    expect(buildDomains(groups(g("a@x.example", 0)))).toEqual([]);
  });

  test("count-weighted engagement, newest last, dominant AI verdict", () => {
    const ai = (verdict: "delete_safe" | "keep") => ({ verdict, reason: "" });
    const [d] = buildDomains(groups(
      g("a@x.example", MB, { count: 30, engagement: 10, last: "2025-05-01",
        ai: ai("delete_safe") }),
      g("b@x.example", MB, { count: 10, engagement: 90, last: "2026-02-01",
        ai: ai("keep") })));
    expect(d.engagement).toBe(30);
    expect(d.last).toBe("2026-02-01");
    expect(d.verdict).toBe("delete_safe");
    expect(dominantVerdict({})).toBeNull();
    expect(dominantVerdict({ keep: 5, delete_safe: 5 })).toBe("keep");
  });
});

describe("levelTiles", () => {
  const items = (sizes: number[]) => buildDomains(groups(
    ...sizes.map((s, i) => g(`u${i}@d${i}.example`, s))));

  test("items under 0.5 % merge into one Other tile that holds them", () => {
    const tiles = levelTiles(items([1000, 600, 4, 3, 2]));
    expect(tiles.map((t) => t.kind)).toEqual(["domain", "domain", "other"]);
    const other = tiles[2];
    expect(other.children).toHaveLength(3);
    expect(other.size).toBe(9);
    expect(other.label).toBe("");
  });

  test("a lone small item is not hidden in an Other (1)", () => {
    const tiles = levelTiles(items([1000, 600, 4]));
    expect(tiles.map((t) => t.kind)).toEqual(["domain", "domain", "domain"]);
  });

  test("at most MAX_TILES tiles, the rest drills into Other", () => {
    const many = items(Array.from({ length: 150 }, () => 1000));
    const tiles = levelTiles(many);
    expect(tiles).toHaveLength(MAX_TILES);
    const other = tiles[MAX_TILES - 1];
    expect(other.kind).toBe("other");
    expect(other.children).toHaveLength(150 - (MAX_TILES - 1));
    // inside Other the share rule is off, only the cap applies
    const inner = levelTiles(other.children, false);
    expect(inner).toHaveLength(MAX_TILES);       // 91 members: capped again
    expect(inner.filter((t) => t.kind === "other")).toHaveLength(1);
    expect(levelTiles(other.children.slice(0, 5), false)
      .every((t) => t.kind === "domain")).toBe(true);
  });

  test("an Other tile ticks every non-protected sender inside", () => {
    const tiles = levelTiles(buildDomains(groups(
      g("a@big.example", 100000), g("a@t1.example", 1), g("b@t2.example", 1,
        { protected: true }), g("c@t3.example", 1))));
    const other = tiles.find((t) => t.kind === "other")!;
    expect(other.keys.sort()).toEqual(["a@t1.example", "c@t3.example"]);
    expect(other.protectedSenders).toBe(1);
  });
});

describe("selection", () => {
  const [d] = buildDomains(groups(
    g("a@x.example", 10 * MB), g("b@x.example", 20 * MB),
    g("p@x.example", 30 * MB, { protected: true })));

  test("toggling a domain ticks exactly its non-protected senders", () => {
    const sel = toggleItem(d, new Set());
    expect([...sel].sort()).toEqual(["a@x.example", "b@x.example"]);
    expect(tickState(d, sel)).toBe("all");
    expect(toggleItem(d, sel).size).toBe(0);
  });

  test("partly ticked: a toggle completes it; foreign keys stay", () => {
    const sel = new Set(["a@x.example", "other@y.example"]);
    expect(tickState(d, sel)).toBe("some");
    const next = toggleItem(d, sel);
    expect(tickState(d, next)).toBe("all");
    expect(next.has("other@y.example")).toBe(true);
  });

  test("an all-protected tile can't be ticked", () => {
    const [p] = buildDomains(groups(g("p@z.example", MB, { protected: true })));
    expect(p.keys).toEqual([]);
    expect(toggleItem(p, new Set()).size).toBe(0);
    expect(tickState(p, new Set())).toBe("none");
  });

  test("senderIndex maps every sender key", () => {
    expect([...senderIndex([d]).keys()].sort())
      .toEqual(["a@x.example", "b@x.example", "p@x.example"]);
  });
});

describe("colour + size helpers", () => {
  const it = (over: object) => buildDomains(groups(g("a@x.example", MB,
    over)))[0];
  const now = Date.parse("2026-10-29T00:00:00Z");

  test("engagement: low is the strong (candidate) end", () => {
    expect(heatOf(it({ engagement: 10 }), "engagement")).toBe(2);
    expect(heatOf(it({ engagement: 50 }), "engagement")).toBe(1);
    expect(heatOf(it({ engagement: 90 }), "engagement")).toBe(0);
  });

  test("age: older last mail is stronger", () => {
    expect(heatOf(it({ last: "2022-01-01" }), "age", now)).toBe(2);
    expect(heatOf(it({ last: "2025-06-01" }), "age", now)).toBe(1);
    expect(heatOf(it({ last: "2026-10-01" }), "age", now)).toBe(0);
  });

  test("fmtBig steps up to GB", () => {
    expect(fmtBig(512)).toBe("512 B");
    expect(fmtBig(5 * MB)).toBe("5.0 MB");
    expect(fmtBig(1.2 * 1024 * MB)).toBe("1.2 GB");
  });
});

describe("colours: tones and sums", () => {
  const NOW = Date.UTC(2026, 5, 15);
  const ai = (verdict: "delete_safe" | "keep") => ({ verdict, reason: "" });
  const items = buildDomains(groups(
    g("a@old.example", 60 * MB, { engagement: 10, last: "2020-01-01",
      ai: ai("delete_safe") }),
    g("b@mid.example", 10 * MB, { engagement: 50, last: "2025-12-01" }),
    g("c@busy.example", 30 * MB, { engagement: 90, last: "2026-06-01",
      ai: ai("keep") })));

  test("engagement: the sizes per tone and their total", () => {
    const { total, sums } = toneSums(items, "engagement", NOW);
    expect(total).toBe(100 * MB);
    expect(sums).toEqual([{ tone: "strong", size: 60 * MB },
      { tone: "mid", size: 10 * MB }, { tone: "quiet", size: 30 * MB }]);
  });

  test("age uses the last mail", () => {
    const { sums } = toneSums(items, "age", NOW);
    expect(sums.map((s) => s.size)).toEqual([60 * MB, 10 * MB, 30 * MB]);
    expect(toneOf(items[0], "age", NOW)).toBe("strong");
  });

  test("AI: verdicts, with the unrated in their own tone", () => {
    const { sums } = toneSums(items, "ai", NOW);
    expect(sums).toEqual([{ tone: "delete_safe", size: 60 * MB },
      { tone: "review", size: 0 }, { tone: "keep", size: 30 * MB },
      { tone: "none", size: 10 * MB }]);
  });

  test("an empty level sums to nothing", () => {
    expect(toneSums([], "engagement", NOW).total).toBe(0);
  });
});

describe("pct", () => {
  test("rounds, shows a sliver as 1, and is 0 without a whole", () => {
    expect(pct(59, 100)).toBe(59);
    expect(pct(1, 1000)).toBe(1);
    expect(pct(0, 100)).toBe(0);
    expect(pct(5, 0)).toBe(0);
  });
});

describe("labelLevel", () => {
  test("big tiles get name + size + share, middle ones a short name, "
    + "small ones nothing", () => {
    expect(labelLevel(300, 200)).toBe("full");
    expect(labelLevel(120, 52)).toBe("full");
    expect(labelLevel(119, 200)).toBe("short");
    expect(labelLevel(300, 51)).toBe("short");
    expect(labelLevel(56, 30)).toBe("short");
    expect(labelLevel(55, 200)).toBe("none");
    expect(labelLevel(200, 29)).toBe("none");
  });
});

describe("shortName", () => {
  const [d] = buildDomains(groups(g("News.Team@chirper.example", MB),
    g("x@shop.co.example", MB)));
  const named = (label: string) => buildDomains(groups(g(label, MB)))[0];
  test("a domain without its TLD, second-level suffixes skipped", () => {
    expect(shortName(d)).toBeTruthy();
    expect(shortName(named("a@chirper.example"))).toBe("chirper");
    expect(shortName(named("a@mail.chirper.example"))).toBe("chirper");
    expect(shortName(named("x@shop.co.example"))).toBe("shop");
    expect(shortName(named("x@localhost"))).toBe("localhost");
  });
  test("a sender: its domain on a domain level the local part", () => {
    const s = named("news@chirper.example").children[0];
    expect(shortName(s)).toBe("chirper");
    expect(shortName(s, true)).toBe("news");
  });
});

describe("zooming", () => {
  const tree = buildDomains(groups(g("a@one.example", 50 * MB),
    g("a@two.example", 30 * MB), g("b@two.example", 20 * MB)));
  test("a domain with one sender has a sole sender to show instead", () => {
    const one = tree.find((d) => d.label === "one.example")!;
    const two = tree.find((d) => d.label === "two.example")!;
    expect(soleSender(one)?.label).toBe("a@one.example");
    expect(soleSender(two)).toBeNull();
    expect(soleSender(one.children[0])).toBeNull();
  });
  test("what is inside an item: its senders; a sender has none", () => {
    const two = tree.find((d) => d.label === "two.example")!;
    expect(childTiles(two).map((c) => c.label))
      .toEqual(["a@two.example", "b@two.example"]);
    expect(childTiles(two.children[0])).toEqual([]);
  });
});

describe("details figures", () => {
  test("opened = the read share of all mails of the item", () => {
    const [d] = buildDomains(groups(
      g("a@x.example", MB, { count: 30, unread: 27 }),
      g("b@x.example", MB, { count: 10, unread: 0 })));
    expect(d.count).toBe(40);
    expect(d.unread).toBe(27);
    expect(openedPct(d)).toBe(33);
  });
  test("AI counts: mails behind the dominant verdict, and the rated ones", () => {
    const ai = (verdict: "delete_safe" | "keep") => ({ verdict, reason: "" });
    const [d] = buildDomains(groups(
      g("a@x.example", MB, { count: 30, ai: ai("delete_safe") }),
      g("b@x.example", MB, { count: 10, ai: ai("keep") }),
      g("c@x.example", MB, { count: 5 })));
    expect(d.verdict).toBe("delete_safe");
    expect(d.verdictMails).toBe(30);
    expect(d.ratedMails).toBe(40);
    expect(d.count).toBe(45);
  });
  test("months since the last mail", () => {
    const now = Date.UTC(2026, 5, 15);
    expect(monthsSince("2025-04-15", now)).toBe(14);
    expect(monthsSince("2025-04-16", now)).toBe(13);
    expect(monthsSince("2026-06-01", now)).toBe(0);
    expect(monthsSince("", now)).toBeNull();
  });
});

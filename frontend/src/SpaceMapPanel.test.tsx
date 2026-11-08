// @vitest-environment jsdom
/* Space map panel: tiles and rings, details on tap, zoom + breadcrumb, the
 * Other bucket, colour modes, tick -> "Review in Senders" hands exactly the
 * ticked (non-protected) sender keys over, "Show in Senders" a filter,
 * selection pruning, keyboard use, German. */

import { cleanup, fireEvent, render, screen, within }
  from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { SpaceMapPanel } from "./components/SpaceMapPanel";
import { PageSlot } from "./components/ui";
import { setLang } from "./i18n";
import type { Group } from "./types";

const MB = 1048576;
const g = (key: string, size: number, over: Partial<Group> = {}): Group => ({
  key, label: key, sub: key, count: 10, size, unread: 0, first: "2020-01-01",
  last: "2026-01-01", tags: [], samples: [], bulk: false, unsub: false,
  ai: null, ratings: null, protected: false, replied: false, att_size: 0,
  unsubscribed: null, new: false, pinned: 0, engagement: 50, ...over,
});
const groups = (...gs: Group[]) => Object.fromEntries(gs.map((x) => [x.key, x]));

const BASE = groups(
  g("a@big.example", 300 * MB, { count: 100 }),
  g("b@big.example", 500 * MB, { count: 200 }),
  g("p@big.example", 100 * MB, { count: 20, protected: true }),
  g("c@mid.example", 200 * MB, { count: 50 }),
  g("d@small.example", 100 * MB, { count: 5 }));

const onDone = vi.fn();
const onShow = vi.fn();
const panel = (gs: Record<string, Group>) =>
  <SpaceMapPanel groups={gs} onDone={onDone} onShow={onShow}
    onClose={() => {}} />;
const show = (gs: Record<string, Group> = BASE) => render(panel(gs));
const showPage = (gs: Record<string, Group> = BASE) =>
  render(<PageSlot page>{panel(gs)}</PageSlot>);
const map = () => screen.getByTestId("space-map");
const tile = (re: RegExp | string) =>
  within(map()).getByRole("button", { name: re });
/** Two quick taps = a double-tap: zoom in. */
const zoomTile = (re: RegExp | string) => {
  fireEvent.click(tile(re));
  fireEvent.click(tile(re));
};
const list = () => screen.getByRole("region", { name: "Biggest here" });
const details = () => screen.getByRole("region", { name: /^Details of / });
const review = () => screen.getByRole("button", { name: "Review in Senders" });

afterEach(() => {
  cleanup();
  onDone.mockReset();
  onShow.mockReset();
  localStorage.clear();
  setLang("en");
});

test("header total and tile labels name size and mails", () => {
  show();
  expect(screen.getByText("1.2 GB in 375 mails · by sender domain")).toBeTruthy();
  expect(tile("big.example, 900.0 MB, 320 mails, 1 protected sender"))
    .toBeTruthy();
});

test("tile areas are proportional to the sizes", () => {
  show();
  const areaOf = (name: string) => {
    const b = within(map()).getByRole("button", { name: new RegExp(`^${name}`) });
    // each tile is inset by the 6 px gap between tiles
    return (parseFloat(b.style.width) + 6) * (parseFloat(b.style.height) + 6);
  };
  expect(areaOf("big.example") / areaOf("mid.example")).toBeCloseTo(4.5, 1);
  expect(areaOf("mid.example") / areaOf("small.example")).toBeCloseTo(2, 1);
});

test("drill into a domain shows its senders and a breadcrumb; All mail "
  + "goes back", () => {
  show();
  zoomTile(/^big\.example/);
  const crumbs = screen.getByRole("navigation", { name: "Space map path" });
  expect(within(crumbs).getByText("big.example")
    .getAttribute("aria-current")).toBe("page");
  expect(within(map()).getByRole("button", { name: /^b@big\.example/ }))
    .toBeTruthy();
  expect(within(map()).queryByRole("button", { name: /^c@mid\.example/ }))
    .toBeNull();
  fireEvent.click(within(crumbs).getByRole("button", { name: "All mail" }));
  expect(within(map()).getByRole("button", { name: /^c@mid\.example|^mid\.example/ }))
    .toBeTruthy();
});

test("tiny items fold into an Other tile that drills into its own map", () => {
  const tiny = Object.fromEntries([1, 2, 3].map((i) =>
    [`t${i}@tiny${i}.example`, g(`t${i}@tiny${i}.example`, MB, { count: 1 })]));
  show({ ...groups(g("a@big.example", 900 * MB)), ...tiny });
  zoomTile(/^Other \(3\)/);
  const crumbs = screen.getByRole("navigation", { name: "Space map path" });
  expect(within(crumbs).getByText("Other (3)")).toBeTruthy();
  for (const i of [1, 2, 3]) {
    expect(screen.getAllByRole("button", { name: new RegExp(`^tiny${i}\\.example`) })
      .length).toBeGreaterThan(0);
  }
});

test("colour modes: AI verdict only when something is rated; legend follows",
  () => {
    const { unmount } = show();
    expect(screen.queryByRole("tab", { name: "AI verdict" })).toBeNull();
    expect(screen.getByText("Low engagement")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Age of last mail" }));
    expect(screen.getByText("Last mail over 2 years ago")).toBeTruthy();
    unmount();
    show(groups(g("a@big.example", MB, { ai: { verdict: "keep", reason: "" } })));
    fireEvent.click(screen.getByRole("tab", { name: "AI verdict" }));
    expect(screen.getByText("Not rated yet")).toBeTruthy();
    expect(screen.getByText("Delete-safe")).toBeTruthy();
  });

test("select a domain tile -> Review in Senders hands over its non-protected senders",
  () => {
    show();
    expect(screen.queryByText(/selected$/)).toBeNull();     // no bar before Select
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(screen.queryByRole("button", { name: "Review in Senders" })).toBeNull();
    fireEvent.click(tile(/^big\.example/));
    expect(screen.getByText("2 senders - 800.0 MB selected")).toBeTruthy();
    expect(screen.getByText("Protected senders can't be selected here."))
      .toBeTruthy();
    fireEvent.click(review());
    expect(onDone).toHaveBeenCalledTimes(1);
    expect([...onDone.mock.calls[0][0]].sort())
      .toEqual(["a@big.example", "b@big.example"]);
  });

test("Review hands over exactly the ticked keys across levels", () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  fireEvent.click(tile(/^mid\.example/));
  // tick a whole domain through its list checkbox, then untick it again
  fireEvent.click(screen.getByRole("checkbox", { name: "Select big.example" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select big.example" }));
  // drill through the list row and tick one single sender
  fireEvent.click(within(list()).getByRole("button", { name: /big\.example/ }));
  fireEvent.click(within(map()).getByRole("button", { name: /^a@big\.example/ }));
  fireEvent.click(review());
  expect([...onDone.mock.calls[0][0]].sort())
    .toEqual(["a@big.example"]);   // mid.example is no longer on this level
});

test("a tile of only protected senders can't be ticked", () => {
  show(groups(g("p@z.example", 500 * MB, { protected: true }),
    g("a@y.example", 100 * MB)));
  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  const t = within(map()).getByRole("button", { name: /^z\.example/ });
  expect(t.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(t);
  expect(screen.queryByRole("button", { name: "Review in Senders" })).toBeNull();
});

test("a tap shows details, Select in the card starts a selection with it",
  () => {
    show();
    fireEvent.click(tile(/^small\.example/));
    expect(screen.queryByText(/selected$/)).toBeNull();
    fireEvent.click(within(details()).getByRole("button", { name: "Select" }));
    expect(screen.getByText("1 sender - 100.0 MB selected")).toBeTruthy();
    expect(screen.queryByRole("region", { name: /^Details of / })).toBeNull();
  });

test("tiles are native, focusable buttons with a full label", () => {
  show();
  const tiles = within(map()).getAllByRole("button");
  expect(tiles.length).toBeGreaterThan(2);
  for (const t of tiles) {
    expect(t.tagName).toBe("BUTTON");
    expect(t.tabIndex).toBeGreaterThanOrEqual(0);
    expect(t.getAttribute("aria-label")).toMatch(/, \d.*, \d+ mails?/);
  }
  tiles[0].focus();
  expect(document.activeElement).toBe(tiles[0]);
});

test("the accessible list names the biggest of the level", () => {
  show();
  const rows = within(list()).getAllByRole("listitem");
  expect(rows[0].textContent).toContain("big.example");
  expect(rows[0].textContent).toContain("900.0 MB");
  expect(rows[0].textContent).toContain("75 %");
  expect(rows[0].textContent).toContain("320 mails");
});

test("empty mailbox: a hint instead of a map", () => {
  show({});
  expect(screen.getByText("Nothing to map yet - run a scan first.")).toBeTruthy();
});

test("German", () => {
  setLang("de");
  show();
  expect(screen.getByText("1,2 GB in 375 Mails · nach Absender-Domain")).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Alter der letzten Mail" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Auswählen" }));
  fireEvent.click(tile(/^mid\.example/));
  expect(screen.getByText("1 Absender - 200,0 MB ausgewählt")).toBeTruthy();
  expect(screen.getByRole("button", { name: "In Absendern prüfen" })).toBeTruthy();
});

test("a sender that vanished on rescan is not handed over", () => {
  const view = show();
  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  fireEvent.click(tile(/^big\.example/));
  const { ["b@big.example"]: _gone, ...rest } = BASE;
  view.rerender(panel(rest));
  fireEvent.click(review());
  expect(onDone.mock.calls[0][0]).toEqual(["a@big.example"]);
});

test("headline: a sentence with the share and MB per colour", () => {
  show(groups(
    g("a@old.example", 600 * MB, { engagement: 10 }),
    g("b@mid.example", 100 * MB, { engagement: 50 }),
    g("c@busy.example", 300 * MB, { engagement: 90 })));
  const head = within(screen.getByRole("region", { name: "Space by colour" }));
  expect(head.getByText("60 %")).toBeTruthy();
  expect(head.getByText("of your space is mail you barely engage with")).toBeTruthy();
  const legend = screen.getByRole("list", { name: "Color legend" });
  expect(within(legend).getByText("Low engagement").parentElement!.textContent)
    .toContain("600.0 MB");
  expect(within(legend).getByText("High engagement").parentElement!.textContent)
    .toContain("300.0 MB");
  fireEvent.click(screen.getByRole("tab", { name: "Age of last mail" }));
  expect(screen.getByText(/of your space is mail with no new message in over 2 years/))
    .toBeTruthy();
});

test("the headline follows the level: drilled in, it is about that domain",
  () => {
    show();
    zoomTile(/^big\.example/);
    expect(screen.getByText(/of the space in big\.example is mail you barely engage with/))
      .toBeTruthy();
  });

test("the AI headline reads the verdict", () => {
  show(groups(
    g("a@x.example", 750 * MB, { ai: { verdict: "delete_safe", reason: "" } }),
    g("b@y.example", 250 * MB)));
  fireEvent.click(screen.getByRole("tab", { name: "AI verdict" }));
  const head = within(screen.getByRole("region", { name: "Space by colour" }));
  expect(head.getByText("75 %")).toBeTruthy();
  expect(head.getByText("of your space is mail the AI rates safe to delete"))
    .toBeTruthy();
});

test("a tap shows details: size, share, opened, last mail, AI, actions", () => {
  show(groups(
    g("a@x.example", 750 * MB, { count: 30, unread: 27, last: "2020-03-03",
      ai: { verdict: "delete_safe", reason: "" } }),
    g("b@x.example", 100 * MB, { count: 10 }),
    g("c@y.example", 150 * MB)));
  fireEvent.click(tile(/^x\.example/));
  const d = details();
  expect(within(d).getByText("x.example")).toBeTruthy();
  expect(within(d).getByText("2 senders · 40 mails")).toBeTruthy();
  expect(within(d).getByText("850.0 MB")).toBeTruthy();
  expect(within(d).getByText("85 % of your mailbox")).toBeTruthy();
  expect(within(d).getByText("Last mail")).toBeTruthy();
  expect(within(d).getByText("Delete-safe")).toBeTruthy();
  expect(within(d).getByText("30 of 40 mails")).toBeTruthy();
  expect(within(d).getByRole("button", { name: "Show in Senders" })).toBeTruthy();
  expect(within(d).getByRole("button", { name: "Zoom in" })).toBeTruthy();
  // Engagement (the score behind the colour) in words + what it is built
  // from: the read share of all its mails, 13 of 40, and no replies
  expect(within(d).getByText("Engagement")).toBeTruthy();
  expect(within(d).getByText("Medium")).toBeTruthy();
  expect(within(d).getByText("33% read · never replied")).toBeTruthy();
});

test("Show in Senders hands over a filter: @domain, or from:<sender>", () => {
  show();
  fireEvent.click(tile(/^mid\.example/));
  fireEvent.click(within(details()).getByRole("button", { name: "Show in Senders" }));
  expect(onShow).toHaveBeenLastCalledWith("@mid.example");
  zoomTile(/^big\.example/);
  fireEvent.click(within(map()).getByRole("button", { name: /^b@big\.example/ }));
  fireEvent.click(within(details()).getByRole("button", { name: "Show in Senders" }));
  expect(onShow).toHaveBeenLastCalledWith("from:b@big.example");
  // a sender has nothing inside: no zoom button
  expect(within(details()).queryByRole("button", { name: "Zoom in" })).toBeNull();
});

test("an Other bucket has details but no Senders filter", () => {
  const tiny = Object.fromEntries([1, 2, 3].map((i) =>
    [`t${i}@tiny${i}.example`, g(`t${i}@tiny${i}.example`, MB, { count: 1 })]));
  show({ ...groups(g("a@big.example", 900 * MB)), ...tiny });
  fireEvent.click(tile(/^Other \(3\)/));
  expect(within(details()).queryByRole("button", { name: "Show in Senders" }))
    .toBeNull();
  expect(within(details()).getByRole("button", { name: "Select" })).toBeTruthy();
});

test("a domain with one sender zooms straight to that sender's card", () => {
  show();
  zoomTile(/^small\.example/);
  // still on the same level - no one-tile map - but the card is the sender's
  expect(screen.queryByRole("navigation", { name: "Space map path" })!
    .textContent).toBe("All mail");
  const d = details();
  expect(within(d).getByText("d@small.example")).toBeTruthy();
  expect(within(d).queryByRole("button", { name: "Zoom in" })).toBeNull();
  fireEvent.click(within(d).getByRole("button", { name: "Show in Senders" }));
  expect(onShow).toHaveBeenLastCalledWith("from:d@small.example");
});

test("a protected-only item can't be selected from its card", () => {
  show(groups(g("p@z.example", 500 * MB, { protected: true }),
    g("a@y.example", 100 * MB)));
  fireEvent.click(tile(/^z\.example/));
  expect(within(details()).getByRole("button", { name: "Select" })
    .hasAttribute("disabled")).toBe(true);
});

test("the card closes with its X (phone) and with Escape", () => {
  show();
  fireEvent.click(tile(/^mid\.example/));
  fireEvent.click(within(details()).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("region", { name: /^Details of / })).toBeNull();
  fireEvent.click(tile(/^mid\.example/));
  fireEvent.keyDown(within(details()).getByRole("button", { name: "Show in Senders" }),
    { key: "Escape" });
  expect(screen.queryByRole("region", { name: /^Details of / })).toBeNull();
});

test("on a page the card sits in the side column, without a close button", () => {
  showPage();
  fireEvent.click(tile(/^mid\.example/));
  expect(within(details()).queryByRole("button", { name: "Close" })).toBeNull();
});

test("zoom button in the card drills in, the crumbs go back", () => {
  show();
  fireEvent.click(tile(/^big\.example/));
  fireEvent.click(within(details()).getByRole("button", { name: "Zoom in" }));
  expect(screen.getByRole("navigation", { name: "Space map path" }).textContent)
    .toContain("big.example");
  expect(screen.queryByRole("region", { name: /^Details of / })).toBeNull();
});

test("selection is pruned to the level you drill into", () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  fireEvent.click(tile(/^mid\.example/));
  fireEvent.click(tile(/^small\.example/));
  expect(screen.getByText("2 senders - 300.0 MB selected")).toBeTruthy();
  // zoom into big.example through the list: mid + small are not on it
  fireEvent.click(within(list()).getByRole("button", { name: /big\.example/ }));
  expect(screen.queryByText(/senders? - .* selected/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Review in Senders" })).toBeNull();
  fireEvent.click(within(map()).getByRole("button", { name: /^a@big\.example/ }));
  expect(screen.getByText("1 sender - 300.0 MB selected")).toBeTruthy();
  // back up: the ticked sender is still in a domain of this level
  fireEvent.click(within(screen.getByRole("navigation", { name: "Space map path" }))
    .getByRole("button", { name: "All mail" }));
  expect(screen.getByText("1 sender - 300.0 MB selected")).toBeTruthy();
});

test("the list shows 20 and the rest on request", () => {
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => {
    const k = `u@d${String(i).padStart(2, "0")}.example`;
    return [k, g(k, (100 - i) * MB)];
  }));
  show(many);
  expect(within(list()).getAllByRole("listitem").length).toBe(20);
  fireEvent.click(within(list()).getByRole("button", { name: "Show all 30" }));
  expect(within(list()).getAllByRole("listitem").length).toBe(30);
});

test("view switch: tiles by default, rings on request, remembered", () => {
  const first = show();
  expect(screen.getByRole("radio", { name: "Tiles" }).getAttribute("aria-checked"))
    .toBe("true");
  expect(screen.queryByTestId("space-rings")).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "Rings" }));
  expect(screen.getByTestId("space-rings")).toBeTruthy();
  expect(screen.queryByTestId("space-map")).toBeNull();
  expect(localStorage.getItem("pmc_space_view")).toBe("rings");
  first.unmount();
  show();                                   // a new visit opens on rings
  expect(screen.getByTestId("space-rings")).toBeTruthy();
});

const rings = () => screen.getByTestId("space-rings");
const seg = (id: string) =>
  rings().querySelector<SVGPathElement>(`[data-seg="${id}"]`)!;

test("rings: inner ring domains, outer ring their senders, centre = total",
  () => {
    localStorage.setItem("pmc_space_view", "rings");
    show({ ...BASE, "c@mid.example": g("c@mid.example", 200 * MB,
      { count: 50, engagement: 10 }) });
    // 3 domains inside, 5 senders outside
    expect(rings().querySelectorAll("path").length).toBe(8);
    expect(seg("d:big.example")).toBeTruthy();
    expect(seg("s:b@big.example")).toBeTruthy();
    expect(screen.getAllByText("1.2 GB").length).toBeGreaterThan(0);
    expect(screen.getByText("375 mails")).toBeTruthy();
    expect(screen.getByText("17 % low engagement")).toBeTruthy();
    // the picture is described; the list next to it is the keyboard route
    expect(rings().getAttribute("aria-label")).toMatch(/list next to it/);
  });

test("rings: tap = details in the centre + card, Zoom in makes the domain "
  + "the full ring", () => {
  localStorage.setItem("pmc_space_view", "rings");
  show();
  fireEvent.click(seg("d:big.example"));
  expect(within(details()).getByText("3 senders · 320 mails"))
    .toBeTruthy();
  expect(screen.getAllByText("75 % · 320 mails").length).toBe(2);   // centre + list row
  fireEvent.click(screen.getAllByRole("button", { name: /^Zoom in/ })[0]);
  expect(screen.getByRole("navigation", { name: "Space map path" }).textContent)
    .toContain("big.example");
  // the domain alone as the inner ring, its three senders outside
  expect(rings().querySelectorAll("path").length).toBe(4);
  expect(seg("d:big.example")).toBeTruthy();
  expect(seg("d:mid.example")).toBeNull();
});

test("rings: double-tap zooms, an outer sender segment shows its card", () => {
  localStorage.setItem("pmc_space_view", "rings");
  show();
  fireEvent.click(seg("s:b@big.example"));
  expect(within(details()).getByText("b@big.example")).toBeTruthy();
  fireEvent.click(seg("d:big.example"));
  fireEvent.click(seg("d:big.example"));
  expect(rings().querySelectorAll("path").length).toBe(4);
});

test("rings: Select ticks segments and the capsule counts them", () => {
  localStorage.setItem("pmc_space_view", "rings");
  show();
  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  fireEvent.click(seg("d:big.example"));
  expect(screen.getByText("2 senders - 800.0 MB selected")).toBeTruthy();
  fireEvent.click(review());
  expect([...onDone.mock.calls[0][0]].sort())
    .toEqual(["a@big.example", "b@big.example"]);
});

test("rings: every row of the list is reachable by keyboard", () => {
  localStorage.setItem("pmc_space_view", "rings");
  show();
  const rows = within(list()).getAllByRole("button");
  expect(rows.length).toBe(3);
  for (const r of rows) expect(r.tabIndex).toBeGreaterThanOrEqual(0);
});

test("AI sums add up each sender's own verdict, unrated is its own bucket",
  () => {
    const ai = (verdict: "delete_safe" | "keep") => ({ verdict, reason: "" });
    // one domain: 600 MB safe-to-delete sender, 300 MB keep, 100 MB unrated;
    // by mails "keep" dominates the domain tile - the MB must not all go there
    show(groups(
      g("a@mix.example", 600 * MB, { count: 10, ai: ai("delete_safe") }),
      g("b@mix.example", 300 * MB, { count: 50, ai: ai("keep") }),
      g("c@mix.example", 100 * MB, { count: 5 })));
    fireEvent.click(screen.getByRole("tab", { name: "AI verdict" }));
    const head = within(screen.getByRole("region", { name: "Space by colour" }));
    expect(head.getByText("60 %")).toBeTruthy();
    const legend = within(head.getByRole("list", { name: "Color legend" }));
    expect(legend.getByText("Delete-safe").parentElement!.textContent)
      .toContain("600.0 MB");
    expect(legend.getByText("Keep").parentElement!.textContent)
      .toContain("300.0 MB");
    expect(legend.getByText("Not rated yet").parentElement!.textContent)
      .toContain("100.0 MB");
  });

test("Esc closes the card first (focus anywhere), the page only afterwards",
  () => {
    const close = vi.fn();
    render(<SpaceMapPanel groups={BASE} onDone={onDone} onShow={onShow}
      onClose={close} />);
    fireEvent.click(tile(/^mid\.example/));
    (screen.getByRole("radio", { name: "Rings" }) as HTMLElement).focus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("region", { name: /^Details of / })).toBeNull();
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
  });

test("closing the card puts focus back on the tile; zooming on the list",
  () => {
    show();
    fireEvent.click(tile(/^mid\.example/));
    fireEvent.click(within(details()).getByRole("button", { name: "Close" }));
    expect(document.activeElement).toBe(tile(/^mid\.example/));
    fireEvent.click(tile(/^big\.example/));
    fireEvent.click(within(details()).getByRole("button", { name: "Zoom in" }));
    expect(document.activeElement!.hasAttribute("data-row")).toBe(true);
  });

test("switching Select off clears the selection and the capsule", () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  fireEvent.click(tile(/^mid\.example/));
  expect(review()).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  expect(screen.queryByRole("button", { name: "Review in Senders" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  expect(screen.queryByRole("button", { name: "Review in Senders" })).toBeNull();
});

test("while selecting, a row of a one-sender domain ticks it", () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  fireEvent.click(within(list()).getByRole("button", { name: /small\.example/ }));
  expect(screen.getByText("1 sender - 100.0 MB selected")).toBeTruthy();
  // still on the top level: nothing was zoomed into
  expect(screen.getByRole("navigation", { name: "Space map path" }).textContent)
    .toBe("All mail");
});

test("the docked card pads the page and scrolls the tapped tile above it",
  () => {
    show();
    const scroller = document.querySelector<HTMLElement>('[data-scroll-id="panel"]')!;
    const scrollBy = vi.fn();
    scroller.scrollBy = scrollBy as never;
    scroller.getBoundingClientRect = () => ({ top: 0, bottom: 800, left: 0,
      right: 400, width: 400, height: 800 } as DOMRect);
    // the card is 300 px tall; the tile sits at 600-700, under the card
    Object.defineProperty(HTMLElement.prototype, "offsetHeight",
      { configurable: true, get() { return 300; } });
    const t = tile(/^mid\.example/);
    t.getBoundingClientRect = () => ({ top: 600, bottom: 700, left: 0,
      right: 100, width: 100, height: 100 } as DOMRect);
    fireEvent.click(t);
    expect(scroller.querySelector<HTMLElement>('[aria-hidden="true"][style*="height: 300px"]'))
      .toBeTruthy();
    // free area 8..492: the tile's bottom (700) moves up to 492
    expect(scrollBy).toHaveBeenCalledWith({ top: 208 });
    delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
  });

test("on a page there is no docked card: no padding, no scrolling", () => {
  showPage();
  const scroller = document.querySelector<HTMLElement>('[data-scroll-id="panel"]')!;
  fireEvent.click(tile(/^mid\.example/));
  expect(scroller.querySelector('[style*="height: 300px"]')).toBeNull();
});

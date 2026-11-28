// @vitest-environment jsdom
/* The filter builder must emit exactly the DSL that parseFilter reads -
 * clicking conditions together yields a query users could have typed. */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { QueryBuilder } from "./components/QueryBuilder";
import { parseFilter } from "./lib";
import { setLang } from "./i18n";

afterEach(() => { cleanup(); setLang("en"); });

function setup(initial = "") {
  let value = initial;
  const onChange = vi.fn((q: string) => { value = q; });
  const view = render(
    <QueryBuilder value={value} onChange={onChange} />);
  const rerender = () =>
    view.rerender(<QueryBuilder value={value} onChange={onChange} />);
  fireEvent.click(screen.getByTitle(/Build a filter/));
  return { onChange, get: () => value, rerender };
}

test("clicking conditions appends valid DSL tokens", () => {
  const s = setup();
  // default tag is "newsletter"
  fireEvent.click(screen.getAllByText("Add")[0]);
  expect(s.get()).toBe("tag:newsletter");
  s.rerender();
  fireEvent.click(screen.getByText("with unsubscribe link"));
  expect(s.get()).toBe("tag:newsletter is:unsub");
  s.rerender();
  // age row: 1 + years by default -> age:>1y (third Add button)
  fireEvent.click(screen.getAllByText("Add")[2]);
  expect(s.get()).toBe("tag:newsletter is:unsub age:>1y");
  // …and the result round-trips through the real parser
  const f = parseFilter(s.get());
  expect(f.tags).toEqual(["newsletter"]);
  expect(f.unsub).toBe(true);
  expect(f.ageMonths).toBe(12);
});

test("not-yet-unsubscribed chip emits the DSL token", () => {
  const s = setup();
  fireEvent.click(screen.getByText("not yet unsubscribed"));
  expect(s.get()).toBe("is:not-unsubscribed");
  expect(parseFilter(s.get()).unsubscribed).toBe(false);
});

test("fully-unsubscribed chip emits the DSL token", () => {
  const s = setup();
  fireEvent.click(screen.getByText("fully unsubscribed"));
  expect(s.get()).toBe("is:unsubscribed");
  expect(parseFilter(s.get()).unsubscribed).toBe(true);
});

test("new-senders chip emits the is:new DSL token", () => {
  const s = setup();
  fireEvent.click(screen.getByText("new senders"));
  expect(s.get()).toBe("is:new");
  expect(parseFilter(s.get()).newOnly).toBe(true);
});

test("still-mailing flag emits the is:still-mailing DSL token", () => {
  const s = setup();
  fireEvent.click(screen.getByText("still mailing after unsubscribe"));
  expect(s.get()).toBe("is:still-mailing");
  expect(parseFilter(s.get()).stillMailing).toBe(true);
});

test("louder and came-back flags emit the is:louder / is:back tokens", () => {
  const s = setup();
  fireEvent.click(screen.getByText("got louder"));
  expect(s.get()).toBe("is:louder");
  expect(parseFilter(s.get()).louder).toBe(true);
  cleanup();
  const b = setup();
  fireEvent.click(screen.getByText("came back after 6+ months"));
  expect(b.get()).toBe("is:back");
  expect(parseFilter(b.get()).back).toBe(true);
  // the flags that were there stay
  expect(screen.getByText("still mailing after unsubscribe")).toBeTruthy();
  expect(screen.getByText("new senders")).toBeTruthy();
});

test("the new flags come last: every flag that was there keeps its place", () => {
  setup();
  const order = ["with unsubscribe link", "new senders",
    "still mailing after unsubscribe", "with protected mails",
    "that track opens or clicks", "rarely engaged with",
    "sometimes engaged with", "often engaged with", "got louder",
    "came back after 6+ months"];
  const labels = [...document.querySelectorAll("button")]
    .map((b) => b.textContent);
  const idx = order.map((name) => labels.indexOf(name));
  expect(idx.every((i) => i >= 0)).toBe(true);
  expect([...idx].sort((a, b) => a - b)).toEqual(idx);
});

test("tokens are never added twice", () => {
  const s = setup("is:unsub");
  fireEvent.click(screen.getByText("with unsubscribe link"));
  expect(s.onChange).not.toHaveBeenCalled();
});

test("clear empties the query", () => {
  const s = setup("tag:social is:unsub");
  fireEvent.click(screen.getByText("Clear"));
  expect(s.get()).toBe("");
});

test("protected-mails chip emits the has:pinned DSL token", () => {
  const s = setup();
  fireEvent.click(screen.getByText("with protected mails"));
  expect(s.get()).toBe("has:pinned");
  expect(parseFilter(s.get()).pinnedOnly).toBe(true);
});

test("tracker chip emits the has:tracker DSL token", () => {
  const s = setup();
  fireEvent.click(screen.getByText("that track opens or clicks"));
  expect(s.get()).toBe("has:tracker");
  expect(parseFilter(s.get()).trackerOnly).toBe(true);
});

test.each([
  ["rarely engaged with", "eng:low"],
  ["sometimes engaged with", "eng:medium"],
  ["often engaged with", "eng:high"],
])("engagement chip '%s' emits the %s DSL token", (label, token) => {
  const s = setup();
  fireEvent.click(screen.getByText(label));
  expect(s.get()).toBe(token);
  expect(parseFilter(s.get()).eng).toBe(token.slice(4));
});

test("every row adds its own token, Add buttons are one per row", () => {
  const s = setup();
  const adds = screen.getAllByText("Add");
  expect(adds).toHaveLength(5);
  fireEvent.click(adds[1]);
  expect(s.get()).toBe("ai:safe");
  s.rerender();
  fireEvent.click(adds[3]);
  expect(s.get()).toBe("ai:safe unread:>80");
  s.rerender();
  fireEvent.click(adds[4]);
  expect(s.get()).toBe("ai:safe unread:>80 att:>10m");
});

test("on desktop the builder is a popover; Done closes it", () => {
  setup();
  expect(screen.getByText("Build a filter")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByText("Done"));
  expect(screen.queryByText("Build a filter")).toBeNull();
});

test("on phones it opens as a bottom sheet and Done / Esc close it", () => {
  const mq = vi.fn((q: string) => ({ matches: q.includes("max-width: 639px"),
    addEventListener: () => {}, removeEventListener: () => {} }));
  vi.stubGlobal("matchMedia", mq);
  window.matchMedia = mq as unknown as typeof window.matchMedia;
  try {
    const s = setup("tag:social");
    const sheet = screen.getByRole("dialog");
    expect(sheet.getAttribute("data-size")).toBe("sm");
    expect(sheet.textContent).toContain("Build a filter");
    expect(sheet.textContent).toContain("tag:social");   // current query
    // phones get icon-only Add buttons (named for AT)
    expect(screen.queryByText("Add")).toBeNull();
    expect(document.activeElement).toBe(screen.getByText("Build a filter"));
    fireEvent.click(screen.getAllByRole("button", { name: "Add" })[0]);
    expect(s.get()).toBe("tag:social tag:newsletter");
    fireEvent.click(screen.getByText("Done"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTitle(/Build a filter/));
    fireEvent.click(screen.getByTitle(/Build a filter/));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  } finally {
    vi.unstubAllGlobals();
    // @ts-expect-error jsdom has no matchMedia by default
    delete window.matchMedia;
  }
});

test("Esc with one of its pop-up menus open closes only the menu", () => {
  setup();
  const cat = screen.getByRole("button", { name: /^newsletter/ });
  fireEvent.click(cat);
  const item = screen.getAllByRole("menuitemradio")[0];
  fireEvent.keyDown(item, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(screen.getByText("Build a filter")).toBeTruthy();   // builder stays
  expect(document.activeElement).toBe(cat);
  fireEvent.keyDown(cat, { key: "Escape" });                 // now it closes
  expect(screen.queryByText("Build a filter")).toBeNull();
});

test("closing the popover returns focus to the trigger (Done and Esc)", () => {
  setup();
  fireEvent.click(screen.getByText("Done"));
  expect(document.activeElement).toBe(screen.getByTitle(/Build a filter/));
  fireEvent.click(screen.getByTitle(/Build a filter/));
  expect(screen.getByText("Build a filter")).toBeTruthy();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByText("Build a filter")).toBeNull();
  expect(document.activeElement).toBe(screen.getByTitle(/Build a filter/));
});

test("mailOnly offers only what the per-mail parser applies", () => {
  const onChange = vi.fn();
  render(<QueryBuilder value="" onChange={onChange} mailOnly open
    onOpenChange={() => {}} />);
  // no group-level conditions: tag, AI verdict, unread share, group flags
  for (const name of ["Category", "AI verdict", "Unread ≥", "Only groups…",
    "with unsubscribe link", "new senders"])
    expect(screen.queryByText(name)).toBeNull();
  // per-mail ones are there and add per-mail tokens
  for (const name of ["Older than", "Size ≥", "Attachments ≥", "Only mails…"])
    expect(screen.getByText(name)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "unread" }));
  expect(onChange).toHaveBeenLastCalledWith("is:unread");
  fireEvent.click(screen.getAllByRole("button", { name: "Add" })[1]);   // size
  expect(onChange).toHaveBeenLastCalledWith("size:>5m");
});

test("mailOnly: `past its date` is the last of the per-mail flags and writes " +
  "is:expired; the group-level builder does not offer it", () => {
  const onChange = vi.fn();
  const { unmount } = render(<QueryBuilder value="" onChange={onChange}
    mailOnly open onOpenChange={() => {}} />);
  const flags = ["unread", "read", "protected", "past its date"].map((n) =>
    screen.getByRole("button", { name: n }));
  // the existing flags keep their order; the new one comes after them
  for (let i = 1; i < flags.length; i++)
    expect(flags[i - 1].compareDocumentPosition(flags[i])
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(flags[3]);
  expect(onChange).toHaveBeenLastCalledWith("is:expired");
  unmount();
  render(<QueryBuilder value="" onChange={onChange} open
    onOpenChange={() => {}} />);
  expect(screen.queryByRole("button", { name: "past its date" })).toBeNull();
});

test("mailOnly: `Kind of mail` is the last row, adds kind:<kind>, and the "
  + "group-level builder does not offer it", () => {
  const onChange = vi.fn();
  const { unmount } = render(<QueryBuilder value="" onChange={onChange}
    mailOnly open onOpenChange={() => {}} />);
  const rows = ["Older than", "Size ≥", "Attachments ≥", "Kind of mail"]
    .map((n) => screen.getByText(n));
  for (let i = 1; i < rows.length; i++)           // the others keep their order
    expect(rows[i - 1].compareDocumentPosition(rows[i])
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const adds = screen.getAllByRole("button", { name: "Add" });
  expect(adds).toHaveLength(4);
  fireEvent.click(adds[3]);                        // the first kind
  expect(onChange).toHaveBeenLastCalledWith("kind:ads");
  fireEvent.click(screen.getByRole("button", { name: "Ads and offers" }));
  fireEvent.click(screen.getByRole("menuitemradio",
    { name: "Order confirmations" }));
  fireEvent.click(screen.getAllByRole("button", { name: "Add" })[3]);
  expect(onChange).toHaveBeenLastCalledWith("kind:orders");
  unmount();
  render(<QueryBuilder value="" onChange={onChange} open
    onOpenChange={() => {}} />);
  expect(screen.queryByText("Kind of mail")).toBeNull();
  cleanup();
  render(<QueryBuilder value="" onChange={onChange} senderOnly open
    onOpenChange={() => {}} />);
  expect(screen.queryByText("Kind of mail")).toBeNull();
});

test("every kind the builder offers is one the server knows", async () => {
  const { KIND_IDS } = await import("./kinds");
  expect([...KIND_IDS]).toEqual(["ads", "orders", "shipping", "invoices",
    "appointments", "jobs", "support", "accounts"]);
});

test.each([
  ["graded D or worse", "grade:<=d", { op: "<=", letter: "D" }],
  ["graded C or worse", "grade:<=c", { op: "<=", letter: "C" }],
  ["graded B or better", "grade:>=b", { op: ">=", letter: "B" }],
])("grade chip '%s' emits the %s DSL token", (label, token, parsed) => {
  const s = setup();
  fireEvent.click(screen.getByText(label));
  expect(s.get()).toBe(token);
  expect(parseFilter(s.get()).grade).toEqual(parsed);
});

test("the grade flags come last: every flag that was there keeps its place",
  () => {
    setup();
    const order = ["with unsubscribe link", "new senders",
      "still mailing after unsubscribe", "with protected mails",
      "that track opens or clicks", "rarely engaged with",
      "sometimes engaged with", "often engaged with", "got louder",
      "came back after 6+ months", "graded D or worse", "graded C or worse",
      "graded B or better"];
    const labels = [...document.querySelectorAll("button")]
      .map((b) => b.textContent);
    const idx = order.map((name) => labels.indexOf(name));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

test("the grade chips read in German", () => {
  const s = setup();
  setLang("de");
  s.rerender();
  for (const label of ["Note D oder schlechter", "Note C oder schlechter",
    "Note B oder besser"]) {
    expect(screen.getByText(label)).toBeTruthy();
  }
});

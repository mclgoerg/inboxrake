// @vitest-environment jsdom
/* Protected senders and Custom categories as lists: they edit the same
 * stored text the old text areas did. */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, test } from "vitest";

import { categoriesText, CategoryList, normalizeProtected, parseCategories,
  protectedEntries, ProtectedList } from "./components/SettingsLists";

afterEach(cleanup);

let stored = "";
function Lists({ kind, initial }: { kind: "protected" | "categories";
  initial: string }) {
  const [text, setText] = useState(initial);
  stored = text;
  return kind === "protected"
    ? <ProtectedList text={text} onChange={setText} />
    : <CategoryList text={text} onChange={setText} />;
}

test("entries normalise like the server: lower case, bare domain gets its @", () => {
  expect(normalizeProtected(" Boss@Work.Example ")).toBe("boss@work.example");
  expect(normalizeProtected("bank.example")).toBe("@bank.example");
  expect(normalizeProtected("@bank.example")).toBe("@bank.example");
  // what the server takes: local names and intranet domains too
  expect(normalizeProtected("user@localhost")).toBe("user@localhost");
  expect(normalizeProtected("intranet")).toBe("@intranet");
  expect(normalizeProtected("nobody@")).toBeNull();
  expect(normalizeProtected("a@b@c")).toBeNull();
  expect(normalizeProtected("@")).toBeNull();
  expect(protectedEntries("a@x.example\n\n @y.example ")).toEqual(
    ["a@x.example", "@y.example"]);
});

const addProtected = (value: string) => {
  const open = screen.queryByRole("button", { name: "Add address or domain…" });
  if (open) fireEvent.click(open);
  const input = screen.getByRole("textbox", { name: "Add address or domain…" });
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
  return input;
};

test("protected senders: addresses with an avatar, domains as 'Everyone at', remove with ⊖", () => {
  render(<Lists kind="protected" initial={"anna@mailfox.example\n@dr-meier.example"} />);
  expect(screen.getByText("anna@mailfox.example")).toBeTruthy();
  expect(screen.getByText("dr-meier.example").tagName).toBe("B");
  expect(screen.getByText(/Everyone at/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button",
    { name: "Remove anna@mailfox.example" }));
  expect(stored).toBe("@dr-meier.example");
  expect(screen.queryByText("anna@mailfox.example")).toBeNull();
});

test("protected senders: adding stores the same line format and stays open for the next", () => {
  render(<Lists kind="protected" initial="boss@work.example" />);
  addProtected("Bank.Example");
  expect(stored).toBe("boss@work.example\n@bank.example");
  addProtected("new@x.example");
  expect(stored).toBe("boss@work.example\n@bank.example\nnew@x.example");
});

test("protected senders: invalid and duplicate entries are refused with a message", () => {
  render(<Lists kind="protected" initial="boss@work.example" />);
  addProtected("nobody@");
  expect(screen.getByRole("alert").textContent).toContain("neither an address");
  expect(stored).toBe("boss@work.example");
  addProtected("BOSS@work.example");
  expect(screen.getByRole("alert").textContent)
    .toContain("Already protected: BOSS@work.example");
  expect(stored).toBe("boss@work.example");
});

test("protected senders: a pasted block of lines becomes several entries; Esc closes", () => {
  render(<Lists kind="protected" initial="" />);
  fireEvent.click(screen.getByRole("button", { name: "Add address or domain…" }));
  const input = screen.getByRole("textbox", { name: "Add address or domain…" });
  fireEvent.paste(input, { clipboardData: {
    getData: () => "a@x.example\n@y.example\r\nb@z.example" } });
  expect(stored).toBe("a@x.example\n@y.example\nb@z.example");
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("textbox")).toBeNull();
});

test("protected senders: a paste with one bad line adds the good ones and keeps the bad one to fix", () => {
  render(<Lists kind="protected" initial="" />);
  fireEvent.click(screen.getByRole("button", { name: "Add address or domain…" }));
  const input = screen.getByRole("textbox",
    { name: "Add address or domain…" }) as HTMLInputElement;
  fireEvent.paste(input, { clipboardData: {
    getData: () => "a@x.example\nbroken@\nuser@localhost" } });
  expect(stored).toBe("a@x.example\nuser@localhost");
  expect(screen.getByRole("alert").textContent).toContain("broken@");
  expect(input.value).toBe("broken@");
});

test("category text round-trips: names and keywords lower-cased, empty list kept", () => {
  const text = "insurance: allianz, versicherung\nshipping: ";
  expect(parseCategories(text)).toEqual([
    { name: "insurance", kws: ["allianz", "versicherung"] },
    { name: "shipping", kws: [] }]);
  expect(categoriesText(parseCategories(text))).toBe(text);
  // lines without a name are dropped, a repeated name keeps its place
  expect(parseCategories("x\n: y\nA: 1\nb: 2\na: 3")).toEqual([
    { name: "a", kws: ["3"] }, { name: "b", kws: ["2"] }]);
});

test("categories: keyword chips add and remove in the stored 'name: kw1, kw2' form", () => {
  render(<Lists kind="categories" initial="insurance: allianz, versicherung" />);
  fireEvent.click(screen.getByRole("button",
    { name: "Remove keyword allianz from insurance" }));
  expect(stored).toBe("insurance: versicherung");
  fireEvent.click(screen.getByRole("button",
    { name: "Add a keyword to insurance" }));
  const kw = screen.getByRole("textbox", { name: "Add a keyword to insurance" });
  fireEvent.change(kw, { target: { value: "HUK, versicherung, dkv" } });
  fireEvent.keyDown(kw, { key: "Enter" });
  expect(stored).toBe("insurance: versicherung, huk, dkv");
});

test("categories: add, rename and delete a category; names are validated", () => {
  render(<Lists kind="categories" initial="insurance: allianz" />);
  expect(screen.getByRole("group", { name: "insurance" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Add category…" }));
  const name = screen.getByRole("textbox", { name: "Add category…" });
  fireEvent.change(name, { target: { value: "a:b" } });
  fireEvent.keyDown(name, { key: "Enter" });
  expect(screen.getByRole("alert").textContent).toContain("colon");
  fireEvent.change(name, { target: { value: "Insurance" } });
  fireEvent.keyDown(name, { key: "Enter" });
  expect(screen.getByRole("alert").textContent).toContain("already");
  fireEvent.change(name, { target: { value: "Hobby" } });
  fireEvent.keyDown(name, { key: "Enter" });
  expect(stored).toBe("insurance: allianz\nhobby: ");
  expect(screen.getByText(/No keywords yet/)).toBeTruthy();
  // rename keeps the keywords and the place
  fireEvent.click(screen.getByRole("button", { name: "Rename insurance" }));
  const ren = screen.getByRole("textbox", { name: "Rename insurance" });
  fireEvent.change(ren, { target: { value: "cover" } });
  fireEvent.keyDown(ren, { key: "Enter" });
  expect(stored).toBe("cover: allianz\nhobby: ");
  fireEvent.click(screen.getByRole("button", { name: "Delete hobby" }));
  expect(stored).toBe("cover: allianz");
});

test("categories: the switch alone makes 'off': empty list stored; on again drops the override", () => {
  render(<Lists kind="categories" initial="shipping: dhl, dpd" />);
  const row = within(screen.getByRole("group", { name: "shipping" }));
  expect(row.getByText("Built-in")).toBeTruthy();
  expect(row.getByText(/replace the built-in ones/)).toBeTruthy();
  const sw = row.getByRole("switch", { name: "shipping enabled" });
  expect(sw.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(sw);
  expect(stored).toBe("shipping: ");
  const off = within(screen.getByRole("group", { name: "shipping" }));
  expect(off.getByText(/Turned off/)).toBeTruthy();
  expect(off.getByRole("switch", { name: "shipping enabled" })
    .getAttribute("aria-checked")).toBe("false");
  fireEvent.click(off.getByRole("switch", { name: "shipping enabled" }));
  expect(stored).toBe("");
  const on = within(screen.getByRole("group", { name: "shipping" }));
  expect(on.getByRole("switch", { name: "shipping enabled" })
    .getAttribute("aria-checked")).toBe("true");
  expect(screen.queryByText(/Turned off/)).toBeNull();
});

test("categories: a built-in added by name starts on and stores nothing until it has a keyword", () => {
  render(<Lists kind="categories" initial="" />);
  fireEvent.click(screen.getByRole("button", { name: "Add category…" }));
  const name = screen.getByRole("textbox", { name: "Add category…" });
  fireEvent.change(name, { target: { value: "Shipping" } });
  fireEvent.keyDown(name, { key: "Enter" });
  expect(stored).toBe("");
  const row = within(screen.getByRole("group", { name: "shipping" }));
  expect(row.getByRole("switch", { name: "shipping enabled" })
    .getAttribute("aria-checked")).toBe("true");
  expect(screen.queryByText(/Turned off/)).toBeNull();
  // a keyword makes the override
  const kw = screen.getByRole("textbox", { name: "Add a keyword to shipping" });
  fireEvent.change(kw, { target: { value: "dhl, dpd" } });
  fireEvent.keyDown(kw, { key: "Enter" });
  expect(stored).toBe("shipping: dhl, dpd");
  // the last chip removed: the override is gone (not "off")
  fireEvent.click(screen.getByRole("button",
    { name: "Remove keyword dhl from shipping" }));
  expect(stored).toBe("shipping: dpd");
  fireEvent.click(screen.getByRole("button",
    { name: "Remove keyword dpd from shipping" }));
  expect(stored).toBe("");
  expect(screen.queryByText(/Turned off/)).toBeNull();
  expect(within(screen.getByRole("group", { name: "shipping" }))
    .getByRole("switch", { name: "shipping enabled" })
    .getAttribute("aria-checked")).toBe("true");
});

test("categories: switching a bare built-in off stores the empty list", () => {
  render(<Lists kind="categories" initial="" />);
  fireEvent.click(screen.getByRole("button", { name: "Add category…" }));
  const name = screen.getByRole("textbox", { name: "Add category…" });
  fireEvent.change(name, { target: { value: "travel" } });
  fireEvent.keyDown(name, { key: "Enter" });
  fireEvent.click(screen.getByRole("switch", { name: "travel enabled" }));
  expect(stored).toBe("travel: ");
});

test("categories: restoring a built-in drops its override", () => {
  render(<Lists kind="categories" initial="travel: flug" />);
  fireEvent.click(screen.getByRole("button",
    { name: "Restore the built-in keywords of travel" }));
  expect(stored).toBe("");
});

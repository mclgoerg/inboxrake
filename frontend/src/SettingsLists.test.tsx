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
const BUILTIN = {
  shipping: ["parcel", "tracking", "shipment", "delivery", "courier", "post"],
  finance: ["invoice", "billing", "payment"],
  shopping: ["shop"], social: ["chat"], travel: ["hotel"],
  "dev/cloud": ["hosting"],
};
function Lists({ kind, initial }: { kind: "protected" | "categories";
  initial: string }) {
  const [text, setText] = useState(initial);
  stored = text;
  return kind === "protected"
    ? <ProtectedList text={text} onChange={setText} />
    : <CategoryList text={text} onChange={setText} builtin={BUILTIN} />;
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

const row = (name: string) => within(screen.getByRole("group", { name }));

test("categories: the six built-ins are rows with their first keywords and +N more", () => {
  render(<Lists kind="categories" initial="" />);
  const shipping = row("Shipping");
  for (const k of ["parcel", "tracking", "shipment", "delivery"])
    expect(shipping.getByText(k)).toBeTruthy();
  expect(shipping.queryByText("courier")).toBeNull();
  expect(shipping.getByText("+2 more")).toBeTruthy();
  expect(row("Finance").queryByText(/more/)).toBeNull();
  for (const n of ["Shipping", "Finance", "Shopping", "Social", "Travel",
    "Dev / cloud"]) {
    expect(row(n).getByRole("switch", { name: `${n} enabled` })
      .getAttribute("aria-checked")).toBe("true");
  }
  expect(stored).toBe("");
});

test("categories: your own sit above with an Add row; no built-in name can be added twice", () => {
  render(<Lists kind="categories" initial="insurance: policy, claim" />);
  const own = screen.getByRole("group", { name: "insurance" });
  const builtIn = screen.getByRole("group", { name: "Shipping" });
  expect(own.compareDocumentPosition(builtIn)
    & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Add category…" }));
  const name = screen.getByRole("textbox", { name: "Add category…" });
  fireEvent.change(name, { target: { value: "Shipping" } });
  fireEvent.keyDown(name, { key: "Enter" });
  expect(screen.getByRole("alert").textContent).toContain("already");
  expect(stored).toBe("insurance: policy, claim");
});

test("categories: keyword chips of your own add and remove in the stored 'name: kw1, kw2' form", () => {
  render(<Lists kind="categories" initial="insurance: policy, claim" />);
  fireEvent.click(screen.getByRole("button",
    { name: "Remove keyword policy from insurance" }));
  expect(stored).toBe("insurance: claim");
  fireEvent.click(screen.getByRole("button",
    { name: "Add a keyword to insurance" }));
  const kw = screen.getByRole("textbox", { name: "Add a keyword to insurance" });
  fireEvent.change(kw, { target: { value: "Cover, claim, quote" } });
  fireEvent.keyDown(kw, { key: "Enter" });
  expect(stored).toBe("insurance: claim, cover, quote");
});

test("categories: add, rename and delete a category of your own; names are validated", () => {
  render(<Lists kind="categories" initial="insurance: policy" />);
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
  expect(stored).toBe("insurance: policy\nhobby: ");
  expect(screen.getByText(/No keywords yet/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Rename insurance" }));
  const ren = screen.getByRole("textbox", { name: "Rename insurance" });
  fireEvent.change(ren, { target: { value: "cover" } });
  fireEvent.keyDown(ren, { key: "Enter" });
  expect(stored).toBe("cover: policy\nhobby: ");
  // a built-in name is taken, too
  fireEvent.click(screen.getByRole("button", { name: "Rename cover" }));
  const ren2 = screen.getByRole("textbox", { name: "Rename cover" });
  fireEvent.change(ren2, { target: { value: "travel" } });
  fireEvent.keyDown(ren2, { key: "Enter" });
  expect(screen.getByRole("alert").textContent).toContain("already");
  fireEvent.keyDown(ren2, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Delete hobby" }));
  expect(stored).toBe("cover: policy");
});

test("categories: the switch makes 'off' (empty list stored); on again drops the override", () => {
  render(<Lists kind="categories" initial="" />);
  fireEvent.click(row("Travel").getByRole("switch", { name: "Travel enabled" }));
  expect(stored).toBe("travel: ");
  const off = row("Travel");
  expect(off.getByText("off")).toBeTruthy();
  expect(off.getByRole("switch", { name: "Travel enabled" })
    .getAttribute("aria-checked")).toBe("false");
  // the keywords stay visible (muted) and Edit is unavailable while off
  expect(off.getByText("hotel")).toBeTruthy();
  expect((off.getByRole("button", { name: "Edit Travel" }) as HTMLButtonElement)
    .disabled).toBe(true);
  fireEvent.click(off.getByRole("switch", { name: "Travel enabled" }));
  expect(stored).toBe("");
  expect(row("Travel").queryByText("off")).toBeNull();
});

test("categories: editing a built-in replaces its keywords; back to the defaults leaves no override", () => {
  render(<Lists kind="categories" initial="" />);
  fireEvent.click(screen.getByRole("button", { name: "Edit Finance" }));
  // all keywords as chips while editing
  expect(row("Finance").getByRole("button",
    { name: "Remove keyword payment from Finance" })).toBeTruthy();
  fireEvent.click(row("Finance").getByRole("button",
    { name: "Remove keyword payment from Finance" }));
  expect(stored).toBe("finance: invoice, billing");
  expect(row("Finance").getByRole("button",
    { name: "Restore the built-in keywords of Finance" })).toBeTruthy();
  // adding the keyword back = the built-in list again = no override
  fireEvent.click(row("Finance").getByRole("button",
    { name: "Add a keyword to Finance" }));
  const kw = screen.getByRole("textbox", { name: "Add a keyword to Finance" });
  fireEvent.change(kw, { target: { value: "payment" } });
  fireEvent.keyDown(kw, { key: "Enter" });
  expect(stored).toBe("");
  // a new keyword is an override; Restore defaults drops it (the input
  // stays open for the next keyword)
  const kw2 = screen.getByRole("textbox", { name: "Add a keyword to Finance" });
  fireEvent.change(kw2, { target: { value: "tax" } });
  fireEvent.keyDown(kw2, { key: "Enter" });
  expect(stored).toBe("finance: invoice, billing, payment, tax");
  fireEvent.click(row("Finance").getByRole("button",
    { name: "Restore the built-in keywords of Finance" }));
  expect(stored).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Done editing Finance" }));
  expect(screen.getByRole("button", { name: "Edit Finance" })).toBeTruthy();
});

test("categories: removing the last keyword of an override brings the built-ins back (not 'off')", () => {
  render(<Lists kind="categories" initial="shopping: outlet" />);
  const r = row("Shopping");
  expect(r.getByText("outlet")).toBeTruthy();
  expect(r.queryByText("shop")).toBeNull();
  expect(r.getByText("edited")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Edit Shopping" }));
  fireEvent.click(row("Shopping").getByRole("button",
    { name: "Remove keyword outlet from Shopping" }));
  expect(stored).toBe("");
  expect(row("Shopping").getByRole("switch", { name: "Shopping enabled" })
    .getAttribute("aria-checked")).toBe("true");
  expect(row("Shopping").getByText("shop")).toBeTruthy();
});

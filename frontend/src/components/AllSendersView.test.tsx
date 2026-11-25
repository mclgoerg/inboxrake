// @vitest-environment jsdom
/* The Senders page across accounts: one row per address with a chip per
 * account and summed counts, the account chip narrows to one account's side,
 * filter and sort work over the union, a selection acts through the
 * multi-account confirm (one step per ticked account, protected senders left
 * out of a Trash), the detail lists the accounts and sends per-account work to
 * that account. No shortcut acts on an account. (api mocked.) */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SENDERS_RESP, sender } from "../allAccountsFixtures";
import { setLang } from "../i18n";
import type { AllSendersResp } from "../types";

const calls: { fn: string; account: string; args: unknown[] }[] = [];
const del = vi.fn();
const preview = vi.fn();

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  const at = () => /account=([^&]*)/.exec(actual.withAccount("/x"))?.[1] ?? "";
  const rec = (fn: string, f: (...a: any[]) => unknown) =>
    (...args: unknown[]) => {
      calls.push({ fn, account: decodeURIComponent(at()), args });
      return f(...args);
    };
  return { ...actual, api: {
    deleteGroups: rec("deleteGroups", (...a) => del(...a)),
    unsubscribePreview: rec("preview", (...a) => preview(...a)),
  } };
});
vi.mock("../keepsafe", () => ({
  KEEP_SAFE_MIN: 20,
  confirmTrash: vi.fn().mockResolvedValue({ ok: true, pinned: [] }),
}));

import { AllSendersView } from "./AllSendersView";
import { DialogProvider, ToastProvider } from "./ui";

const NAMES = ["gmail", "icloud", "proton", "gmx"];
const sp = (s: string | null | undefined): string =>
  (s ?? "").replace(/\u00a0/g, " ");
const press = (btn: HTMLElement) => fireEvent.click(btn, { detail: 0 });

const handlers = () => ({ onRetry: vi.fn(), onOpenIn: vi.fn(),
  onShowMails: vi.fn(), onPage: vi.fn(), onOpenActivity: vi.fn(),
  onChanged: vi.fn() });
const mount = (over: Partial<Parameters<typeof AllSendersView>[0]> = {},
    data: AllSendersResp | null = SENDERS_RESP) => {
  const h = handlers();
  const props = { data, failed: false, names: NAMES, phone: false,
    exists: () => true, demo: false, ...h, ...over };
  render(<ToastProvider><DialogProvider>
    <AllSendersView {...props} /></DialogProvider></ToastProvider>);
  return h;
};
const rowOf = (label: string): HTMLElement =>
  screen.getAllByRole("row").find((r) => r.hasAttribute("data-gidx")
    && r.textContent?.includes(label))!;
const tick = (label: string) =>
  fireEvent.click(within(rowOf(label)).getByRole("checkbox"));
const bar = () => screen.getByRole("region", { name: /Selection actions|Aktionen für die Auswahl/ });
// (the filter's "select all matches" banner is a row of its own)
const dataRows = () => screen.getAllByRole("row")
  .filter((r) => r.hasAttribute("data-gidx"));

beforeEach(() => {
  setLang("en");
  calls.length = 0;
  del.mockReset().mockImplementation(async (_g, keys: string[]) =>
    ({ ok: true, queued: keys.length * 10, skipped: 0 }));
  preview.mockReset().mockImplementation(async (_g, keys: string[]) => ({
    senders: [{ addr: keys[0], name: "X", via: "one_click", mails: 1,
      size: 1 }], skipped_protected: 0, skipped_done: 0, capped: 0,
    skipped_no_header: 0, trash: { groups: [], mails: 0, size: 0, pinned: 0 } }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the list", () => {
  it("one row per address, summed counts, one chip per account", () => {
    mount();
    const rows = dataRows();
    expect(rows).toHaveLength(4);
    const deals = rowOf("Deals Daily");
    expect(sp(deals.textContent)).toContain("306");
    expect(within(deals).getByText("gmail: 210 mails")).toBeTruthy();
    expect(within(deals).getByText("proton: 96 mails")).toBeTruthy();
    expect(within(deals).queryByText(/icloud/)).toBeNull();
    // biggest first
    expect(rows[0].textContent).toContain("Deals Daily");
  });

  it("carries no grade (grades are per account)", () => {
    mount();
    expect(screen.queryByRole("img", { name: /^Grade / })).toBeNull();
    expect(screen.queryByRole("button", { name: /Grade/ })).toBeNull();
  });

  it("the summary counts what is shown", () => {
    mount();
    expect(sp(document.body.textContent)).toContain("4 groups");
    expect(sp(document.body.textContent)).toContain("542 mails");
  });

  it("the account chip narrows the list to that account's side of each row",
    () => {
    mount();
    const chips = screen.getByRole("group", { name: "Show one account or all" });
    fireEvent.click(within(chips).getByRole("button", { name: "proton" }));
    const rows = dataRows();
    // Chirper and the Boss row have no part in proton
    expect(rows.map((r) => r.textContent!.match(/Deals Daily|Gadget Weekly|Chirper|The Boss/)![0]))
      .toEqual(["Gadget Weekly", "Deals Daily"]);
    expect(sp(rowOf("Deals Daily").textContent)).toContain("96");
    expect(sp(rowOf("Deals Daily").textContent)).not.toContain("306");
    fireEvent.click(within(chips).getByRole("button", { name: "All" }));
    expect(dataRows()).toHaveLength(4);
  });

  it("the filter box filters the union (the same words as one account)", () => {
    mount();
    fireEvent.change(screen.getByPlaceholderText(/Search or filter/),
      { target: { value: "from:news@gadgetweekly.example" } });
    expect(dataRows()).toHaveLength(1);
    expect(rowOf("Gadget Weekly")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Search or filter/),
      { target: { value: "is:protected" } });
    expect(dataRows().map((r) => r.textContent))
      .toEqual([expect.stringContaining("The Boss")]);
    fireEvent.change(screen.getByPlaceholderText(/Search or filter/),
      { target: { value: "nothing-matches" } });
    expect(screen.getByText("No groups match this filter")).toBeTruthy();
  });

  it("sorts across accounts: by name, and by the clicked column", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Senders" }));
    const names = dataRows()
      .map((r) => r.textContent!.match(/Deals Daily|Gadget Weekly|Chirper|The Boss/)![0]);
    expect(names).toEqual(["Chirper", "Deals Daily", "Gadget Weekly", "The Boss"]);
  });

  it("has no grade sort option", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Sort:/ }));
    expect(screen.queryByText(/grade/i)).toBeNull();
  });

  it("an unread read, a failed read and no data", () => {
    mount({ failed: true }, null);
    expect(screen.getByText("Couldn't load these numbers.")).toBeTruthy();
    cleanup();
    const h = mount({ failed: true }, null);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(h.onRetry).toHaveBeenCalled();
    cleanup();
    mount({}, { accounts: [], senders: [] });
    expect(screen.getByText(/Scan your accounts/)).toBeTruthy();
  });
});

describe("a selection acts through the multi-account confirm", () => {
  it("the account chip starts the selection over (a tick would otherwise " +
    "silently shrink to that account's share)", () => {
    mount();
    const chips = screen.getByRole("group", { name: "Show one account or all" });
    tick("Deals Daily");
    expect(sp(bar().textContent)).toContain("306 mails");
    fireEvent.click(within(chips).getByRole("button", { name: "proton" }));
    expect(screen.queryByRole("region", { name: "Selection actions" })).toBeNull();
    expect((within(rowOf("Deals Daily")).getByRole("checkbox") as
      HTMLInputElement).checked).toBe(false);
    fireEvent.click(within(chips).getByRole("button", { name: "All" }));
    expect(screen.queryByRole("region", { name: "Selection actions" })).toBeNull();
  });

  it("Trash: the bar names senders and mails; the confirm lists the accounts; " +
    "one deleteGroups per ticked account; the protected sender stays",
    async () => {
    const h = mount();
    tick("Deals Daily");
    tick("The Boss");
    expect(sp(bar().textContent)).toContain("2 senders · 321 mails");
    press(within(bar()).getByRole("button", { name: /^Trash/ }));
    await screen.findByText(/Move to Trash: 304 mails in 2 accounts\?/);
    const rows = screen.getAllByRole("listitem");
    // gmail holds the protected Boss part: left out. icloud has only that
    // protected sender: listed, nothing to do
    expect(sp(rows[0].textContent)).toContain("gmail");
    expect(sp(rows[0].textContent)).toContain("1 protected left alone");
    expect(sp(rows[1].textContent)).toContain("icloud");
    expect(sp(rows[1].textContent)).toContain("all protected - left alone");
    expect(sp(rows[2].textContent)).toContain("proton");
    expect(sp(rows[2].textContent)).toContain("2 pinned stay");
    press(screen.getByRole("button", { name: /^Move to Trash \(304\)$/ }));
    await screen.findByText("2 done");
    expect(calls.map((c) => [c.fn, c.account])).toEqual([
      ["deleteGroups", "gmail"], ["deleteGroups", "proton"]]);
    expect(del.mock.calls.map((c) => c[1])).toEqual([
      ["deals@dealsdaily.example"], ["deals@dealsdaily.example"]]);
    expect(h.onChanged).toHaveBeenCalled();
  });

  it("Archive and Mark read open the same confirm with their own verb",
    async () => {
    mount();
    tick("Chirper");
    press(within(bar()).getByRole("button", { name: "Archive" }));
    await screen.findByText(/Archive: 40 mails in 1 account\?/);
    expect(screen.getByRole("checkbox", { name: "Archive in gmail" })).toBeTruthy();
    press(screen.getByRole("button", { name: "Cancel" }));
    press(within(bar()).getByRole("button", { name: "Mark read" }));
    await screen.findByText(/Mark as read: 40 mails in 1 account\?/);
  });

  it("nothing runs before the confirm; Cancel runs nothing", async () => {
    mount();
    tick("Chirper");
    press(within(bar()).getByRole("button", { name: /^Trash/ }));
    await screen.findByText(/Move to Trash: 40 mails/);
    expect(calls).toEqual([]);
    press(screen.getByRole("button", { name: "Cancel" }));
    expect(calls).toEqual([]);
    expect(screen.queryByText(/Move to Trash: 40 mails/)).toBeNull();
  });

  it("with the account chip on, only that account is in the confirm",
    async () => {
    mount();
    fireEvent.click(within(screen.getByRole("group",
      { name: "Show one account or all" })).getByRole("button",
      { name: "gmail" }));
    tick("Deals Daily");
    press(within(bar()).getByRole("button", { name: /^Trash/ }));
    await screen.findByText(/Move to Trash: 210 mails in 1 account\?/);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("Unsubscribe works on one sender at a time: off for two, the confirm of " +
    "'Unsubscribe in N…' for one", async () => {
    mount();
    tick("Deals Daily");
    tick("Gadget Weekly");
    expect((within(bar()).getByRole("button", { name: "Unsubscribe" }) as
      HTMLButtonElement).disabled).toBe(true);
    tick("Gadget Weekly");
    press(within(bar()).getByRole("button", { name: "Unsubscribe" }));
    await screen.findByText(/Unsubscribe from Deals Daily in 2 accounts\?/);
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
    expect(calls.map((c) => [c.fn, c.account])).toEqual([
      ["preview", "gmail"], ["preview", "proton"]]);
  });

  it("a selection only covers what is on screen: a filter drops the rest",
    () => {
    mount();
    tick("Deals Daily");
    tick("Chirper");
    fireEvent.change(screen.getByPlaceholderText(/Search or filter/),
      { target: { value: "chirper" } });
    expect(sp(bar().textContent)).toContain("1 sender · 40 mails");
  });

  it("no keyboard shortcut acts on anything", () => {
    mount();
    tick("Deals Daily");
    for (const key of ["j", "#", "x", "Enter", "#", "k", "e", "Delete"]) {
      fireEvent.keyDown(window, { key });
      fireEvent.keyDown(document.body, { key });
    }
    expect(calls).toEqual([]);
    expect(screen.queryAllByRole("dialog")).toHaveLength(0);
  });
});

describe("the detail", () => {
  const open = (label: string) => fireEvent.click(
    within(rowOf(label)).getAllByRole("button", { name: label })[0]);

  it("lists every account the sender is in, each with its own numbers and " +
    "its own grade", () => {
    mount();
    open("Deals Daily");
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).getByText("In 2 accounts")).toBeTruthy();
    const parts = within(dlg).getAllByRole("listitem");
    expect(parts).toHaveLength(2);
    expect(sp(parts[0].textContent)).toContain("gmail");
    expect(sp(parts[0].textContent)).toContain("210 mails");
    expect(sp(parts[1].textContent)).toContain("proton");
    expect(sp(parts[1].textContent)).toContain("2 mails protected");
    expect(within(parts[0]).getByRole("img", { name: "Grade C" })).toBeTruthy();
  });

  it("'Open in <account>' hands the account and the sender over", () => {
    const h = mount();
    open("Deals Daily");
    fireEvent.click(screen.getByRole("button", { name: "Open in proton" }));
    expect(h.onOpenIn).toHaveBeenCalledWith("proton", "deals@dealsdaily.example");
  });

  it("'Show the mails' goes to All mail for that sender", () => {
    const h = mount();
    open("Deals Daily");
    fireEvent.click(screen.getByRole("button", { name: "Show the mails" }));
    expect(h.onShowMails).toHaveBeenCalledWith("deals@dealsdaily.example");
  });

  it("'Move N mails to Trash' is the same confirm, for this sender only; " +
    "pinned mails are not counted", async () => {
    mount();
    open("Deals Daily");
    press(screen.getByRole("button", { name: /^Move 304.mails to Trash$/ }));
    await screen.findByText(/Move to Trash: 304 mails in 2 accounts\?/);
  });

  it("'Unsubscribe in 2…' opens the multi-account unsubscribe", async () => {
    mount();
    open("Deals Daily");
    press(screen.getByRole("button", { name: "Unsubscribe in 2…" }));
    await screen.findByText(/Unsubscribe from Deals Daily in 2 accounts\?/);
  });

  it("a protected sender cannot be moved to Trash from here", () => {
    mount({}, { ...SENDERS_RESP, senders: [sender("k@boss.example", "The Boss",
      [["gmail", 12, { protected: true }]])] });
    open("The Boss");
    expect((screen.getByRole("button", { name: /^Move 0.mails to Trash$/ }) as
      HTMLButtonElement).disabled).toBe(true);
  });
});

describe("phone and German", () => {
  it("phone: a Senders | All mails switch, and a Select button", () => {
    const h = mount({ phone: true });
    const tabs = screen.getByRole("tablist", { name: "Group by" });
    expect(within(tabs).getByRole("tab", { name: "Senders" })
      .getAttribute("aria-selected")).toBe("true");
    fireEvent.click(within(tabs).getByRole("tab", { name: "All mails" }));
    expect(h.onPage).toHaveBeenCalledWith("all");
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0);
  });

  it("German: the bar and the confirm", async () => {
    setLang("de");
    mount();
    tick("Chirper");
    expect(sp(bar().textContent)).toContain("1 Absender · 40 Mails");
    press(within(bar()).getByRole("button", { name: /^Papierkorb/ }));
    await screen.findByText(/In den Papierkorb: 40 Mails in 1 Konto\?/);
    expect(screen.getByRole("checkbox",
      { name: "In den Papierkorb in gmail" })).toBeTruthy();
  });
});

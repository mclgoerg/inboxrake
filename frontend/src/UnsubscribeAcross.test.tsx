// @vitest-environment jsdom
/* "Unsubscribe in N…": the multi-account confirm. Every account has its own
 * checkbox, address and method; one step runs per ticked account, each pinned
 * to its account; nothing runs for an unticked one; a failed account does not
 * stop the others; the Trash step is off until ticked and follows a DONE
 * unsubscribe only. (api mocked; no mail is sent.) */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountGuard, noteAccountSwitch } from "./accountGuard";
import { row } from "./allAccountsFixtures";
import { setLang } from "./i18n";
import type { UnsubPreview } from "./types";

/** Every mocked call records the account it was pinned to (`inAccount`). */
const calls: { fn: string; account: string; args: unknown[] }[] = [];
const preview = vi.fn();
const unsub = vi.fn();
const del = vi.fn();
const ack = vi.fn();
const confirmTrash = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  const at = () => /account=([^&]*)/.exec(actual.withAccount("/x"))?.[1] ?? "";
  const rec = (fn: string, f: (...a: any[]) => unknown) =>
    (...args: unknown[]) => {
      calls.push({ fn, account: decodeURIComponent(at()), args });
      return f(...args);
    };
  return { ...actual, api: {
    unsubscribePreview: rec("preview", (...a) => preview(...a)),
    unsubscribe: rec("unsubscribe", (...a) => unsub(...a)),
    deleteGroups: rec("delete", (...a) => del(...a)),
    unsubscribeAck: rec("ack", (...a) => ack(...a)),
  } };
});
vi.mock("./keepsafe", () => ({
  KEEP_SAFE_MIN: 20,
  confirmTrash: (...a: unknown[]) => confirmTrash(...a),
}));

import { UnsubscribeAcross } from "./components/UnsubscribeAcross";
import { DialogProvider, ToastProvider } from "./components/ui";

const SENDER = (addr: string, via: string) => ({ addr, name: "Deals Daily",
  via, mails: 10, size: 1000 });
const prev = (addr: string, via: string, trashMails: number): UnsubPreview => ({
  senders: [SENDER(addr, via)] as UnsubPreview["senders"],
  skipped_protected: 0, skipped_done: 0, capped: 0, skipped_no_header: 0,
  trash: { groups: trashMails ? [{ key: addr, addrs: [addr],
    mails: trashMails, size: 1000 }] : [], mails: trashMails, size: 1000,
    pinned: 0 } });

const ROW = row("dealsdaily.example", "Deals Daily", [
  ["gmail", 210], ["proton", 96],
  ["gmx", 44, { addr: "promo@dealsdaily.example" }]]);

const sp = (s: string): string => s.replace(/\u00a0/g, " ");
const txt = (el: Element): string => sp(el.textContent ?? "");

const props = (over: Partial<Parameters<typeof UnsubscribeAcross>[0]> = {}) => ({
  row: ROW, demo: false, exists: () => true,
  onOpenActivity: vi.fn(), onChanged: vi.fn(), onClose: vi.fn(), ...over });
const mount = (over = {}) => {
  const p = props(over);
  render(<ToastProvider><DialogProvider>
    <UnsubscribeAcross {...p} /></DialogProvider></ToastProvider>);
  return p;
};
const confirmBtn = (name: RegExp) =>
  screen.getByRole("button", { name });
// a tap in the first half second is ignored (a double tap must not confirm
// unseen); a keyboard activation (detail 0) is exempt
const press = (btn: HTMLElement) => fireEvent.click(btn, { detail: 0 });
const lines = () => screen.getAllByRole("checkbox");

beforeEach(() => {
  setLang("en");
  calls.length = 0;
  preview.mockReset().mockImplementation(async (_g, keys: string[]) => {
    const addr = keys[0];
    return addr.startsWith("promo") ? prev(addr, "http", 44)
      : prev(addr, "one_click", addr === "deals@dealsdaily.example"
        && calls.at(-1)?.account === "gmail" ? 210 : 96);
  });
  unsub.mockReset().mockImplementation(async (_g, key: string) => ({
    action: key.startsWith("promo") ? "link" : "done", method: "x",
    detail: key.startsWith("promo") ? "https://dealsdaily.example/page" : "",
    addr: key, via: "one_click" }));
  del.mockReset().mockResolvedValue({ ok: true, queued: 5, skipped: 0 });
  ack.mockReset().mockResolvedValue({ status: "done" });
  confirmTrash.mockReset().mockResolvedValue({ ok: true, pinned: [] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("review", () => {
  it("lists every account with its own checkbox, address, method and count",
    async () => {
    mount();
    await screen.findByText(/Unsubscribe from Deals Daily in 3\saccounts\?/);
    const boxes = lines();
    expect(boxes).toHaveLength(4);     // three accounts + the Trash box
    const rows = screen.getAllByRole("listitem");
    expect(txt(rows[0])).toContain("gmail");
    expect(txt(rows[0])).toContain("deals@dealsdaily.example · one-click");
    expect(txt(rows[0])).toContain("210 mails");
    expect(txt(rows[2])).toContain("promo@dealsdaily.example · opens a page");
    expect(txt(rows[2])).toContain("44 mails");
    expect(screen.getByRole("checkbox", { name: "Unsubscribe in gmail" }))
      .toBeTruthy();
    expect(screen.getByText(
      "Each account runs its own step, with its own Undo and Activity entry."))
      .toBeTruthy();
  });

  it("asks each account for its own preview, pinned to it - nothing is sent",
    async () => {
    mount();
    await screen.findByRole("checkbox", { name: "Unsubscribe in gmail" });
    expect(calls.map((c) => [c.fn, c.account])).toEqual([
      ["preview", "gmail"], ["preview", "proton"], ["preview", "gmx"]]);
    expect(unsub).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    // the address of THAT account is asked about, as one single sender
    // (bulk preview: it also reports what is protected right now)
    expect(preview.mock.calls[2]).toEqual(
      ["sender", ["promo@dealsdaily.example"]]);
  });

  it("an account with no link, or already unsubscribed, is listed but " +
    "cannot be ticked", async () => {
    mount({ row: row("dealsdaily.example", "Deals Daily", [
      ["gmail", 210], ["proton", 96, { state: "done" }],
      ["gmx", 44, { unsub: false }]]) });
    await screen.findByRole("checkbox", { name: "Unsubscribe in gmail" });
    const proton = screen.getByRole("checkbox",
      { name: "Unsubscribe in proton" }) as HTMLInputElement;
    const gmx = screen.getByRole("checkbox",
      { name: "Unsubscribe in gmx" }) as HTMLInputElement;
    expect([proton.disabled, proton.checked]).toEqual([true, false]);
    expect([gmx.disabled, gmx.checked]).toEqual([true, false]);
    expect(screen.getByText("already unsubscribed")).toBeTruthy();
    expect(screen.getByText("no unsubscribe link here")).toBeTruthy();
    expect(confirmBtn(/^Unsubscribe in 1$/)).toBeTruthy();
    expect(calls.filter((c) => c.fn === "preview")
      .map((c) => c.account)).toEqual(["gmail"]);
  });

  it("the title counts the accounts the button can still reach", async () => {
    mount({ row: row("dealsdaily.example", "Deals Daily", [
      ["gmail", 210], ["proton", 96, { state: "done" }],
      ["gmx", 44, { unsub: false }]]) });
    await screen.findByText(/Unsubscribe from Deals Daily in 1\saccount\?/);
    expect(confirmBtn(/^Unsubscribe in 1$/)).toBeTruthy();
  });

  it("a sender protected after the Overview was drawn is listed, unticked " +
    "and disabled - and never unsubscribed", async () => {
    preview.mockReset().mockImplementation(async (_g, keys: string[]) =>
      calls.at(-1)?.account === "proton"
        ? { ...prev(keys[0], "one_click", 0), senders: [],
          skipped_protected: 1 }
        : prev(keys[0], "one_click", 10));
    mount();
    await screen.findByText("protected sender - left alone");
    const proton = screen.getByRole("checkbox",
      { name: "Unsubscribe in proton" }) as HTMLInputElement;
    expect([proton.disabled, proton.checked]).toEqual([true, false]);
    expect(txt(screen.getAllByRole("listitem")[1])).toContain("proton");
    expect(confirmBtn(/^Unsubscribe in 2$/)).toBeTruthy();
    calls.length = 0;
    press(confirmBtn(/^Unsubscribe in 2$/));
    await screen.findByText("1 done · 1 needs you");
    expect(calls.map((c) => c.account)).toEqual(["gmail", "gmx"]);
    // the step itself asks the server to refuse a protected sender too
    expect(unsub.mock.calls.map((c) => c[2])).toEqual([true, true]);
  });

  it("a sender protected while the dialog is open: the server refuses, " +
    "the account is reported, the others run", async () => {
    mount();
    await screen.findByRole("checkbox", { name: "Unsubscribe in gmail" });
    unsub.mockImplementation(async (_g, key: string) => {
      if (calls.at(-1)?.account === "proton") {
        throw new Error("unsub_protected");
      }
      return { action: "done", method: "x", detail: "", addr: key,
        via: "one_click" };
    });
    press(confirmBtn(/^Unsubscribe in 3$/));
    await screen.findByText("2 done · 1 failed");
    expect(txt(screen.getAllByRole("listitem")[1])).toContain(
      "This sender is protected, so it was not unsubscribed.");
  });

  it("a preview that fails blocks only that account", async () => {
    preview.mockReset().mockImplementation(async (_g, keys: string[]) => {
      if (keys[0].startsWith("promo")) throw new Error("no header");
      return prev(keys[0], "one_click", 10);
    });
    mount();
    await screen.findByRole("checkbox", { name: "Unsubscribe in gmail" });
    expect((screen.getByRole("checkbox",
      { name: "Unsubscribe in gmx" }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Couldn't check gmx: no header")).toBeTruthy();
    expect(confirmBtn(/^Unsubscribe in 2$/)).toBeTruthy();
  });
});

describe("running", () => {
  const ready = async () => {
    const p = mount();
    await screen.findByRole("checkbox", { name: "Unsubscribe in gmail" });
    return p;
  };

  it("one step per ticked account, in order, each pinned to its account",
    async () => {
    await ready();
    calls.length = 0;
    press(confirmBtn(/^Unsubscribe in 3$/));
    await screen.findByText("2 done · 1 needs you");
    expect(calls.map((c) => [c.fn, c.account])).toEqual([
      ["unsubscribe", "gmail"], ["unsubscribe", "proton"],
      ["unsubscribe", "gmx"]]);
    expect(unsub.mock.calls.map((c) => c[1])).toEqual([
      "deals@dealsdaily.example", "deals@dealsdaily.example",
      "promo@dealsdaily.example"]);
    // nothing was moved: the Trash box was not ticked
    expect(del).not.toHaveBeenCalled();
    const result = screen.getAllByRole("listitem");
    expect(txt(result[0])).toContain("Unsubscribed");
    expect(txt(result[2])).toContain("Confirm on their page");
  });

  it("an unticked account is never called", async () => {
    await ready();
    calls.length = 0;
    fireEvent.click(screen.getByRole("checkbox",
      { name: "Unsubscribe in proton" }));
    press(confirmBtn(/^Unsubscribe in 2$/));
    await screen.findByText("1 done · 1 needs you");
    expect(calls.map((c) => c.account)).toEqual(["gmail", "gmx"]);
    expect(calls.some((c) => c.account === "proton")).toBe(false);
  });

  it("nothing can be confirmed with no account ticked", async () => {
    await ready();
    for (const a of ["gmail", "proton", "gmx"]) {
      fireEvent.click(screen.getByRole("checkbox",
        { name: `Unsubscribe in ${a}` }));
    }
    expect((confirmBtn(/^Unsubscribe in 0$/) as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it("a failed account is reported and does not stop the others", async () => {
    await ready();
    unsub.mockImplementation(async (_g, key: string, ) => {
      if (calls.at(-1)?.account === "proton") throw new Error("server said no");
      return { action: "done", method: "x", detail: "", addr: key,
        via: "one_click" };
    });
    press(confirmBtn(/^Unsubscribe in 3$/));
    await screen.findByText("2 done · 1 failed");
    const rows = screen.getAllByRole("listitem");
    expect(txt(rows[1])).toContain("proton");
    expect(txt(rows[1])).toContain("Failed: server said no");
    expect(txt(rows[0])).toContain("Unsubscribed");
    expect(txt(rows[2])).toContain("Unsubscribed");
    expect(unsub).toHaveBeenCalledTimes(3);
  });

  it("the Trash step is off until ticked; ticking makes it the danger confirm",
    async () => {
    await ready();
    const box = screen.getByRole("checkbox", { name: /Also move the .*\smails to Trash/ }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.getAttribute("aria-label")).toBeNull();
    expect(txt(box.closest("label")!)).toMatch(/Also move the 350\smails to Trash/);
    expect(screen.queryByText(/after its unsubscribe is done/)).toBeNull();
    const plain = confirmBtn(/^Unsubscribe in 3$/);
    expect(plain.className).not.toContain("danger");
    fireEvent.click(box);
    const danger = screen.getByRole("button",
      { name: /Unsubscribe in 3 and move .* to Trash/ });
    expect(sp(danger.textContent ?? "")).toMatch(
      /^Unsubscribe in 3 and move 350\smails to Trash$/);
    expect(danger.className).toContain("bg-danger");
    expect(screen.getByText(/after its unsubscribe is done/)).toBeTruthy();
  });

  it("ticked, each account moves its own sender's mails after ITS " +
    "unsubscribe is done - never after a page-only or failed one", async () => {
    await ready();
    calls.length = 0;
    fireEvent.click(screen.getByRole("checkbox",
      { name: /Also move the .*\smails to Trash/ }));
    press(screen.getByRole("button", { name: /Unsubscribe in 3 and move/ }));
    await screen.findByText("2 done · 1 needs you");
    expect(calls.map((c) => [c.fn, c.account])).toEqual([
      ["unsubscribe", "gmail"], ["delete", "gmail"],
      ["unsubscribe", "proton"], ["delete", "proton"],
      ["unsubscribe", "gmx"]]);              // gmx only opened a page
    // exact addresses + the sender group, the ordinary reversible move
    expect(del.mock.calls[0]).toEqual(["sender", ["deals@dealsdaily.example"],
      "trash", "", false, null, null, ["deals@dealsdaily.example"]]);
    // the result says what moved, and where its Undo is
    const rows = screen.getAllByRole("listitem");
    expect(txt(rows[0])).toContain("5 mails moved to Trash");
    expect(txt(rows[0])).toContain("Undo is in this account's Activity.");
    expect(txt(rows[2])).not.toContain("moved to Trash");
  });

  it("a Trash move that fails is said; the unsubscribe stays done", async () => {
    await ready();
    del.mockRejectedValue(new Error("busy"));
    fireEvent.click(screen.getByRole("checkbox",
      { name: /Also move the .*\smails to Trash/ }));
    press(screen.getByRole("button", { name: /Unsubscribe in 3 and move/ }));
    await screen.findByText("2 done · 1 needs you");
    expect(txt(screen.getAllByRole("listitem")[0]))
      .toContain("the move to Trash failed");
  });

  it("a big move asks the keep-safe check per account; declining runs " +
    "nothing", async () => {
    preview.mockReset().mockImplementation(async (_g, keys: string[]) =>
      prev(keys[0], "one_click", keys[0].startsWith("promo") ? 5 : 150));
    await ready();
    calls.length = 0;
    confirmTrash.mockResolvedValue({ ok: false });
    fireEvent.click(screen.getByRole("checkbox",
      { name: /Also move the .*\smails to Trash/ }));
    press(screen.getByRole("button", { name: /Unsubscribe in 3 and move/ }));
    await waitFor(() => expect(confirmTrash).toHaveBeenCalledTimes(1));
    expect(confirmTrash.mock.calls[0][0]).toMatchObject({ account: "gmail",
      onlyIfFound: true, n: 150 });
    expect(unsub).not.toHaveBeenCalled();
    // still reviewable: the dialog did not close or run
    expect(screen.getByRole("button", { name: /Unsubscribe in 3 and move/ }))
      .toBeTruthy();
    // small moves (the third account's 5 mails) are not checked
    confirmTrash.mockResolvedValue({ ok: true, pinned: [] });
    press(screen.getByRole("button", { name: /Unsubscribe in 3 and move/ }));
    await screen.findByText(/done/);
    expect(confirmTrash.mock.calls.map((c) => c[0].account))
      .toEqual(["gmail", "gmail", "proton"]);
  });

  it("a keep-safe check that throws goes back to the review with the " +
    "problem - nothing ran, no result is listed", async () => {
    preview.mockReset().mockImplementation(async (_g, keys: string[]) =>
      prev(keys[0], "one_click", 150));
    await ready();
    calls.length = 0;
    confirmTrash.mockRejectedValue(new Error("connection lost"));
    fireEvent.click(screen.getByRole("checkbox",
      { name: /Also move the .*\smails to Trash/ }));
    press(screen.getByRole("button", { name: /Unsubscribe in 3 and move/ }));
    const alert = await screen.findByRole("alert");
    expect(txt(alert)).toContain("Couldn't check gmail:");
    expect(unsub).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.fn !== "preview")).toEqual([]);
    expect(screen.getByRole("button", { name: /Unsubscribe in 3 and move/ }))
      .toBeTruthy();
    expect(screen.queryByText(/not run/)).toBeNull();
    // the next try starts from a clean slate
    confirmTrash.mockResolvedValue({ ok: true, pinned: [] });
    press(screen.getByRole("button", { name: /Unsubscribe in 3 and move/ }));
    await screen.findByText(/done/);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Esc and the backdrop do nothing while it runs: every account's " +
    "outcome still ends up in the result", async () => {
    const p = await ready();
    let release: () => void = () => {};
    unsub.mockImplementation((_g, key: string) => new Promise((res) => {
      release = () => res({ action: "done", method: "x", detail: "",
        addr: key, via: "one_click" });
    }));
    press(confirmBtn(/^Unsubscribe in 3$/));
    await screen.findByText(/Working on gmail/);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(p.onClose).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
      .disabled).toBe(true);
    for (let i = 0; i < 3; i++) {
      await waitFor(() => expect(unsub).toHaveBeenCalledTimes(i + 1));
      release();
    }
    await screen.findByText("3 done");
    expect(p.onClose).not.toHaveBeenCalled();
    // finished: Esc closes it again
    fireEvent.keyDown(document, { key: "Escape" });
    expect(p.onClose).toHaveBeenCalled();
  });

  it("an account that disappears while the confirm is open is skipped, " +
    "never acted on", async () => {
    let list = ["gmail", "proton", "gmx"];
    await (async () => {
      cleanup();
      mount({ exists: (a: string) => list.includes(a) });
      await screen.findByRole("checkbox", { name: "Unsubscribe in gmail" });
    })();
    calls.length = 0;
    list = ["gmail", "gmx"];                       // proton removed meanwhile
    press(confirmBtn(/^Unsubscribe in 3$/));
    await screen.findByText("1 done · 1 needs you · 1 not run");
    expect(calls.map((c) => c.account)).toEqual(["gmail", "gmx"]);
    const rows = screen.getAllByRole("listitem");
    expect(txt(rows[1])).toContain("This account is no longer there");
    expect(txt(rows[1])).toContain("Not run");
  });

  it("leaving the view mid-run stands the remaining accounts down", async () => {
    await ready();
    calls.length = 0;
    unsub.mockImplementation(async (_g, key: string) => {
      noteAccountSwitch();                    // the user switched away
      return { action: "done", method: "x", detail: "", addr: key,
        via: "one_click" };
    });
    press(confirmBtn(/^Unsubscribe in 3$/));
    await screen.findByText("1 done · 2 not run");
    expect(calls.map((c) => c.account)).toEqual(["gmail"]);
    expect(accountGuard()()).toBe(false);
  });

  it("a page-only account: open the page, or mark it done", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const p = await ready();
    press(confirmBtn(/^Unsubscribe in 3$/));
    await screen.findByText("2 done · 1 needs you");
    fireEvent.click(screen.getByRole("button", { name: "Open page" }));
    expect(open).toHaveBeenCalledWith("https://dealsdaily.example/page",
      "_blank", "noopener");
    calls.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Mark as done" }));
    await screen.findByText("Marked as done");
    expect(calls.map((c) => [c.fn, c.account])).toEqual([["ack", "gmx"]]);
    expect(ack).toHaveBeenCalledWith("promo@dealsdaily.example");
    expect(p.onChanged).toHaveBeenCalled();
  });

  it("Open Activity closes the confirm and names the account", async () => {
    const p = await ready();
    fireEvent.click(screen.getByRole("checkbox",
      { name: /Also move the .*\smails to Trash/ }));
    press(screen.getByRole("button", { name: /Unsubscribe in 3 and move/ }));
    await screen.findByText("2 done · 1 needs you");
    const first = screen.getAllByRole("listitem")[0];
    fireEvent.click(within(first).getByRole("button", { name: "Open Activity" }));
    expect(p.onClose).toHaveBeenCalled();
    expect(p.onOpenActivity).toHaveBeenCalledWith("gmail");
  });

  it("the numbers are fetched again when it is done", async () => {
    const p = await ready();
    press(confirmBtn(/^Unsubscribe in 3$/));
    await screen.findByText("2 done · 1 needs you");
    expect(p.onChanged).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(p.onClose).toHaveBeenCalled();
  });
});

describe("German", () => {
  it("the dialog speaks German with the plural forms", async () => {
    setLang("de");
    mount({ row: row("dealsdaily.example", "Deals Daily",
      [["gmail", 210], ["proton", 96]]) });
    await screen.findByText(/Deals Daily in 2\sKonten abbestellen\?/);
    expect(screen.getByRole("button", { name: /^In 2.Konten abbestellen$/ })).toBeTruthy();
    expect(screen.getByText(/Jedes Konto führt seinen eigenen Schritt aus/))
      .toBeTruthy();
    expect(screen.getByRole("checkbox",
      { name: "In gmail abbestellen" })).toBeTruthy();
  });

  it("one account: the singular title", async () => {
    mount({ row: row("dealsdaily.example", "Deals Daily", [["gmail", 3]]) });
    await screen.findByText(/Unsubscribe from Deals Daily in 1\saccount\?/);
  });
});

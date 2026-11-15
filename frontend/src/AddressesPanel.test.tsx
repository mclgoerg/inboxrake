// @vitest-environment jsdom
/* Insights -> Your addresses: the list (phone layout and the wide list + pane),
 * the leaked address's card / pane (story, strangers), the actions with their
 * confirms (Retire, Strangers to Junk, Block, Not a leak, Turn back on), the
 * hand-over when no alias service is connected, the empty states and German. */

import { cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AddressesPanel } from "./components/AddressesPanel";
import { DialogProvider, ToastProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog }
  from "./dialogTestUtils";
import { setLang } from "./i18n";
import { DE } from "./locales/de";
import { EN } from "./locales/en";
import type { AddressReport, AddressRow } from "./types";

const addresses = vi.fn();
const retireAddress = vi.fn();
const restoreAddress = vi.fn();
const strangersToJunk = vi.fn();
const notALeak = vi.fn();
const block = vi.fn();
const clearNotice = vi.fn().mockResolvedValue({ ok: true });

vi.mock("./api", () => ({
  api: {
    addresses: () => addresses(),
    retireAddress: (...a: unknown[]) => retireAddress(...a),
    restoreAddress: (...a: unknown[]) => restoreAddress(...a),
    addressStrangersToJunk: (...a: unknown[]) => strangersToJunk(...a),
    addressNotALeak: (...a: unknown[]) => notALeak(...a),
    block: (...a: unknown[]) => block(...a),
    clearNotice: (...a: unknown[]) => clearNotice(...a),
  },
}));

/** A text with the no-break spaces the locale uses between a number and its
 *  unit (`{n}\u00a0mails`): any whitespace matches. */
const rx = (text: string, flags = "") => new RegExp(
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s"), flags);

const DAY = 86400;
const NOW = Math.floor(Date.now() / 1000);
const ALIAS = "acme.x7k2@alias.example";

const leaked = (over: Partial<AddressRow> = {}): AddressRow => ({
  address: ALIAS, kind: "alias", tag: "", mails: 312, senders: 5,
  first_ts: NOW - 540 * DAY, last_ts: NOW - DAY,
  given_to: { name: "ACME Store", addr: "shop@acme.example",
    ts: NOW - 540 * DAY, subject: "Welcome to ACME" },
  leak: {
    quiet_days: 550, quiet_mails: 295,
    first_stranger: { ts: NOW - 60 * DAY, party: "win-big.example",
      name: "Prize Center", addr: "prizes@win-big.example" },
    followed: 3, stranger_mails: 37, dmarc_failed: null,
    strangers: [
      { party: "win-big.example", name: "Prize Center",
        addr: "prizes@win-big.example", addrs: ["prizes@win-big.example"], addr_total: 1,
        to_block: ["prizes@win-big.example"],
        mails: 17, protected: false, blocked: false },
      { party: "loanquick.example", name: "Loan Quick",
        addr: "offer@loanquick.example", addrs: ["offer@loanquick.example",
          "news@loanquick.example"], addr_total: 2,
        to_block: ["offer@loanquick.example", "news@loanquick.example"],
        mails: 9, protected: false, blocked: false },
      { party: "pills.example", name: "Pharma Shop",
        addr: "sale@pills.example", addrs: ["sale@pills.example"], addr_total: 1,
        to_block: [], mails: 4, protected: true, blocked: false },
      { party: "crypto.example", name: "Crypto Daily",
        addr: "hi@crypto.example", addrs: ["hi@crypto.example"], addr_total: 1,
        to_block: [], mails: 7, protected: false, blocked: true },
    ],
  },
  retired: false, retired_ts: 0, status: "leaked", ...over,
});
const main: AddressRow = {
  address: "demo@example.com", kind: "main", tag: "", mails: 1204,
  senders: 131, first_ts: NOW - 2000 * DAY, last_ts: NOW, given_to: null,
  leak: null, retired: false, retired_ts: 0, status: "" };
const tagged: AddressRow = {
  ...main, address: "demo+news@example.com", kind: "tag", tag: "news",
  mails: 641, senders: 9, status: "clean" };
const fwd: AddressRow = {
  ...main, address: "old.demo@oldmail.example", kind: "other", mails: 88,
  senders: 23, status: "last_seen", days_ago: 3 };

const report = (over: Partial<AddressReport> = {},
    rows: AddressRow[] = [leaked(), main, tagged, fwd]): AddressReport => ({
  scanned: true, main: "demo@example.com", mails: 2000, read: 2000,
  total: rows.length, leaked: rows.filter((r) => r.status === "leaked"
    && !r.retired).length, addresses: rows,
  service: { service: "simplelogin", key_set: true, aliases: 142,
    synced_ts: NOW, error: "", services: ["simplelogin", "addy"],
    connected: true },
  ...over });

const onClose = vi.fn();
const onChanged = vi.fn();
const onSettings = vi.fn();
const onLeaked = vi.fn();
const show = () => render(<ToastProvider><DialogProvider>
  <AddressesPanel account="proton" rev={1} onClose={onClose}
    onChanged={onChanged} onOpenAliasSettings={onSettings}
    onLeaked={onLeaked} />
</DialogProvider></ToastProvider>);

/** The wide layout: the list with its pane beside it (>= 1280 px). */
const wide = () => vi.stubGlobal("matchMedia", (q: string) => ({
  matches: q === "(min-width: 1280px)", media: q,
  addEventListener: () => {}, removeEventListener: () => {},
  addListener: () => {}, removeListener: () => {} }));

beforeEach(() => {
  setLang("en");
  addresses.mockResolvedValue(report());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const m of [addresses, retireAddress, restoreAddress, strangersToJunk,
    notALeak, block, clearNotice, onClose, onChanged, onSettings, onLeaked]) m.mockReset();
  setLang("en");
});

/* ------------------------------ phone layout ------------------------------ */

test("phone: the leaked address is a card on top, the list has every address",
  async () => {
    show();
    const card = await screen.findByRole("region",
      { name: `${ALIAS} looks leaked` });
    expect(within(card).getByText(`${ALIAS} leaked`)).toBeTruthy();
    expect(within(card).getByText(new RegExp(rx("Given to ACME Store only. 4 strangers have used it since ").source + ".* · " + rx("37 mails.").source)))
      .toBeTruthy();
    expect(within(card).getByRole("button", { name: "Retire alias…" })).toBeTruthy();
    expect(screen.getByText(rx("4 addresses received mail · 1 looks leaked")))
      .toBeTruthy();
    // every address of the report, with the sub line of its kind
    for (const a of [ALIAS, "demo@example.com", "demo+news@example.com",
      "old.demo@oldmail.example"]) {
      expect(screen.getAllByText(a).length).toBeGreaterThan(0);
    }
    // the phone row's second line: kind and senders (the leaked one: strangers)
    expect(screen.getByText(rx("+ tag · 9 senders"))).toBeTruthy();
    expect(screen.getByText(rx("Forwarded · 23 senders"))).toBeTruthy();
    expect(screen.getByText(rx("Main address · 131 senders"))).toBeTruthy();
    expect(screen.getByText(/^4\sstrangers since /)).toBeTruthy();
    expect(onLeaked).toHaveBeenCalledWith(1);
  });

test("phone: See strangers opens the address as a page, Back returns", async () => {
  show();
  fireEvent.click(await screen.findByRole("button", { name: "See strangers" }));
  expect(await screen.findByText("This address got out.")).toBeTruthy();
  // the story as a timeline
  expect(screen.getByText("How it happened")).toBeTruthy();
  expect(screen.getByText(/first mail, from ACME Store/)).toBeTruthy();
  expect(screen.getByText("“Welcome to ACME”")).toBeTruthy();
  expect(screen.getByText(rx("1 year, 6 months"))).toBeTruthy();
  expect(screen.getByText(rx("only ACME Store · 295 mails"))).toBeTruthy();
  expect(screen.getByText(/first stranger: Prize Center/)).toBeTruthy();
  expect(screen.getByText(rx("3 more followed within 2 weeks"))).toBeTruthy();
  // no sender-check data: the DMARC part is left out, not invented
  expect(screen.getByText(rx("37 mails from strangers so far"))).toBeTruthy();
  expect(screen.queryByText(/DMARC/)).toBeNull();
  // the strangers with their counts
  expect(screen.getByText("Strangers on this address")).toBeTruthy();
  expect(screen.getByText("prizes@win-big.example")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Your addresses" }));
  expect(await screen.findByRole("region", { name: `${ALIAS} looks leaked` }))
    .toBeTruthy();
});

test("a row of a clean address opens its facts, not a leak story", async () => {
  show();
  fireEvent.click(await screen.findByText("demo+news@example.com"));
  expect(await screen.findByText(/never counts as leaked/)).toBeTruthy();
  expect(screen.queryByText("How it happened")).toBeNull();
  expect(screen.queryByRole("button", { name: /Retire/ })).toBeNull();
});

/* ------------------------------- wide layout ------------------------------ */

test("wide: the pane shows the leaked address with its story and actions",
  async () => {
    wide();
    show();
    const pane = await screen.findByRole("complementary",
      { name: "Address details" });
    expect(within(pane).getByText("This address got out.")).toBeTruthy();
    expect(within(pane).getByText(new RegExp(rx("You gave it to ACME Store only. Since ").source + ".*" + rx(", 4 other senders write to it.").source)))
      .toBeTruthy();
    expect(within(pane).getByText("Loan Quick")).toBeTruthy();
    expect(within(pane).getByText("Protected")).toBeTruthy();   // the protected one
    expect(within(pane).getByText("Blocked")).toBeTruthy();     // the blocked one
    expect(within(pane).getByRole("button", { name: "Retire this alias…" }))
      .toBeTruthy();
    // 4 strangers - 1 protected - 1 blocked already = 2 to block
    expect(within(pane).getByRole("button", { name: "Block the 2" }))
      .toBeTruthy();
    expect(within(pane).getByRole("button", { name: "ACME Store uses these senders" }))
      .toBeTruthy();
    // the list has the pills the board shows
    expect(screen.getByText(rx("4 strangers"))).toBeTruthy();
    expect(screen.getAllByText("Clean").length).toBeGreaterThan(0);
    expect(screen.getByText(rx("Last 3 days ago"))).toBeTruthy();
    // picking another row changes the pane
    fireEvent.click(screen.getByText("old.demo@oldmail.example"));
    expect(within(pane).getByText("Forwarded to you")).toBeTruthy();
    expect(within(pane).queryByText("This address got out.")).toBeNull();
  });

/* --------------------------------- actions -------------------------------- */

test("Retire: the dialog says what happens, then shows the new alias", async () => {
  wide();
  retireAddress.mockResolvedValue({ ok: true, address: ALIAS,
    new_alias: "acme.m3p8@alias.example",
    junk: { queued: 26, skipped_protected: 4, skipped_pinned: 0 } });
  show();
  fireEvent.click(await screen.findByRole("button",
    { name: "Retire this alias…" }));
  const dlg = await findDialog();
  expect(within(dlg).getByText(`Retire ${ALIAS}?`)).toBeTruthy();
  expect(within(dlg).getByText(/stops forwarding mail sent to it - from strangers and from ACME Store/))
    .toBeTruthy();
  expect(within(dlg).getByText("Mails already here stay where they are."))
    .toBeTruthy();
  // both extras are on; the junk count is what Strangers to Junk would move
  const make = within(dlg).getByRole("checkbox",
    { name: /Make a new alias for ACME Store/ }) as HTMLInputElement;
  const junk = within(dlg).getByRole("checkbox",
    { name: rx("Move the 33 mails from strangers to Junk") }) as HTMLInputElement;
  expect(make.checked && junk.checked).toBe(true);
  // nothing happened yet; Cancel leaves everything as it was
  await cancelDialog();
  await expectNoDialog();
  expect(retireAddress).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retire this alias…" }));
  await pressDialog("Retire alias");
  await waitFor(() => expect(retireAddress)
    .toHaveBeenCalledWith(ALIAS, true, true));
  expect(await screen.findByText(`${ALIAS} is retired`)).toBeTruthy();
  expect(screen.getByText("acme.m3p8@alias.example")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  expect(screen.getByText("Change it in your ACME Store account first."))
    .toBeTruthy();
  expect(screen.getByText(rx("26 mails are being moved to Junk. 4 stayed")))
    .toBeTruthy();
  expect(onChanged).toHaveBeenCalled();
});

test("Retire without the extras sends them off", async () => {
  wide();
  retireAddress.mockResolvedValue({ ok: true, address: ALIAS });
  show();
  fireEvent.click(await screen.findByRole("button",
    { name: "Retire this alias…" }));
  const dlg = await findDialog();
  fireEvent.click(within(dlg).getByRole("checkbox",
    { name: /Make a new alias/ }));
  fireEvent.click(within(dlg).getByRole("checkbox",
    { name: /mails from strangers to Junk/ }));
  await pressDialog("Retire alias");
  await waitFor(() => expect(retireAddress)
    .toHaveBeenCalledWith(ALIAS, false, false));
});

test("Retire shows a refusal and changes nothing in the list", async () => {
  wide();
  retireAddress.mockRejectedValue(new Error("The alias service did not accept the API key."));
  show();
  fireEvent.click(await screen.findByRole("button",
    { name: "Retire this alias…" }));
  await pressDialog("Retire alias");
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByText("The alias service did not accept the API key."))
    .toBeTruthy();
  expect(onChanged).not.toHaveBeenCalled();
});

test("without a connected service Retire explains how to do it by hand",
  async () => {
    wide();
    addresses.mockResolvedValue(report({ service: { service: "", key_set: false,
      aliases: null, synced_ts: 0, error: "", services: [], connected: false } }));
    show();
    fireEvent.click(await screen.findByRole("button",
      { name: "Retire this alias…" }));
    const dlg = await findDialog();
    expect(within(dlg).getByText(`Switch off ${ALIAS} by hand`)).toBeTruthy();
    expect(within(dlg).getByText(/Open your alias service, find this alias/))
      .toBeTruthy();
    expect(retireAddress).not.toHaveBeenCalled();
    await pressDialog("Alias service settings");
    expect(onSettings).toHaveBeenCalledOnce();
  });

test("Strangers to Junk: the confirm names the count, protected stay",
  async () => {
    wide();
    strangersToJunk.mockResolvedValue({ ok: true, queued: 33,
      skipped_protected: 4, skipped_pinned: 0 });
    show();
    fireEvent.click(await screen.findByRole("button",
      { name: "Strangers to Junk" }));
    const dlg = await findDialog();
    // 17 + 9 + 7 = 33; Pharma Shop (4) is protected and not counted
    expect(within(dlg).getByText(rx("Move 33 mails to Junk?"))).toBeTruthy();
    expect(within(dlg).getByText(/Protected senders and pinned mails stay/))
      .toBeTruthy();
    await cancelDialog();
    await expectNoDialog();
    expect(strangersToJunk).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Strangers to Junk" }));
    await pressDialog(rx("Move 33 mails to Junk"));
    await waitFor(() => expect(strangersToJunk).toHaveBeenCalledWith(ALIAS));
    expect(await screen.findByText(rx("33 mails are being moved to Junk.")))
      .toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
  });

test("Block the N: confirm lists the senders, protected and blocked are left",
  async () => {
    wide();
    block.mockResolvedValue({ rule: { id: "r" } });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Block the 2" }));
    const dlg = await findDialog();
    expect(within(dlg).getByText(rx("Block 2 senders?"))).toBeTruthy();
    expect(within(dlg).getByText("Prize Center")).toBeTruthy();
    expect(within(dlg).getByText("Loan Quick")).toBeTruthy();
    expect(within(dlg).queryByText("Pharma Shop")).toBeNull();
    expect(within(dlg).queryByText("Crypto Daily")).toBeNull();
    await cancelDialog();
    await expectNoDialog();
    expect(block).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Block the 2" }));
    await pressDialog("Block");
    // one block rule per sender address of the two parties (3 addresses)
    await waitFor(() => expect(block).toHaveBeenCalledTimes(3));
    expect(block).toHaveBeenCalledWith("sender", "prizes@win-big.example",
      "Prize Center", false);
    expect(block).toHaveBeenCalledWith("sender", "news@loanquick.example",
      "Loan Quick", false);
    expect(await screen.findByText(rx("Blocked 2 senders."))).toBeTruthy();
  });

test("Not a leak marks the strangers as related, Undo puts the marks back",
  async () => {
    wide();
    notALeak.mockResolvedValue({ ok: true, previous: ["old.example"] });
    show();
    fireEvent.click(await screen.findByRole("button",
      { name: "ACME Store uses these senders" }));
    await waitFor(() => expect(notALeak).toHaveBeenCalledWith(ALIAS));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(notALeak)
      .toHaveBeenCalledWith(ALIAS, ["old.example"]));
  });

test("a retired alias reads Retired and can be turned back on", async () => {
  wide();
  addresses.mockResolvedValue(report({ leaked: 0 }, [
    leaked({ retired: true, retired_ts: NOW - 5 * DAY }), main]));
  restoreAddress.mockResolvedValue({ ok: true });
  show();
  expect(await screen.findByText("Retired")).toBeTruthy();
  const pane = screen.getByRole("complementary", { name: "Address details" });
  expect(within(pane).getByText(/Retired on .*Your alias service no longer forwards/))
    .toBeTruthy();
  // no leak warning and no second Retire for a retired address
  expect(within(pane).queryByText("This address got out.")).toBeNull();
  expect(within(pane).queryByRole("button", { name: "Retire this alias…" }))
    .toBeNull();
  fireEvent.click(within(pane).getByRole("button", { name: "Turn back on" }));
  await waitFor(() => expect(restoreAddress).toHaveBeenCalledWith(ALIAS));
  expect(await screen.findByText(`${ALIAS} is switched on again.`)).toBeTruthy();
});

test("a catch-all that leaked has no Retire, only the strangers' actions",
  async () => {
    wide();
    addresses.mockResolvedValue(report({}, [
      leaked({ address: "library@home.example", kind: "catchall" }), main]));
    show();
    const pane = await screen.findByRole("complementary",
      { name: "Address details" });
    expect(within(pane).getByText(/can't be switched off from here/)).toBeTruthy();
    expect(within(pane).queryByRole("button", { name: /Retire/ })).toBeNull();
    expect(within(pane).getByRole("button", { name: "Strangers to Junk" }))
      .toBeTruthy();
  });

/* ---------------------------------- states -------------------------------- */

test("states: before the first scan, nothing read yet, nothing found",
  async () => {
    addresses.mockResolvedValue(report({ scanned: false }, []));
    show();
    expect(await screen.findByText(
      "Scan your mailbox to see which addresses received mail.")).toBeTruthy();
    cleanup();
    addresses.mockResolvedValue(report({ read: 0 }, []));
    show();
    expect(await screen.findByText(/first one after the update reads it/))
      .toBeTruthy();
  });

test("the Alias service button opens its settings", async () => {
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Alias service" }));
  expect(onSettings).toHaveBeenCalledOnce();
});

test("a failed load shows the error", async () => {
  addresses.mockRejectedValue(new Error("boom"));
  show();
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByText("boom")).toBeTruthy();
});

test("German: du, translated pills and sub lines", async () => {
  setLang("de");
  wide();
  show();
  expect(await screen.findByText("Deine Adressen", { selector: "span" }))
    .toBeTruthy();
  expect(screen.getByText(rx("4 Fremde"))).toBeTruthy();
  expect(screen.getByText("Diese Adresse ist durchgesickert.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Diesen Alias stilllegen…" }))
    .toBeTruthy();
  expect(screen.getByText("Weitergeleitet", { selector: "span" })).toBeTruthy();
  expect(screen.getByText(rx("An dich weitergeleitet · 23 Absender")))
    .toBeTruthy();
  expect(screen.getByText(rx("1 Jahr, 6 Monate"))).toBeTruthy();
});

test("every addr.* and alias.* text exists in English and German", () => {
  const keys = (d: Record<string, string>) => Object.keys(d)
    .filter((k) => /^(addr|alias)\./.test(k) || k.startsWith("tab.addr_")
      || k === "settings.sec.alias" || k.startsWith("audit.h.alias_")
      || k.startsWith("audit.act.alias_") || k.startsWith("ferr.alias_"));
  expect(keys(DE).sort()).toEqual(keys(EN).sort());
  expect(keys(EN).length).toBeGreaterThan(80);
});

/* ------------------------------ review round ------------------------------ */

test("an iCloud / Relay alias: Retire explains its own settings, no service step",
  async () => {
    wide();
    for (const via of ["icloud", "relay"] as const) {
      addresses.mockResolvedValue(report({}, [leaked({ via }), main]));
      show();
      fireEvent.click(await screen.findByRole("button",
        { name: "Retire this alias…" }));
      const dlg = await findDialog();
      expect(within(dlg).getByText(`Switch off ${ALIAS} by hand`)).toBeTruthy();
      expect(within(dlg).getByText(via === "icloud" ? /go to Hide My Email, choose/
        : /Firefox Relay dashboard/)).toBeTruthy();
      // nothing to connect: no way into the alias service settings from here
      expect(within(dlg).queryByRole("button",
        { name: "Alias service settings" })).toBeNull();
      expect(within(dlg).queryByText(/connect the service/i)).toBeNull();
      await pressDialog("Close");
      await expectNoDialog();
      cleanup();
    }
    expect(onSettings).not.toHaveBeenCalled();
  });

test("mails not read for their receiving address yet say so", async () => {
  addresses.mockResolvedValue(report({ read: 1990 }));
  show();
  expect(await screen.findByText(rx("10 mails are not read for their receiving address yet - the next scan picks them up.")))
    .toBeTruthy();
});

test("Block covers every address of a stranger and reports a failure",
  async () => {
    wide();
    block.mockImplementation((_g: string, addr: string) =>
      addr === "news@loanquick.example" ? Promise.reject(new Error("x"))
        : Promise.resolve({ rule: { id: "r" } }));
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Block the 2" }));
    await pressDialog("Block");
    await waitFor(() => expect(block).toHaveBeenCalledTimes(3));
    expect(await screen.findByText(rx("1 sender could not be blocked.")))
      .toBeTruthy();
    // an "already blocked" error is not swallowed any more: nothing sends one
    expect(screen.queryByText(rx("Blocked 2 senders."))).toBeNull();
  });

test("phone: Not a leak? is part of the page, the sticky footer is the buttons",
  async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "See strangers" }));
    const link = await screen.findByRole("button",
      { name: /^ACME Store uses these senders/ });
    expect(link.closest('[data-scroll-id="address-detail"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Retire this alias…" })
      .closest('[data-scroll-id="address-detail"]')).toBeNull();
  });

test("Block: one summary toast, the rules' own notices are cleared, a cap is said",
  async () => {
    wide();
    const many = leaked();
    many.leak!.strangers[0] = { ...many.leak!.strangers[0], addr_total: 14 };
    addresses.mockResolvedValue(report({}, [many, main]));
    block.mockResolvedValue({ rule: { id: "r" } });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Block the 2" }));
    const dlg = await findDialog();
    expect(within(dlg).getByText(/Only the 10 most used sender addresses of each stranger are blocked \(1 of them have more\)\./))
      .toBeTruthy();
    await pressDialog("Block");
    await waitFor(() => expect(block).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(clearNotice).toHaveBeenCalledOnce());
    expect(clearNotice).toHaveBeenCalledWith(
      ["rule_report", "rule_executed", "rule_queued"]);
    expect(await screen.findAllByText(rx("Blocked 2 senders."))).toHaveLength(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

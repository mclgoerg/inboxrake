// @vitest-environment jsdom
/* Clean up > Snoozed: batches and snoozed mail with when they come back,
   Back now, Turn off… (which asks first and returns what a batch holds), and
   the states around the list. */
import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { setLang } from "./i18n";
import type { SnoozedResp } from "./types";
import { epoch } from "./snooze";

const snoozed = vi.fn();
const snoozedBack = vi.fn();
const snoozeBatch = vi.fn();

vi.mock("./api", () => ({
  api: {
    snoozed: (...a: unknown[]) => snoozed(...a),
    snoozedBack: (...a: unknown[]) => snoozedBack(...a),
    snoozeBatch: (...a: unknown[]) => snoozeBatch(...a),
  },
  fmtSize: (b: number) => `${b} B`,
}));

import { SnoozedPanel } from "./components/SnoozedPanel";
import { DialogProvider, ToastProvider } from "./components/ui";

// Tuesday 2026-11-24, 09:30 local
const NOW = new Date(2026, 10, 24, 9, 30);
const at = (d: number, h: number, mo = 10) => epoch(new Date(2026, mo, d, h));

const data = (over: Partial<SnoozedResp> = {}): SnoozedResp => ({
  count: 10, stale: false, now: epoch(NOW), folder: "Snoozed",
  batches: [{ key: "deals@promo.example", label: "Promo Deals",
    slot: "weekly", tz: "Europe/Berlin", held: 6, next: at(28, 9),
    msgids: ["<a@x>"] }],
  rows: [
    { kind: "sender", addr: "news@weekly.example", label: "Weekly News",
      count: 3, until: at(25, 8), subject: "", what: "ads",
      msgids: ["<b@x>", "<c@x>"] },
    { kind: "mail", addr: "shop@store.example", label: "Corner Store",
      count: 1, until: at(1, 9, 11), subject: "Invoice 2026-0412 for your order",
      what: "", msgids: ["<d@x>"] }],
  ...over });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  snoozed.mockReset();
  snoozedBack.mockReset().mockResolvedValue({ returned: 3, gone: 0 });
  snoozeBatch.mockReset().mockResolvedValue({ ok: true, slot: "off",
    returned: 6 });
  snoozed.mockResolvedValue(data());
});
afterEach(() => { cleanup(); vi.useRealTimers(); setLang("en"); });

const show = (props: Partial<Parameters<typeof SnoozedPanel>[0]> = {}) =>
  render(<ToastProvider><DialogProvider><SnoozedPanel account="proton"
    rev={0} onClose={() => {}} onChanged={() => {}} {...props} />
  </DialogProvider></ToastProvider>);
const text = (s: string | null) => (s ?? "").replace(/\u00a0/g, " ");

test("rows for the sender, the batch and the single mail, soonest first, as the board words them", async () => {
  show();
  const rows = await screen.findAllByTestId("snoozed-row");
  expect(rows.map((r) => text(r.textContent))).toEqual([
    "WWeekly News3 mails · Ads and offersback tomorrow 08:00Back now",
    "PPromo Dealsbatchweekly batch · Sat 09:00holds 6 mails · next Sat 09:00"
      + "Turn off…",
    "CCorner Store1 mail · “Invoice 2026-0412 for your order”"
      + "back 1 Dec 09:00Back now"]);
  // the header counts mails and batches and names the folder
  expect(text(screen.getByText(/out of sight/).textContent)).toBe(
    "10 mails out of sight · 1 batch · folder “Snoozed” on proton");
  // the notice says where it waits and that nothing is deleted
  expect(text(screen.getByText(/Snoozed mail waits in the server folder/)
    .textContent)).toContain("Nothing here is ever deleted.");
});

test("mail in the folder with no record is listed last, says so, and Back now returns it", async () => {
  snoozed.mockResolvedValue(data({ count: 12, rows: [...data().rows,
    { kind: "unrecorded", addr: "pat@people.example", label: "Pat People",
      count: 2, until: 0, subject: "", what: "", msgids: ["<u1@x>", "uid:9"] },
    { kind: "unrecorded", addr: "", label: "Lone note", count: 1, until: 0,
      subject: "Lone note", what: "", msgids: ["uid:12"] }] }));
  show();
  const rows = await screen.findAllByTestId("snoozed-row");
  expect(rows).toHaveLength(5);
  expect(text(rows[3].textContent)).toBe(
    "PPat People2 mailsin the folder, no time setBack now");
  expect(text(rows[4].textContent)).toContain("1 mail · “Lone note”");
  fireEvent.click(within(rows[3]).getByRole("button", { name: "Back now: Pat People" }));
  await waitFor(() => expect(snoozedBack).toHaveBeenCalledWith(["<u1@x>", "uid:9"]));
  setLang("de");
  cleanup();
  show();
  const de = await screen.findAllByTestId("snoozed-row");
  expect(text(de[3].textContent)).toContain("im Ordner, ohne Zeit");
});

test("only a batch carries the pill; mail rows have none", async () => {
  show();
  const rows = await screen.findAllByTestId("snoozed-row");
  expect(within(rows[1]).getByText("batch")).toBeTruthy();
  expect(within(rows[0]).queryByText("batch")).toBeNull();
  expect(within(rows[2]).queryByText("batch")).toBeNull();
});

test("Back now brings a sender's mails back and tells the app", async () => {
  const onChanged = vi.fn();
  show({ onChanged });
  const rows = await screen.findAllByTestId("snoozed-row");
  fireEvent.click(within(rows[0]).getByRole("button",
    { name: "Back now: Weekly News" }));
  await waitFor(() => expect(snoozedBack).toHaveBeenCalledWith(
    ["<b@x>", "<c@x>"]));
  await screen.findByText(/3 mails are back, unread/);
  expect(onChanged).toHaveBeenCalled();
  expect(snoozed).toHaveBeenCalledTimes(2);         // the list reloads
});

test("Turn off… asks first, names what comes back, and only then ends the batch", async () => {
  const onChanged = vi.fn();
  show({ onChanged });
  const rows = await screen.findAllByTestId("snoozed-row");
  fireEvent.click(within(rows[1]).getByRole("button",
    { name: "Turn off the batch for Promo Deals" }));
  const dlg = await screen.findByRole("dialog",
    { name: "Turn off the batch for Promo Deals?" });
  expect(text(dlg.textContent)).toContain(
    "The 6 mails it holds come back now, unread.");
  expect(snoozeBatch).not.toHaveBeenCalled();
  fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
  expect(snoozeBatch).not.toHaveBeenCalled();
  fireEvent.click(within((await screen.findAllByTestId("snoozed-row"))[1])
    .getByRole("button", { name: "Turn off the batch for Promo Deals" }));
  const again = await screen.findByRole("dialog",
    { name: "Turn off the batch for Promo Deals?" });
  fireEvent.click(within(again).getByRole("button", { name: "Turn off" }));
  await waitFor(() => expect(snoozeBatch).toHaveBeenCalledWith(
    "deals@promo.example", "off", "", "Promo Deals"));
  await screen.findByText(/6 held mails are back/);
  expect(onChanged).toHaveBeenCalledTimes(1);
});

test("a batch that holds nothing yet says so and can still be turned off", async () => {
  snoozed.mockResolvedValue(data({ rows: [], count: 0, batches: [{
    key: "deals@promo.example", label: "Promo Deals", slot: "daily",
    tz: "UTC", held: 0, next: at(24, 18), msgids: [] }] }));
  show();
  const row = (await screen.findAllByTestId("snoozed-row"))[0];
  expect(text(row.textContent)).toContain(
    "daily batch · 18:00holds nothing yet · next today 18:00");
  expect(within(row).getByRole("button", { name: /Turn off/ })).toBeTruthy();
  expect(within(row).queryByRole("button", { name: /Back now/ })).toBeNull();
});

test("an empty page says what to do", async () => {
  snoozed.mockResolvedValue(data({ batches: [], rows: [], count: 0 }));
  show();
  await screen.findByText("Nothing is snoozed");
  expect(screen.queryAllByTestId("snoozed-row")).toHaveLength(0);
  expect(screen.getByText(/Use Not now… on a sender or a mail/)).toBeTruthy();
});

test("a server that could not be asked says so; a failed load offers a retry", async () => {
  snoozed.mockResolvedValue(data({ stale: true }));
  const { unmount } = show();
  await screen.findByText(/could not be reached/);
  unmount();
  snoozed.mockReset();
  snoozed.mockRejectedValueOnce(new Error("boom"))
    .mockResolvedValue(data());
  show();
  await screen.findByText("Could not load the snoozed mail.");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findAllByTestId("snoozed-row");
});

test("a missing Snoozed folder says so and still lists what is remembered", async () => {
  snoozed.mockResolvedValue(data({ stale: true, no_folder: true }));
  const { unmount } = show();
  await screen.findByText(/Can’t find the “Snoozed” folder on your mail server/);
  expect(screen.getAllByTestId("snoozed-row")).toHaveLength(3);
  unmount();
  setLang("de");
  show();
  await screen.findByText(/Der Ordner „Snoozed“ wurde auf deinem Mailserver nicht gefunden/);
});

test("a folder the server put under a prefix is named as it is", async () => {
  snoozed.mockResolvedValue(data({ folder: "INBOX.Snoozed" }));
  show();
  await screen.findAllByTestId("snoozed-row");
  expect(text(screen.getByText(/out of sight/).textContent)).toContain(
    "folder “INBOX.Snoozed” on proton");
});

test("a failed Back now shows the error and keeps the list", async () => {
  snoozedBack.mockRejectedValue(new Error("busy_action"));
  show();
  const rows = await screen.findAllByTestId("snoozed-row");
  fireEvent.click(within(rows[2]).getByRole("button", { name: /Back now/ }));
  await screen.findByText(/busy_action/);
  expect(screen.getAllByTestId("snoozed-row")).toHaveLength(3);
});

test("the list reloads when the state's count moves", async () => {
  const { rerender } = show({ rev: 10 });
  await screen.findAllByTestId("snoozed-row");
  rerender(<ToastProvider><DialogProvider><SnoozedPanel account="proton"
    rev={7} onClose={() => {}} onChanged={() => {}} /></DialogProvider>
  </ToastProvider>);
  await waitFor(() => expect(snoozed).toHaveBeenCalledTimes(2));
});

test("German: title, rows and buttons", async () => {
  setLang("de");
  show();
  const rows = await screen.findAllByTestId("snoozed-row");
  expect(text(rows[0].textContent)).toContain("3 Mails · Werbung und Angebote");
  expect(text(rows[0].textContent)).toContain("zurück morgen 08:00");
  expect(within(rows[0]).getByRole("button", { name: /Jetzt zurück/ }))
    .toBeTruthy();
  expect(text(rows[1].textContent)).toContain(
    "wöchentliche Sammellieferung · Sa");
  expect(within(rows[1]).getByRole("button", { name: /Sammellieferung von Promo Deals beenden/ }))
    .toBeTruthy();
  expect(screen.getAllByText(/Zurückgestellt/).length).toBeGreaterThan(0);
  expect(screen.getByText(/aus dem Blick/)).toBeTruthy();
});

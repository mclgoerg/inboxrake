// @vitest-environment jsdom
/* Clean up > Snoozed: batches and snoozed mail with when they come back,
   "Back now", stopping a batch, and the states around the list. */
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
import { ToastProvider } from "./components/ui";

// Tuesday 2026-11-24, 09:30 local
const NOW = new Date(2026, 10, 24, 9, 30);
const at = (d: number, h: number, mo = 10) => epoch(new Date(2026, mo, d, h));

const data = (over: Partial<SnoozedResp> = {}): SnoozedResp => ({
  count: 10, stale: false, now: epoch(NOW),
  batches: [{ key: "deals@promo.example", label: "Promo Deals",
    slot: "weekly", tz: "Europe/Berlin", held: 6, next: at(28, 9),
    msgids: ["<a@x>"] }],
  rows: [
    { kind: "sender", addr: "news@weekly.example", label: "Weekly News",
      count: 3, until: at(25, 8), subject: "", msgids: ["<b@x>", "<c@x>"] },
    { kind: "mail", addr: "shop@store.example", label: "Corner Store",
      count: 1, until: at(1, 9, 11), subject: "Invoice 2026-0412 for your order",
      msgids: ["<d@x>"] }],
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
  render(<ToastProvider><SnoozedPanel rev={0} onClose={() => {}}
    onChanged={() => {}} {...props} /></ToastProvider>);
const text = (s: string | null) => (s ?? "").replace(/\u00a0/g, " ");

test("rows for the batch, the sender and the single mail, as the board words them", async () => {
  show();
  const rows = await screen.findAllByTestId("snoozed-row");
  expect(rows.map((r) => text(r.textContent))).toEqual([
    "Promo Deals · weekly batch6 mails so far · delivered Sat 09:00"
      + "Back nowStop",
    "Weekly News3 mails · back tomorrow 08:00Back now",
    "Invoice 2026-0412 for your orderCorner Store · back 1 Dec 09:00"
      + "Back now"]);
  // the header counts mails and batches
  expect(text(screen.getByText(/10 mails/).textContent)).toBe(
    "10 mails · 1 batch");
});

test("Back now brings a sender's mails back and tells the app", async () => {
  const onChanged = vi.fn();
  show({ onChanged });
  const rows = await screen.findAllByTestId("snoozed-row");
  fireEvent.click(within(rows[1]).getByRole("button", { name: "Back now: Weekly News" }));
  await waitFor(() => expect(snoozedBack).toHaveBeenCalledWith(
    ["<b@x>", "<c@x>"], ""));
  await screen.findByText(/3 mails are back, unread/);
  expect(onChanged).toHaveBeenCalled();
  expect(snoozed).toHaveBeenCalledTimes(2);         // the list reloads
});

test("Back now on a batch delivers what it holds; Stop ends it", async () => {
  const onChanged = vi.fn();
  show({ onChanged });
  const rows = await screen.findAllByTestId("snoozed-row");
  fireEvent.click(within(rows[0]).getByRole("button",
    { name: "Back now: Promo Deals" }));
  await waitFor(() => expect(snoozedBack).toHaveBeenCalledWith(
    [], "deals@promo.example"));
  await waitFor(() => expect(snoozed).toHaveBeenCalledTimes(2));
  fireEvent.click(within((await screen.findAllByTestId("snoozed-row"))[0])
    .getByRole("button", { name: "Stop delivering Promo Deals in batches" }));
  await waitFor(() => expect(snoozeBatch).toHaveBeenCalledWith(
    "deals@promo.example", "off", "", "Promo Deals"));
  await screen.findByText(/6 held mails are back/);
  expect(onChanged).toHaveBeenCalledTimes(2);
});

test("a batch that holds nothing yet cannot be brought back", async () => {
  snoozed.mockResolvedValue(data({ rows: [], count: 0, batches: [{
    key: "deals@promo.example", label: "Promo Deals", slot: "daily",
    tz: "UTC", held: 0, next: at(24, 18), msgids: [] }] }));
  show();
  const row = (await screen.findAllByTestId("snoozed-row"))[0];
  expect(text(row.textContent)).toContain(
    "Promo Deals · daily batchNothing held yet · delivered today 18:00");
  const backNow = within(row).getByRole("button", { name: /Back now/ });
  expect((backNow as HTMLButtonElement).disabled).toBe(true);
});

test("an empty page says what to do", async () => {
  snoozed.mockResolvedValue(data({ batches: [], rows: [], count: 0 }));
  show();
  await screen.findByText("Nothing is snoozed");
  expect(screen.queryAllByTestId("snoozed-row")).toHaveLength(0);
  expect(screen.getByText(/Use Not now on a sender or a mail/)).toBeTruthy();
});

test("the page explains where snoozed mail waits", async () => {
  show();
  await screen.findAllByTestId("snoozed-row");
  expect(screen.getByRole("heading", { name: "Where snoozed mail waits" }))
    .toBeTruthy();
  expect(screen.getByText(/folder named “Snoozed” on your mail server/))
    .toBeTruthy();
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
  rerender(<ToastProvider><SnoozedPanel rev={7} onClose={() => {}}
    onChanged={() => {}} /></ToastProvider>);
  await waitFor(() => expect(snoozed).toHaveBeenCalledTimes(2));
});

test("German: title, rows and buttons", async () => {
  setLang("de");
  show();
  const rows = await screen.findAllByTestId("snoozed-row");
  expect(text(rows[0].textContent)).toContain(
    "Promo Deals · wöchentliche Sammellieferung");
  expect(text(rows[0].textContent)).toContain("6 Mails bisher · Zustellung");
  expect(text(rows[1].textContent)).toContain("3 Mails · zurück morgen 08:00");
  expect(within(rows[1]).getByRole("button", { name: /Jetzt zurück/ }))
    .toBeTruthy();
  expect(screen.getAllByText(/Zurückgestellt/).length).toBeGreaterThan(0);
  expect(screen.getByText("Wo zurückgestellte Mails warten")).toBeTruthy();
});

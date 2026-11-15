// @vitest-environment jsdom
/* Insights > Subscriptions: the page (KPI tiles, table, pane), the phone
 * layout, the actions (remind, .ics, keep, not a subscription, the opt-in to
 * read the receipt text) and German. */

import { act, cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const subscriptions = vi.fn();
const hide = vi.fn();
const remind = vi.fn();
const keep = vi.fn();
const settings = vi.fn();
const amounts = vi.fn();
const saveBlob = vi.fn();
const message = vi.fn();
vi.mock("./api", () => ({
  api: {
    subscriptions: () => subscriptions(),
    subscriptionHide: (...a: unknown[]) => hide(...a),
    subscriptionRemind: (...a: unknown[]) => remind(...a),
    subscriptionKeep: (...a: unknown[]) => keep(...a),
    subscriptionSettings: (...a: unknown[]) => settings(...a),
    subscriptionAmounts: () => amounts(),
    message: (...a: unknown[]) => message(...a),
  },
  saveBlob: (...a: unknown[]) => saveBlob(...a),
  fmtSize: (b: number) => `${b} B`,
  mailKey: (m: { folder: string; uid: number }) => `${m.folder} ${m.uid}`,
}));

import { SubscriptionsPanel } from "./components/SubscriptionsPanel";
import { DialogProvider, ToastProvider } from "./components/ui";
import { clockShiftFor } from "./subscriptionsTestUtils";
import { findDialog, pressDialog } from "./dialogTestUtils";
import { setLang } from "./i18n";
import { DE } from "./locales/de";
import { EN } from "./locales/en";
import { clouddrive, fittrack, ITEMS, NOW, resp, streambox }
  from "./subscriptionsFixtures";

/** matchMedia for one viewport width (min-/max-width queries). */
const viewport = (width: number) => vi.stubGlobal("matchMedia", (q: string) => {
  const min = /min-width:\s*(\d+)px/.exec(q);
  const max = /max-width:\s*(\d+)px/.exec(q);
  const matches = (!min || width >= +min[1]) && (!max || width <= +max[1])
    && !q.includes("pointer");
  return { matches, media: q, addEventListener: () => {},
    removeEventListener: () => {} };
});

const onChanged = vi.fn();
const onNotifications = vi.fn();
const show = (props: Record<string, unknown> = {}) => render(
  <ToastProvider><DialogProvider>
    <SubscriptionsPanel account="main" onClose={() => {}}
      onChanged={onChanged} onNotifications={onNotifications} {...props} />
  </DialogProvider></ToastProvider>);

let restoreClock = () => {};
beforeEach(() => {
  setLang("en");
  restoreClock = clockShiftFor(NOW);
  viewport(1440);
  subscriptions.mockResolvedValue(resp());
  for (const f of [hide, remind, keep, settings, amounts])
    f.mockResolvedValue({ ok: true, changed: 4 });
  message.mockResolvedValue({ from: "x", to: "y", date: "", subject: "S",
    text: "body", thread: null });
});
afterEach(() => {
  cleanup();
  restoreClock();
  vi.unstubAllGlobals();
  for (const f of [subscriptions, hide, remind, keep, settings, amounts,
    saveBlob, message, onChanged, onNotifications]) f.mockReset();
  localStorage.clear();
  setLang("en");
});

const rows = () => screen.getAllByTestId("sub-row");

test("desktop: the KPI tiles, the table and the pane of the first row", async () => {
  show();
  expect(await screen.findByText("€32")).toBeTruthy();
  expect(screen.getByText("a month")).toBeTruthy();
  expect(screen.getByText("5 of 6 with an amount")).toBeTruthy();
  expect(screen.getByText("look unused")).toBeTruthy();
  expect(screen.getByText("renews within 60 days")).toBeTruthy();
  // the table: one row per service with the columns of the board
  for (const h of ["Service", "Every", "Next receipt", "Amount", "Still in use?"])
    expect(screen.getByRole("columnheader", { name: h })).toBeTruthy();
  expect(rows()).toHaveLength(6);
  const sb = rows()[0];
  expect(within(sb).getByText("StreamBox")).toBeTruthy();
  expect(within(sb).getByText("since Jan 2023")).toBeTruthy();
  expect(within(sb).getByText("Monthly")).toBeTruthy();
  expect(within(sb).getByText("€12.99")).toBeTruthy();
  expect(within(sb).getByText(/Signed in /)).toBeTruthy();
  // a yearly one inside 60 days carries the pill; a far one does not
  const cd = rows().find((r) => within(r).queryByText("CloudDrive Pro"))!;
  expect(within(cd).getByText("in 60 days")).toBeTruthy();
  expect(within(cd).getByText("Yearly")).toBeTruthy();
  expect(within(cd).getByText("Mail read")).toBeTruthy();
  const vp = rows().find((r) => within(r).queryByText("VPNly"))!;
  expect(within(vp).queryByText(/in \d+ days/)).toBeNull();
  // no amount in the subject; unused ones say why
  const nd = rows().find((r) => within(r).queryByText("NewsDaily+"))!;
  expect(within(nd).getByText("not in subject")).toBeTruthy();
  expect(within(nd).getByText("Never opened")).toBeTruthy();
  const ft = rows().find((r) => within(r).queryByText("FitTrack Premium"))!;
  expect(within(ft).getByText(/Unused since Mar/)).toBeTruthy();
  // the footnote of the board
  expect(screen.getByText(/No mail body is read; amounts only when the subject/))
    .toBeTruthy();
  // the pane (>= 1280) shows the first row without a click
  const pane = screen.getByTestId("sub-pane");
  expect(within(pane).getByRole("heading", { name: "StreamBox" })).toBeTruthy();
  expect(within(pane).getByText("Remind me 3 days before")).toBeTruthy();
});

test("the pane of an unused one: amount, receipts, total, rhythm, notice, receipts, actions",
  async () => {
    show();
    await screen.findByText("€32");
    fireEvent.click(within(rows()[2]).getByRole("button", { name: /FitTrack/ }));
    const pane = screen.getByTestId("sub-pane");
    expect(within(pane).getByRole("heading", { name: "FitTrack Premium" }))
      .toBeTruthy();
    expect(within(pane).getByText(
      "billing@fittrack.example · monthly, around the 5th")).toBeTruthy();
    expect(within(pane).getByText("€7.99")).toBeTruthy();
    expect(within(pane).getByText("a month · from the subject")).toBeTruthy();
    expect(within(pane).getByText("21")).toBeTruthy();
    expect(within(pane).getByText("receipts so far")).toBeTruthy();
    expect(within(pane).getByText("€168")).toBeTruthy();
    expect(within(pane).getByText("since Mar 2025")).toBeTruthy();
    // 21 filled squares and the outlined next one, named for a screen reader
    expect(within(pane).getByRole("img", { name:
      /^21 receipts so far; the next one is expected around 5 Dec/ }))
      .toBeTruthy();
    expect(within(pane).getByText(/^next ~5 Dec/)).toBeTruthy();
    // the notice, with the board's two sentences
    expect(within(pane).getByText("Looks unused.")).toBeTruthy();
    expect(within(pane).getByText(/Your last sign-in alert from FitTrack Premium came on 12 Mar\. Since then you opened 0 of their 40 other mails\./))
      .toBeTruthy();
    expect(within(pane).getByText("Latest receipts")).toBeTruthy();
    expect(within(pane).getAllByText("Your receipt - €7.99")).toHaveLength(3);
    for (const name of ["Remind me 3 days before", /\.ics/, "Keep the receipts",
      "Not a subscription"])
      expect(within(pane).getByRole("button", { name })).toBeTruthy();
    expect(within(pane).getByText(/Inboxrake can't cancel it for you\./))
      .toBeTruthy();
    expect(within(pane).getByRole("button", { name: "Open the latest receipt" }))
      .toBeTruthy();
  });

test("a service in use has no notice; one without a price offers to find it",
  async () => {
    show();
    await screen.findByText("€32");
    expect(within(screen.getByTestId("sub-pane")).queryByText("Looks unused."))
      .toBeNull();
    fireEvent.click(within(rows()[3]).getByRole("button", { name: /NewsDaily/ }));
    const pane = screen.getByTestId("sub-pane");
    expect(within(pane).getByText("—")).toBeTruthy();
    expect(within(pane).getByText(/not in subject/)).toBeTruthy();
    expect(within(pane).getByRole("button", { name: "Find in the receipt text" }))
      .toBeTruthy();
    expect(within(pane).getByText(/There is no sign-in alert from NewsDaily\+ in your mail\. You opened 0 of their 14 other mails\./))
      .toBeTruthy();
    // no total without a price
    expect(within(pane).queryByText(/since /)).toBeNull();
  });

test("Remind me: on and off, with the way to notifications when they are off",
  async () => {
    show();
    await screen.findByText("€32");
    // the reload after the click comes back with the reminder on
    subscriptions.mockResolvedValue(resp({}, [{ ...streambox, reminder: true },
      ...ITEMS.slice(1)]));
    fireEvent.click(within(screen.getByTestId("sub-pane"))
      .getByRole("button", { name: "Remind me 3 days before" }));
    await waitFor(() => expect(remind).toHaveBeenCalledWith(
      "streambox.example", true));
    expect(onChanged).toHaveBeenCalled();
    await screen.findByText(
      "Reminder set. You'll be told 3 days before StreamBox bills again.");
    const on = await within(screen.getByTestId("sub-pane")).findByRole("button",
      { name: "Reminder on - 3 days before" });
    const pane = screen.getByTestId("sub-pane");
    expect(within(pane).getByText("Notifications are off on this device."))
      .toBeTruthy();
    fireEvent.click(within(pane).getByRole("button", { name: "Turn them on" }));
    expect(onNotifications).toHaveBeenCalled();
    fireEvent.click(on);
    await waitFor(() => expect(remind).toHaveBeenLastCalledWith(
      "streambox.example", false));
  });

test(".ics: hands the browser a calendar file of the next date", async () => {
  show();
  await screen.findByText("€32");
  fireEvent.click(within(screen.getByTestId("sub-pane")).getByRole("button",
    { name: "Add to your calendar (.ics file)" }));
  expect(saveBlob).toHaveBeenCalledTimes(1);
  const [name, blob] = saveBlob.mock.calls[0];
  expect(name).toBe("StreamBox.ics");
  expect(await (blob as Blob).text()).toContain("DTSTART;VALUE=DATE:20261202");
});

test("Keep the receipts pins them and says how many", async () => {
  show();
  await screen.findByText("€32");
  fireEvent.click(within(screen.getByTestId("sub-pane"))
    .getByRole("button", { name: "Keep the receipts" }));
  await waitFor(() => expect(keep).toHaveBeenCalledWith(
    "streambox.example", true));
  await screen.findByText(
    "4 receipts of StreamBox kept (protected from bulk actions).");
});

test("Not a subscription hides it with an Undo; Show hidden brings it back",
  async () => {
    show();
    await screen.findByText("€32");
    fireEvent.click(within(screen.getByTestId("sub-pane"))
      .getByRole("button", { name: "Not a subscription" }));
    await waitFor(() => expect(hide).toHaveBeenCalledWith(
      "streambox.example", true));
    await screen.findByText("StreamBox is no longer listed as a subscription.");
    // undo = hide: false
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(hide).toHaveBeenLastCalledWith(
      "streambox.example", false));
  });

test("hidden ones leave the list, and a filter shows them to bring back",
  async () => {
    subscriptions.mockResolvedValue(resp({}, [{ ...streambox, hidden: true },
      ...ITEMS.slice(1)]));
    show();
    await screen.findByText("€32");
    expect(rows()).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Show 1 hidden" }));
    expect(rows()).toHaveLength(6);
    const sb = rows().at(-1)!;                 // hidden ones come last
    expect(within(sb).getByText("Hidden")).toBeTruthy();
    fireEvent.click(within(sb).getByRole("button", { name: /StreamBox/ }));
    fireEvent.click(within(screen.getByTestId("sub-pane"))
      .getByRole("button", { name: "Bring it back" }));
    await waitFor(() => expect(hide).toHaveBeenCalledWith(
      "streambox.example", false));
  });

test("the unused tile filters the table to what looks unused", async () => {
  show();
  await screen.findByText("€32");
  fireEvent.click(screen.getByRole("button", { name: /look unused/ }));
  expect(rows()).toHaveLength(2);
  expect(screen.getByText("Showing only the ones that look unused."))
    .toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show all" }));
  expect(rows()).toHaveLength(6);
});

test("opened from the Overview's Review it starts on the unused ones", async () => {
  show({ onlyUnused: true });
  await screen.findByText("€32");
  expect(rows()).toHaveLength(2);
});

test("the opt-in: a link, a confirm that says what is read, then the amounts",
  async () => {
    show();
    await screen.findByText("€32");
    fireEvent.click(screen.getByRole("button",
      { name: "Find amounts in the receipt text" }));
    const dialog = await findDialog();
    expect(within(dialog).getByText("Find amounts in the receipt text"))
      .toBeTruthy();
    expect(within(dialog).getByText(/on this server only/)).toBeTruthy();
    expect(within(dialog).getByText(/nothing is sent anywhere/)).toBeTruthy();
    expect(within(dialog).getByText(/switch this off in Settings/)).toBeTruthy();
    expect(settings).not.toHaveBeenCalled();
    await pressDialog("Find amounts");
    await waitFor(() => expect(settings).toHaveBeenCalledWith(true));
    await waitFor(() => expect(amounts).toHaveBeenCalledTimes(1));
  });

test("declining the opt-in changes nothing", async () => {
  show();
  await screen.findByText("€32");
  fireEvent.click(screen.getByRole("button",
    { name: "Find amounts in the receipt text" }));
  await findDialog();
  await pressDialog("Cancel");
  await act(async () => {});
  expect(settings).not.toHaveBeenCalled();
  expect(amounts).not.toHaveBeenCalled();
});

test("with the opt-in on there is no link, the note says what is read, and "
  + "unread receipts are read once when the page opens", async () => {
  subscriptions.mockResolvedValue(resp({ body_amounts: true,
    unread_amounts: 1 }));
  show();
  await screen.findByText("€32");
  expect(screen.queryByRole("button",
    { name: "Find amounts in the receipt text" })).toBeNull();
  expect(screen.getByText(/only the latest receipt is read - on your server/))
    .toBeTruthy();
  await waitFor(() => expect(amounts).toHaveBeenCalledTimes(1));
  await act(async () => {});
  expect(amounts).toHaveBeenCalledTimes(1);     // not again after the reload
});

test("nothing to read: the amounts are not asked for", async () => {
  subscriptions.mockResolvedValue(resp({ body_amounts: true }));
  show();
  await screen.findByText("€32");
  expect(amounts).not.toHaveBeenCalled();
});

test("amounts from the receipt text say so", async () => {
  const read = { ...newsdailyRead() };
  subscriptions.mockResolvedValue(resp({ body_amounts: true },
    [read, ...ITEMS.filter((s) => s.key !== read.key)]));
  show();
  await screen.findByText("€32");
  fireEvent.click(within(rows().find((r) => within(r).queryByText("NewsDaily+"))!)
    .getByRole("button", { name: /NewsDaily/ }));
  expect(within(screen.getByTestId("sub-pane"))
    .getByText("a month · from the receipt text")).toBeTruthy();
});

function newsdailyRead() {
  return { ...ITEMS[3], amount: 4.99, currency: "EUR", monthly: 4.99,
    amount_source: "receipt" as const, total: 29.94, total_estimated: true };
}

test("an estimated total says about", async () => {
  subscriptions.mockResolvedValue(resp({}, [{ ...newsdailyRead() }]));
  show();
  await screen.findByRole("heading", { name: "NewsDaily+" });
  expect(screen.getByText("about €30")).toBeTruthy();
});

test("another currency is named, not added up", async () => {
  const totals = { ...resp().totals, other_currencies: ["USD"] };
  subscriptions.mockResolvedValue(resp({ totals }));
  show();
  expect(await screen.findByText(/USD not added up/)).toBeTruthy();
});

test("states: loading, failure with retry, no scan, nothing found", async () => {
  subscriptions.mockRejectedValueOnce(new Error("down"));
  show();
  expect(await screen.findByText("Could not load the subscriptions.")).toBeTruthy();
  subscriptions.mockResolvedValue(resp({ scanned: false }, []));
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Scan your mailbox first")).toBeTruthy();
  cleanup();
  subscriptions.mockResolvedValue(resp({}, []));
  show();
  expect(await screen.findByText("No subscriptions found")).toBeTruthy();
  expect(screen.getByText(/at least three times/)).toBeTruthy();
});

test("an action that fails shows the error and keeps the page", async () => {
  remind.mockRejectedValue(new Error("boom"));
  show();
  await screen.findByText("€32");
  fireEvent.click(within(screen.getByTestId("sub-pane"))
    .getByRole("button", { name: "Remind me 3 days before" }));
  await screen.findByText("Error: boom");
  expect(rows()).toHaveLength(6);
});

test("Open the latest receipt opens the mail in the panel and Back returns",
  async () => {
    show();
    await screen.findByText("€32");
    fireEvent.click(within(screen.getByTestId("sub-pane")).getByRole("button",
      { name: "Open the latest receipt" }));
    await waitFor(() => expect(message).toHaveBeenCalledWith("INBOX", 3));
    expect(await screen.findByText("body")).toBeTruthy();
  });

/* ------------------------------ below 1280 ------------------------------- */

test("a laptop width keeps the table and opens the pane as a dialog", async () => {
  viewport(1024);
  show();
  await screen.findByText("€32");
  expect(screen.queryByTestId("sub-pane")).toBeNull();
  fireEvent.click(within(rows()[2]).getByRole("button", { name: /FitTrack/ }));
  const dialog = await screen.findByRole("dialog", { name: "FitTrack Premium" });
  expect(within(dialog).getByText("Looks unused.")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Not a subscription" }));
  await waitFor(() => expect(hide).toHaveBeenCalledWith(
    "fittrack.example", true));
});

/* -------------------------------- the phone ------------------------------ */

test("phone: two tiles, a row per service with a use marker, tap opens the pane",
  async () => {
    viewport(390);
    show();
    expect(await screen.findByText("€32 / month")).toBeTruthy();
    expect(screen.getByText("5 of 6 with amount")).toBeTruthy();
    expect(screen.getByText("2 look unused")).toBeTruthy();
    expect(screen.getByText("about €8 a month")).toBeTruthy();
    expect(screen.getByText("6 services · about €32 a month")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(rows()).toHaveLength(6);
    expect(screen.getByText("€12.99 · monthly")).toBeTruthy();
    expect(screen.getByText("€59.88 · yearly · in 60 days")).toBeTruthy();
    expect(screen.getByText("monthly · amount unknown")).toBeTruthy();
    // the unused tile filters the list
    fireEvent.click(screen.getByRole("button", { name: /2 look unused/ }));
    expect(rows()).toHaveLength(2);
    fireEvent.click(within(rows()[0]).getByRole("button"));
    const dialog = await screen.findByRole("dialog",
      { name: /NewsDaily|FitTrack/ });
    expect(within(dialog).getByRole("heading", { name: /NewsDaily|FitTrack/ }))
      .toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Keep the receipts" }))
      .toBeTruthy();
  });

/* --------------------------------- German -------------------------------- */

test("German: the page speaks German (du)", async () => {
  setLang("de");
  show();
  expect(await screen.findByText("Etwa")).toBeTruthy();
  expect(screen.getByText("im Monat")).toBeTruthy();
  expect(screen.getByText("5 von 6 mit Betrag")).toBeTruthy();
  expect(screen.getByRole("columnheader", { name: "Noch in Benutzung?" }))
    .toBeTruthy();
  expect(screen.getByText("Mail gelesen")).toBeTruthy();
  expect(screen.getByText("Nie geöffnet")).toBeTruthy();
  expect(screen.getAllByText(/Ungenutzt seit /)).toHaveLength(1);
  expect(screen.getByText(/Beträge nur, wenn der Betreff sie nennt/)).toBeTruthy();
  fireEvent.click(within(rows()[2]).getByRole("button", { name: /FitTrack/ }));
  const pane = screen.getByTestId("sub-pane");
  expect(within(pane).getByText("Scheint ungenutzt.")).toBeTruthy();
  expect(within(pane).getByText(/Der letzte Anmeldehinweis von FitTrack Premium kam am /))
    .toBeTruthy();
  expect(within(pane).getByRole("button", { name: "3 Tage vorher erinnern" }))
    .toBeTruthy();
  expect(within(pane).getByRole("button", { name: "Kein Abo" })).toBeTruthy();
});

test("every subscription string exists in both languages", () => {
  const keys = Object.keys(EN).filter((k) => /^(sub\.|tab\.subs_|overview\.subs_)/
    .test(k));
  expect(keys.length).toBeGreaterThan(80);
  for (const k of keys) expect(DE[k], k).toBeTruthy();
  for (const k of Object.keys(DE).filter((k) => /^(sub\.|tab\.subs_|overview\.subs_)/
    .test(k))) expect(EN[k], k).toBeTruthy();
});

test("the clouddrive fixture is a yearly one (sanity of the data the tests use)",
  () => {
    expect(clouddrive.cadence).toBe("yearly");
    expect(fittrack.use.in_use).toBe(false);
  });

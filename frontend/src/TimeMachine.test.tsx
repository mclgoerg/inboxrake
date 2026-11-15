// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { setClockShift } from "./clock";
import { pressDialog, findDialog, cancelDialog, expectNoDialog } from
  "./dialogTestUtils";
import { setLang } from "./i18n";
import type { Group, RestoreState, Rule, TmListing, TmPreview, TmStep } from
  "./types";

const listing = vi.fn();
const preview = vi.fn();
const restoreCall = vi.fn();

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: {
    timeMachine: (...a: unknown[]) => listing(...a),
    timeMachinePreview: (...a: unknown[]) => preview(...a),
    timeMachineRestore: (...a: unknown[]) => restoreCall(...a),
  },
}));

import { TimeMachine } from "./components/TimeMachine";
import { DialogProvider, ToastProvider } from "./components/ui";

const at = (h: number, m = 0, day = 15) => Math.floor(
  new Date(2026, 10, day, h, m).getTime() / 1000);
const step = (id: string, ts: number, over: Partial<TmStep> = {}): TmStep => ({
  id, ts, action: "trash", actor: "user", count: 3, bytes: 0, label: "",
  outcome: "ok", status: "back", mails: 3, senders: [], senders_total: 0,
  ...over });

// newest first, like the API: 14:31 emptied, 14:28 trash, 14:22 archive,
// 14:15 unsubscribes, 14:12 a rule's trash, 14:08 marked read
const STEPS: TmStep[] = [
  step("e", at(14, 31), { action: "empty_trash", status: "cant",
    reason: "deleted", count: 12 }),
  step("d", at(14, 28), { count: 300, mails: 300,
    senders: [{ addr: "deals@x.example", n: 200 },
      { addr: "gadget@x.example", n: 100 }], senders_total: 2 }),
  step("c", at(14, 22), { action: "archive", count: 410, mails: 410 }),
  step("b", at(14, 15), { action: "unsubscribe", status: "stays", count: 6 }),
  step("a", at(14, 12), { actor: "rule:r1", count: 120, mails: 120 }),
  step("z", at(14, 8), { action: "mark_read", status: "stays", count: 220 }),
];
const OLD = step("o", at(10, 2, 12), { count: 50, mails: 50 });

const LISTING: TmListing = {
  steps: STEPS,
  sessions: [{ start: at(14, 8), end: at(14, 31), steps: 6, mails: 1050,
    first: "z", last: "e" }],
  now: at(15), keep_days: 30, step_cap: 500 };

const PREVIEW: TmPreview = {
  top: "e", point: "c", point_ts: at(14, 18), steps: 1, newer_sessions: 0,
  mails: 300, bytes: 412 * 1048576,
  folders: [{ folder: "INBOX", name: "INBOX", mails: 260 },
    { folder: "News", name: "News", mails: 40 }],
  senders: [{ addr: "deals@x.example", mails: 200, bytes: 1 },
    { addr: "gadget@x.example", mails: 100, bytes: 1 }],
  cant: [{ reason: "emptied", mails: 12, at: at(14, 31) }],
  stays: [{ kind: "unsubscribe", n: 6 }], skipped: { protected: 0, pinned: 0 },
  rules: [{ id: "r1", name: "Sweep old newsletters", mails: 120 }] };

const rules = [{ id: "r1", name: "Sweep old newsletters" }] as unknown as Rule[];
const groups = { "deals@x.example": { label: "Deals Daily" } } as unknown as
  Record<string, Group>;

const mount = (props: Partial<React.ComponentProps<typeof TimeMachine>> = {}) =>
  render(<ToastProvider><DialogProvider>
    <TimeMachine rules={rules} groups={groups} phone={false} {...props} />
  </DialogProvider></ToastProvider>);

beforeEach(() => {
  // the page's "now": 15 Nov 2026, 15:00
  setClockShift(Date.now() - new Date(2026, 10, 15, 15, 0).getTime());
  listing.mockResolvedValue(LISTING);
  preview.mockImplementation((body: { point: string }) => Promise.resolve(
    { ...PREVIEW, point: body.point }));
  restoreCall.mockResolvedValue({ started: true, steps: 1, point_ts: 1 });
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  cleanup();
  setLang("en");
  setClockShift(0);
  listing.mockReset(); preview.mockReset(); restoreCall.mockReset();
});

const plain = (s: string | null) => (s ?? "").replace(/\u00a0/g, " ");
/** An accessible name, anchored, spaces matching the no-break spaces the
 *  strings glue counts with. */
const named = (s: string) => new RegExp(
  `^${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s")}$`);
const starts = (s: string) => new RegExp(
  `^${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s")}`);
const settled = async () => {
  await screen.findByRole("slider");
  await waitFor(() => expect(preview).toHaveBeenCalled());
  await screen.findByText(/to Inbox/);
};

test("the steps, newest first, with what each does when the line is above it",
  async () => {
    mount();
    await settled();
    const rows = screen.getAllByRole("listitem").filter(
      (li) => li.hasAttribute("data-tm-row"));
    expect(rows.map((r) => plain(r.textContent).slice(0, 24))).toEqual([
      expect.stringContaining("14:31"), expect.stringContaining("14:28"),
      expect.stringContaining("14:22"), expect.stringContaining("14:15"),
      expect.stringContaining("14:12"), expect.stringContaining("14:08")]);
    // above the default line (just below the newest undoable step): pills
    expect(within(rows[0]).getByText("Can't")).toBeTruthy();
    expect(within(rows[1]).getByText("Comes back")).toBeTruthy();
    expect(within(rows[0]).getByText(/deleted for good/)).toBeTruthy();
    // below it: no pill
    for (const r of rows.slice(2)) {
      expect(within(r).queryByText(/Comes back|Stays|Can't/)).toBeNull();
    }
    expect(within(rows[3]).getByText("Unsubscribed from 6 senders")).toBeTruthy();
    // the rule's step names the rule; senders use the group's name
    expect(within(rows[1]).getByText(/Deals Daily, deals?|gadget@x.example|Deals Daily/))
      .toBeTruthy();
    expect(within(rows[4]).getByText(/Rule/)).toBeTruthy();
  });

test("the line starts below the newest step that comes back, the preview is " +
  "asked for exactly that point", async () => {
  mount();
  await settled();
  const slider = screen.getByRole("slider");
  expect(slider.getAttribute("aria-valuenow")).toBe("2");
  expect(slider.getAttribute("aria-valuemax")).toBe("6");
  expect(slider.getAttribute("aria-valuetext")).toMatch(/Restore point 14:\d\d:/);
  expect(preview).toHaveBeenLastCalledWith({ point: "c" });
  expect(screen.getByText(/Restore point · 14:\d\d/)).toBeTruthy();
});

test("the card: big number, size, folders, the notes and the buttons", async () => {
  mount();
  await settled();
  expect(screen.getByText("300")).toBeTruthy();
  expect(plain(screen.getByText(/mails come back/).textContent))
    .toMatch(/^mails come back · 412\.0 MB$/);
  expect(plain(screen.getByText(/to Inbox/).textContent)).toBe("260 to Inbox");
  expect(plain(screen.getByText(/to News/).textContent)).toBe("40 to News");
  expect(screen.getByText("from 2 senders")).toBeTruthy();
  expect(plain(screen.getByText(/12 mails can't come back/).parentElement!
    .textContent)).toMatch(/12 mails can't come back - you emptied Trash at 14:31\./);
  expect(plain(screen.getByText(/6 unsubscribes stay\./).parentElement!
    .textContent)).toContain("Inboxrake can't sign you up again.");
  expect(screen.getByRole("button", { name: named("Restore 300 mails…") })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Pick senders…" })).toBeTruthy();
  // the rule that would sweep them up again is offered, ticked
  const pause = screen.getByRole("checkbox") as HTMLInputElement;
  expect(pause.checked).toBe(true);
  expect(plain(pause.closest("label")!.textContent))
    .toBe("Pause rule “Sweep old newsletters” - it would move 120 of them again tonight.");
});

test("choosing a step puts the line right below it and asks for that point",
  async () => {
    mount();
    await settled();
    fireEvent.click(screen.getByRole("button", { name: starts("14:12 Moved 120 mails") }));
    await waitFor(() => expect(preview).toHaveBeenLastCalledWith({ point: "z" }));
    expect(screen.getByRole("slider").getAttribute("aria-valuenow")).toBe("5");
    // the step and everything above it now wears a pill; the one below none
    const row = screen.getByRole("button", { name: starts("14:08 Marked 220") })
      .closest("li")!;
    expect(within(row).queryByText(/Comes back|Stays/)).toBeNull();
    const above = screen.getByRole("button", { name: starts("14:15 Unsubscribed") })
      .closest("li")!;
    expect(within(above).getByText("Stays")).toBeTruthy();
  });

test("the keyboard moves the line: arrows, Home and End, never outside the list",
  async () => {
    mount();
    await settled();
    const slider = screen.getByRole("slider");
    slider.focus();
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    await waitFor(() => expect(preview).toHaveBeenLastCalledWith({ point: "d" }));
    expect(slider.getAttribute("aria-valuenow")).toBe("1");
    fireEvent.keyDown(slider, { key: "ArrowDown" });
    fireEvent.keyDown(slider, { key: "ArrowDown" });
    await waitFor(() => expect(slider.getAttribute("aria-valuenow")).toBe("3"));
    fireEvent.keyDown(slider, { key: "Home" });
    await waitFor(() => expect(slider.getAttribute("aria-valuenow")).toBe("0"));
    fireEvent.keyDown(slider, { key: "ArrowUp" });          // already on top
    expect(slider.getAttribute("aria-valuenow")).toBe("0");
    fireEvent.keyDown(slider, { key: "End" });
    await waitFor(() => expect(slider.getAttribute("aria-valuenow")).toBe("6"));
    await waitFor(() => expect(preview).toHaveBeenLastCalledWith({ point: "" }));
    fireEvent.keyDown(slider, { key: "ArrowDown" });        // already at the end
    expect(slider.getAttribute("aria-valuenow")).toBe("6");
  });

test("dragging the line follows the pointer between the rows", async () => {
  mount();
  await settled();
  const slider = screen.getByRole("slider");
  // jsdom has no layout: 6 rows of 50 px from the top of the list
  const list = screen.getByRole("list", { name: "Steps, newest first" });
  list.getBoundingClientRect = () => ({ top: 0 } as DOMRect);
  for (const li of list.querySelectorAll<HTMLElement>("[data-tm-row]"))
    Object.defineProperty(li, "offsetHeight", { value: 50 });
  slider.setPointerCapture = () => {};
  fireEvent.pointerDown(slider, { pointerId: 1 });
  const move = (y: number) => act(() => {
    slider.dispatchEvent(new MouseEvent("pointermove",
      { clientY: y, bubbles: true }));
  });
  move(130);                       // past the middle of the 3rd row: 3 above
  await waitFor(() => expect(slider.getAttribute("aria-valuenow")).toBe("3"));
  move(-40);
  await waitFor(() => expect(slider.getAttribute("aria-valuenow")).toBe("0"));
  move(900);
  await waitFor(() => expect(slider.getAttribute("aria-valuenow")).toBe("6"));
  act(() => { slider.dispatchEvent(new MouseEvent("pointerup", { bubbles: true })); });
  move(60);                        // released: no longer follows
  expect(slider.getAttribute("aria-valuenow")).toBe("6");
});

test("Restore asks with verb + count, lists what happens, then starts the job " +
  "with the point, the preview's top and the ticked rule", async () => {
  mount();
  await settled();
  fireEvent.click(screen.getByRole("button", { name: named("Restore 300 mails…") }));
  const dlg = await findDialog();
  expect(plain(within(dlg).getByText(/Restore 300 mails to how they were/).textContent))
    .toMatch(/^Restore 300 mails to how they were at 14:\d\d\?$/);
  const bullets = within(dlg).getAllByRole("listitem").map((l) => plain(l.textContent));
  expect(bullets[0]).toBe("1 step is undone: 260 mails back to Inbox, 40 to News");
  expect(bullets[1]).toBe("Pinned and protected stay as they are; 12 mails can't come back");
  expect(bullets[2]).toBe("Rule “Sweep old newsletters” is paused (switch it on in Rules)");
  expect(within(dlg).getByText("The restore itself is a step in Activity - you can undo it, too."))
    .toBeTruthy();
  await pressDialog(named("Restore 300 mails"));
  await waitFor(() => expect(restoreCall).toHaveBeenCalledTimes(1));
  expect(restoreCall).toHaveBeenCalledWith({
    point: "c", top: "e", senders: null, pause: ["r1"] });
});

test("an unticked rule is not paused and not listed in the confirm", async () => {
  mount();
  await settled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: named("Restore 300 mails…") }));
  const dlg = await findDialog();
  expect(within(dlg).queryByText(/is paused/)).toBeNull();
  await pressDialog(named("Restore 300 mails"));
  await waitFor(() => expect(restoreCall).toHaveBeenCalled());
  expect(restoreCall).toHaveBeenCalledWith(expect.objectContaining({ pause: [] }));
});

test("cancelling the confirm starts nothing", async () => {
  mount();
  await settled();
  fireEvent.click(screen.getByRole("button", { name: named("Restore 300 mails…") }));
  await cancelDialog();
  await expectNoDialog();
  expect(restoreCall).not.toHaveBeenCalled();
});

test("the numbers are fetched again right before the confirm", async () => {
  mount();
  await settled();
  preview.mockClear();
  preview.mockImplementation((body: { point: string }) => Promise.resolve(
    { ...PREVIEW, point: body.point, mails: 250 }));
  fireEvent.click(screen.getByRole("button", { name: named("Restore 300 mails…") }));
  const dlg = await findDialog();
  expect(preview).toHaveBeenCalledWith({ point: "c", senders: null });
  expect(plain(dlg.textContent)).toContain("Restore 250 mails to how they were");
});

test("Pick senders: only the ticked ones come back, the count follows",
  async () => {
    mount();
    await settled();
    fireEvent.click(screen.getByRole("button", { name: "Pick senders…" }));
    const sheet = await screen.findByText("Pick senders · only these come back");
    const box = sheet.closest("[role=dialog]") as HTMLElement;
    expect(within(box).getByText("Deals Daily")).toBeTruthy();     // by name
    expect(within(box).getByRole("button", { name: named("Restore 300 mails") })).toBeTruthy();
    fireEvent.click(within(box).getByRole("checkbox", { name: /gadget@x.example/ }));
    expect(within(box).getByRole("button", { name: named("Restore 200 mails") })).toBeTruthy();
    preview.mockImplementation((body: { point: string; senders?: string[] }) =>
      Promise.resolve({ ...PREVIEW, mails: 200, point: body.point,
        senders: PREVIEW.senders.slice(0, 1) }));
    fireEvent.click(within(box).getByRole("button", { name: named("Restore 200 mails") }));
    const dlg = await findDialog();
    expect(preview).toHaveBeenLastCalledWith({ point: "c",
      senders: ["deals@x.example"] });
    expect(plain(dlg.textContent)).toContain("Restore 200 mails to how");
    await pressDialog(named("Restore 200 mails"));
    await waitFor(() => expect(restoreCall).toHaveBeenCalled());
    expect(restoreCall).toHaveBeenCalledWith(expect.objectContaining({
      senders: ["deals@x.example"] }));
  });

test("nothing to bring back: the button is off", async () => {
  preview.mockImplementation((body: { point: string }) => Promise.resolve(
    { ...PREVIEW, point: body.point, mails: 0, folders: [], senders: [],
      cant: [], stays: [], rules: [] }));
  mount();
  await screen.findByRole("slider");
  const btn = await screen.findByRole("button", { name: named("Restore 0 mails…") });
  expect((btn as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Pick senders…" }) as HTMLButtonElement)
    .disabled).toBe(true);
});

test("a running restore shows its progress and locks the page", async () => {
  const restore: RestoreState = { status: "running", progress: "1/3", error: "",
    seq: 1, steps_done: 1, steps_total: 3, moved: 120 };
  mount({ restore });
  await screen.findByRole("slider");
  const bar = await screen.findByRole("progressbar", { name: "Restoring…" });
  expect(bar.getAttribute("aria-valuenow")).toBe("1");
  expect(bar.getAttribute("aria-valuemax")).toBe("3");
  expect(plain(screen.getByText(/of 3 steps/).textContent))
    .toBe("1 of 3 steps · 120 mails back so far");
  expect((screen.getByRole("button", { name: /^Restore\s\d+\smails…$/ }) as HTMLButtonElement)
    .disabled).toBe(true);
  expect((screen.getByRole("button", { name: starts("14:12 Moved 120 mails") }) as HTMLButtonElement)
    .disabled).toBe(true);
});

test("a phone gets the page: bottom button with the time, a caption, the card",
  async () => {
    mount({ phone: true });
    await settled();
    expect(screen.getByRole("button", { name: /^Restore\s300\smails to 14:\d\d…$/ }))
      .toBeTruthy();
    expect(screen.getByText(/Tap a step to move the line/)).toBeTruthy();
    expect(screen.getByText(/12 mails can't come back; 6 unsubscribes stay\./))
      .toBeTruthy();
    // the card has no buttons of its own here (the bottom one is the action)
    expect(screen.queryByRole("button", { name: named("Restore 300 mails…") })).toBeNull();
    // the pause tick is still there
    expect(screen.getByRole("checkbox")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pick senders…" }));
    expect(await screen.findByText("Pick senders · only these come back")).toBeTruthy();
  });

test("sessions: one bar each; choosing an older one shows its steps and puts " +
  "the line below its newest undoable step", async () => {
  listing.mockResolvedValue({ ...LISTING,
    steps: [...STEPS, OLD],
    sessions: [LISTING.sessions[0],
      { start: at(10, 2, 12), end: at(10, 2, 12), steps: 1, mails: 50,
        first: "o", last: "o" }] });
  mount();
  await settled();
  const bars = screen.getByRole("list", { name: "Cleanup sessions, oldest first" });
  const buttons = within(bars).getAllByRole("button");
  expect(buttons).toHaveLength(2);
  // oldest on the left: the 12 Nov one
  expect(buttons[0].getAttribute("aria-pressed")).toBe("false");
  expect(buttons[1].getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByText("Today, 14:08 - 14:31")).toBeTruthy();
  fireEvent.click(buttons[0]);
  await screen.findByText(/^12 Nov, 10:02 - 10:02$/);
  expect(screen.queryByRole("button", { name: /14:12 Moved/ })).toBeNull();
  expect(screen.getByRole("button", { name: starts("10:02 Moved 50 mails") })).toBeTruthy();
  // the only step is undoable: the line goes below it (point = before all)
  await waitFor(() => expect(preview).toHaveBeenLastCalledWith({ point: "" }));
  expect(screen.getByRole("slider").getAttribute("aria-valuenow")).toBe("1");
});

test("each reason a mail can't come back gets its own line", async () => {
  preview.mockImplementation((body: { point: string }) => Promise.resolve(
    { ...PREVIEW, point: body.point, cant: [
      { reason: "emptied", mails: 12, at: at(14, 31) },
      { reason: "left_trash", mails: 3, at: null },
      { reason: "folder_gone", mails: 2, at: null }] }));
  mount();
  await settled();
  const text = plain(document.body.textContent);
  expect(text).toContain("12 mails can't come back - you emptied Trash at 14:31.");
  expect(text).toContain("3 mails can't come back - they are no longer in Trash.");
  expect(text).toContain("2 mails can't come back - the folder they came from is gone.");
});

test("nothing recorded yet: an empty state, no restore", async () => {
  listing.mockResolvedValue({ ...LISTING, steps: [], sessions: [] });
  mount();
  expect(await screen.findByText("Nothing to go back to yet")).toBeTruthy();
  expect(screen.queryByRole("slider")).toBeNull();
  expect(preview).not.toHaveBeenCalled();
});

test("German: the pills, the notes and the buttons are German", async () => {
  setLang("de");
  mount();
  await screen.findByRole("slider");
  await screen.findByRole("button", { name: named("300 Mails wiederherstellen…") });
  expect(screen.getByText("Kommt zurück")).toBeTruthy();
  expect(screen.getByText("Nicht möglich")).toBeTruthy();
  expect(screen.getByText(/Wiederherstellungspunkt · 14:\d\d/)).toBeTruthy();
  expect(plain(screen.getByText(/Mails kommen zurück/).textContent))
    .toMatch(/^Mails kommen zurück · 412,0 MB$/);
  expect(screen.getByText(/Inboxrake kann dich nicht wieder anmelden/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Absender wählen…" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: named("300 Mails wiederherstellen…") }));
  const dlg = await findDialog();
  expect(plain(dlg.textContent)).toContain(
    "300 Mails so wiederherstellen, wie sie um 14:");
  expect(plain(dlg.textContent)).toContain("Angepinnte und geschützte bleiben, wie sie sind");
});

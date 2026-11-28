// @vitest-environment jsdom
/* "Download 2026...": the dialog of the board - the four kinds with what they
 * hold, the list and the pin, the footer, the split above the cap, the running
 * and failing states, Esc / Cancel, German. */

import { cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { DownloadYear } from "./components/DownloadYear";
import { DialogProvider, ToastProvider } from "./components/ui";
import { KINDS_2026, yearOf } from "./documentsFixtures";
import { setLang } from "./i18n";

const MB = 1024 * 1024;
const year = yearOf(2026, KINDS_2026);
const result = { parts: 1, done: 1, mails: 38, files: 51, skipped: 0,
  pinned: 0 };

const run = vi.fn();
const onResult = vi.fn();
const loadPlan = vi.fn();
const show = (props: Record<string, unknown> = {}) => render(
  <ToastProvider><DialogProvider>
    <DownloadYear year={year} cap={256 * MB} loadPlan={loadPlan} run={run}
      onResult={onResult} {...props} />
  </DialogProvider></ToastProvider>);

/** Counts keep their number and noun together with a no-break space. */
const plain = (s: string | null) => (s ?? "").replace(/\u00a0/g, " ");
const same = (want: string) => (content: string) => plain(content) === want;
const box = (name: string | RegExp) => screen.getByRole("checkbox",
  { name }) as HTMLInputElement;

beforeEach(() => {
  setLang("en");
  run.mockResolvedValue(result);
  loadPlan.mockResolvedValue({ parts: 1 });
});
afterEach(() => {
  cleanup();
  run.mockReset();
  onResult.mockReset();
  loadPlan.mockReset();
  setLang("en");
});

test("the board: four kinds with what they hold, three ticked, the list ticked", () => {
  show();
  expect(screen.getByText("Download your 2026 documents")).toBeTruthy();
  expect(screen.getByText(
    "One .zip, made on your server, nothing sent anywhere else")).toBeTruthy();
  expect(plain(screen.getByRole("dialog").textContent)).toContain(
    "184 files in 151 mails · 21.0 MB");
  for (const [label, on, sub] of [
    ["Invoices & bills", true, "184 files in 151 mails · 21.0 MB"],
    ["Contracts & policies", true, "41 files in 22 mails · 18.0 MB"],
    ["Bookings & tickets", false, "52 files in 26 mails · 9.0 MB"],
    ["Tax & official", true, "35 files in 15 mails · 12.0 MB"]] as const) {
    expect(box(label).checked).toBe(on);
    expect(screen.getByText(same(sub))).toBeTruthy();
  }
  expect(box(/^Add a list \(index\.csv: date, sender, subject, file, amount if known\)/)
    .checked).toBe(true);
  expect(box(/^Also keep these mails safe/).checked).toBe(false);
  // what the ticks come to: the board's 188 mails and 51 MB
  expect(plain(screen.getByText(/^Also keep these mails safe/).textContent))
    .toBe("Also keep these mails safe (protect the 188 mails)");
  expect(screen.getByText(/^51(\.0)?\sMB\s·\sfolders by kind and month$/))
    .toBeTruthy();
  expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
});

test("ticking a kind changes the counts the footer and the pin name", () => {
  show();
  fireEvent.click(box("Bookings & tickets"));
  expect(plain(screen.getByText(/^Also keep these mails safe/).textContent))
    .toBe("Also keep these mails safe (protect the 214 mails)");
  expect(screen.getByText(/^60(\.0)?\sMB\s·/)).toBeTruthy();
  fireEvent.click(box("Invoices & bills"));
  expect(plain(screen.getByText(/^Also keep these mails safe/).textContent))
    .toBe("Also keep these mails safe (protect the 63 mails)");
});

test("nothing ticked, nothing to download; a kind without documents cannot be ticked", () => {
  const empty = yearOf(2026, { ...KINDS_2026,
    tax: { mails: 0, files: 0, bytes: 0 } });
  show({ year: empty });
  expect(box("Tax & official").disabled).toBe(true);
  expect(box("Tax & official").checked).toBe(false);
  for (const k of ["Invoices & bills", "Contracts & policies"])
    fireEvent.click(box(k));
  expect((screen.getByRole("button", { name: "Download" }) as HTMLButtonElement)
    .disabled).toBe(true);
  fireEvent.click(box("Bookings & tickets"));
  expect((screen.getByRole("button", { name: "Download" }) as HTMLButtonElement)
    .disabled).toBe(false);
});

test("above the cap the footer says how many downloads it will be - the server's count", async () => {
  // by the sizes it looks like 3; the server cuts by mails and says 4
  loadPlan.mockResolvedValue({ parts: 4 });
  show({ cap: 20 * MB });
  expect(screen.getByText(
    (c) => /^51(\.0)? MB · 3 downloads of up to 20(\.0)? MB · folders by kind and month$/
      .test(plain(c)))).toBeTruthy();
  expect(await screen.findByText(
    (c) => /^51(\.0)? MB · 4 downloads of up to 20(\.0)? MB · folders by kind and month$/
      .test(plain(c)))).toBeTruthy();
  expect(loadPlan).toHaveBeenCalledWith(["invoices", "contracts", "tax"]);
  // ticking asks again, for the kinds that are ticked
  loadPlan.mockResolvedValue({ parts: 1 });
  fireEvent.click(box("Invoices & bills"));
  await waitFor(() => expect(loadPlan).toHaveBeenLastCalledWith(
    ["contracts", "tax"]));
  expect(await screen.findByText(/^30(\.0)?\sMB\s·\sfolders by kind/))
    .toBeTruthy();
});

test("a plan that cannot be had leaves the estimate and the dialog working", async () => {
  loadPlan.mockRejectedValue(new Error("down"));
  show({ cap: 20 * MB });
  await waitFor(() => expect(loadPlan).toHaveBeenCalled());
  expect(screen.getByText((c) => /3 downloads of up to/.test(plain(c))))
    .toBeTruthy();
  expect((screen.getByRole("button", { name: "Download" }) as HTMLButtonElement)
    .disabled).toBe(false);
});

test("nothing is asked of the server when nothing is ticked", async () => {
  show();
  await waitFor(() => expect(loadPlan).toHaveBeenCalledTimes(1));
  fireEvent.click(box("Invoices & bills"));
  fireEvent.click(box("Contracts & policies"));
  await waitFor(() => expect(loadPlan).toHaveBeenCalledTimes(3));
  expect(loadPlan).toHaveBeenLastCalledWith(["tax"]);
  fireEvent.click(box("Tax & official"));
  expect(loadPlan).toHaveBeenCalledTimes(3);       // none ticked: no plan
});

test("what is ticked is what is asked for", async () => {
  show();
  fireEvent.click(box("Bookings & tickets"));
  fireEvent.click(box("Invoices & bills"));
  fireEvent.click(box(/^Add a list/));
  fireEvent.click(box(/^Also keep these mails safe/));
  fireEvent.click(screen.getByRole("button", { name: "Download" }));
  await waitFor(() => expect(onResult).toHaveBeenCalledWith(result));
  expect(run.mock.calls[0][0]).toEqual({
    kinds: ["contracts", "bookings", "tax"], index: false, pin: true });
});

test("while it runs it says so, nothing can be changed and Esc does nothing", async () => {
  let release: (r: typeof result) => void = () => {};
  run.mockImplementation((_a: unknown, progress: (n: number, of: number) => void) => {
    progress(2, 3);
    return new Promise((r) => { release = r; });
  });
  show();
  fireEvent.click(screen.getByRole("button", { name: "Download" }));
  expect(await screen.findByRole("button", { name: /Download 2 of 3…$/ }))
    .toBeTruthy();
  expect(box("Invoices & bills").disabled).toBe(true);
  expect(box(/^Add a list/).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(onResult).not.toHaveBeenCalled();
  release(result);
  await waitFor(() => expect(onResult).toHaveBeenCalledWith(result));
});

test("several downloads can be stopped after the one that is running", async () => {
  let release: (r: unknown) => void = () => {};
  let seen: { stop: boolean } | null = null;
  run.mockImplementation((_a: unknown, progress: (n: number, of: number) => void,
      state: { stop: boolean }) => {
    seen = state;
    progress(1, 3);
    return new Promise((r) => { release = r; });
  });
  show();
  fireEvent.click(screen.getByRole("button", { name: "Download" }));
  const stop = await screen.findByRole("button",
    { name: "Stop after this download" });
  expect((stop as HTMLButtonElement).disabled).toBe(false);
  expect(seen!.stop).toBe(false);
  fireEvent.click(stop);
  expect(seen!.stop).toBe(true);            // the run ends after this part
  const stopping = screen.getByRole("button", { name: "Stopping…" });
  expect((stopping as HTMLButtonElement).disabled).toBe(true);
  const stopped = { ...result, parts: 3, done: 1, stopped: true };
  release(stopped);
  await waitFor(() => expect(onResult).toHaveBeenCalledWith(stopped));
});

test("one download cannot be stopped half way", async () => {
  run.mockImplementation((_a: unknown, progress: (n: number, of: number) => void) => {
    progress(1, 1);
    return new Promise(() => {});
  });
  show();
  fireEvent.click(screen.getByRole("button", { name: "Download" }));
  const stop = await screen.findByRole("button",
    { name: "Stop after this download" });
  expect((stop as HTMLButtonElement).disabled).toBe(true);
});

test("one download says 'Making the .zip'", async () => {
  run.mockReturnValue(new Promise(() => {}));
  show();
  fireEvent.click(screen.getByRole("button", { name: "Download" }));
  expect(await screen.findByRole("button", { name: /Making the \.zip…$/ }))
    .toBeTruthy();
});

test("a failure stays in the dialog, everything can be changed, Try again asks again", async () => {
  run.mockRejectedValueOnce(new Error("A .zip of your documents is already being made."));
  show();
  fireEvent.click(screen.getByRole("button", { name: "Download" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("already being made");
  expect(onResult).not.toHaveBeenCalled();
  expect(box("Invoices & bills").disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(onResult).toHaveBeenCalledWith(result));
  expect(run).toHaveBeenCalledTimes(2);
});

test("the action takes the focus: nothing here is destructive", () => {
  show();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Download" }));
});

test("a failed part keeps what the earlier ones saved: the run goes on with the same state", async () => {
  const states: unknown[] = [];
  run.mockImplementation(async (_a: unknown, _p: unknown, state: any) => {
    states.push(state);
    if (states.length === 1) {
      state.total = { parts: 3, done: 1, mails: 10, files: 12, skipped: 0,
        pinned: 10 };
      state.next = 2;
      state.pinnedAny = true;
      throw new Error("The list changed.");
    }
    return result;
  });
  show();
  fireEvent.click(screen.getByRole("button", { name: "Download" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(onResult).toHaveBeenCalledWith(result));
  expect(states[1]).toBe(states[0]);            // not a fresh run
});

test("Cancel after a failed part says what was saved (and pinned)", async () => {
  run.mockImplementation(async (_a: unknown, _p: unknown, state: any) => {
    state.total = { parts: 3, done: 1, mails: 10, files: 12, skipped: 0,
      pinned: 10 };
    state.pinnedAny = true;
    throw new Error("The server did not answer.");
  });
  show();
  fireEvent.click(screen.getByRole("button", { name: "Download" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onResult).toHaveBeenCalledWith({ parts: 3, done: 1, mails: 10,
    files: 12, skipped: 0, pinned: 10, stopped: true });
});

test("Cancel and Esc close it without asking for anything", () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onResult).toHaveBeenCalledWith(null);
  expect(run).not.toHaveBeenCalled();
  onResult.mockClear();
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(onResult).toHaveBeenCalledWith(null);
});

test("German: the board's words", () => {
  setLang("de");
  show();
  expect(screen.getByText("Deine Dokumente 2026 herunterladen")).toBeTruthy();
  expect(box("Rechnungen & Belege").checked).toBe(true);
  expect(box("Buchungen & Tickets").checked).toBe(false);
  expect(plain(screen.getByRole("dialog").textContent)).toContain(
    "184 Dateien in 151 Mails · 21,0 MB");
  expect(box(/^Eine Liste hinzufügen \(index\.csv/)).toBeTruthy();
  expect(plain(screen.getByText(/^Diese Mails auch sicher behalten/).textContent))
    .toBe("Diese Mails auch sicher behalten (die 188 Mails schützen)");
  expect(screen.getByRole("button", { name: "Herunterladen" })).toBeTruthy();
  expect(within(screen.getByRole("dialog")).getByText(/Ordner nach Art und Monat/))
    .toBeTruthy();
});

test("German: stopping", async () => {
  setLang("de");
  run.mockImplementation((_a: unknown, progress: (n: number, of: number) => void) => {
    progress(1, 2);
    return new Promise(() => {});
  });
  show();
  fireEvent.click(screen.getByRole("button", { name: "Herunterladen" }));
  fireEvent.click(await screen.findByRole("button",
    { name: "Nach diesem Download anhalten" }));
  expect(screen.getByRole("button", { name: "Wird angehalten…" })).toBeTruthy();
});

test("once a part is saved the choices are locked, and Try again goes on with them", async () => {
  const seen: { plan: unknown; kinds: string[] }[] = [];
  run.mockImplementation(async (a: any, _p: unknown, state: any) => {
    seen.push({ plan: state, kinds: a.kinds });
    if (seen.length === 1) {
      state.plan = { kinds: a.kinds, parts: 3 };
      state.total = { parts: 3, done: 1, mails: 10, files: 12, skipped: 0,
        pinned: 0 };
      state.next = 2;
      throw new Error("The server did not answer.");
    }
    return result;
  });
  show();
  fireEvent.click(screen.getByRole("button", { name: "Download" }));
  await screen.findByRole("alert");
  // nothing can be changed any more, and it says why
  for (const k of ["Invoices & bills", "Contracts & policies",
    "Bookings & tickets", "Tax & official"])
    expect(box(k).disabled).toBe(true);
  expect(box(/^Add a list/).disabled).toBe(true);
  expect(box(/^Also keep these mails safe/).disabled).toBe(true);
  expect(screen.getByText(
    "Some downloads are saved already: Try again goes on with the same choices."))
    .toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(onResult).toHaveBeenCalledWith(result));
  expect(seen[1].plan).toBe(seen[0].plan);          // the same run
  expect(seen[1].kinds).toEqual(seen[0].kinds);     // the same ticks
});

test("a choice changed before anything was saved starts a new run", async () => {
  const states: any[] = [];
  run.mockImplementation(async (_a: unknown, _p: unknown, state: any) => {
    states.push(state);
    if (states.length === 1) {
      state.plan = { kinds: ["invoices", "contracts", "tax"], parts: 2 };
      throw new Error("The list changed.");
    }
    return result;
  });
  show();
  fireEvent.click(screen.getByRole("button", { name: "Download" }));
  await screen.findByRole("alert");
  // nothing was saved: the ticks are free, and the old plan is not kept
  expect(box("Tax & official").disabled).toBe(false);
  expect(screen.queryByText(/Some downloads are saved already/)).toBeNull();
  fireEvent.click(box("Tax & official"));
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(onResult).toHaveBeenCalledWith(result));
  expect(states[1]).not.toBe(states[0]);
  expect(states[1].plan).toBeNull();
  expect(run.mock.calls[1][0].kinds).toEqual(["invoices", "contracts"]);
});

test("German: the lock says so", async () => {
  setLang("de");
  run.mockImplementation(async (_a: unknown, _p: unknown, state: any) => {
    state.total = { parts: 2, done: 1, mails: 1, files: 1, skipped: 0,
      pinned: 0 };
    throw new Error("x");
  });
  show();
  fireEvent.click(screen.getByRole("button", { name: "Herunterladen" }));
  await screen.findByRole("alert");
  expect(screen.getByText(
    "Einige Downloads sind schon gespeichert: Erneut versuchen macht mit denselben Einstellungen weiter."))
    .toBeTruthy();
});

// @vitest-environment jsdom
/* Tools -> Trackers: the states (no scan / no index / not checked yet /
 * partial coverage / data), the sender tap, "Check older mails" with its
 * confirm, and German. */

import { cleanup, fireEvent, render, screen, waitFor }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { TrackersPanel } from "./components/TrackersPanel";
import { DialogProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog }
  from "./dialogTestUtils";
import { setLang } from "./i18n";
import type { TrackerReport } from "./types";

const trackers = vi.fn();
const indexBuild = vi.fn();

vi.mock("./api", () => ({
  api: {
    trackers: () => trackers(),
    indexBuild: (...a: unknown[]) => indexBuild(...a),
  },
  fmtSize: (b: number) => `${b} B`,
}));

const est = { mails: 40, bytes: 4000, bytes_max: 8000, free: 100000 };
const rep = (over: Partial<TrackerReport> = {}): TrackerReport => ({
  usable: true, reason: null, docs: 40, checked: 40, pixel: 25, click: 30,
  any: 32, senders: 2,
  top_senders: [
    { key: "news@shop.example", label: "Shop News", checked: 20,
      tracked: 18, pixel: 18, click: 20, hosts: ["pix.example"] },
    { key: "deals@promo.example", label: "Promo Deals", checked: 10,
      tracked: 1, pixel: 0, click: 1, hosts: [] },
  ],
  top_hosts: [{ host: "pix.example", mails: 18, senders: 1 },
    { host: "go.example", mails: 1, senders: 1 }],
  mode: "local", secret_key_set: true, scanned: true, estimate_full: est,
  job: { status: "idle", progress: "", error: "", done: 0, total: 0 },
  ...over,
});

const onPick = vi.fn();
const onShowAll = vi.fn();
const show = () => render(<DialogProvider>
  <TrackersPanel account="main" onClose={() => {}} onPickSender={onPick} onShowAll={onShowAll} />
</DialogProvider>);

beforeEach(() => setLang("en"));
afterEach(() => {
  cleanup();
  trackers.mockReset();
  indexBuild.mockReset();
  onPick.mockReset();
  onShowAll.mockReset();
  setLang("en");
});

test("data: headline share, numbers, senders, hosts and the explainer",
  async () => {
    trackers.mockResolvedValue(rep());
    show();
    await screen.findByText("of the mails we checked carry a tracking pixel");
    expect(screen.getByRole("img", { name: "63% of the mails we checked "
      + "carry a tracking pixel" })).toBeTruthy();
    expect(screen.getByText("63%")).toBeTruthy();
    expect(screen.getByText(/remote images never load/)).toBeTruthy();
    expect(screen.getByText("Checked 40 of 40 mails")).toBeTruthy();
    // the three figures say what they count (not a bare "pixel")
    expect(screen.getByText("mails with a pixel")).toBeTruthy();
    expect(screen.getByText("mails with tracked links")).toBeTruthy();
    expect(screen.getByText("Shop News")).toBeTruthy();
    // the hosts of a sender get a line of their own (they wrapped 3-5 lines
    // beside the pills); the host list below shows the same name
    expect(screen.getByText("18 of 20 mails tracked")).toBeTruthy();
    expect(screen.getAllByText("pix.example")).toHaveLength(2);
    expect(screen.getByText(/18 mails · 1 sender$/)).toBeTruthy();
    // full coverage: nothing to check
    expect(screen.queryByRole("button", { name: "Check older mails" }))
      .toBeNull();
  });

const many = (n: number) => Array.from({ length: n }, (_, i) => ({
  key: `s${i}@track.example`, label: `Sender ${i + 1}`, checked: 3,
  tracked: 3, pixel: 3, click: i === 0 ? 2 : 0, hosts: ["pix.example"] }));

test("the senders list shows the top 6 and a Show all N for the rest",
  async () => {
    trackers.mockResolvedValue(rep({ top_senders: many(9) }));
    show();
    await screen.findByText("Sender 1");
    expect(screen.getByText("Sender 6")).toBeTruthy();
    expect(screen.queryByText("Sender 7")).toBeNull();
    const all = screen.getByRole("button", { name: "Show all 9" });
    expect(all.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(all);
    expect(screen.getByText("Sender 9")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(screen.queryByText("Sender 7")).toBeNull();
  });

test("six senders or fewer: no Show all", async () => {
  trackers.mockResolvedValue(rep({ top_senders: many(6) }));
  show();
  await screen.findByText("Sender 6");
  expect(screen.queryByRole("button", { name: /^Show all \d/ })).toBeNull();
});

test("a sender row keeps its chips on the name line and reads the plural "
  + "from the total", async () => {
  trackers.mockResolvedValue(rep({ top_senders: [
    { key: "a@one.example", label: "One Mail", checked: 1, tracked: 1,
      pixel: 1, click: 1, hosts: ["pix.example"] },
    { key: "b@two.example", label: "Two Mails", checked: 5, tracked: 1,
      pixel: 1, click: 0, hosts: [] }] }));
  show();
  const row = (await screen.findByRole("button",
    { name: "Show mails from One Mail" }));
  // chips beside the name, the count line is one line with the hosts
  const nameLine = screen.getByText("One Mail").parentElement!;
  expect(nameLine.textContent).toContain("opens");
  expect(nameLine.textContent).toContain("clicks");
  expect(row.textContent).toContain("1 of 1\u00a0mail tracked");
  expect(screen.getByRole("button", { name: "Show mails from Two Mails" })
    .textContent).toContain("1 of 5\u00a0mails tracked");
  setLang("de");
  cleanup();
  show();
  expect((await screen.findByRole("button",
    { name: "Mails von One Mail anzeigen" })).textContent)
    .toContain("1 von 1\u00a0Mail mit Tracking");
});

test("tapping a sender hands its address to the caller", async () => {
  trackers.mockResolvedValue(rep());
  show();
  fireEvent.click(await screen.findByRole("button",
    { name: "Show mails from Shop News" }));
  expect(onPick).toHaveBeenCalledWith("news@shop.example");
});

test("Show all in Senders hands over to the caller", async () => {
  trackers.mockResolvedValue(rep());
  show();
  fireEvent.click(await screen.findByRole("button",
    { name: "Show all in Senders" }));
  expect(onShowAll).toHaveBeenCalled();
});

test("no index: explains, offers the build behind the confirm", async () => {
  trackers.mockResolvedValue(rep({ usable: false, reason: "index_missing",
    docs: 0, checked: 0, top_senders: [], top_hosts: [] }));
  show();
  await screen.findByText("No body index yet");
  expect(screen.getByText(/detected while the local body index is built/))
    .toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Build the body index" }));
  const dlg = await findDialog();
  expect(dlg.textContent).toContain("40 scanned mails");
  await cancelDialog();
  await expectNoDialog();
  expect(indexBuild).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Build the body index" }));
  await pressDialog("Build the body index");
  await waitFor(() => expect(indexBuild).toHaveBeenCalledWith("main", false));
});

test("no index and local mode off / no key: only the explanation",
  async () => {
    trackers.mockResolvedValue(rep({ usable: false, docs: 0, checked: 0,
      mode: "server", top_senders: [], top_hosts: [] }));
    show();
    await screen.findByText(/Switch mail-text search to/);
    expect(screen.queryByRole("button", { name: "Build the body index" }))
      .toBeNull();
  });

test("index without tracker rows: 'Not checked yet' + Check older mails",
  async () => {
    trackers.mockResolvedValue(rep({ checked: 0, pixel: 0, click: 0, any: 0,
      senders: 0, top_senders: [], top_hosts: [] }));
    show();
    await screen.findByText("Not checked yet");
    fireEvent.click(screen.getByRole("button", { name: "Check older mails" }));
    await pressDialog("Check older mails");
    await waitFor(() => expect(indexBuild).toHaveBeenCalledWith("main", true));
  });

test("partial coverage shows 'Checked N of M' and Check older mails "
  + "(cancel does nothing)", async () => {
  trackers.mockResolvedValue(rep({ docs: 100, checked: 40 }));
  show();
  await screen.findByText("Checked 40 of 100 mails");
  fireEvent.click(screen.getByRole("button", { name: "Check older mails" }));
  const dlg = await findDialog();
  expect(dlg.textContent).toContain("tracking pixels and click-tracking");
  await cancelDialog();
  await expectNoDialog();
  expect(indexBuild).not.toHaveBeenCalled();
});

test("a running job shows progress instead of the report", async () => {
  trackers.mockResolvedValue(rep({
    job: { status: "running", progress: "5/40", error: "", done: 5,
      total: 40 } }));
  show();
  await screen.findAllByText(/Checking mails/);
  expect(screen.queryByText("Shop News")).toBeNull();
});

test("no scan yet", async () => {
  trackers.mockResolvedValue(rep({ scanned: false, usable: false }));
  show();
  await screen.findByText("Scan your mailbox first");
});

test("checked mails without any tracking say so", async () => {
  trackers.mockResolvedValue(rep({ pixel: 0, click: 0, any: 0, senders: 0,
    top_senders: [], top_hosts: [] }));
  show();
  await screen.findByText("No tracking pixels found in the mails we checked");
  expect(screen.getByText("No tracking found in the 40 checked mails."))
    .toBeTruthy();
});

test("German", async () => {
  setLang("de");
  trackers.mockResolvedValue(rep());
  show();
  await screen.findByText("der geprüften Mails tragen ein Tracking-Pixel");
  expect(screen.getByText("40 von 40 Mails geprüft")).toBeTruthy();
  expect(screen.getByText("Am meisten Tracking")).toBeTruthy();
  expect(screen.getByText("Mails mit Pixel")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Mails von Shop News anzeigen" }))
    .toBeTruthy();
});

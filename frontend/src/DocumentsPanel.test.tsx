// @vitest-environment jsdom
/* Insights > Your documents: the years, the four kinds, the rows of the board
 * (open the mail, download its file, keep it safe), the states before there is
 * anything to show (scan first, Analyze first, nothing found), the phone
 * layout and German. */

import { act, cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const documentsSummary = vi.fn();
const documents = vi.fn();
const downloadDocument = vi.fn();
const pin = vi.fn();
const cancel = vi.fn();
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: {
    documentsSummary: () => documentsSummary(),
    documents: (...a: unknown[]) => documents(...a),
    downloadDocument: (...a: unknown[]) => downloadDocument(...a),
    pin: (...a: unknown[]) => pin(...a),
    cancel: (...a: unknown[]) => cancel(...a),
  },
}));
// the reader is its own tested component: here only what the page hands it
vi.mock("./components/MailList", () => ({
  MessageView: (p: { mail: { subject: string; pinned?: boolean };
      backLabel?: string; onBack: () => void;
      actions?: { pinned?: (m: unknown, on: boolean) => void };
      nav?: { list: { subject: string }[] } }) => (
    <div data-testid="reader">
      <span>{p.mail.subject}</span>
      <span data-testid="reader-pinned">{String(p.mail.pinned)}</span>
      <span data-testid="reader-list">
        {(p.nav?.list ?? []).map((m) => m.subject).join("|")}</span>
      <button onClick={p.onBack}>Back to {p.backLabel}</button>
      <button onClick={() => p.actions?.pinned?.(p.mail, true)}>told pinned
      </button>
    </div>),
}));

import { DocumentsPanel } from "./components/DocumentsPanel";
import { DialogProvider, ToastProvider } from "./components/ui";
import { KINDS_2026, ROWS, page, row, summary } from "./documentsFixtures";
import { setLang } from "./i18n";

/** matchMedia for one viewport width; `coarse` = a touch screen. */
const viewport = (width: number, coarse = false) =>
  vi.stubGlobal("matchMedia", (q: string) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*(\d+)px/.exec(q);
    const matches = q.includes("pointer: coarse") ? coarse
      : (!min || width >= +min[1]) && (!max || width <= +max[1])
        && !q.includes("pointer") && !q.includes("reduced");
    return { matches, media: q, addEventListener: () => {},
      removeEventListener: () => {} };
  });

/** Counts keep their number and noun together with a no-break space. */
const plain = (s: string | null) => (s ?? "").replace(/\u00a0/g, " ");
/** A text matcher that ignores the no-break spaces. */
const same = (want: string) => (content: string) => plain(content) === want;
const PROTECT = /^Protect this mail/;
const UNPROTECT = "Remove this mail's protection";

const onClose = vi.fn();
const onAnalyze = vi.fn();
const show = (props: Record<string, unknown> = {}) => render(
  <ToastProvider><DialogProvider>
    <DocumentsPanel account="proton" scannedTs={1} onClose={onClose}
      onAnalyze={onAnalyze} {...props} />
  </DialogProvider></ToastProvider>);

beforeEach(() => {
  setLang("en");
  viewport(1440);
  documentsSummary.mockResolvedValue(summary());
  documents.mockImplementation(async (y: number) =>
    y === 2026 ? page() : page({ year: y, total: 1, rows: [row({
      subject: `Invoice ${y}-001`, uid: 100 + (y % 100) })] }));
  downloadDocument.mockResolvedValue(undefined);
  pin.mockResolvedValue({ ok: true, pinned: true });
  cancel.mockResolvedValue({ ok: true });
  onAnalyze.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const f of [documentsSummary, documents, downloadDocument, pin, cancel,
    onClose, onAnalyze]) f.mockReset();
  setLang("en");
});

const rows = () => screen.getAllByTestId("doc-row");

/* --------------------------------- desktop -------------------------------- */

test("the board: header, the three years, four kinds, six rows", async () => {
  show();
  expect(await screen.findByText(same("312 documents in 214 mails · 2026")))
    .toBeTruthy();
  expect(screen.getByText("Your documents")).toBeTruthy();
  // the years, oldest first, the newest selected
  const years = screen.getByRole("radiogroup", { name: "Year" });
  expect(within(years).getAllByRole("radio").map((r) => r.textContent))
    .toEqual(["2024", "2025", "2026"]);
  expect(within(years).getByRole("radio", { name: "2026" })
    .getAttribute("aria-checked")).toBe("true");
  // the four kinds with what each holds
  const kinds = screen.getByRole("group", { name: "Kind of document" });
  const text = (kinds.textContent ?? "").replace(/\u00a0/g, " ");
  for (const [label, n] of [["Invoices & bills", 184],
    ["Contracts & policies", 41], ["Bookings & tickets", 52],
    ["Tax & official", 35]])
    expect(text).toContain(`${label}${n} documents`);
  // the rows, newest first
  await waitFor(() => expect(rows()).toHaveLength(6));
  const first = rows()[0];
  expect(first.textContent).toContain("24 Nov");
  expect(first.textContent).toContain("Invoice 2026-1187");
  expect(first.textContent).toContain("Northwind Invoices");
  expect(plain(first.textContent)).toContain("invoice-2026-1187.pdf · 84 KB");
  expect(first.textContent).toContain("Invoices & bills");
  expect(plain(rows()[3].textContent))
    .toContain("policy.pdf · 1.2 MB · terms.pdf · 380 KB");
  expect(rows()[3].textContent).toContain("Contracts & policies");
  expect(rows()[5].textContent).toContain("Tax & official");
  // what the page says it does
  expect(screen.getByText(/Files are read from your mail server only when you download them/))
    .toBeTruthy();
});

test("a year is picked from the switch and its rows are read", async () => {
  show();
  await waitFor(() => expect(rows()).toHaveLength(6));
  fireEvent.click(screen.getByRole("radio", { name: "2025" }));
  expect(await screen.findByText("Invoice 2025-001")).toBeTruthy();
  expect(documents).toHaveBeenLastCalledWith(2025);
  expect(rows()).toHaveLength(1);
  expect(screen.getByText(/· 2025$/)).toBeTruthy();
});

test("a kind tile narrows the rows and a second press shows all again", async () => {
  show();
  await waitFor(() => expect(rows()).toHaveLength(6));
  const tile = screen.getByRole("button", { name: /^Invoices & bills/ });
  expect(tile.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(tile);
  expect(tile.getAttribute("aria-pressed")).toBe("true");
  expect(rows()).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: /^Tax & official/ }));
  expect(rows()).toHaveLength(1);
  expect(rows()[0].textContent).toContain("Bescheid für 2025");
  fireEvent.click(screen.getByRole("button", { name: /^Tax & official/ }));
  expect(rows()).toHaveLength(6);
});

test("a kind with nothing in the year says so", async () => {
  documents.mockResolvedValue(page({ rows: ROWS.filter((r) => r.kind !== "tax"),
    total: 5 }));
  show();
  await waitFor(() => expect(rows()).toHaveLength(5));
  fireEvent.click(screen.getByRole("button", { name: /^Tax & official/ }));
  expect(screen.getByText("No documents of this kind in this year")).toBeTruthy();
  expect(screen.queryAllByTestId("doc-row")).toHaveLength(0);
});

test("download: one file is one tap, with the server's answer shown on a failure", async () => {
  show();
  await waitFor(() => expect(rows()).toHaveLength(6));
  fireEvent.click(within(rows()[0]).getByRole("button",
    { name: "Download invoice-2026-1187.pdf" }));
  await waitFor(() => expect(downloadDocument).toHaveBeenCalledWith(
    "INBOX", 1, { name: "invoice-2026-1187.pdf", size: 84 * 1024 }));
  // nothing is sent anywhere else and no mail is opened by it
  expect(screen.queryByTestId("reader")).toBeNull();
  downloadDocument.mockRejectedValueOnce(
    new Error("That document is not in the list any more."));
  fireEvent.click(within(rows()[1]).getByRole("button",
    { name: "Download cloudbox-nov.pdf" }));
  expect(await screen.findByText("That document is not in the list any more."))
    .toBeTruthy();
});

test("download: a mail with two files offers each of them in a menu", async () => {
  show();
  await waitFor(() => expect(rows()).toHaveLength(6));
  const trigger = within(rows()[3]).getByRole("button",
    { name: /^Download one of the 2\sfiles$/ });
  fireEvent.click(trigger);
  const items = screen.getAllByRole("menuitem");
  expect(items.map((i) => plain(i.textContent))).toEqual([
    "policy.pdf1.2 MB", "terms.pdf380 KB"]);
  fireEvent.click(items[1]);
  await waitFor(() => expect(downloadDocument).toHaveBeenCalledWith(
    "INBOX", 4, { name: "terms.pdf", size: 380 * 1024 }));
  expect(downloadDocument).toHaveBeenCalledTimes(1);
});

test("a download in flight cannot be started twice", async () => {
  let done: () => void = () => {};
  downloadDocument.mockReturnValue(new Promise<void>((r) => { done = r; }));
  show();
  await waitFor(() => expect(rows()).toHaveLength(6));
  const name = "Download invoice-2026-1187.pdf";
  fireEvent.click(within(rows()[0]).getByRole("button", { name }));
  await waitFor(() => expect(
    (within(rows()[0]).getByRole("button", { name }) as HTMLButtonElement)
      .disabled).toBe(true));
  fireEvent.click(within(rows()[0]).getByRole("button", { name }));
  expect(downloadDocument).toHaveBeenCalledTimes(1);
  await act(async () => { done(); });
  await waitFor(() => expect(
    (within(rows()[0]).getByRole("button", { name }) as HTMLButtonElement)
      .disabled).toBe(false));
});

test("a file of a menu cannot be asked for twice while it is on its way", async () => {
  downloadDocument.mockReturnValue(new Promise<void>(() => {}));
  show();
  await waitFor(() => expect(rows()).toHaveLength(6));
  const pick = () => {
    fireEvent.click(within(rows()[3]).getByRole("button",
      { name: /^Download one of the 2\sfiles$/ }));
    fireEvent.click(screen.getAllByRole("menuitem")[1]);
  };
  pick();
  await waitFor(() => expect(downloadDocument).toHaveBeenCalledTimes(1));
  pick();
  expect(downloadDocument).toHaveBeenCalledTimes(1);
});

test("keep it safe: the pin is the app's own protect, per row", async () => {
  show();
  await waitFor(() => expect(rows()).toHaveLength(6));
  const protect = within(rows()[0]).getByRole("button",
    { name: PROTECT });
  expect(protect.getAttribute("aria-pressed")).toBe("false");
  // the Bescheid is pinned already
  expect(within(rows()[5]).getByRole("button",
    { name: UNPROTECT })
    .getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(protect);
  await waitFor(() => expect(pin).toHaveBeenCalledWith("INBOX", 1, true));
  await waitFor(() => expect(within(rows()[0]).getByRole("button",
    { name: UNPROTECT })
    .getAttribute("aria-pressed")).toBe("true"));
  fireEvent.click(within(rows()[5]).getByRole("button",
    { name: UNPROTECT }));
  await waitFor(() => expect(pin).toHaveBeenCalledWith("INBOX", 6, false));
});

test("a pin that fails stays off and says why", async () => {
  pin.mockRejectedValueOnce(new Error("boom"));
  show();
  await waitFor(() => expect(rows()).toHaveLength(6));
  fireEvent.click(within(rows()[0]).getByRole("button",
    { name: PROTECT }));
  expect(await screen.findByText(/boom/)).toBeTruthy();
  expect(within(rows()[0]).getByRole("button",
    { name: PROTECT })
    .getAttribute("aria-pressed")).toBe("false");
});

test("a mail without a Message-ID cannot be pinned, but can be downloaded", async () => {
  documents.mockResolvedValue(page({ rows: [row({ pinnable: false })],
    total: 1 }));
  show();
  await waitFor(() => expect(rows()).toHaveLength(1));
  expect((within(rows()[0]).getByRole("button",
    { name: PROTECT }) as HTMLButtonElement)
    .disabled).toBe(true);
  expect((within(rows()[0]).getByRole("button",
    { name: "Download invoice-2026-1187.pdf" }) as HTMLButtonElement)
    .disabled).toBe(false);
});

test("a row opens the mail in the reader, with the list for Previous / Next", async () => {
  show();
  await waitFor(() => expect(rows()).toHaveLength(6));
  fireEvent.click(within(rows()[3]).getByText("Your policy documents"));
  expect(await screen.findByTestId("reader")).toBeTruthy();
  expect(screen.getByTestId("reader").textContent)
    .toContain("Your policy documents");
  expect(screen.getByTestId("reader-pinned").textContent).toBe("false");
  expect(screen.getByTestId("reader-list").textContent).toBe(ROWS.map(
    (r) => r.subject).join("|"));
  // a pin made in the reader is shown on the row afterwards
  fireEvent.click(screen.getByText("told pinned"));
  fireEvent.click(screen.getByText("Back to Your documents"));
  await waitFor(() => expect(rows()).toHaveLength(6));
  expect(within(rows()[3]).getByRole("button",
    { name: UNPROTECT })).toBeTruthy();
});

test("the reader's list follows the kind that is picked", async () => {
  show();
  await waitFor(() => expect(rows()).toHaveLength(6));
  fireEvent.click(screen.getByRole("button", { name: /^Invoices & bills/ }));
  fireEvent.click(within(rows()[0]).getByText("Invoice 2026-1187"));
  expect((await screen.findByTestId("reader-list")).textContent)
    .toBe("Invoice 2026-1187|Your invoice for November|Ihre Jahresabrechnung 2025");
});

test("the newest documents are listed when there are more than the page holds", async () => {
  documents.mockResolvedValue(page({ capped: true, total: 7000 }));
  show();
  expect(await screen.findByText(same("Showing the newest 6 documents of this year.")))
    .toBeTruthy();
});

/* ------------------------------ before there is a list --------------------- */

test("the mails are not scanned yet", async () => {
  documentsSummary.mockResolvedValue(summary({ scanned: false, analyzed: false,
    years: [] }));
  show();
  expect(await screen.findByText("Scan your mailbox first")).toBeTruthy();
  expect(documents).not.toHaveBeenCalled();
});

test("Analyze comes first: the card of the board, then the analysis runs", async () => {
  documentsSummary.mockResolvedValue(summary({ analyzed: false, years: [] }));
  show();
  expect(await screen.findByText("Find your documents")).toBeTruthy();
  expect(screen.getByText(
    "Inboxrake reads which mails carry files once (as on the Attachments page)."))
    .toBeTruthy();
  expect(documents).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
  await waitFor(() => expect(onAnalyze).toHaveBeenCalledOnce());
});

test("a failed analysis start is shown, and Analyze can be tried again", async () => {
  documentsSummary.mockResolvedValue(summary({ analyzed: false, years: [] }));
  onAnalyze.mockRejectedValueOnce(new Error("busy"));
  show({ atts: { status: "error", progress: "", error: "IMAP broke",
    mails: 0, size: 0 } });
  fireEvent.click(await screen.findByRole("button", { name: "Analyze" }));
  expect(await screen.findByText("busy")).toBeTruthy();
  expect(screen.getByText("IMAP broke")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
  await waitFor(() => expect(onAnalyze).toHaveBeenCalledTimes(2));
});

test("while the analysis runs its progress shows, and it can be cancelled", async () => {
  documentsSummary.mockResolvedValue(summary({ analyzed: false, years: [] }));
  show({ atts: { status: "running", progress: "INBOX: 600/1200", mails: 0,
    size: 0 } });
  expect(await screen.findByText("INBOX: 600/1200")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "cancel" }));
  expect(cancel).toHaveBeenCalledWith("atts");
});

test("when the analysis finishes the list is read", async () => {
  documentsSummary.mockResolvedValue(summary({ analyzed: false, years: [] }));
  const { rerender } = show({ atts: { status: "running", progress: "x",
    mails: 0, size: 0 } });
  await screen.findByText("x");
  documentsSummary.mockResolvedValue(summary());
  rerender(
    <ToastProvider><DialogProvider>
      <DocumentsPanel account="proton" scannedTs={1} onClose={onClose}
        onAnalyze={onAnalyze}
        atts={{ status: "done", progress: "", error: "", mails: 3, size: 1 }} />
    </DialogProvider></ToastProvider>);
  await waitFor(() => expect(rows()).toHaveLength(6));
});

test("analysed, but no document found", async () => {
  documentsSummary.mockResolvedValue(summary({ years: [] }));
  show();
  expect(await screen.findByText("No documents found yet")).toBeTruthy();
});

test("a list that cannot be read offers to try again", async () => {
  documentsSummary.mockRejectedValueOnce(new Error("down"));
  show();
  expect(await screen.findByText("Your documents could not be loaded.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(rows()).toHaveLength(6));
});

test("a year whose rows cannot be read offers to try again", async () => {
  documents.mockRejectedValueOnce(new Error("down"));
  show();
  expect(await screen.findByText("Your documents could not be loaded.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(rows()).toHaveLength(6));
});

test("a new scan reads the list again", async () => {
  const { rerender } = show();
  await waitFor(() => expect(rows()).toHaveLength(6));
  const calls = documentsSummary.mock.calls.length;
  rerender(
    <ToastProvider><DialogProvider>
      <DocumentsPanel account="proton" scannedTs={2} onClose={onClose}
        onAnalyze={onAnalyze} />
    </DialogProvider></ToastProvider>);
  await waitFor(() => expect(documentsSummary.mock.calls.length)
    .toBeGreaterThan(calls));
});

test("many years are a menu, not a row of buttons", async () => {
  documentsSummary.mockResolvedValue(summary({ years: Array.from(
    { length: 8 }, (_, i) => ({ year: 2019 + i, mails: 1, files: 1, bytes: 1,
      kinds: { ...KINDS_2026 } })) }));
  show();
  await waitFor(() => expect(rows()).toHaveLength(6));
  expect(screen.queryByRole("radiogroup", { name: "Year" })).toBeNull();
  expect(screen.getByRole("button", { name: /^Year/ })).toBeTruthy();
});

/* ----------------------------------- phone --------------------------------- */

test("phone: the same page, the year switch in the body, the day in the meta line", async () => {
  viewport(390, true);
  show();
  await waitFor(() => expect(rows()).toHaveLength(6));
  const years = screen.getByRole("radiogroup", { name: "Year" });
  expect(years.closest("[data-scroll-id]")).toBeTruthy();
  expect(rows()[0].textContent).toContain("24 Nov");
  for (const n of ["Download invoice-2026-1187.pdf"])
    expect(within(rows()[0]).getByRole("button", { name: n })).toBeTruthy();
  expect(within(rows()[0]).getByRole("button",
    { name: PROTECT })).toBeTruthy();
  expect(screen.getByRole("group", { name: "Kind of document" })).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "2025" }));
  expect(await screen.findByText("Invoice 2025-001")).toBeTruthy();
});

/* ----------------------------------- German -------------------------------- */

test("German: every word of the page", async () => {
  setLang("de");
  show();
  expect(await screen.findByText(same("312 Dokumente in 214 Mails · 2026")))
    .toBeTruthy();
  expect(screen.getByText("Deine Dokumente")).toBeTruthy();
  const kinds = screen.getByRole("group", { name: "Art des Dokuments" });
  const text = (kinds.textContent ?? "").replace(/\u00a0/g, " ");
  for (const [label, n] of [["Rechnungen & Belege", 184],
    ["Verträge & Policen", 41], ["Buchungen & Tickets", 52],
    ["Steuern & Behörden", 35]])
    expect(text).toContain(`${label}${n} Dokumente`);
  await waitFor(() => expect(rows()).toHaveLength(6));
  expect(within(rows()[0]).getByRole("button",
    { name: "invoice-2026-1187.pdf herunterladen" })).toBeTruthy();
  expect(within(rows()[3]).getByRole("button",
    { name: /^Eine der 2\sDateien herunterladen$/ })).toBeTruthy();
  expect(rows()[0].textContent).toContain("24. Nov");
  expect(screen.getByText(/„Sicher behalten“/)).toBeTruthy();
});

test("German: the states before a list", async () => {
  setLang("de");
  documentsSummary.mockResolvedValue(summary({ analyzed: false, years: [] }));
  show();
  expect(await screen.findByText("Deine Dokumente finden")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Analysieren" })).toBeTruthy();
  cleanup();
  documentsSummary.mockResolvedValue(summary({ scanned: false, years: [] }));
  show();
  expect(await screen.findByText("Scanne zuerst dein Postfach")).toBeTruthy();
});

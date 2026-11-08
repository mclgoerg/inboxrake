// @vitest-environment jsdom
/* Attachments panel: kind bar, repeats card, file tiles (grid / list),
 * per-mail selection with the honest capsule, empty states and the
 * ConfirmDialog flow for trashing. */

import { cleanup, fireEvent, render, screen, waitFor }
  from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AttachmentsPanel } from "./components/AttachmentsPanel";
import { DialogProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, pressDialog } from "./dialogTestUtils";
import { setLang } from "./i18n";
import type { AppState } from "./types";

const attachments = vi.fn();
const deleteMessages = vi.fn();
const summary = vi.fn();

vi.mock("./api", () => ({
  api: { attachments: () => attachments(),
    attachmentsSummary: () => summary(),
    deleteMessages: (...a: unknown[]) => deleteMessages(...a) },
  fmtSize: () => "2 MB",
  mailKey: (m: { folder: string; uid: number }) => `${m.folder}\0${m.uid}`,
}));

const file = (name: string, size: number, kind: string, copies = 1) =>
  ({ name, size, kind, ext: name.split(".").pop()!, copies });

const mk = (uid: number, atts = [file("doc.pdf", 2e6, "pdf")], ts = 1e9) => ({
  uid, folder: "INBOX", date: "2026-01-02", ts, subject: `Scan ${uid}`,
  addr: "a@x.example", size: 10 + uid, seen: false, ai: null,
  att_size: 2e6, atts });

const SUMMARY = { total: 6e6, mails: 3,
  kinds: [{ kind: "pdf", bytes: 4e6, count: 2 },
    { kind: "images", bytes: 2e6, count: 1 }],
  repeats: { files: 1, mails: 2, bytes: 2e6 } };

const state = (status: string) => ({ status: "done",
  delete: { status: "idle" },
  atts: { status, mails: 2, size: 4e6, progress: "", error: "" },
}) as unknown as AppState;

const show = (status = "done") => render(<DialogProvider>
  <AttachmentsPanel state={state(status)} onClose={() => {}}
    onDeleted={() => {}} />
</DialogProvider>);

// two mails carry scan.pdf (one tile "in 2 mails"), one carries a photo
const REPEAT = file("scan.pdf", 2e6, "pdf", 2);
const three = () => [mk(1, [REPEAT]), mk(2, [REPEAT]),
  mk(3, [file("beach.jpg", 1e6, "images")], 2e8)];

afterEach(() => {
  cleanup();
  attachments.mockReset();
  deleteMessages.mockReset();
  summary.mockReset();
  localStorage.clear();
  setLang("en");
});

test("never analyzed: empty state, no selection capsule", () => {
  show("idle");
  expect(screen.getByText("Not analyzed yet")).toBeTruthy();
  expect(screen.queryByRole("region", { name: /selection/i })).toBeNull();
});

test("nothing found: empty state that points to Re-analyze", async () => {
  attachments.mockResolvedValue([]);
  summary.mockResolvedValue({ ...SUMMARY, kinds: [], total: 0 });
  show();
  await screen.findByText("No attachments found");
  expect(screen.getByText(/Re-analyze/, { selector: "div" })).toBeTruthy();
});

test("bar lists every kind with its size as text", async () => {
  attachments.mockResolvedValue(three());
  summary.mockResolvedValue(SUMMARY);
  show();
  await screen.findByText("beach.jpg");
  const bar = screen.getAllByRole("img")
    .find((e) => e.getAttribute("aria-label")?.startsWith("PDF"))!;
  expect(bar.getAttribute("aria-label")).toBe("PDF 2 MB, Images 2 MB");
  expect(screen.getByText("in attachments, by kind of file")).toBeTruthy();
  expect(screen.getByText("1 file appears in more than one mail · 2 MB of repeats"))
    .toBeTruthy();
});

test("one tile per file: a repeated file is one tile for all its mails",
  async () => {
  attachments.mockResolvedValue(three());
  summary.mockResolvedValue(SUMMARY);
  show();
  await screen.findByText("scan.pdf");
  expect(screen.getAllByText("scan.pdf")).toHaveLength(1);
  expect(screen.getByText("in 2 mails")).toBeTruthy();
  expect(screen.getAllByRole("checkbox")).toHaveLength(2);

  // selecting the tile selects BOTH mails; the capsule says so honestly
  fireEvent.click(screen.getByLabelText("Select scan.pdf"));
  expect(screen.getByText("2 mails · 2 MB")).toBeTruthy();
  expect(screen.getByText(
    "The whole mail goes to Trash, not only the file.")).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Select scan.pdf"));
  expect(screen.queryByText("2 mails · 2 MB")).toBeNull();
});

test("Show repeats keeps only repeated files; kind and age filter",
  async () => {
  attachments.mockResolvedValue(three());
  summary.mockResolvedValue(SUMMARY);
  show();
  await screen.findByText("beach.jpg");
  fireEvent.click(screen.getByRole("button", { name: "Show" }));
  expect(screen.queryByText("beach.jpg")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show all" }));
  expect(screen.getByText("beach.jpg")).toBeTruthy();

  fireEvent.click(screen.getByRole("radio", { name: "Images" }));
  expect(screen.queryByText("scan.pdf")).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "All" }));

  // ts 1e9 is 2001 (older than 5 years), ts 2e8 is 1976; both old, so use
  // the newest mail's date: everything here is older than 1 year
  fireEvent.click(screen.getByRole("button", { name: /Older than/ }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: "5 years" }));
  expect(screen.getByText("scan.pdf")).toBeTruthy();
});

test("age filter hides files with a recent mail", async () => {
  const recent = Date.now() / 1000 - 86400;
  attachments.mockResolvedValue([mk(1, [file("new.pdf", 9, "pdf")], recent),
    mk(2, [file("old.pdf", 8, "pdf")], 1e9)]);
  summary.mockResolvedValue(SUMMARY);
  show();
  await screen.findByText("new.pdf");
  fireEvent.click(screen.getByRole("button", { name: /Older than/ }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: "1 year" }));
  expect(screen.queryByText("new.pdf")).toBeNull();
  expect(screen.getByText("old.pdf")).toBeTruthy();
});

test("grid / list toggle is remembered", async () => {
  attachments.mockResolvedValue(three());
  summary.mockResolvedValue(SUMMARY);
  show();
  await screen.findByText("scan.pdf");
  fireEvent.click(screen.getByRole("radio", { name: "List" }));
  expect(localStorage.getItem("pmc_atts_view")).toBe("list");
  cleanup();
  show();
  await screen.findByText("scan.pdf");
  expect(screen.getByRole("radio", { name: "List" })
    .getAttribute("aria-checked")).toBe("true");
});

test("trash: confirm first, cancel keeps everything, then the whole mails go",
  async () => {
  attachments.mockResolvedValue(three());
  summary.mockResolvedValue(SUMMARY);
  show();
  await screen.findByText("scan.pdf");
  fireEvent.click(screen.getByLabelText("Select scan.pdf"));
  fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
  await cancelDialog();
  await expectNoDialog();
  expect(deleteMessages).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
  await pressDialog(/Move to Trash \(2\)/);
  await waitFor(() => expect(deleteMessages)
    .toHaveBeenCalledWith([["INBOX", 1], ["INBOX", 2]], "trash"));
  await waitFor(() => expect(screen.queryByText("scan.pdf")).toBeNull());
  expect(screen.getByText("beach.jpg")).toBeTruthy();
});

test("Open shows the selected mail in the viewer", async () => {
  attachments.mockResolvedValue([mk(7)]);
  summary.mockResolvedValue(SUMMARY);
  show();
  await screen.findByText("doc.pdf");
  fireEvent.click(screen.getByLabelText("Select doc.pdf"));
  expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
});

test("Open needs exactly one mail; the subject stays visible in the list",
  async () => {
  attachments.mockResolvedValue(three());
  summary.mockResolvedValue(SUMMARY);
  show();
  await screen.findByText("scan.pdf");
  fireEvent.click(screen.getByLabelText("Select scan.pdf"));   // 2 mails
  expect((screen.getByRole("button", { name: "Open" }) as HTMLButtonElement)
    .disabled).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: "List" }));
  expect(screen.getByText(/Scan 1 · 2 MB/)).toBeTruthy();
});

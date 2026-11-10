// @vitest-environment jsdom
/* Attachments panel: kind bar, repeats card, file tiles (grid / list),
 * per-mail selection with the honest capsule, empty states and the
 * ConfirmDialog flow for trashing. */

import { cleanup, fireEvent, render, screen, waitFor }
  from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AttachmentsPanel } from "./components/AttachmentsPanel";
import { DialogProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog } from "./dialogTestUtils";
import { noteAccountSwitch } from "./accountGuard";
import { setClockShift } from "./clock";
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

vi.mock("./components/MailList", () => ({
  MessageView: ({ mail, actions, nav }: { mail: { subject: string };
    actions?: { trash?: (m: unknown) => void }; nav?: { list: unknown[] } }) =>
    <div><span data-testid="viewer">{mail.subject}</span>
      <span data-testid="nav">{nav?.list.length ?? 0}</span>
      {actions?.trash && <button onClick={() => actions.trash!(mail)}>reader trash</button>}
      {actions?.trash && <button onClick={() => actions.trash!(
        { uid: 99, folder: "INBOX", subject: "Elsewhere", size: 1 })}>
        reader trash outside</button>}
    </div>,
}));

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
  setClockShift(0);
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
  fireEvent.click(screen.getByRole("menuitemradio", { name: "5\u00a0years" }));
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
  fireEvent.click(screen.getByRole("menuitemradio", { name: "1\u00a0year" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(screen.getByTestId("viewer").textContent).toBe("Scan 7");
});

test("the reader's Trash: the same confirm and call for the one mail; "
  + "previous / next cover the listed mails", async () => {
  attachments.mockResolvedValue(three());
  summary.mockResolvedValue(SUMMARY);
  show();
  await screen.findByText("scan.pdf");
  fireEvent.click(screen.getByLabelText("Select beach.jpg"));
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(screen.getByTestId("nav").textContent).toBe("3");
  fireEvent.click(screen.getByText("reader trash"));
  expect((await findDialog()).textContent).toContain('"Scan 3"');   // the mail is named
  await cancelDialog();
  await expectNoDialog();
  expect(deleteMessages).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("reader trash"));
  await pressDialog(/Move to Trash \(1\)/);
  await waitFor(() => expect(deleteMessages)
    .toHaveBeenCalledWith([["INBOX", 3]], "trash"));
  await waitFor(() => expect(screen.queryByTestId("viewer")).toBeNull());
});

test("the reader's Trash on a conversation card outside the list trashes "
  + "that mail (it does nothing today)", async () => {
  attachments.mockResolvedValue(three());
  summary.mockResolvedValue(SUMMARY);
  show();
  await screen.findByText("scan.pdf");
  fireEvent.click(screen.getByLabelText("Select beach.jpg"));
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  fireEvent.click(screen.getByText("reader trash outside"));
  expect((await findDialog()).textContent).toContain('"Elsewhere"');
  await pressDialog(/Move to Trash \(1\)/);
  await waitFor(() => expect(deleteMessages)
    .toHaveBeenCalledWith([["INBOX", 99]], "trash"));
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

test("a filter change drops hidden mails from the selection and the action",
  async () => {
  attachments.mockResolvedValue(three());
  summary.mockResolvedValue(SUMMARY);
  show();
  await screen.findByText("scan.pdf");
  fireEvent.click(screen.getByLabelText("Select scan.pdf"));
  expect(screen.getByText("2 mails · 2 MB")).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "Images" }));
  expect(screen.queryByText(/mails · 2 MB/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Move to Trash" })).toBeNull();
  // selecting what is visible only ever covers visible mails
  fireEvent.click(screen.getByLabelText("Select beach.jpg"));
  fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
  await pressDialog(/Move to Trash \(1\)/);
  await waitFor(() => expect(deleteMessages)
    .toHaveBeenCalledWith([["INBOX", 3]], "trash"));
});

test("the badge counts the mails the tile selects, also after a trash",
  async () => {
  attachments.mockResolvedValue([mk(1, [REPEAT]), mk(2, [REPEAT]),
    mk(3, [REPEAT])]);
  summary.mockResolvedValue(SUMMARY);
  show();
  await screen.findByText("in 3 mails");
  fireEvent.click(screen.getByLabelText("Select scan.pdf"));
  fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
  await pressDialog(/Move to Trash \(3\)/);
  await waitFor(() => expect(screen.queryByText("scan.pdf")).toBeNull());
});

test("a truncated list says so", async () => {
  attachments.mockResolvedValue(Array.from({ length: 2000 },
    (_, i) => mk(i + 1, [file(`f${i}.pdf`, 1e6, "pdf")])));
  summary.mockResolvedValue(SUMMARY);
  show();
  await screen.findByText(/Showing the 2.?000 mails/);
});

// 70 distinct PDFs, largest first (so tile n is mail n), plus a small photo
const many = () => [
  ...Array.from({ length: 70 }, (_, i) =>
    mk(i + 1, [file(`f${i + 1}.pdf`, 1e6 - i * 1000, "pdf")])),
  mk(71, [file("p.jpg", 10, "images")])];

test("a tile ticked behind Show more is not acted on after a filter keeps it "
  + "beyond the first page", async () => {
  attachments.mockResolvedValue(many());
  summary.mockResolvedValue(SUMMARY);
  deleteMessages.mockResolvedValue({ ok: true, queued: 1 });
  show();
  await screen.findByText("f1.pdf");
  expect(screen.queryByText("f65.pdf")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show 11 more" }));
  fireEvent.click(await screen.findByLabelText("Select f65.pdf"));
  expect(screen.getByText("1 mail · 2 MB")).toBeTruthy();
  // the PDF filter still lists f65 - at position 65, behind Show more again
  fireEvent.click(screen.getByRole("radio", { name: "PDF" }));
  expect(screen.queryByText("f65.pdf")).toBeNull();
  expect(screen.queryByRole("button", { name: "Move to Trash" })).toBeNull();
});

test("Show more tapped right after the list appears is not undone", async () => {
  attachments.mockResolvedValue(many());
  summary.mockResolvedValue(SUMMARY);
  const { container } = show();
  // the tap lands in the same task as the commit that shows the tiles - the
  // moment a busy runner can reach before React has run its after-commit work
  await new Promise<void>((resolve) => {
    const watch = new MutationObserver(() => {
      const more = screen.queryByRole("button", { name: "Show 11 more" });
      if (!more) return;
      watch.disconnect();
      fireEvent.click(more);
      resolve();
    });
    watch.observe(container, { childList: true, subtree: true });
  });
  expect(await screen.findByText("f65.pdf")).toBeTruthy();
  await waitFor(() => expect(screen.queryByText("f65.pdf")).toBeTruthy());
  expect(screen.queryByRole("button", { name: /Show \d+ more/ })).toBeNull();
});

test("Show more keeps what was ticked on the pages already shown", async () => {
  attachments.mockResolvedValue(many());
  summary.mockResolvedValue(SUMMARY);
  show();
  await screen.findByText("f1.pdf");
  fireEvent.click(screen.getByLabelText("Select f2.pdf"));
  fireEvent.click(screen.getByRole("button", { name: "Show 11 more" }));
  await screen.findByText("f65.pdf");
  expect(screen.getByText("1 mail · 2 MB")).toBeTruthy();
});

test("one mail in the bar: the confirm names its subject", async () => {
  attachments.mockResolvedValue(three());
  summary.mockResolvedValue(SUMMARY);
  deleteMessages.mockResolvedValue({ ok: true, queued: 1 });
  show();
  fireEvent.click(await screen.findByLabelText("Select beach.jpg"));
  fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
  expect((await findDialog()).textContent).toContain('"Scan 3"');
  await cancelDialog();
});

test("the age filter reads the UI clock, not the machine's", async () => {
  const yearAndHalfAgo = Date.now() / 1000 - 1.5 * 365 * 86400;
  attachments.mockResolvedValue([mk(1, [file("mid.pdf", 9, "pdf")],
    yearAndHalfAgo)]);
  summary.mockResolvedValue(SUMMARY);
  setClockShift(2 * 365 * 86400 * 1000);   // the demo's "now" is two years back
  show();
  await screen.findByText("mid.pdf");
  fireEvent.click(screen.getByRole("button", { name: /Older than/ }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: "1\u00a0year" }));
  // on the demo clock the mail is not even a year old yet
  expect(screen.queryByText("mid.pdf")).toBeNull();
});

test("a confirm that outlives an account switch moves nothing", async () => {
  attachments.mockResolvedValue(three());
  summary.mockResolvedValue(SUMMARY);
  show();
  fireEvent.click(await screen.findByLabelText("Select beach.jpg"));
  fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
  await findDialog();
  noteAccountSwitch();
  await pressDialog(/Move to Trash \(1\)/);
  await new Promise((r) => setTimeout(r, 50));
  expect(deleteMessages).not.toHaveBeenCalled();
});

test.each(["grid", "list"])("clicking the round check selects the file once "
  + "(%s)", async (layout) => {
  localStorage.setItem("pmc_atts_view", layout);
  attachments.mockResolvedValue(three());
  summary.mockResolvedValue(SUMMARY);
  show();
  const box = await screen.findByLabelText("Select beach.jpg");
  // a real click lands on the check's label, which reaches the card too
  fireEvent.click(box.closest("label")!);
  expect(screen.getByText("1 mail · 2 MB")).toBeTruthy();
  expect((box as HTMLInputElement).checked).toBe(true);
  fireEvent.click(box.closest("label")!);
  expect(screen.queryByText("1 mail · 2 MB")).toBeNull();
});

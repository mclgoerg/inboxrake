// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, fireEvent, within } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { setLang } from "./i18n";
import type { AuditEntry } from "./types";

const entries: AuditEntry[] = Array.from({ length: 3 }, (_, i) => ({
  ts: 1700000000 + i, account: "default", actor: i === 0 ? "rule:abc123"
    : "user", action: i === 0 ? "rule_execute" : i === 1 ? "trash"
    : "unsubscribe",
  count: i + 1, bytes: 1000 * (i + 1), label: `item ${i}`,
  outcome: i === 2 ? "failed" : "ok", error: i === 2 ? "boom" : "",
}));

const audit = vi.fn().mockResolvedValue({ total: 3, entries });
const downloadFile = vi.fn().mockResolvedValue(undefined);

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: { audit: (...args: unknown[]) => audit(...args),
    auditExportUrl: () => "/api/audit/export" },
  downloadFile: (...args: unknown[]) => downloadFile(...args),
  fmtSize: (b: number) => `${b} B`,
}));

import { AuditLogPanel } from "./components/AuditLogPanel";

afterEach(() => { setLang("en"); cleanup(); audit.mockClear(); downloadFile.mockClear(); });

const mk = (over: Partial<AuditEntry>): AuditEntry => ({
  ts: Math.floor(Date.now() / 1000), account: "default", actor: "user",
  action: "trash", count: 4, bytes: 0, label: "", outcome: "ok", error: "",
  ...over });
const reset = () => audit.mockResolvedValue({ total: 3, entries });

test("one headline per entry, then who did it", async () => {
  render(<AuditLogPanel rules={[]} onClose={() => {}} />);
  // rule not in the list: its stored name is shown
  await waitFor(() => screen.getByText("Ran rule “item 0” · 1 mail"));
  expect(screen.getByText("Moved 2 mails to Trash")).toBeTruthy();
  expect(screen.getByText("Could not unsubscribe from item 2")).toBeTruthy();
  expect(screen.getByText(/item 1/)).toBeTruthy();
  expect(screen.getAllByText(/by you/).length).toBe(2);
  expect(audit).toHaveBeenCalledWith(0, 50);
});

test("a rule run is about the rule; the move it caused names the rule on its " +
  "second line", async () => {
  audit.mockResolvedValue({ total: 2, entries: [
    mk({ action: "rule_execute", actor: "rule:abc123", count: 3,
      label: "Grok" }),
    mk({ action: "trash", actor: "rule:abc123", count: 3,
      label: "a@x.example" })] });
  const rule = { id: "abc123", name: "Grok2", action: "trash" } as any;
  render(<AuditLogPanel rules={[rule]} onClose={() => {}} />);
  await waitFor(() => screen.getByText("Ran rule “Grok2” · 3 mails"));
  expect(screen.getByText("Trashed")).toBeTruthy();   // what the rule does
  expect(screen.getByText("Moved 3 mails to Trash")).toBeTruthy();
  expect(screen.getByText(/· Rule “Grok2”/)).toBeTruthy();
  expect(screen.queryByText(/abc123/)).toBeNull();
  reset();
});

test("the subtitle counts the entries", async () => {
  render(<AuditLogPanel rules={[]} onClose={() => {}} />);
  await waitFor(() => screen.getByText(/^3 entries/));
  expect(screen.queryByText(/of 3/)).toBeNull();
});

test("empty state shows when there is nothing to show", async () => {
  audit.mockResolvedValueOnce({ total: 0, entries: [] });
  render(<AuditLogPanel rules={[]} onClose={() => {}} />);
  await waitFor(() => screen.getByText("Nothing recorded yet"));
});

test("no pager for a single page; with more it pages and shows the range",
  async () => {
    render(<AuditLogPanel rules={[]} onClose={() => {}} />);
    await waitFor(() => screen.getByText(/item 1/));
    expect(screen.queryByText("Next")).toBeNull();
    expect(screen.queryByText("Previous")).toBeNull();
    cleanup();
    audit.mockResolvedValue({ total: 120, entries });
    render(<AuditLogPanel rules={[]} onClose={() => {}} />);
    await waitFor(() => screen.getByText(/item 1/));
    expect(screen.getByText("1–50 of 120")).toBeTruthy();
    const prev = screen.getByText(/Previous/).closest("button")!;
    expect((screen.getByText(/Next/).closest("button") as HTMLButtonElement)
      .disabled).toBe(false);
    expect(prev.disabled).toBe(true);
    // the pager sits below the list
    expect(prev.compareDocumentPosition(screen.getByText(/item 1/))
      & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    fireEvent.click(screen.getByText(/Next/));
    await waitFor(() => expect(audit).toHaveBeenCalledWith(50, 50));
    reset();
  });

test("close button calls onClose", async () => {
  const onClose = vi.fn();
  render(<AuditLogPanel rules={[]} onClose={onClose} />);
  await waitFor(() => screen.getByText(/item 1/));
  fireEvent.click(screen.getByTitle("Close"));
  expect(onClose).toHaveBeenCalled();
});

test("CSV export fetches and saves a blob instead of navigating", async () => {
  render(<AuditLogPanel rules={[]} onClose={() => {}} />);
  await waitFor(() => screen.getByText(/item 1/));
  fireEvent.click(screen.getByLabelText("Export audit log as CSV"));
  expect(downloadFile).toHaveBeenCalledWith("/api/audit/export");
});

test("an empty log hides the pager, the CSV button and the summary",
  async () => {
    audit.mockResolvedValueOnce({ total: 0, entries: [] });
    render(<AuditLogPanel rules={[]} onClose={() => {}} />);
    await waitFor(() => screen.getByText("Nothing recorded yet"));
    expect(screen.queryByText(/Next/)).toBeNull();
    expect(screen.queryByText(/Previous/)).toBeNull();
    expect(screen.queryByLabelText("Export audit log as CSV")).toBeNull();
    expect(screen.queryByText(/entries/)).toBeNull();
  });

test("a failed entry says Failed and its stored error opens behind Why?",
  async () => {
    audit.mockResolvedValue({ total: 2, entries: [
      mk({ action: "empty_trash", count: 3, outcome: "partial",
        error: "deleted_then_failed:n=3,cause=cannot_expunge" }),
      mk({ action: "purge", count: 0, outcome: "error",
        error: "moved to Trash, could not verify for permanent deletion" })] });
    render(<AuditLogPanel rules={[]} onClose={() => {}} />);
    await waitFor(() => screen.getByText("Partial"));
    expect(screen.getByText("Failed")).toBeTruthy();
    // nothing of the error before Why? is pressed
    expect(screen.queryByText(/could not verify/)).toBeNull();
    const [partial, failed] = screen.getAllByRole("button", { name: "Why?" });
    expect(failed.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(failed);
    expect(failed.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/could not verify for permanent deletion/))
      .toBeTruthy();
    // a coded error is worded in the interface language
    fireEvent.click(partial);
    expect(screen.getByText("The server did not remove the marked mails. "
      + "(3 mails were permanently deleted before the failure)")).toBeTruthy();
    fireEvent.click(failed);
    expect(screen.queryByText(/could not verify/)).toBeNull();
    reset();
  });

test("Why? does not point at an element that is not there", async () => {
  audit.mockResolvedValue({ total: 1, entries: [
    mk({ outcome: "error", error: "boom" })] });
  render(<AuditLogPanel rules={[]} onClose={() => {}} />);
  const why = await screen.findByRole("button", { name: "Why?" });
  expect(why.hasAttribute("aria-controls")).toBe(false);
  reset();
});

test("an outcome this release does not know gets a neutral status", async () => {
  audit.mockResolvedValue({ total: 1, entries: [mk({ outcome: "weird" })] });
  const { container } = render(<AuditLogPanel rules={[]} onClose={() => {}} />);
  await waitFor(() => screen.getByText("weird"));
  expect(container.querySelector(".lucide-ban")).toBeNull();
  expect(container.querySelector(".lucide-circle")).toBeTruthy();
  reset();
});

test("a rule's move entry whose rule is gone says so, not the id", async () => {
  audit.mockResolvedValue({ total: 1, entries: [
    mk({ actor: "rule:deadbeef01", label: "a@x.example" })] });
  render(<AuditLogPanel rules={[]} onClose={() => {}} />);
  await waitFor(() => screen.getByText(/by a deleted rule/));
  expect(screen.queryByText(/deadbeef01/)).toBeNull();
  cleanup();
  setLang("de");
  render(<AuditLogPanel rules={[]} onClose={() => {}} />);
  await waitFor(() => screen.getByText(/von einer gelöschten Regel/));
  reset();
});

test("a rule-triggered move entry names its rule on the second line",
  async () => {
    audit.mockResolvedValue({ total: 1, entries: [
      mk({ actor: "rule:r1", count: 3, label: "a@x.example" })] });
    render(<AuditLogPanel rules={[{ id: "r1", name: "Sweep",
      action: "trash" } as any]} onClose={() => {}} />);
    await waitFor(() => screen.getByText("Moved 3 mails to Trash"));
    expect(screen.getByText(/· Rule “Sweep”/)).toBeTruthy();
    reset();
  });

test("a move out of Junk is worded from from_role or the old label and " +
  "the source is not repeated", async () => {
  audit.mockResolvedValue({ total: 2, entries: [
    mk({ action: "move", count: 3, from_role: "junk", label: "3 mails from Junk" }),
    mk({ action: "trash", count: 2, label: "2 mails from Junk" })] });
  render(<AuditLogPanel rules={[]} onClose={() => {}} />);
  await waitFor(() => screen.getByText("Moved 3 mails from Junk to the inbox"));
  expect(screen.getByText("Moved 2 mails from Junk to Trash")).toBeTruthy();
  expect(screen.queryByText("3 mails from Junk")).toBeNull();
  expect(screen.queryByText("2 mails from Junk")).toBeNull();
  reset();
});

test("a history cut short by the page cap marks the week and split values " +
  "as at least", async () => {
  const now = Math.floor(Date.now() / 1000);
  audit.mockImplementation(() => Promise.resolve({ total: 100,
    entries: [mk({ ts: now, count: 5 })] }));
  render(<AuditLogPanel rules={[]} onClose={() => {}} />);
  const card = await screen.findByRole("region", { name: "This month" });
  await waitFor(() => expect(within(card).getByText("at least 20")).toBeTruthy());
  expect(within(card).getAllByText("20+").length).toBe(2);   // bar + by you
  expect(within(card).getByText("By rules").closest("li")!.textContent)
    .toMatch(/0$/);
  audit.mockReset();
  reset();
});

test("an entry without an error has no Why?", async () => {
  render(<AuditLogPanel rules={[]} onClose={() => {}} />);
  await waitFor(() => screen.getByText(/item 1/));
  expect(screen.getAllByText("Done").length).toBeGreaterThan(0);
  expect(screen.getAllByRole("button", { name: "Why?" })).toHaveLength(1);
});

test("groups the log by month", async () => {
  audit.mockResolvedValue({ total: 2, entries: [
    mk({ ts: 1700000000, label: "from x.example" }),
    mk({ ts: 1690000000, action: "unsubscribe", count: 1,
      label: "x.example", outcome: "failed" })] });
  render(<AuditLogPanel rules={[]} onClose={() => {}} />);
  await waitFor(() => screen.getByText("from x.example"));
  expect(screen.getAllByRole("region", { name: /^(July|November)/ }).length)
    .toBe(2);
  expect(screen.getByText("Could not unsubscribe from x.example")).toBeTruthy();
  reset();
});

test("renders the undo cards given above the timeline", async () => {
  render(<AuditLogPanel rules={[]} onClose={() => {}}
    above={<div>UNDO-CARDS</div>} />);
  await waitFor(() => screen.getByText(/item 1/));
  expect(screen.getByText("UNDO-CARDS")).toBeTruthy();
  expect(screen.queryByText("Nothing to undo.")).toBeNull();
});

test("a failed unsubscribe of a known sender offers Retry", async () => {
  audit.mockResolvedValue({ total: 1, entries: [
    mk({ action: "unsubscribe", count: 1, label: "news@x.example",
      outcome: "failed" })] });
  const group = { key: "news@x.example", unsub: { mailto: "a@b.example" },
    unsubscribed: null } as any;
  const onRetryUnsub = vi.fn().mockResolvedValue(undefined);
  render(<AuditLogPanel rules={[]} onClose={() => {}}
    groups={{ "news@x.example": group }} onRetryUnsub={onRetryUnsub} />);
  const retry = await screen.findByRole("button", { name: "Retry" });
  // inline in the status line, after "Failed", not a row of its own
  expect(retry.parentElement!.textContent).toMatch(/^Failed/);
  fireEvent.click(retry);
  await waitFor(() => expect(onRetryUnsub).toHaveBeenCalledWith(group));
  reset();
});

test("no Retry when the sender is gone", async () => {
  audit.mockResolvedValue({ total: 1, entries: [
    mk({ action: "unsubscribe", count: 1, label: "gone@x.example",
      outcome: "failed" })] });
  render(<AuditLogPanel rules={[]} onClose={() => {}} groups={{}}
    onRetryUnsub={vi.fn()} />);
  await waitFor(() => screen.getByText("Could not unsubscribe from gone@x.example"));
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  reset();
});

test("shows the time of day of an entry", async () => {
  audit.mockResolvedValue({ total: 1, entries: [
    mk({ ts: 1700000000, action: "purge", count: 2, outcome: "partial",
      error: "disk is full" })] });
  render(<AuditLogPanel rules={[]} onClose={() => {}} />);
  await waitFor(() => screen.getByText("Permanently deleted 2 mails"));
  expect(document.querySelector("time")!.textContent).toMatch(/\d{2}:\d{2}/);
  reset();
});

test("an entry that a later undo restored carries an undone pill", async () => {
  audit.mockResolvedValue({ total: 3, entries: [
    mk({ action: "undo", id: "u1", label: "undid-one",
      undoes: { id: "a", count: 4 } }),
    mk({ id: "a", label: "trashed-one" }),
    mk({ id: "b", label: "trashed-two" })] });
  render(<AuditLogPanel rules={[]} onClose={() => {}} />);
  await waitFor(() => screen.getByText(/trashed-one/));
  expect(screen.getAllByText("undone")).toHaveLength(1);
  reset();
});

test("a partly undone entry shows how many were restored", async () => {
  audit.mockResolvedValue({ total: 2, entries: [
    mk({ action: "undo", id: "u1", count: 1, undoes: { id: "a", count: 1 } }),
    mk({ id: "a", label: "trashed-part" })] });
  render(<AuditLogPanel rules={[]} onClose={() => {}} />);
  await waitFor(() => screen.getByText(/trashed-part/));
  expect(screen.getAllByText("1 undone")).toHaveLength(1);
  expect(screen.queryByText("undone")).toBeNull();
  reset();
});

test("the month card shows the week values, their dates and the split",
  async () => {
    const d = new Date();
    const ts = (day: number) => Math.floor(
      new Date(d.getFullYear(), d.getMonth(), day, 12).getTime() / 1000);
    audit.mockResolvedValue({ total: 3, entries: [
      mk({ ts: ts(9), count: 6, actor: "rule:r1", action: "rule_execute",
        label: "Sweep" }),
      mk({ ts: ts(2), count: 4 }),
      mk({ ts: ts(2), action: "unsubscribe", count: 1, label: "a@x.example",
        outcome: "done" })] });
    render(<AuditLogPanel rules={[{ id: "r1", name: "Sweep",
      action: "trash" } as any]} onClose={() => {}} />);
    const card = await screen.findByRole("region", { name: "This month" });
    await waitFor(() => expect(within(card).getByText("10")).toBeTruthy());
    expect(within(card).getAllByText("6").length).toBe(2);   // bar + split
    expect(within(card).getByText(/^1–7 /)).toBeTruthy();
    expect(within(card).getByText("8–14")).toBeTruthy();
    const row = (label: string) => within(card).getByText(label).closest("li")!;
    expect(row("By rules").textContent).toContain("6");
    expect(row("By you").textContent).toContain("4");
    expect(row("Unsubscribed").textContent).toContain("1");
    reset();
  });

test("every recorded action has a headline, in English and German", async () => {
  const cases: [Partial<AuditEntry>, string, string][] = [
    [{ action: "trash", count: 3 }, "Moved 3 mails to Trash",
      "3 Mails in den Papierkorb verschoben"],
    [{ action: "trash", count: 1, from_role: "junk" },
      "Moved 1 mail from Junk to Trash",
      "1 Mail aus Spam in den Papierkorb verschoben"],
    [{ action: "archive", count: 3 }, "Archived 3 mails", "3 Mails archiviert"],
    [{ action: "move", count: 3 }, "Moved 3 mails", "3 Mails verschoben"],
    [{ action: "move", count: 2, from_role: "junk" },
      "Moved 2 mails from Junk to the inbox",
      "2 Mails aus Spam in den Posteingang verschoben"],
    [{ action: "mark_read", count: 1 }, "Marked 1 mail as read",
      "1 Mail als gelesen markiert"],
    [{ action: "move_contents", count: 5, label: "Spam2 \u2192 Spam" },
      "Moved 5 mails from Spam2 to Spam", "5 Mails von Spam2 nach Spam verschoben"],
    [{ action: "empty_trash", count: 7 },
      "Emptied Trash: 7 mails deleted permanently",
      "Papierkorb geleert: 7 Mails endgültig gelöscht"],
    [{ action: "purge", count: 2, label: "Junk" },
      "Permanently deleted 2 mails", "2 Mails endgültig gelöscht"],
    [{ action: "rule_execute", count: 150, actor: "rule:zz", label: "Old" },
      "Ran rule “Old” · 150 mails", "Regel „Old“ ausgeführt · 150 Mails"],
    [{ action: "rule_report", count: 9, actor: "rule:zz", label: "Old" },
      "Rule report: 9 mails match", "Regel-Bericht: 9 Mails passen"],
    [{ action: "rule_report", count: 0, actor: "rule:zz", label: "Old" },
      "Rule report: nothing matches", "Regel-Bericht: nichts passt"],
    [{ action: "unsubscribe", count: 1, label: "a@x.example" },
      "Unsubscribed from a@x.example", "Von a@x.example abbestellt"],
    [{ action: "unsubscribe", count: 1, label: "a@x.example",
      outcome: "link" }, "Unsubscribe link found for a@x.example",
      "Abmelde-Link für a@x.example gefunden"],
    [{ action: "undo", count: 3 }, "Undo: restored 3 mails",
      "Rückgängig: 3 Mails wiederhergestellt"],
    [{ action: "digest_sent", count: 0, label: "me@x.example" },
      "Sent the activity report to me@x.example",
      "Aktivitätsbericht an me@x.example gesendet"],
    [{ action: "trash", count: 0, outcome: "error", error: "x" }, "Trashed",
      "In den Papierkorb verschoben"],
    [{ action: "brand_new", count: 2 }, "brand_new · 2 mails",
      "brand_new · 2 Mails"],
  ];
  for (const [lang, col] of [["en", 1], ["de", 2]] as const) {
    setLang(lang);
    audit.mockResolvedValue({ total: cases.length,
      entries: cases.map(([over]) => mk(over)) });
    render(<AuditLogPanel rules={[]} onClose={() => {}} />);
    for (const c of cases) {
      await waitFor(() => expect(screen.getAllByText(c[col]).length)
        .toBeGreaterThan(0));
    }
    cleanup();
  }
  reset();
});

test("a deleted rule keeps its stored name in the headline",
  async () => {
    audit.mockResolvedValue({ total: 1, entries: [
      mk({ action: "rule_execute", actor: "rule:gone", count: 3,
        label: "Old rule" })] });
    render(<AuditLogPanel rules={[]} onClose={() => {}} />);
    await waitFor(() => screen.getByText("Ran rule “Old rule” · 3 mails"));
    reset();
  });

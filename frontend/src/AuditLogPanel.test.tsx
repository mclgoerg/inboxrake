// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, fireEvent, within } from
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
const timeMachine = vi.fn();
const timeMachinePreview = vi.fn();
const downloadFile = vi.fn().mockResolvedValue(undefined);

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: { audit: (...args: unknown[]) => audit(...args),
    timeMachine: (...args: unknown[]) => timeMachine(...args),
    timeMachinePreview: (...args: unknown[]) => timeMachinePreview(...args),
    auditExportUrl: () => "/api/audit/export" },
  downloadFile: (...args: unknown[]) => downloadFile(...args),
  fmtSize: (b: number) => `${b} B`,
}));

import { AuditLogPanel } from "./components/AuditLogPanel";
import { DialogProvider, ToastProvider } from "./components/ui";

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
  expect(audit).toHaveBeenCalledWith(0, 50, "all");
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
    await waitFor(() => expect(audit).toHaveBeenCalledWith(50, 50, "all"));
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
    [{ action: "account_copy", count: 5, label: "gmail \u2192 proton" },
      "Copied 5 mails from gmail to proton",
      "5 Mails von gmail nach proton kopiert"],
    [{ action: "account_copy", count: 1, label: "gmail \u2192 proton" },
      "Copied 1 mail from gmail to proton",
      "1 Mail von gmail nach proton kopiert"],
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
    [{ action: "assistant_token_created", count: 0, label: "Laptop" },
      "Created the AI assistant access token “Laptop”",
      "KI-Assistenten-Zugriffs-Token „Laptop“ erstellt"],
    [{ action: "assistant_token_revoked", count: 0, label: "Laptop" },
      "Revoked the AI assistant access token “Laptop”",
      "KI-Assistenten-Zugriffs-Token „Laptop“ widerrufen"],
    [{ action: "alias_retired", count: 0, label: "acme@alias.example" },
      "Retired the alias acme@alias.example",
      "Alias acme@alias.example stillgelegt"],
    [{ action: "alias_restored", count: 0, label: "acme@alias.example" },
      "Turned the alias acme@alias.example back on",
      "Alias acme@alias.example wieder eingeschaltet"],
    [{ action: "alias_created", count: 0, label: "new@alias.example" },
      "Created the alias new@alias.example",
      "Alias new@alias.example angelegt"],
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

test("an assistant's entry reads 'by <bot> <token>' and the month card has a " +
  "By assistants line", async () => {
  audit.mockResolvedValue({ total: 2, entries: [
    mk({ actor: "mcp:Claude Code · laptop", count: 120, label: "120 selected mails" }),
    mk({ actor: "user", count: 9 })] });
  render(<AuditLogPanel rules={[]} onClose={() => {}} />);
  await waitFor(() => screen.getAllByText("Moved 120 mails to Trash"));
  const row = screen.getByText("Moved 120 mails to Trash").closest("li")!;
  expect(row.textContent).toMatch(/by\s*Claude Code · laptop/);
  expect(row.querySelector("svg.lucide-bot")).toBeTruthy();
  const card = screen.getByRole("region", { name: "This month" });
  expect(within(card).getByText("By assistants").parentElement!.textContent)
    .toMatch(/120/);
  expect(within(card).getByText("By you").parentElement!.textContent)
    .toMatch(/9/);
});

test("the filter row asks the server for one kind and starts over", async () => {
  audit.mockResolvedValue({ total: 80, entries });
  render(<AuditLogPanel rules={[]} onClose={() => {}} />);
  await waitFor(() => screen.getByText("Moved 2 mails to Trash"));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(audit).toHaveBeenCalledWith(50, 50, "all"));
  const filter = screen.getByRole("group", { name: "Filter" });
  expect(within(filter).getByRole("button", { name: "All" })
    .getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(within(filter).getByRole("button", { name: "Assistants" }));
  await waitFor(() => expect(audit).toHaveBeenCalledWith(0, 50, "assistants"));
  expect(within(filter).getByRole("button", { name: "Assistants" })
    .getAttribute("aria-pressed")).toBe("true");
  // nothing of that kind: a short note, the filter stays
  audit.mockResolvedValue({ total: 0, entries: [] });
  fireEvent.click(within(filter).getByRole("button", { name: "Rules" }));
  await screen.findByText("Nothing here yet.");
  expect(screen.getByRole("group", { name: "Filter" })).toBeTruthy();
});

test("Activity can open already narrowed to the assistants", async () => {
  render(<AuditLogPanel rules={[]} onClose={() => {}} initialBy="assistants" />);
  await waitFor(() => expect(audit).toHaveBeenCalledWith(0, 50, "assistants"));
});

test("one token's steps get a button of their own, the subtitle follows the " +
  "filter and leaving the page calls onLeave", async () => {
  audit.mockResolvedValue({ total: 4, entries });
  const left = vi.fn();
  const { unmount } = render(<AuditLogPanel rules={[]} onClose={() => {}}
    initialBy="token:ab12" byName="Claude Code · laptop" onLeave={left} />);
  await waitFor(() => expect(audit).toHaveBeenCalledWith(0, 50, "token:ab12"));
  await waitFor(() => screen.getByText(/what Claude Code · laptop did, newest first/));
  const filter = screen.getByRole("group", { name: "Filter" });
  expect(within(filter).getByRole("button", { name: "Claude Code · laptop" })
    .getAttribute("aria-pressed")).toBe("true");
  expect(within(filter).getByText("Filter:")).toBeTruthy();
  fireEvent.click(within(filter).getByRole("button", { name: "You" }));
  await waitFor(() => screen.getByText(/what you did, newest first/));
  expect(within(screen.getByRole("group", { name: "Filter" }))
    .queryByRole("button", { name: "Claude Code · laptop" })).toBeNull();
  expect(left).not.toHaveBeenCalled();
  unmount();
  expect(left).toHaveBeenCalledTimes(1);
});

test("a slow answer to an earlier filter never replaces the later one", async () => {
  let slow: (v: unknown) => void = () => {};
  audit.mockImplementation((_o: number, _l: number, by: string) =>
    by === "rules" ? new Promise((r) => { slow = r; })
      : Promise.resolve({ total: 1, entries: [mk({ label: `only ${by}`,
        action: "assistant_scan", count: 0 })] }));
  render(<AuditLogPanel rules={[]} onClose={() => {}} />);
  await screen.findByText(/Started a rescan/);
  const filter = screen.getByRole("group", { name: "Filter" });
  fireEvent.click(within(filter).getByRole("button", { name: "Rules" }));
  fireEvent.click(within(filter).getByRole("button", { name: "You" }));
  await waitFor(() => expect(audit).toHaveBeenCalledWith(0, 50, "user"));
  await screen.findByText(/Started a rescan/);
  // the earlier (rules) answer arrives last
  await act(async () => slow({ total: 1, entries: [mk({
    action: "trash", count: 7, label: "STALE" })] }));
  expect(screen.queryByText("Moved 7 mails to Trash")).toBeNull();
  expect(screen.getByText(/what you did/)).toBeTruthy();
});

// ---------------------------------------------------------- Time machine

const wide = (on: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({
  get matches() { return !on && q.includes("max-width"); }, media: q,
  addEventListener: () => {}, removeEventListener: () => {},
}));
const TM_STEP = { id: "s1", ts: Math.floor(Date.now() / 1000) - 600,
  action: "trash", actor: "user", count: 4, bytes: 0, label: "x",
  outcome: "ok", status: "back", mails: 4, senders: [], senders_total: 0 };
const TM = { steps: [TM_STEP], sessions: [{ start: TM_STEP.ts, end: TM_STEP.ts,
  steps: 1, mails: 4, first: "s1", last: "s1" }], now: TM_STEP.ts + 600,
keep_days: 30, step_cap: 500 };
const tmPreview = { top: "s1", point: "", point_ts: TM_STEP.ts - 60, steps: 1,
  newer_sessions: 0, mails: 4, bytes: 4000, senders: [], cant: [], stays: [],
  skipped: { protected: 0, pinned: 0 }, rules: [],
  folders: [{ folder: "INBOX", name: "INBOX", mails: 4 }] };

afterEach(() => { vi.unstubAllGlobals(); timeMachine.mockReset();
  timeMachinePreview.mockReset(); });

test("from 1024 px the header has a Log / Time machine switch; Time machine " +
  "loads the steps, Log brings the entries back", async () => {
  reset();
  wide(true);
  timeMachine.mockResolvedValue(TM);
  timeMachinePreview.mockResolvedValue(tmPreview);
  render(<ToastProvider><DialogProvider>
    <AuditLogPanel rules={[]} onClose={() => {}} /></DialogProvider></ToastProvider>);
  await waitFor(() => screen.getByText(/item 1/));
  const tabs = screen.getByRole("tablist", { name: "View" });
  expect(within(tabs).getByRole("tab", { name: "Log" })
    .getAttribute("aria-selected")).toBe("true");
  expect(timeMachine).not.toHaveBeenCalled();
  // no phone entry card on a wide screen
  expect(screen.queryByRole("button", { name: /Go back to any point/ })).toBeNull();
  fireEvent.click(within(tabs).getByRole("tab", { name: "Time machine" }));
  await screen.findByRole("slider");
  expect(screen.getByText(/Everything Inboxrake did · go back to any point of the last 30 days/))
    .toBeTruthy();
  expect(screen.queryByText(/item 1/)).toBeNull();
  fireEvent.click(within(tabs).getByRole("tab", { name: "Log" }));
  await waitFor(() => screen.getByText(/item 1/));
});

test("below 1024 px the log has a Time machine card; it opens a page with a " +
  "back link to Activity", async () => {
  reset();
  wide(false);
  timeMachine.mockResolvedValue(TM);
  timeMachinePreview.mockResolvedValue(tmPreview);
  render(<ToastProvider><DialogProvider>
    <AuditLogPanel rules={[]} onClose={() => {}} /></DialogProvider></ToastProvider>);
  await waitFor(() => screen.getByText(/item 1/));
  expect(screen.queryByRole("tablist", { name: "View" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Time machine/ }));
  await screen.findByRole("slider");
  // the page's own title, the bottom button, a way back
  expect(screen.getAllByText("Time machine").length).toBeGreaterThan(0);
  expect(await screen.findByRole("button", { name: /^Restore\s4\smails to/ }))
    .toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Activity" }));
  await waitFor(() => screen.getByText(/item 1/));
});

test("a Time machine restore and a paused rule have headlines in both " +
  "languages, and the steps the restore undid read as undone", async () => {
  const moment = Math.floor(Date.now() / 1000) - 7200;
  const list = [
    mk({ action: "restore", count: 4, label: String(moment), id: "r1",
      undoes_many: [{ id: "t1", count: 4 }] }),
    mk({ action: "rule_paused", count: 0, label: "Sweep old newsletters" }),
    mk({ action: "trash", count: 4, id: "t1", label: "x" })];
  for (const [lang, restored, paused] of [
    ["en", /^Restored 4 mails to today, \d\d:\d\d$/,
      "Paused the rule “Sweep old newsletters” (Report only)"],
    ["de", /^4 Mails auf (heute|gestern), \d\d:\d\d Uhr wiederhergestellt$/,
      "Regel „Sweep old newsletters“ pausiert (nur Bericht)"]] as const) {
    setLang(lang);
    audit.mockResolvedValue({ total: 3, entries: list });
    render(<AuditLogPanel rules={[]} onClose={() => {}} />);
    await waitFor(() => screen.getByText(paused));
    expect(screen.getAllByText(
      (_t, el) => el?.tagName === "SPAN" && restored.test(
        (el.textContent ?? "").replace(/\u00a0/g, " "))).length).toBeGreaterThan(0);
    // the trash entry it undid is tagged
    const row = screen.getByText(/^(Moved|4 Mails in den)/).closest("li")!;
    expect(within(row).getByText(/undone|rückgängig/i)).toBeTruthy();
    cleanup();
  }
  reset();
});

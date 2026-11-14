// @vitest-environment jsdom
/* Rules an AI assistant proposed (board 92): the proposal card at the top
 * with its report inline, the Approve confirm (verb + count, "Run it once
 * now", danger tone), the small Decline confirm, and the ordinary card once
 * the user has approved it. Invented .example data only. */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { RulesModal } from "./components/RulesModal";
import { DialogProvider, ToastProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog } from "./dialogTestUtils";
import { setLang } from "./i18n";
import type { AppState, Rule } from "./types";

const updateRule = vi.fn().mockResolvedValue({});
const deleteRule = vi.fn().mockResolvedValue({});
const runRule = vi.fn().mockResolvedValue({});

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: { updateRule: (id: string, body: unknown) => updateRule(id, body),
         deleteRule: (id: string) => deleteRule(id),
         runRule: (id: string) => runRule(id),
         createRule: vi.fn(),
         rules: () => Promise.resolve({ rules: [], cap: 500 }) },
}));

const baseState: AppState = {
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 0,
  progress: "", error: "", folders: ["Receipts"],
  groups: { sender: {}, smart: {}, domain: {}, subject: {}, thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "",
    usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: ["Receipts"],
  rules: [], presets: [],
};

const AT = Date.UTC(2026, 10, 14, 10, 42) / 1000;
const report = (over = {}) => ({
  ts: AT, mode: "report" as const, groups: 9, mails: 412, acted: 0,
  capped: 0, skipped_protected: 3, skipped_pinned: 2,
  preview: [{ key: "a@gadget.example", label: "Gadget Weekly", count: 120 },
    { key: "d@deals.example", label: "Deals Daily", count: 96 },
    { key: "s@acme.example", label: "ACME Store", count: 71 }],
  error: "", ...over });
const proposal = (over: Partial<Rule> = {}): Rule => ({
  id: "p1", name: "Clear out old shop newsletters", scope: "mail",
  grouping: "sender", query: "is:unsub age:>1y eng:low", action: "trash",
  dest: "", schedule: "manual", mode: "report", keep_latest: null,
  older_than_days: null, origin: "mcp", report_runs: 1, created: AT,
  last_run: report(),
  proposed_by: { token_id: "t1", name: "Claude Code · laptop", at: AT },
  ...over });
const manual: Rule = {
  id: "m1", name: "Sweep old newsletters", scope: "mail", grouping: "sender",
  query: "age:>1y", action: "trash", dest: "", schedule: "manual",
  mode: "report", keep_latest: null, older_than_days: null, origin: "manual",
  report_runs: 1, created: 0, last_run: null };

const onChanged = vi.fn();
const mount = (rules: Rule[]) => render(
  <ToastProvider><DialogProvider>
    <RulesModal state={{ ...baseState, rules }} onClose={() => {}}
      onChanged={onChanged} />
  </DialogProvider></ToastProvider>);
const card = () => document.querySelector<HTMLElement>("[data-proposal]")!;

afterEach(() => {
  cleanup();
  for (const m of [updateRule, deleteRule, runRule, onChanged]) m.mockClear();
  setLang("en");
});

test("a proposal sits above the ordinary rules with who, the tag and the report", () => {
  mount([manual, proposal()]);
  const cards = [...document.querySelectorAll("section[data-proposal], div.rounded-card.border")];
  expect(cards[0]).toBe(card());
  const c = within(card());
  expect(c.getByText("Proposal · waiting for you")).toBeTruthy();
  expect(card().textContent).toContain("Claude Code · laptop · proposed");
  expect(c.getByText("Clear out old shop newsletters")).toBeTruthy();
  // the report, inline: four numbers and the top senders
  expect(c.getByText("412").nextSibling!.textContent).toBe("mails");
  expect(c.getByText("9").nextSibling!.textContent).toBe("senders");
  expect(c.getByText("3").nextSibling!.textContent).toBe("protected, skipped");
  expect(c.getByText("2").nextSibling!.textContent).toBe("pinned, kept");
  expect(card().textContent).toContain("nothing moved yet");
  expect(c.getByText(/Gadget Weekly · 120/)).toBeTruthy();
  expect(c.getByText("+6 more")).toBeTruthy();
  // the sentence of the rule
  expect(card().querySelector("p.leading-9")!.textContent!.replace(/ /g, " "))
    .toBe("When Sender groups match is:unsub age:>1y eng:low then move to Trash · manual");
  // the four buttons, in order
  expect([...card().querySelectorAll("button")].map((b) => b.textContent!.trim()))
    .toEqual(["Approve…", "Report again", "Edit", "Decline"]);
  // the header counts them
  expect(screen.getByText("2 rules · 1 proposal waiting for you")).toBeTruthy();
});

test("an ordinary rules page is unchanged: no proposal card, the usual sub-line", () => {
  mount([manual]);
  expect(card()).toBeNull();
  expect(screen.getByText(/new rules only report until you switch them to Active/))
    .toBeTruthy();
});

test("Approve… says what moves, what is skipped and how it runs, with verb + count", async () => {
  mount([proposal()]);
  fireEvent.click(within(card()).getByRole("button", { name: "Approve…" }));
  const dlg = await findDialog();
  const d = within(dlg);
  expect(d.getByText("Approve “Clear out old shop newsletters”?")).toBeTruthy();
  expect(dlg.textContent).toContain("Proposed by Claude Code · laptop");
  const bullets = [...dlg.querySelectorAll("li")].map((l) =>
    l.textContent!.replace(/ /g, " "));
  expect(bullets).toEqual([
    "412 mails from 9 senders move to Trash (undoable)",
    "3 protected senders skipped", "2 pinned mails kept",
    "Runs: manual - only when you press Run now"]);
  // on by default for a manual rule
  expect((d.getByRole("checkbox", { name: "Run it once now" }) as HTMLInputElement)
    .checked).toBe(true);
  const ok = d.getByRole("button", { name: /^Approve and move 412 to Trash$/ });
  expect(ok.className).toContain("bg-danger");       // danger tone
  await cancelDialog();
  await expectNoDialog();
  expect(updateRule).not.toHaveBeenCalled();
  expect(runRule).not.toHaveBeenCalled();
});

test("confirming arms through the ordinary mode switch, then runs it once", async () => {
  mount([proposal()]);
  fireEvent.click(within(card()).getByRole("button", { name: "Approve…" }));
  await pressDialog(/^Approve and move 412 to Trash$/);
  await waitFor(() => expect(runRule).toHaveBeenCalledWith("p1"));
  expect(updateRule).toHaveBeenCalledWith("p1", { mode: "execute" });
  expect(updateRule.mock.invocationCallOrder[0])
    .toBeLessThan(runRule.mock.invocationCallOrder[0]);
  await screen.findByText("Approved “Clear out old shop newsletters” and ran it once.");
  expect(onChanged).toHaveBeenCalled();
});

test("without 'Run it once now' it only approves, and the button says so", async () => {
  mount([proposal()]);
  fireEvent.click(within(card()).getByRole("button", { name: "Approve…" }));
  const dlg = await findDialog();
  fireEvent.click(within(dlg).getByRole("checkbox", { name: "Run it once now" }));
  expect(within(dlg).queryByRole("button", { name: /Approve and move/ })).toBeNull();
  await pressDialog(/^Approve$/);
  await waitFor(() => expect(updateRule).toHaveBeenCalledWith("p1", { mode: "execute" }));
  await screen.findByText("Approved “Clear out old shop newsletters”.");
  expect(runRule).not.toHaveBeenCalled();
});

test("a scheduled proposal starts with the box off; the verbs follow the action", async () => {
  for (const [action, label, dest] of [
    ["archive", /^Approve and archive 412$/, ""],
    ["move", /^Approve and move 412 to Receipts$/, "Receipts"],
    ["mark_read", /^Approve and mark 412 as read$/, ""]] as const) {
    cleanup();
    mount([proposal({ action, dest, schedule: "daily" })]);
    fireEvent.click(within(card()).getByRole("button", { name: "Approve…" }));
    const dlg = await findDialog();
    expect((within(dlg).getByRole("checkbox", { name: "Run it once now" }) as
      HTMLInputElement).checked).toBe(false);
    expect(within(dlg).getByText(/Runs: every day, on its own/)).toBeTruthy();
    fireEvent.click(within(dlg).getByRole("checkbox", { name: "Run it once now" }));
    expect(within(dlg).getByRole("button", { name: label })).toBeTruthy();
    // mark as read is not destructive: the primary button
    expect(within(dlg).getByRole("button", { name: label }).className
      .includes("bg-danger")).toBe(action !== "mark_read");
    await cancelDialog();
  }
});

test("a refused arming (the server's gate) is shown on the card and nothing runs", async () => {
  updateRule.mockRejectedValueOnce(new Error("Run a report first"));
  mount([proposal()]);
  fireEvent.click(within(card()).getByRole("button", { name: "Approve…" }));
  await pressDialog(/^Approve and move 412 to Trash$/);
  await screen.findByText(/Run a report first/);
  expect(runRule).not.toHaveBeenCalled();
  expect(card()).toBeTruthy();
});

test("Approve waits for a clean report of the current definition", () => {
  mount([proposal({ report_runs: 0, last_run: null })]);
  expect((within(card()).getByRole("button", { name: "Approve…" }) as
    HTMLButtonElement).disabled).toBe(true);
  expect(card().textContent).toContain("No report yet");
  cleanup();
  mount([proposal({ last_run: report({ error: "scan did not finish" }) })]);
  expect((within(card()).getByRole("button", { name: "Approve…" }) as
    HTMLButtonElement).disabled).toBe(true);
  expect(card().textContent).toContain("The last report failed");
});

test("Report again runs the report and nothing else", async () => {
  mount([proposal()]);
  fireEvent.click(within(card()).getByRole("button", { name: "Report again" }));
  await waitFor(() => expect(runRule).toHaveBeenCalledWith("p1"));
  expect(updateRule).not.toHaveBeenCalled();
  expect(deleteRule).not.toHaveBeenCalled();
});

test("Decline is a small confirm in danger tone that deletes the rule", async () => {
  mount([proposal()]);
  fireEvent.click(within(card()).getByRole("button", { name: "Decline" }));
  const dlg = await findDialog();
  expect(within(dlg).getByText("Decline this proposal?")).toBeTruthy();
  expect(dlg.textContent).toContain("The rule is deleted. Nothing was moved.");
  expect(within(dlg).getByRole("button", { name: "Decline" }).className)
    .toContain("bg-danger");
  await cancelDialog();
  await expectNoDialog();
  expect(deleteRule).not.toHaveBeenCalled();
  fireEvent.click(within(card()).getByRole("button", { name: "Decline" }));
  await pressDialog("Decline");
  await waitFor(() => expect(deleteRule).toHaveBeenCalledWith("p1"));
  await screen.findByText("Declined “Clear out old shop newsletters”.");
});

test("Edit opens the ordinary editor with the proposal's values", () => {
  mount([proposal()]);
  fireEvent.click(within(card()).getByRole("button", { name: "Edit" }));
  expect((screen.getByLabelText("Name") as HTMLInputElement).value)
    .toBe("Clear out old shop newsletters");
  expect((screen.getByLabelText("Filter") as HTMLInputElement).value)
    .toBe("is:unsub age:>1y eng:low");
});

test("an approved proposal is an ordinary card that remembers who proposed it", () => {
  mount([proposal({ mode: "execute" })]);
  expect(card()).toBeNull();
  expect(screen.getByText(/Claude Code · laptop · proposed/)).toBeTruthy();
  expect(screen.getByRole("radio", { name: "Active" }).getAttribute("aria-checked"))
    .toBe("true");
});

test("an edited proposal (now manual) keeps the history line, not the proposal card", () => {
  mount([proposal({ origin: "manual" })]);
  expect(card()).toBeNull();
  expect(screen.getByText(/Claude Code · laptop · proposed/)).toBeTruthy();
});

test("the assistant's words are text: a name with markup stays inert", () => {
  mount([proposal({ name: "<img src=x onerror=alert(1)> now",
    proposed_by: { token_id: "t", name: "<b>Evil</b>", at: AT } })]);
  expect(card().querySelector("img, b")).toBeNull();
  expect(card().textContent).toContain("<img src=x onerror=alert(1)> now");
  expect(card().textContent).toContain("<b>Evil</b>");
});

test("German: du, and the same shape", async () => {
  setLang("de");
  mount([proposal()]);
  expect(card().textContent).toContain("Vorschlag · wartet auf dich");
  expect([...card().querySelectorAll("button")].map((b) => b.textContent!.trim()))
    .toEqual(["Genehmigen…", "Bericht neu erstellen", "Bearbeiten", "Ablehnen"]);
  fireEvent.click(within(card()).getByRole("button", { name: "Genehmigen…" }));
  const dlg = await findDialog();
  expect(dlg.textContent).toContain("Jetzt einmal ausführen");
  expect(within(dlg).getByRole("button",
    { name: "Genehmigen und 412 in den Papierkorb verschieben" })).toBeTruthy();
  expect(dlg.textContent).toContain("du kannst sie jederzeit");
});

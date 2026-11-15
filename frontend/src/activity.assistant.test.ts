// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { assistantActorName, entryText, isRuleActor, monthSummary,
  whoLine } from "./activity";
import { setLang } from "./i18n";
import type { AuditEntry } from "./types";

const e = (over: Partial<AuditEntry> = {}): AuditEntry => ({
  ts: 1, account: "a", actor: "mcp:Claude Code · laptop",
  action: "rule_proposed", count: 412, bytes: 0, label: "Sweep old shop mail",
  outcome: "ok", error: "", ...over });

afterEach(() => setLang("en"));

test("assistantActorName reads the token name out of `mcp:<name>`", () => {
  expect(assistantActorName("mcp:Claude Code · laptop")).toBe("Claude Code · laptop");
  expect(assistantActorName("mcp:a:b")).toBe("a:b");     // names may hold colons
  expect(assistantActorName("mcp:")).toBe("");
  for (const other of ["user", "rule:ab12cd34", "system", "mcpx", ""])
    expect(assistantActorName(other)).toBeNull();
  expect(isRuleActor("mcp:rule:x")).toBe(false);
});

test("an assistant's entry is 'by <token>', never 'by you' or a rule", () => {
  expect(whoLine(e(), [])).toBe("by Claude Code · laptop");
  setLang("de");
  expect(whoLine(e(), [])).toBe("von Claude Code · laptop");
});

test("proposals, withdrawals and the alert mail have their own headlines", () => {
  expect(entryText(e(), [])).toEqual({
    title: "Proposed the rule “Sweep old shop mail”",
    who: "by Claude Code · laptop", detail: "412\u00a0mails" });
  expect(entryText(e({ action: "rule_withdrawn", count: 0 }), []).title)
    .toBe("Withdrew the proposed rule “Sweep old shop mail”");
  const mail = (count: number) => entryText(e({
    actor: "user", action: "proposal_mail_sent", count, label: "me@home.example" }), []);
  expect(mail(1).title).toBe("Emailed me@home.example about a proposed rule");
  expect(mail(3).title).toBe("Emailed me@home.example about 3\u00a0proposed rules");
  setLang("de");
  expect(entryText(e(), []).title).toBe("Regel „Sweep old shop mail“ vorgeschlagen");
  expect(mail(1).title).toBe("E-Mail an me@home.example über eine vorgeschlagene Regel gesendet");
});

test("an entry without a label falls back to the plain action word", () => {
  expect(entryText(e({ label: "" }), []).title).toBe("Rule proposed");
});

test("the month card splits assistants from you and from rules", () => {
  const now = new Date(2026, 10, 14, 12);
  const ts = Math.floor(new Date(2026, 10, 10, 9).getTime() / 1000);
  const mv = (actor: string, count: number): AuditEntry =>
    e({ ts, actor, action: "trash", count, label: "x", bytes: count * 10 });
  const sum = monthSummary([mv("user", 9), mv("rule:r1", 4),
    mv("mcp:Claude Code · laptop", 120), mv("mcp:Other", 1)], now);
  expect(sum.mails).toBe(134);
  expect(sum.byAssistants).toBe(121);
  expect(sum.byRules).toBe(4);
  expect(sum.byYou).toBe(9);              // never inflated by assistants
});

test("what an assistant did besides moving mail has its own headlines", () => {
  // number and noun are joined by a no-break space: compare as words
  const words = (x: { title: string; detail: string }) => ({
    title: x.title.replace(/\s/g, " "), detail: x.detail });
  const a = (action: string, count: number, label = "") =>
    words(entryText(e({ action, count, label }), []));
  expect(a("assistant_protect", 3, "billing@power.example, a@x.example").title)
    .toBe("Protected 3 senders");
  expect(a("assistant_protect", 3, "billing@power.example").detail)
    .toBe("billing@power.example");
  expect(a("assistant_protect", 1).title).toBe("Protected 1 sender");
  expect(a("assistant_pin", 2).title).toBe("Pinned 2 mails");
  expect(a("assistant_scan", 0).title).toBe("Started a rescan");
  expect(words(entryText(e({ actor: "user", action: "assistant_token_cap",
    count: 0, label: "Claude Code · laptop: 3000" }), [])).title)
    .toBe("Set the daily limit of “Claude Code · laptop” to 3,000 mails");
  // an entry from a newer build without a label: the plain action word
  expect(a("assistant_token_cap", 0).title).toBe("Daily limit changed");
  setLang("de");
  expect(a("assistant_pin", 2).title).toBe("2 Mails angepinnt");
  expect(a("assistant_scan", 0).title).toBe("Neuen Scan gestartet");
  expect(a("assistant_protect", 3).title).toBe("3 Absender geschützt");
});

test("a hosted app's connection and its end have their own headlines", () => {
  const ev = (action: string, over: Partial<AuditEntry> = {}) => entryText(e({
    actor: "user", action, count: 0, label: "Claude · claude.example", ...over }), []);
  expect(ev("assistant_connected").title)
    .toBe("Connected the hosted app “Claude · claude.example”");
  expect(ev("assistant_disconnected").title)
    .toBe("Disconnected the hosted app “Claude · claude.example”");
  expect(ev("assistant_connected", { label: "" }).title)
    .toBe("Hosted app connected");
  setLang("de");
  expect(ev("assistant_disconnected").title)
    .toBe("Gehostete App „Claude · claude.example“ getrennt");
});

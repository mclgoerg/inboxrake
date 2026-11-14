// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { assistantActorName, entryText, isRuleActor, whoLine } from "./activity";
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

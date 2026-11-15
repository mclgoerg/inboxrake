// @vitest-environment jsdom
/* Activity: a rule run's second line mentions what keep-safe left alone. */
import { afterEach, expect, test } from "vitest";
import { entryText } from "./activity";
import { setLang } from "./i18n";
import type { AuditEntry, Rule } from "./types";

const e = (over: Partial<AuditEntry> = {}): AuditEntry => ({
  ts: 1, account: "a", actor: "rule:r1", action: "rule_execute", count: 147,
  bytes: 0, label: "Sweep old newsletters", outcome: "ok", error: "", ...over });
const rule = { id: "r1", name: "Sweep old newsletters", action: "trash" } as Rule;

afterEach(() => setLang("en"));

test("an executed run names the kept-safe mails on its second line", () => {
  expect(entryText(e({ kept_safe: 2 }), [rule]).detail)
    .toBe("Trashed · 2 kept safe");
  expect(entryText(e(), [rule]).detail).toBe("Trashed");
});

test("a report names them too, alone on the line", () => {
  expect(entryText(e({ action: "rule_report", kept_safe: 3 }), [rule]).detail)
    .toBe("3 kept safe");
  expect(entryText(e({ action: "rule_report" }), [rule]).detail).toBe("");
});

test("German", () => {
  setLang("de");
  expect(entryText(e({ action: "rule_report", kept_safe: 3 }), [rule]).detail)
    .toBe("3 sicher behalten");
});

// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { entryText, monthSummary } from "./activity";
import { ACTION_LOOK, FALLBACK_LOOK } from "./components/actionLook";
import { setLang } from "./i18n";
import type { AuditEntry } from "./types";

const e = (over: Partial<AuditEntry>): AuditEntry => ({
  ts: 1, account: "a", actor: "user", action: "trash", count: 0, bytes: 0,
  label: "", outcome: "ok", error: "", ...over });

afterEach(() => setLang("en"));

test("a folder action is in Activity in words: created, renamed, deleted", () => {
  expect(entryText(e({ action: "folder_create", label: "Warranty" }), []).title)
    .toBe("Created the folder Warranty");
  expect(entryText(e({ action: "folder_rename",
    label: "Receipts 2019 → Receipts 2020" }), []).title)
    .toBe("Renamed the folder Receipts 2019 to Receipts 2020");
  expect(entryText(e({ action: "folder_delete", label: "receipts-old" }), [])
    .title).toBe("Deleted the empty folder receipts-old");
  // a merge is the existing folder-contents move, named by both folders
  expect(entryText(e({ action: "move_contents", count: 41,
    label: "Receipts 2019 → Receipts" }), []).title)
    .toBe("Moved 41 mails from Receipts 2019 to Receipts");
});

test("German headlines", () => {
  setLang("de");
  expect(entryText(e({ action: "folder_create", label: "Garantie" }), []).title)
    .toBe("Ordner Garantie angelegt");
  expect(entryText(e({ action: "folder_rename", label: "A → B" }), []).title)
    .toBe("Ordner A in B umbenannt");
  expect(entryText(e({ action: "folder_delete", label: "alt" }), []).title)
    .toBe("Leeren Ordner alt gelöscht");
});

test("a folder entry without its label falls back to the action's name", () => {
  expect(entryText(e({ action: "folder_rename", label: "" }), []).title)
    .toBe("Folder renamed");
  expect(entryText(e({ action: "folder_create", label: "" }), []).title)
    .toBe("Folder created");
});

test("each has its own icon in the timeline, and none counts as cleaning", () => {
  for (const a of ["folder_create", "folder_rename", "folder_delete"])
    expect(ACTION_LOOK[a], a).toBeTruthy();
  expect(ACTION_LOOK.folder_rename).not.toBe(FALLBACK_LOOK);
  const now = new Date(2026, 9, 20, 12);
  const at = new Date(2026, 9, 5, 12).getTime() / 1000;
  const s = monthSummary([e({ ts: at, action: "folder_rename", count: 3 }),
    e({ ts: at, action: "folder_create" })], now);
  expect(s.mails).toBe(0);
});

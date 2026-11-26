// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { setLang } from "./i18n";
import { FAMILY, ARCHIVE, INBOX, PHONE, RECEIPTS, RECEIPTS_2019, RECEIPTS_OLD,
  ROWS, TAXES, TRAVEL, rule } from "./yourFoldersFixtures";
import { anyActive, folderFilter, leafName, mergeTargets, quietSince,
  renameNotes, ruleSentences, tidyCount, unreadPct, whyText } from "./yourFolders";
import { resp } from "./yourFoldersFixtures";

afterEach(() => setLang("en"));

test("the leaf is what Rename edits: the last part below the parent", () => {
  expect(leafName({ name: "Work/Receipts", delim: "/" })).toBe("Receipts");
  expect(leafName({ name: "Work.Receipts", delim: "." })).toBe("Receipts");
  expect(leafName({ name: "Receipts", delim: null })).toBe("Receipts");
});

test("Open in All mail asks for exactly that folder, with spaces", () => {
  expect(folderFilter("Receipts 2019")).toBe('folder:"Receipts 2019"');
  expect(folderFilter("Work/Receipts")).toBe('folder:"Work/Receipts"');
  // a quote cannot be written in the filter: the plain word then matches
  expect(folderFilter('A "B" C')).toBe("folder:A\"B\"C");
});

test("the year a folder went quiet and its unread share", () => {
  expect(quietSince(RECEIPTS_2019)).toBe(2019);
  expect(quietSince(RECEIPTS_OLD)).toBeNull();
  expect(unreadPct({ mails: 120, unread: 118 })).toBe(98);
  expect(unreadPct({ mails: 0, unread: 0 })).toBe(0);
  expect(unreadPct({ mails: null, unread: null })).toBe(0);
});

test("merge targets: ordinary folders, the Archive folder and the inbox - never itself, a label or a special folder", () => {
  const to = mergeTargets(ROWS, RECEIPTS_2019).map((r) => r.name);
  expect(to).toContain("Receipts");
  expect(to).toContain("Archive");
  expect(to).toContain("INBOX");
  expect(to).toContain("Taxes");
  expect(to).not.toContain("Receipts 2019");                 // itself
  expect(to).not.toContain("Labels/Family");                 // a label
  // a locked folder that is not the inbox / archive is no target
  const locked = { ...TRAVEL, raw: "Sent", name: "Sent", lock: "role" as const,
    role: "sent" };
  const provider = { ...TRAVEL, raw: "[Gmail]/Starred", name: "[Gmail]/Starred",
    lock: "provider" as const };
  const out = mergeTargets([...ROWS, locked, provider], RECEIPTS_2019)
    .map((r) => r.name);
  expect(out).not.toContain("Sent");
  expect(out).not.toContain("[Gmail]/Starred");
});

test("merge targets: the look-alike first, then by mails", () => {
  const to = mergeTargets(ROWS, RECEIPTS_2019).map((r) => r.name);
  expect(to[0]).toBe("Receipts");
  expect(to.slice(1, 4)).toEqual(["INBOX", "Archive", "Newsletters 2019"]);
  // a folder without numbers goes last
  expect(to.at(-1)).toBe("Old phone backup");
  expect(mergeTargets(ROWS, TAXES)[0].name).toBe("INBOX");
});

test("merge targets: removing the lock check would offer the special folders", () => {
  // the rule is "unlocked, or the inbox, or the Archive folder": a folder
  // with ANY other lock must be refused whatever else it looks like
  for (const lock of ["role", "provider", "noselect"] as const) {
    const r = { ...TRAVEL, raw: `L-${lock}`, name: `L-${lock}`, lock };
    expect(mergeTargets([r, RECEIPTS], TAXES).map((x) => x.raw))
      .not.toContain(`L-${lock}`);
  }
  const inbox = mergeTargets([INBOX, ARCHIVE], TAXES).map((r) => r.name);
  expect(inbox).toEqual(["INBOX", "Archive"]);
});

test("the sentences name each rule: Active goes back to Report only, Report only just follows", () => {
  const s = ruleSentences([rule(), rule({ id: "r2", name: "Weekly",
    mode: "report" })], "Receipts");
  expect(s[0]).toBe("The Active rule “Old receipts to their folder” will point at “Receipts” and go back to Report only, as every target change does today.");
  expect(s[1]).toBe("The rule “Weekly” (Report only) will point at “Receipts”.");
  setLang("de");
  expect(ruleSentences([rule()], "Receipts")[0]).toContain("geht zurück auf „Nur Bericht“");
  expect(anyActive([rule()])).toBe(true);
  expect(anyActive([rule({ mode: "report" })])).toBe(false);
  expect(anyActive(undefined)).toBe(false);
});

test("rename notes: subfolders and an exclude pattern", () => {
  expect(renameNotes({ folder: "a", name: "a" })).toEqual([]);
  expect(renameNotes({ folder: "a", name: "a", children: 1,
    stops_scanning: true })).toEqual([
    "1 subfolder is renamed with it.",
    "The new name matches an exclude pattern: the folder will no longer be part of the cleanup scan."]);
});

test("things to tidy are the hint cards; every reason has its words in both languages", () => {
  expect(tidyCount(resp())).toBe(3);
  expect(tidyCount(null)).toBe(0);
  for (const why of ["inbox", "role", "provider", "noselect", "label",
    "move_unsafe", "children", "rules", "not_empty"] as const) {
    setLang("en");
    const en = whyText(why);
    setLang("de");
    const de = whyText(why);
    expect(en).not.toBe(`yf.why.${why}`);
    expect(de).not.toBe(`yf.why.${why}`);
    expect(de).not.toBe(en);
  }
  expect([RECEIPTS, PHONE, FAMILY].length).toBe(3);
});

import type { FolderCheck, YourFolderRow, YourFoldersResp } from "./types";

/* Invented folders for the Your folders tests (no real mailbox names). */

/** 24 Nov 2026, noon UTC: the "now" of these tests. */
export const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const ts = (y: number, m: number, d: number) =>
  Math.floor(Date.UTC(y, m - 1, d, 10) / 1000);

const base = (over: Partial<YourFolderRow>): YourFolderRow => ({
  raw: "X", name: "X", delim: "/", lock: null, role: null, label: false,
  scanned: true, off: null, pattern: "", mails: 0, size: 0, newest: null,
  unread: 0, top: [], used_by: [], children: 0, hints: [], twin: null,
  can: { rename: null, merge: null, delete: "not_empty" }, ...over,
});

export const rule = (over: Partial<{ id: string; name: string;
  mode: "report" | "execute"; schedule: "manual" | "daily" | "weekly" }> = {}) =>
  ({ id: "r1", name: "Old receipts to their folder", mode: "execute" as const,
    schedule: "weekly" as const, ...over });

export const INBOX = base({ raw: "INBOX", name: "INBOX", lock: "inbox",
  mails: 1402, size: 134_637_158, newest: ts(2026, 11, 24), unread: 12,
  can: { rename: "inbox", merge: "inbox", delete: "inbox" } });
export const ARCHIVE = base({ raw: "Archive", name: "Archive", lock: "role",
  role: "archive", mails: 318, size: 54_840_422, newest: ts(2026, 11, 24),
  used_by: [rule({ id: "a1", name: "Archive the old", mode: "report",
    schedule: "manual" })],
  can: { rename: "role", merge: "role", delete: "role" } });
export const RECEIPTS = base({ raw: "Receipts", name: "Receipts", mails: 164,
  size: 19_083_059, newest: ts(2026, 11, 24), unread: 3,
  top: [{ addr: "orders@northwind.example", label: "Northwind Shop", n: 22 },
    { addr: "hello@cloudbox.example", label: "CloudBox", n: 11 },
    { addr: "sales@acme.example", label: "ACME Store", n: 8 }],
  used_by: [rule({ id: "r0", name: "Receipts weekly", mode: "report" })],
  hints: ["look"], twin: "Receipts 2019",
  can: { rename: null, merge: null, delete: "not_empty" } });
export const RECEIPTS_2019 = base({ raw: "Receipts 2019", name: "Receipts 2019",
  mails: 41, size: 5_138_022, newest: ts(2019, 12, 30), unread: 5,
  top: [{ addr: "orders@northwind.example", label: "Northwind Shop", n: 22 }],
  used_by: [rule()], hints: ["look"], twin: "Receipts",
  can: { rename: null, merge: null, delete: "not_empty" } });
export const RECEIPTS_OLD = base({ raw: "receipts-old", name: "receipts-old",
  hints: ["look", "empty"], twin: "Receipts",
  can: { rename: null, merge: null, delete: null } });
export const TRAVEL = base({ raw: "Travel", name: "Travel", mails: 86,
  size: 23_699_865, newest: ts(2026, 10, 2), unread: 1,
  can: { rename: null, merge: null, delete: "not_empty" } });
export const NEWSLETTERS = base({ raw: "Newsletters 2019",
  name: "Newsletters 2019", mails: 120, size: 8_493_158,
  newest: ts(2021, 3, 14), unread: 118, hints: ["stale"],
  can: { rename: null, merge: null, delete: "not_empty" } });
export const TAXES = base({ raw: "Taxes", name: "Taxes", mails: 6,
  size: 1_572_864, newest: ts(2026, 6, 3), unread: 0,
  can: { rename: null, merge: null, delete: "not_empty" } });
export const PHONE = base({ raw: "Old phone backup", name: "Old phone backup",
  scanned: false, off: "switch", mails: null, size: null, unread: null,
  can: { rename: null, merge: null, delete: null } });
export const FAMILY = base({ raw: "Labels/Family", name: "Labels/Family",
  scanned: false, off: "pattern", pattern: "Labels/*", label: true,
  mails: null, size: null, unread: null,
  can: { rename: null, merge: "label", delete: null } });

export const ROWS = [INBOX, ARCHIVE, RECEIPTS, RECEIPTS_2019, RECEIPTS_OLD,
  TRAVEL, NEWSLETTERS, TAXES, PHONE, FAMILY];

export const resp = (over: Partial<YourFoldersResp> = {}): YourFoldersResp => ({
  rows: ROWS,
  hints: [
    { kind: "look", folders: ["Receipts", "Receipts 2019", "receipts-old"] },
    { kind: "empty", folders: ["receipts-old"] },
    { kind: "stale", folders: ["Newsletters 2019"] }],
  special: [
    { raw: "Sent", name: "Sent", why: "role", role: "sent" },
    { raw: "Trash", name: "Trash", why: "role", role: "trash" }],
  totals: { scanned: 8, mails: 2137, size: 247_500_000, not_scanned: 2 },
  scanned: true, gmail: false, busy: null, scanned_ts: NOW / 1000,
  ...over,
});

/** What the live check of merging "Receipts 2019" into "Receipts" says. */
export const mergeCheck = (over: Partial<FolderCheck> = {}): FolderCheck => ({
  folder: "Receipts 2019", name: "Receipts 2019", target: "Receipts",
  target_name: "Receipts", count: 41, uv: 7, max_uid: 98, rules: [rule()],
  pinned: 0, protected: 0, can_delete: null, ...over,
});

export const renameCheck = (over: Partial<FolderCheck> = {}): FolderCheck => ({
  folder: "Receipts 2019", name: "Receipts 2019", new: "Receipts 2020",
  new_name: "Receipts 2020", rules: [rule()], children: 0,
  stops_scanning: false, ...over,
});

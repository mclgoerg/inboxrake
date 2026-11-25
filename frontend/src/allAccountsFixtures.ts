/* Invented numbers for the All accounts tests (the answer of
 * `GET /api/accounts/overview`). */

import type { AllAccountCard, AllAccountsResp, SameSenderRow } from "./types";

const MB = 1048576;
const GB = 1024 * MB;

export const card = (name: string, over: Partial<AllAccountCard> = {}):
    AllAccountCard => ({
  name, user: `me@${name}.example`, status: "done", progress: "",
  scanned_ts: 1_700_000_000, failed: false, mails: 1000, size: GB,
  senders: 50, junk: 3, trash: 4, new: 12, new_basis: "visit", ...over });

export const row = (key: string, name: string,
    accounts: [string, number, Partial<SameSenderRow["accounts"][0]>?][],
    over: Partial<SameSenderRow> = {}): SameSenderRow => ({
  key, name, match: "domain", opened: 2,
  accounts: accounts.map(([account, mails, extra]) => ({
    account, addr: `deals@${key}`, mails, size: mails * 1000, unsub: true,
    state: null, ...extra })),
  mails: accounts.reduce((n, a) => n + a[1], 0),
  size: accounts.reduce((n, a) => n + a[1] * 1000, 0), ...over });

export const ACCOUNTS = [
  card("gmail", { size: 6 * GB, mails: 22410, new: 312 }),
  card("icloud", { size: 2 * GB, mails: 9870, new: 48 }),
  card("proton", { size: 1.3 * GB, mails: 7240, new: 96 }),
  card("gmx", { size: 0.5 * GB, mails: 1710, new: 21, failed: true,
    status: "error", scanned_ts: 1_699_990_000 }),
];

export const SAME: SameSenderRow[] = [
  row("dealsdaily.example", "Deals Daily",
    [["gmail", 210], ["proton", 96], ["gmx", 44, { addr: "promo@dealsdaily.example" }]]),
  row("gadgetweekly.example", "Gadget Weekly", [["proton", 120], ["icloud", 61]]),
  row("chirper.example", "Chirper", [["gmail", 402], ["icloud", 58]]),
  row("acmestore.example", "ACME Store", [["proton", 71], ["gmail", 33]]),
  row("fifth.example", "Fifth Sender", [["gmail", 9], ["gmx", 8]]),
];

export const DATA: AllAccountsResp = {
  now: 1_700_000_100, accounts: ACCOUNTS,
  totals: { mails: 41230, size: ACCOUNTS.reduce((n, a) => n + a.size, 0),
    senders: 512 },
  same_sender: SAME };

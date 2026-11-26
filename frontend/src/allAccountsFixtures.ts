/* Invented `.example` data for the All accounts page tests. */

import type { AllAccountCard, AllAccountsResp, SameSenderPart, SameSenderRow }
  from "./types";

const MB = 1048576;

export const card = (name: string, over: Partial<AllAccountCard> = {}):
    AllAccountCard => ({
  name, user: `demo@${name}.example`, status: "done", progress: "",
  scanned_ts: 1_700_000_000, failed: false, failed_ts: null,
  mails: 100, size: 10 * MB, senders: 10, junk: 0, trash: 0, new: 0,
  new_basis: "week", rev: 1, busy: false, job_failed: null, undo_last: null,
  ...over });

export const part = (account: string, addr: string,
    over: Partial<SameSenderPart> = {}): SameSenderPart => ({
  account, addr, mails: 10, size: MB, pinned: 0, blocked: false, unsub: true,
  state: null, via: "one_click", ...over });

export const row = (key: string, name: string, accounts: SameSenderPart[],
    over: Partial<SameSenderRow> = {}): SameSenderRow => ({
  key, name, match: "domain", accounts, left_out: [],
  mails: accounts.reduce((n, a) => n + a.mails, 0),
  size: accounts.reduce((n, a) => n + a.size, 0), opened: 2, ...over });

/** Deals Daily writes to three accounts (one of them from another address of
 *  the same company), Chirper to two, ... */
export const deals = (): SameSenderRow => row("dealsdaily.example",
  "Deals Daily", [
    part("work", "deals@dealsdaily.example", { mails: 210, size: 5.1 * MB }),
    part("proton", "deals@dealsdaily.example",
      { mails: 93, size: 2.9 * MB, via: "http" }),
    part("old", "promo@dealsdaily.example", { mails: 44, size: 0.9 * MB }),
  ]);

export const chirper = (): SameSenderRow => row("chirper.example", "Chirper", [
  part("work", "digest@chirper.example", { mails: 402 }),
  part("proton", "digest@chirper.example", { mails: 168 })]);

export const acme = (): SameSenderRow => row("acme-store.example",
  "ACME Store", [
    part("proton", "news@acme-store.example", { mails: 214 }),
    part("work", "news@acme-store.example", { mails: 33 })]);

export const gadget = (): SameSenderRow => row("gadgetweekly.example",
  "Gadget Weekly", [
    part("proton", "weekly@gadgetweekly.example", { mails: 120 }),
    part("icloud", "weekly@gadgetweekly.example", { mails: 61 })]);

export const overview = (over: Partial<AllAccountsResp> = {}):
    AllAccountsResp => ({
  now: 1_700_000_300,
  accounts: [
    card("proton", { mails: 2137, size: 236 * MB, new: 63, new_basis: "visit",
      scanned_ts: 1_700_000_240 }),
    card("icloud", { mails: 634, size: 131.5 * MB, new: 12,
      scanned_ts: 1_700_000_240 }),
    card("work", { mails: 22410, size: 5.9 * 1024 * MB, new: 312,
      scanned_ts: 1_700_000_060 }),
    card("old", { mails: 1710, size: 0.5 * 1024 * MB, new: 21, failed: true,
      status: "error", failed_ts: 1_699_992_800, scanned_ts: 1_699_000_000 }),
  ],
  totals: { mails: 26891, size: 7.3 * 1024 * MB, senders: 400 },
  same_sender: [deals(), chirper(), acme(), gadget()],
  ...over });

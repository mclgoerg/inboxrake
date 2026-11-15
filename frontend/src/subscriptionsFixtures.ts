/* Fixtures for the Subscriptions tests: the board's six services, invented
 * `.example` senders. Epoch seconds are derived from one fixed "now". */

import type { Subscription, SubscriptionsResp } from "./types";

export const DAY = 86400;
/** 2026-11-15 10:00 UTC */
export const NOW = Date.UTC(2026, 10, 15, 10) / 1000;
const at = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 12) / 1000;

const base = (over: Partial<Subscription>): Subscription => ({
  key: "x.example", name: "X", addr: "billing@x.example", cadence: "monthly",
  every_days: 30, day: 5, since: at(2025, 3, 5), last: at(2026, 11, 5),
  next: at(2026, 12, 5), next_days: 20, receipts: 21, amount: 7.99,
  currency: "EUR", amount_source: "subject", monthly: 7.99, total: 167.79,
  total_estimated: false, slots: Array(21).fill(1), slots_from: at(2025, 3, 1),
  use: { state: "signin", in_use: true, ts: at(2026, 11, 9) },
  latest: [
    { subject: "Your receipt - €7.99", ts: at(2026, 11, 5), folder: "INBOX", uid: 3 },
    { subject: "Your receipt - €7.99", ts: at(2026, 10, 5), folder: "INBOX", uid: 2 },
    { subject: "Your receipt - €7.99", ts: at(2026, 9, 5), folder: "INBOX", uid: 1 }],
  hidden: false, reminder: false, kept: false, ...over });

export const streambox = base({
  key: "streambox.example", name: "StreamBox", addr: "billing@streambox.example",
  amount: 12.99, monthly: 12.99, total: 280, next: at(2026, 12, 2),
  next_days: 17, since: at(2023, 1, 5),
  use: { state: "signin", in_use: true, ts: at(2026, 11, 9) } });
export const clouddrive = base({
  key: "clouddrive.example", name: "CloudDrive Pro",
  addr: "billing@clouddrive.example", cadence: "yearly", every_days: 365,
  amount: 59.88, monthly: 4.99, since: at(2021, 1, 14), next: at(2027, 1, 14),
  next_days: 60, receipts: 5, total: 299.4, slots: [1, 1, 1, 1, 1],
  use: { state: "read", in_use: true, ts: at(2026, 10, 2) } });
export const fittrack = base({
  key: "fittrack.example", name: "FitTrack Premium",
  addr: "billing@fittrack.example",
  use: { state: "unused", in_use: false, ts: at(2026, 3, 12),
    since: "signin", others: 40 } });
export const newsdaily = base({
  key: "newsdaily.example", name: "NewsDaily+",
  addr: "billing@newsdaily.example", amount: null, currency: "", monthly: null,
  amount_source: null, total: null, since: at(2025, 6, 1), next: at(2026, 12, 1),
  next_days: 16, receipts: 6, slots: Array(6).fill(1),
  latest: [{ subject: "Your NewsDaily+ receipt", ts: at(2026, 11, 1),
    folder: "INBOX", uid: 9 }],
  use: { state: "never", in_use: false, ts: 0, others: 14 } });
export const photovault = base({
  key: "photovault.example", name: "PhotoVault",
  addr: "billing@photovault.example", amount: 2.99, monthly: 2.99, total: 80,
  since: at(2022, 8, 5), next: at(2026, 11, 28), next_days: 13,
  use: { state: "signin", in_use: true, ts: at(2026, 10, 30) } });
export const vpnly = base({
  key: "vpnly.example", name: "VPNly", addr: "billing@vpnly.example",
  cadence: "yearly", every_days: 365, amount: 39, monthly: 3.25,
  since: at(2024, 2, 3), next: at(2027, 2, 3), next_days: 80, receipts: 3,
  total: 117, slots: [1, 1, 1],
  use: { state: "signin", in_use: true, ts: at(2026, 11, 1) } });

export const ITEMS = [streambox, clouddrive, fittrack, newsdaily, photovault,
  vpnly];

export const resp = (over: Partial<SubscriptionsResp> = {},
    items: Subscription[] = ITEMS): SubscriptionsResp => {
  const visible = items.filter((s) => !s.hidden);
  const unused = visible.filter((s) => !s.use.in_use);
  return {
    scanned: true, now: NOW, body_amounts: false, unread_amounts: 0,
    totals: {
      count: visible.length, currency: "EUR", other_currencies: [],
      with_amount: visible.filter((s) => s.amount !== null).length,
      monthly: 32.21, unused: unused.length, unused_monthly: 7.99,
      renewing: visible.filter((s) => s.cadence === "yearly"
        && s.next_days <= 60).length },
    items, ...over };
};

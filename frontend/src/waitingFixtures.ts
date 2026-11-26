/* Fixtures for the Waiting for a reply tests: the board's five mails, invented
 * `.example` people. Epoch seconds derive from one fixed "now" (a Tuesday). */

import type { WaitingDetail, WaitingItem, WaitingResp } from "./types";

export const DAY = 86400;
/** 2026-11-24 10:00 UTC (a Tuesday) */
export const NOW = Date.UTC(2026, 10, 24, 10) / 1000;
const ago = (days: number) => NOW - days * DAY;

const item = (over: Partial<WaitingItem>): WaitingItem => ({
  id: "<m1@self.example>", uid: 11, state: "open",
  person: { addr: "pat@x.example", name: "Pat" }, subject: "A question",
  ts: ago(1), age: DAY, days: 1, overdue: false, limit_days: 3,
  usual_days: null, usual_n: 0, answered_ts: null, answered_days: null,
  recipients: 1, reminder: null, ...over });

/** No display name: the address stands in for it. */
export const tax = item({
  id: "<tax@self.example>", uid: 11,
  person: { addr: "steuerberater@kanzlei-brandt.example",
    name: "steuerberater@kanzlei-brandt.example" },
  subject: "Documents for the 2025 tax return", ts: ago(9), age: 9 * DAY,
  days: 9, overdue: true, limit_days: 3, usual_days: 3, usual_n: 2 });
export const clara = item({
  id: "<clara@self.example>", uid: 12,
  person: { addr: "clara.neumann@mailfox.example", name: "Clara Neumann" },
  subject: "Coffee next week?", ts: ago(6), age: 6 * DAY, days: 6,
  overdue: true, limit_days: 1, usual_days: 1, usual_n: 2 });
export const landlord = item({
  id: "<landlord@self.example>", uid: 13,
  person: { addr: "vermieter@hausverwaltung-nord.example",
    name: "vermieter@hausverwaltung-nord.example" },
  subject: "Question about the service charges", ts: ago(5), age: 5 * DAY,
  days: 5, overdue: true, limit_days: 2, usual_days: 2, usual_n: 2 });
export const tobi = item({
  id: "<tobi@self.example>", uid: 14,
  person: { addr: "tobi@kletterhalle.example", name: "Tobi" },
  subject: "Climbing on Saturday?", ts: ago(2), age: 2 * DAY, days: 2,
  limit_days: 2, usual_days: 2, usual_n: 2 });
export const opa = item({
  id: "<opa@self.example>", uid: 15,
  person: { addr: "opa@familienpost.example", name: "Opa" },
  subject: "Photos from the weekend", ts: ago(1), age: DAY, days: 1,
  limit_days: 4, usual_days: 4, usual_n: 3 });
export const answered = item({
  id: "<ans@self.example>", uid: 16, state: "answered",
  person: { addr: "kim@y.example", name: "Kim Roe" },
  subject: "Invoice question", ts: ago(9), age: 9 * DAY, days: 9,
  answered_ts: ago(7), answered_days: 2 });
export const skipped = item({
  id: "<skip@self.example>", uid: 17, state: "needed",
  person: { addr: "lee@z.example", name: "Lee Fox" },
  subject: "FYI: new address", ts: ago(5), age: 5 * DAY, days: 5 });

export const OPEN = [tax, clara, landlord, tobi, opa];

export const resp = (over: Partial<WaitingResp> = {}): WaitingResp => ({
  watching: true, scanned: true, mode: "usual", days: 3,
  counts: { open: 5, answered: 41, needed: 7 },
  kpis: { overdue: 3, open: 5, typical_days: 1.5 },
  summary: { watching: true, overdue: 3, open: 5, people_n: 3,
    people: [tax.person.name, "Clara Neumann", landlord.person.name],
    more: 0, oldest_days: 9, oldest_usual: 3 },
  items: [...OPEN, answered, skipped], ...over });

export const detailOf = (over: Partial<WaitingDetail> = {}): WaitingDetail => ({
  id: tax.id,
  timeline: [
    { ts: ago(55), kind: "out", who: "", subject: "Questions about 2024",
      answered_ts: ago(52) },
    { ts: ago(52), kind: "in", who: "", subject: "Re: Questions about 2024" },
    { ts: ago(9), kind: "out", who: "",
      subject: "Documents for the 2025 tax return", answered_ts: null }],
  newsletters: 2, sent: { folder: "Sent", uid: 11 },
  ...over });

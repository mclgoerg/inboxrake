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
  ts: ago(1), age: DAY, days: 1, overdue: false, usual_days: null,
  usual_n: 0, answered_ts: null, answered_days: null, recipients: 1,
  reminder: null, ...over });

export const travelly = item({
  id: "<travelly@self.example>", uid: 11,
  person: { addr: "help@travelly.example", name: "Travelly" },
  subject: "Re: Change of booking 88213", ts: ago(12), age: 12 * DAY,
  days: 12, overdue: true, usual_days: 2, usual_n: 4 });
export const alex = item({
  id: "<alex@self.example>", uid: 12,
  person: { addr: "alex@friends.example", name: "Alex Doe" },
  subject: "Saturday dinner - are you in?", ts: ago(6), age: 6 * DAY,
  days: 6, overdue: true });
export const library = item({
  id: "<library@self.example>", uid: 13,
  person: { addr: "loans@library.example", name: "City Library" },
  subject: "Extend loan for “The Long Way”", ts: ago(4),
  age: 4 * DAY, days: 4, overdue: true });
export const sam = item({
  id: "<sam@self.example>", uid: 14,
  person: { addr: "sam@work.example", name: "Sam Lee" },
  subject: "Draft for Q1 plan", ts: ago(2), age: 2 * DAY, days: 2 });
export const bank = item({
  id: "<bank@self.example>", uid: 15,
  person: { addr: "service@bank.example", name: "Bank of Example" },
  subject: "Re: Card replacement", ts: ago(1), age: DAY, days: 1 });
export const answered = item({
  id: "<ans@self.example>", uid: 16, state: "answered",
  person: { addr: "kim@y.example", name: "Kim Roe" },
  subject: "Invoice question", ts: ago(9), age: 9 * DAY, days: 9,
  answered_ts: ago(7), answered_days: 2 });
export const skipped = item({
  id: "<skip@self.example>", uid: 17, state: "needed",
  person: { addr: "lee@z.example", name: "Lee Fox" },
  subject: "FYI: new address", ts: ago(5), age: 5 * DAY, days: 5 });

export const OPEN = [travelly, alex, library, sam, bank];

export const resp = (over: Partial<WaitingResp> = {}): WaitingResp => ({
  tracking: true, days: 3, scanned: true,
  counts: { open: 5, answered: 41, needed: 7 },
  kpis: { overdue: 3, recent: 2, share: 94, share_of: 40 },
  summary: { overdue: 3, people_n: 3,
    people: ["Travelly", "Alex Doe", "City Library"], more: 0,
    oldest_days: 12 },
  items: [...OPEN, answered, skipped], ...over });

export const detailOf = (over: Partial<WaitingDetail> = {}): WaitingDetail => ({
  id: travelly.id,
  timeline: [
    { ts: ago(16), kind: "in", who: "Travelly",
      subject: "Your booking 88213 is confirmed" },
    { ts: ago(15), kind: "out", who: "", subject: "Change of booking 88213",
      answered_ts: ago(14) },
    { ts: ago(12), kind: "out", who: "", subject: "Re: Change of booking 88213",
      answered_ts: null }],
  newsletters: 2, sent: { folder: "Sent", uid: 11 },
  thread: { folder: "INBOX", uid: 40, ts: ago(14), addr: "help@travelly.example",
    subject: "Re: Change of booking 88213" },
  ...over });

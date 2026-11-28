/* "You keep doing this" fixtures: invented senders on .example domains. */

import type { Habit } from "./types";

const DAY = 86400;
export const T0 = 1_791_000_000;          // a fixed "since" (epoch seconds)

const step = (days: number, n: number, young: number | null = 8,
    unread = n) => ({ id: `s${days}`, ts: T0 + days * DAY, n, unread,
  youngest_days: young });

export const deals: Habit = {
  id: "h-deals", key: "deals@dealsdaily.example", label: "Deals Daily",
  action: "trash", dest: "", dest_name: "", times: 5, days: 5,
  since: T0, last: T0 + 42 * DAY, min_n: 7, max_n: 9, mails: 41, gap_min: 3,
  gap_max: 5, always_unread: true, older_than_days: 3, schedule: "daily",
  catch: 12,
  steps: [step(0, 9), step(4, 8), step(9, 7), step(13, 8),
    step(18, 9, 3, 6)],
  rule: { grouping: "sender", query: "from:deals@dealsdaily.example",
    action: "trash", dest: "", schedule: "daily", older_than_days: 3 } };

export const news: Habit = {
  id: "h-news", key: "news@northwind.example", label: "Northwind News",
  action: "archive", dest: "", dest_name: "", times: 4, days: 4,
  since: T0 + 2 * DAY, last: T0 + 23 * DAY, min_n: 5, max_n: 6, mails: 22,
  gap_min: 7, gap_max: 7, always_unread: false, older_than_days: 7,
  schedule: "weekly", catch: 6,
  steps: [step(2, 5, 9, 2), step(9, 6, 8, 3), step(16, 5, 10, 1),
    step(23, 6, 7, 2)],
  rule: { grouping: "sender", query: "from:news@northwind.example",
    action: "archive", dest: "", schedule: "weekly", older_than_days: 7 } };

export const bank: Habit = {
  id: "h-bank", key: "service@paybank.example", label: "PayBank",
  action: "move", dest: "Finance", dest_name: "Finance", times: 4, days: 4,
  since: T0 + 3 * DAY, last: T0 + 40 * DAY, min_n: 2, max_n: 4, mails: 12,
  gap_min: 10, gap_max: 16, always_unread: false, older_than_days: null,
  schedule: "weekly", catch: 3,
  steps: [step(3, 3, null, 1), step(14, 4, null, 2), step(30, 2, null, 0),
    step(40, 3, null, 1)],
  rule: { grouping: "sender", query: "from:service@paybank.example",
    action: "move", dest: "Finance", schedule: "weekly",
    older_than_days: null } };

export const chirp: Habit = {
  id: "h-chirp", key: "notify@chirper.example", label: "Chirper",
  action: "mark_read", dest: "", dest_name: "", times: 6, days: 6,
  since: T0 + 5 * DAY, last: T0 + 40 * DAY, min_n: 9, max_n: 9, mails: 54,
  gap_min: 1, gap_max: 1, always_unread: true, older_than_days: null,
  schedule: "daily", catch: 11,
  steps: [step(5, 9, null), step(12, 9, null), step(19, 9, null),
    step(26, 9, null), step(33, 9, null), step(40, 9, null)],
  rule: { grouping: "sender", query: "from:notify@chirper.example",
    action: "mark_read", dest: "", schedule: "daily",
    older_than_days: null } };

export const habitsResp = (suggestions: Habit[] = [deals, news],
    over: Partial<{ enabled: boolean; hidden: number }> = {}) =>
  ({ enabled: true, suggestions, hidden: 0, ...over });

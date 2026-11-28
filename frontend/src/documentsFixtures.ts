/* The Your documents page of the board, as the backend answers it (invented
 * `.example` senders): the three years, the four kinds of 2026 and its six
 * rows. Shared by the panel, the entry points and the App tests. */

import type { DocKind, DocRow, DocsPage, DocsSummary, DocTotals, DocYear }
  from "./types";

const KB = 1024;
const MB = 1024 * KB;
const totals = (mails: number, files: number, bytes: number): DocTotals =>
  ({ mails, files, bytes });

export const yearOf = (year: number, kinds: Record<DocKind, DocTotals>):
    DocYear => {
  const all = Object.values(kinds);
  return { year, kinds,
    mails: all.reduce((n, k) => n + k.mails, 0),
    files: all.reduce((n, k) => n + k.files, 0),
    bytes: all.reduce((n, k) => n + k.bytes, 0) };
};

export const KINDS_2026: Record<DocKind, DocTotals> = {
  invoices: totals(151, 184, 21 * MB), contracts: totals(22, 41, 18 * MB),
  bookings: totals(26, 52, 9 * MB), tax: totals(15, 35, 12 * MB) };

export function summary(over: Partial<DocsSummary> = {}): DocsSummary {
  return { scanned: true, analyzed: true, analyzing: false,
    cap: 256 * MB, years: [
    yearOf(2024, { invoices: totals(90, 100, 10 * MB),
      contracts: totals(10, 11, 8 * MB), bookings: totals(20, 22, 6 * MB),
      tax: totals(9, 9, 5 * MB) }),
    yearOf(2025, { invoices: totals(120, 140, 15 * MB),
      contracts: totals(18, 20, 12 * MB), bookings: totals(24, 30, 7 * MB),
      tax: totals(12, 13, 9 * MB) }),
    yearOf(2026, KINDS_2026)], ...over };
}

const at = (y: number, m: number, d: number): number =>
  Date.UTC(y, m - 1, d, 12) / 1000;
const iso = (y: number, m: number, d: number): string =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")} 12:00`;

export const row = (over: Partial<DocRow> = {}): DocRow => ({
  folder: "INBOX", uid: 1, ts: at(2026, 11, 24), date: iso(2026, 11, 24),
  subject: "Invoice 2026-1187", addr: "billing@northwind.example",
  name: "Northwind Invoices", size: 90 * KB, seen: false, kind: "invoices",
  files: [{ name: "invoice-2026-1187.pdf", size: 84 * KB }],
  pinned: false, pinnable: true, ...over });

/** The six rows of the board, newest first. */
export const ROWS: DocRow[] = [
  row(),
  row({ uid: 2, ts: at(2026, 11, 18), date: iso(2026, 11, 18),
    subject: "Your invoice for November", addr: "billing@cloudbox.example",
    name: "CloudBox", files: [{ name: "cloudbox-nov.pdf", size: 61 * KB }] }),
  row({ uid: 3, ts: at(2026, 11, 3), date: iso(2026, 11, 3),
    subject: "Ihre Jahresabrechnung 2025", addr: "post@stadtwerke.example",
    name: "Stadtwerke Example",
    files: [{ name: "jahresabrechnung.pdf", size: 412 * KB }] }),
  row({ uid: 4, ts: at(2026, 10, 28), date: iso(2026, 10, 28),
    subject: "Your policy documents", addr: "service@insure.example",
    name: "Insure Example", kind: "contracts",
    files: [{ name: "policy.pdf", size: Math.round(1.2 * MB) },
      { name: "terms.pdf", size: 380 * KB }] }),
  row({ uid: 5, ts: at(2026, 10, 12), date: iso(2026, 10, 12),
    subject: "Your tickets for 14 Dec", addr: "orders@ticketline.example",
    name: "Ticketline", kind: "bookings",
    files: [{ name: "tickets.pdf", size: 220 * KB }] }),
  row({ uid: 6, ts: at(2026, 10, 2), date: iso(2026, 10, 2),
    subject: "Bescheid für 2025",
    addr: "post@finanzamt-musterstadt.example", name: "Finanzamt Musterstadt",
    kind: "tax", pinned: true,
    files: [{ name: "bescheid-2025.pdf", size: 410 * KB }] }),
];

export const page = (over: Partial<DocsPage> = {}): DocsPage =>
  ({ year: 2026, total: ROWS.length, capped: false, rows: ROWS, ...over });

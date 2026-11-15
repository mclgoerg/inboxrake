import { expect } from "vitest";
import { within } from "@testing-library/react";
import type { KeepSafeCheck } from "./types";

/** A backend answer: 3 invoices and 1 booking look worth keeping (4 mails). */
export const KEEP_FOUND: KeepSafeCheck = { total: 40, kept: 4, classes: [
  { id: "invoices", count: 3,
    senders: [{ name: "ACME Store", count: 3 }],
    subjects: [{ subject: "Invoice 2026-0412 for your order",
      sender: "ACME Store", ts: 1759500000 }] },
  { id: "bookings", count: 1,
    senders: [{ name: "Travelly", count: 1 }],
    subjects: [{ subject: "A booking for 3 Dec", sender: "Travelly",
      ts: 1759500000 }] },
] };

/** The green keep-safe box is in the open confirm, both groups ticked. */
export const expectKeepBox = (dlg: HTMLElement) => {
  expect(within(dlg).getByText("4 look worth keeping")).toBeTruthy();
  expect(within(dlg).getByText(/Invoices & receipts · 3/)).toBeTruthy();
  expect(within(dlg).getByText(/Bookings & tickets · 1/)).toBeTruthy();
  for (const box of within(dlg).getAllByRole("checkbox"))
    expect((box as HTMLInputElement).checked).toBe(true);
};

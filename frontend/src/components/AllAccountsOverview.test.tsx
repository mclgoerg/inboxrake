// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ACCOUNTS, DATA, SAME, row } from "../allAccountsFixtures";
import { setLang } from "../i18n";
import { AccountChips, AllAccountsOverview, SAME_SHOWN } from
  "./AllAccountsOverview";

afterEach(() => { cleanup(); setLang("en"); });

/** An expected text with its no-break spaces as plain ones too. */
const sp = (s: string): string => s.replace(/\u00a0/g, " ");

/** Text with the no-break spaces of counts and sizes as plain ones. */
const txt = (el: Element): string =>
  (el.textContent ?? "").replace(/\u00a0/g, " ");

const show = (over: Partial<Parameters<typeof AllAccountsOverview>[0]> = {}) => {
  const h = { onRetry: vi.fn(), onOpenAccount: vi.fn(),
    onUnsubscribe: vi.fn() };
  render(<AllAccountsOverview data={DATA} failed={false} phone={false}
    {...h} {...over} />);
  return h;
};

test("one card per account: size, mails, new, last scan; a failed scan " +
  "says so", () => {
  show();
  const gmail = screen.getByRole("button", { name: /gmail/ });
  expect(txt(gmail)).toContain(sp("me@gmail.example"));
  expect(txt(gmail)).toContain(sp("6.0 GB"));
  expect(txt(gmail)).toContain(sp("22,410 mails"));
  expect(txt(gmail)).toContain(sp("+312 new"));
  expect(txt(gmail)).toMatch(/scanned .+ ago/);
  const gmx = screen.getByRole("button", { name: /gmx/ });
  expect(txt(gmx)).toMatch(/ago · failed/);
  expect(txt(gmx)).not.toMatch(/scanned/);
  // the failure is in the warm colour, and in words too
  expect(within(gmx).getByText(/failed/).className).toContain(sp("text-review-fg"));
});

test("a card without a remembered visit counts the last week", () => {
  show({ data: { ...DATA, accounts: [{ ...ACCOUNTS[0], new_basis: "week" },
    ACCOUNTS[1]] } });
  expect(txt(screen.getByRole("button", { name: /gmail/ })))
    .toContain(sp("+312 new this week"));
});

test("a scan that is running says so instead of the age", () => {
  show({ data: { ...DATA, accounts: [{ ...ACCOUNTS[0], status: "scanning" },
    ACCOUNTS[1]] } });
  expect(txt(screen.getByRole("button", { name: /gmail/ })))
    .toContain(sp("Scanning…"));
});

test("a card opens that account", () => {
  const h = show();
  fireEvent.click(screen.getByRole("button", { name: /icloud/ }));
  expect(h.onOpenAccount).toHaveBeenCalledWith("icloud");
});

test("where the space is: the total, one bar by account, a legend", () => {
  show();
  const space = screen.getByRole("region", { name: /Where your 9\.8 GB are/ });
  expect(txt(space)).toContain(sp("by account"));
  const bar = within(space).getByRole("img");
  expect(bar.getAttribute("aria-label")).toBe(
    "Space by account: gmail 6.0 GB, icloud 2.0 GB, "
    + "proton 1.3 GB, gmx 512.0 MB");
  expect(bar.children).toHaveLength(4);
  const legend = within(space).getAllByRole("listitem");
  expect(legend.map((li) => txt(li))).toEqual([
    "gmail 6.0 GB", "icloud 2.0 GB", "proton 1.3 GB",
    "gmx 512.0 MB"].map(sp));
});

test("same sender: a row per sender with a count per account and the total",
  () => {
  show();
  const list = screen.getByRole("region", { name: "Same sender, several accounts" });
  const first = within(list).getAllByRole("listitem")[0];
  expect(txt(first)).toContain(sp("Deals Daily"));
  expect(txt(first)).toContain(sp("You opened 2% · in 3 accounts"));
  expect(txt(first)).toContain(sp("gmail: 210"));
  expect(txt(first)).toContain(sp("proton: 96"));
  expect(txt(first)).toContain(sp("gmx: 44"));
  expect(txt(first)).toContain(sp("350"));
  expect(first.getAttribute("aria-label")).toBe(
    "Deals Daily: 3\u00a0accounts, 350\u00a0mails");
});

test("four rows first, \"All N\" shows the rest and \"Fewer\" folds back",
  () => {
  show();
  const items = () => screen.getAllByRole("listitem")
    .filter((li) => li.getAttribute("aria-label")?.includes("accounts,"));
  expect(items()).toHaveLength(SAME_SHOWN);
  const all = screen.getByRole("button", { name: "All 5" });
  expect(all.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(all);
  expect(items()).toHaveLength(5);
  fireEvent.click(screen.getByRole("button", { name: "Fewer" }));
  expect(items()).toHaveLength(SAME_SHOWN);
});

test("\"Unsubscribe in N…\" counts the accounts that can still be reached",
  () => {
  const h = show({ data: { ...DATA, same_sender: [
    row("a.example", "Alpha", [["gmail", 5], ["icloud", 4, { state: "done" }],
      ["proton", 3, { unsub: false }]]),
    row("b.example", "Bravo", [["gmail", 5, { state: "done" }],
      ["icloud", 4, { state: "done" }]]),
    row("c.example", "Charlie", [["gmail", 5], ["icloud", 4, { state: "link" }]]),
  ] } });
  // Alpha: only gmail (icloud is done, proton has no link)
  expect(screen.getByRole("button", { name: "Unsubscribe…" })).toBeTruthy();
  // Charlie: both (a recorded "needs a page" can be tried again)
  fireEvent.click(screen.getByRole("button", { name: "Unsubscribe in 2…" }));
  expect(h.onUnsubscribe.mock.calls[0][0].key).toBe("c.example");
  // Bravo: nothing left to do - said, not offered
  expect(screen.getByText("Unsubscribed in all")).toBeTruthy();
});

test("no sender in several accounts: say so", () => {
  show({ data: { ...DATA, same_sender: [] } });
  expect(screen.getByText(
    "No sender writes to more than one of your accounts.")).toBeTruthy();
});

test("nothing scanned yet / loading / failed", () => {
  const { unmount } = render(<AllAccountsOverview data={null} failed={false}
    phone={false} onRetry={() => {}} onOpenAccount={() => {}}
    onUnsubscribe={() => {}} />);
  expect(screen.getByText("loading…")).toBeTruthy();
  unmount();
  const retry = vi.fn();
  const { unmount: u2 } = render(<AllAccountsOverview data={null} failed
    phone={false} onRetry={retry} onOpenAccount={() => {}}
    onUnsubscribe={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalled();
  u2();
  render(<AllAccountsOverview phone={false} failed={false} onRetry={() => {}}
    data={{ ...DATA, accounts: ACCOUNTS.map((a) => ({ ...a, scanned_ts: null })) }}
    onOpenAccount={() => {}} onUnsubscribe={() => {}} />);
  expect(screen.getByText("Scan your accounts to see them side by side."))
    .toBeTruthy();
});

test("phone: the two widgets - mailboxes with the bar, and the top sender",
  () => {
  const h = show({ phone: true });
  const boxes = screen.getByRole("region", { name: "4 mailboxes" });
  expect(txt(boxes)).toContain(sp("9.8 GB"));
  expect(txt(within(boxes).getByRole("button", { name: /gmx/ })))
    .toContain(sp("scan failed"));
  expect(txt(within(boxes).getByRole("button", { name: /gmail/ })))
    .toContain(sp("+312 new"));
  const same = screen.getByRole("region", { name: "Same sender, several accounts" });
  expect(txt(same)).toContain(sp("Deals Daily writes to 3 of them"));
  expect(txt(same)).toContain(sp("350 mails · you opened 2% · "));
  fireEvent.click(within(same).getByRole("button", { name: "Unsubscribe in 3…" }));
  expect(h.onUnsubscribe.mock.calls[0][0].key).toBe("dealsdaily.example");
  // the desktop cards are not there
  expect(screen.queryByRole("region", { name: /Where your/ })).toBeNull();
  // the rest of the list opens from "All 5"
  fireEvent.click(within(same).getByRole("button", { name: "All 5" }));
  expect(screen.getAllByRole("listitem").some((li) =>
    li.getAttribute("aria-label") === "Chirper: 2\u00a0accounts, 460\u00a0mails")).toBe(true);
});

test("phone: account chips - All plus each account", () => {
  const select = vi.fn();
  render(<AccountChips names={["gmail", "icloud"]} selected={null}
    onSelect={select} />);
  const group = screen.getByRole("group", { name: "Show one account or all" });
  const chips = within(group).getAllByRole("button");
  expect(chips.map((c) => txt(c))).toEqual(["All", "gmail", "icloud"]);
  expect(chips[0].getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(chips[2]);
  expect(select).toHaveBeenCalledWith("icloud");
  fireEvent.click(chips[0]);
  expect(select).toHaveBeenCalledWith(null);
});

test("German: the words and the plural forms", () => {
  setLang("de");
  show({ data: { ...DATA, accounts: [ACCOUNTS[0], ACCOUNTS[3]] } });
  expect(screen.getByText("Gleicher Absender, mehrere Konten")).toBeTruthy();
  expect(screen.getByText(/Wo deine .* liegen/)).toBeTruthy();
  expect(screen.getByText("nach Konto")).toBeTruthy();
  expect(txt(screen.getByRole("button", { name: /gmx/ })))
    .toMatch(/vor .+ · fehlgeschlagen/);
  expect(txt(document.body)).toContain(sp("Du hast 2 % geöffnet · in 3 Konten"));
  expect(screen.getByRole("button", { name: /^In 3.Konten abbestellen…$/ })).toBeTruthy();
});

test("SAME is five senders (the fixture the list tests rely on)", () => {
  expect(SAME).toHaveLength(5);
});

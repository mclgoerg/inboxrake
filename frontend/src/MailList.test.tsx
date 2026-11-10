// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import type { Mail } from "./types";
import { mailKey } from "./api";

import { MailRows } from "./components/MailList";

const mk = (uid: number, over: Partial<Mail> = {}): Mail => ({
  uid, folder: "INBOX", date: "2025-01-01", ts: 0,
  subject: `Mail ${uid}`, addr: "s@x.example", size: 1000,
  seen: true, ai: null, ...over,
});

const noop = () => {};

describe("MailRows", () => {
  afterEach(cleanup);
  setLang("en");

  it("bolds the subject of an unread mail and keeps read ones regular",
    () => {
    render(<MailRows mails={[mk(1, { seen: false }), mk(2, { seen: true })]}
      sel={new Set()} onToggle={noop} onOpen={noop} />);
    expect(screen.getByText("Mail 1").className).toContain("font-semibold");
    expect(screen.getByText("Mail 2").className).not.toContain("font-semibold");
  });

  it("keeps the meta line to date + size for a single-sender, "
    + "single-folder list", () => {
    render(<MailRows mails={[mk(1), mk(2)]}
      sel={new Set()} onToggle={noop} onOpen={noop} />);
    expect(screen.getAllByText("1,000 B").length).toBe(2);
    // the date is a <time> with the ISO day as its tooltip
    expect(screen.getAllByText("1 Jan 2025")[0].getAttribute("title"))
      .toBe("2025-01-01");
  });

  it("adds the sender address once the visible mails span more than one "
    + "sender", () => {
    render(<MailRows mails={[
      mk(1, { addr: "a@x.example" }), mk(2, { addr: "b@x.example" }),
    ]} sel={new Set()} onToggle={noop} onOpen={noop} />);
    expect(screen.getByText("a@x.example · 1,000 B")).toBeTruthy();
    expect(screen.getByText("b@x.example · 1,000 B")).toBeTruthy();
  });

  it("adds the folder once the visible mails span more than one folder",
    () => {
    render(<MailRows mails={[
      mk(1, { folder: "INBOX" }), mk(2, { folder: "Archive" }),
    ]} sel={new Set()} onToggle={noop} onOpen={noop} />);
    expect(screen.getByText("INBOX · 1,000 B")).toBeTruthy();
    expect(screen.getByText("Archive · 1,000 B")).toBeTruthy();
  });

  describe("paging and month headings (sender detail)", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => mk(i + 1, {
      date: i < 3 ? "2026-09-20" : "2026-08-10" }));

    it("heads each month with its count, counting mails not shown yet", () => {
      render(<MailRows mails={many(150)} pageSize={100} byMonth
        sel={new Set()} onToggle={noop} onOpen={noop} />);
      expect(screen.getByText("September 2026 · 3 mails")).toBeTruthy();
      // August has 147 mails, 97 of them rendered
      expect(screen.getByText("August 2026 · 147 mails")).toBeTruthy();
      expect(screen.getAllByText(/^Mail \d+$/)).toHaveLength(100);
    });

    it("shows 100 at a time and says how many are left", () => {
      render(<MailRows mails={many(250)} pageSize={100} byMonth
        sel={new Set()} onToggle={noop} onOpen={noop} />);
      const more = () => screen.getByRole("button",
        { name: /Show \d+ more/ });
      expect(more().textContent).toBe("Show 100 more · 150 left");
      fireEvent.click(more());
      expect(screen.getAllByText(/^Mail \d+$/)).toHaveLength(200);
      expect(more().textContent).toBe("Show 50 more · 50 left");
      fireEvent.click(more());
      expect(screen.queryByRole("button", { name: /Show/ })).toBeNull();
    });

    it("renders a selected mail beyond the first page, so no selection "
      + "is out of sight", () => {
      const ms = many(250);
      const { rerender } = render(<MailRows mails={ms} pageSize={100} byMonth
        sel={new Set()} onToggle={noop} onOpen={noop} />);
      expect(screen.queryByText("Mail 230")).toBeNull();
      rerender(<MailRows mails={ms} pageSize={100} byMonth onToggle={noop}
        onOpen={noop} sel={new Set(ms.map(mailKey))} />);
      expect(screen.getByText("Mail 230")).toBeTruthy();
      expect(screen.getAllByText(/^Mail \d+$/)).toHaveLength(250);
    });

    it("stops revealing selected mails at 500 rows", () => {
      const ms = many(900);
      render(<MailRows mails={ms} pageSize={100} byMonth onToggle={noop}
        onOpen={noop} sel={new Set(ms.map(mailKey))} />);
      expect(screen.getAllByText(/^Mail \d+$/)).toHaveLength(500);
      expect(screen.getByRole("button", { name: /Show 100 more/ })
        .textContent).toBe("Show 100 more · 400 left");
    });

    it("has no headings unless asked (size sort, other lists)", () => {
      render(<MailRows mails={many(5)} sel={new Set()} onToggle={noop}
        onOpen={noop} />);
      expect(screen.queryByRole("heading")).toBeNull();
    });
  });
});

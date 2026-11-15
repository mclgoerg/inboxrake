// @vitest-environment jsdom
import { beforeEach, expect, test } from "vitest";
import { addressSub, blockable, junkCount, movableStrangers, spanText }
  from "./addresses";
import { setLang } from "./i18n";
import type { AddressRow } from "./types";

beforeEach(() => setLang("en"));
const sp = (s: string) => s.replace(/\u00a0/g, " ");

test("spanText: days, months, years and months", () => {
  expect(sp(spanText(75))).toBe("2 months");
  expect(sp(spanText(20))).toBe("20 days");
  expect(sp(spanText(365))).toBe("1 year");
  expect(sp(spanText(550))).toBe("1 year, 6 months");
  expect(sp(spanText(900))).toBe("2 years, 5 months");
  setLang("de");
  expect(sp(spanText(550))).toBe("1 Jahr, 6 Monate");
});

const row = (over: Partial<AddressRow>): AddressRow => ({
  address: "a@alias.example", kind: "alias", tag: "", mails: 10, senders: 3,
  first_ts: 1_700_000_000, last_ts: 1_700_000_000,
  given_to: { name: "Shop", addr: "s@shop.example", ts: 1_700_000_000,
    subject: "" },
  leak: null, retired: false, retired_ts: 0, status: "clean", ...over });

test("movable and blockable strangers leave protected and blocked ones", () => {
  const s = (party: string, mails: number, prot = false, blocked = false) =>
    ({ party, name: party, addr: `x@${party}`, addrs: [`x@${party}`], mails,
      addr_total: 1, to_block: prot || blocked ? [] : [`x@${party}`],
      protected: prot, blocked });
  const leak = { quiet_days: 90, quiet_mails: 5, followed: 0,
    stranger_mails: 17, dmarc_failed: null,
    first_stranger: { ts: 1, party: "a", name: "a", addr: "x@a" },
    strangers: [s("a", 5), s("b", 7, true), s("c", 3, false, true), s("d", 2)] };
  const r = row({ leak, status: "leaked" });
  expect(movableStrangers(r).map((x) => x.party)).toEqual(["a", "c", "d"]);
  expect(junkCount(r)).toBe(10);
  expect(blockable(r).map((x) => x.party)).toEqual(["a", "d"]);
  expect(junkCount(row({}))).toBe(0);
});

test("addressSub: one line per kind", () => {
  expect(sp(addressSub(row({})))).toMatch(/^Given to Shop · /);
  expect(sp(addressSub(row({ kind: "catchall", senders: 1 }))))
    .toBe("Own domain · Shop only");
  expect(sp(addressSub(row({ kind: "catchall", senders: 4 }))))
    .toBe("Own domain · 4 senders");
  expect(sp(addressSub(row({ kind: "tag", tag: "news", senders: 9 }))))
    .toBe("Tag “news” · 9 senders");
  expect(addressSub(row({ kind: "main" }))).toMatch(/^Since 20\d\d · everyone$/);
  expect(sp(addressSub(row({ kind: "other", senders: 1 }))))
    .toBe("Forwarded to you · 1 sender");
});

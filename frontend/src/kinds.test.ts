// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import { EN } from "./locales/en";
import { DE } from "./locales/de";
import { hasKinds, isKind, KIND_IDS, kindLabel, kindOnly, kindRows,
  kindShort } from "./kinds";
import type { Mail } from "./types";

const mk = (uid: number, kind: string | undefined,
    over: Partial<Mail> = {}): Mail => ({
  uid, folder: "INBOX", date: "2026-10-01", ts: 1000 + uid,
  subject: `S${uid}`, addr: "a@x.example", size: 100, seen: true, ai: null,
  kind, ...over,
});

afterEach(() => setLang("en"));

describe("kindRows", () => {
  it("counts per kind, the biggest first, ties in KIND_IDS order", () => {
    const rows = kindRows([mk(1, "shipping"), mk(2, "ads"), mk(3, "orders"),
      mk(4, "orders"), mk(5, "ads"), mk(6, "invoices")]);
    expect(rows.map((r) => [r.id, r.n])).toEqual([
      ["ads", 2], ["orders", 2], ["shipping", 1], ["invoices", 1]]);
  });

  it("adds up the size and the open share, and names the newest mail",
    () => {
    const [ads] = kindRows([
      mk(1, "ads", { size: 1000, seen: false, date: "2026-09-01", ts: 5 }),
      mk(2, "ads", { size: 3000, seen: true, date: "2026-10-30", ts: 90 }),
      mk(3, "ads", { size: 500, seen: false, date: "2026-10-02", ts: 50 }),
      mk(4, "ads", { size: 500, seen: false, date: "2026-10-01", ts: 40 })]);
    expect(ads.size).toBe(5000);
    expect(ads.opened).toBe(25);
    expect(ads.last).toBe("2026-10-30");
    expect(ads.mails).toHaveLength(4);
  });

  it("leaves out mails of no kind, an unknown kind or an older server's",
    () => {
    const rows = kindRows([mk(1, ""), mk(2, undefined), mk(3, "weird"),
      mk(4, "ads"), mk(5, "orders")]);
    expect(rows.map((r) => r.id)).toEqual(["ads", "orders"]);
    expect(kindRows([])).toEqual([]);
  });

  it("the box needs two kinds", () => {
    expect(hasKinds(kindRows([mk(1, "ads"), mk(2, "ads")]))).toBe(false);
    expect(hasKinds(kindRows([mk(1, "ads"), mk(2, "orders")]))).toBe(true);
    expect(hasKinds(kindRows([mk(1, "")]))).toBe(false);
  });
});

describe("the kinds and their words", () => {
  it("isKind accepts exactly the server's kinds", () => {
    for (const k of KIND_IDS) expect(isKind(k)).toBe(true);
    for (const k of ["", "ADS", "weird", null, undefined, 3, ["ads"]]) {
      expect(isKind(k)).toBe(false);
    }
  });

  it("every kind has its three words in English and German", () => {
    for (const k of KIND_IDS) {
      for (const key of [`kind.${k}`, `kind.short_${k}`, `kind.lc_${k}`]) {
        expect(EN[key], `en ${key}`).toBeTruthy();
        expect(DE[key], `de ${key}`).toBeTruthy();
      }
    }
  });

  it("the words read as the board says", () => {
    expect(kindLabel("ads")).toBe("Ads and offers");
    expect(kindShort("ads")).toBe("ads");
    expect(kindOnly("ads")).toBe("only ads and offers");
    expect(kindOnly("shipping")).toBe("only shipping updates");
    expect(kindOnly("weird")).toBe("only weird");
    setLang("de");
    expect(kindLabel("orders")).toBe("Bestellbestätigungen");
    expect(kindOnly("ads")).toBe("nur Werbung und Angebote");
  });
});

// @vitest-environment jsdom
/* Your documents: the calls (summary, one year, one file), the file name a
 * download is saved under, the coded refusals in the user's language - and the
 * small helpers of the page. */

import { afterEach, expect, test, vi } from "vitest";
import { api, dispositionName, setAccount } from "./api";
import { dayShort, downloadYear, filesLine, latestYear, mailOf, newRun,
  partial, savedText, yearLine, yearOf } from "./documents";
import { ROWS, row, summary } from "./documentsFixtures";
import { setLang } from "./i18n";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setAccount("");
  setLang("en");
});

const reply = (status: number, body: unknown,
               headers: Record<string, string> = {}) =>
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: status < 300, status, text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
    blob: () => Promise.resolve(new Blob(["file"])),
    headers: new Headers(headers) }));

/** What the browser is told to save: the names the anchors were clicked with. */
const saves = () => {
  const saved: string[] = [];
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:doc");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const real = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const el = real(tag);
    if (el instanceof HTMLAnchorElement)
      el.addEventListener("click", () => saved.push(el.download));
    return el;
  });
  return saved;
};

test("the summary and a year are read for the account asked for", async () => {
  setAccount("work mail");
  reply(200, summary());
  await api.documentsSummary();
  expect((fetch as any).mock.calls[0][0])
    .toBe("/api/documents/summary?account=work%20mail");
  reply(200, { year: 2025, total: 0, capped: false, rows: [] });
  await api.documents(2025);
  expect((fetch as any).mock.calls[0][0])
    .toBe("/api/documents?year=2025&account=work%20mail");
});

test("a file is asked for by POST - its name stays out of the URL", async () => {
  setAccount("work mail");
  reply(200, {}, { "Content-Disposition":
    "attachment; filename=\"invoice.pdf\"; filename*=UTF-8''invoice.pdf" });
  const saved = saves();
  await api.downloadDocument("INBOX/Rechnungen", 7,
    { name: "invoice 2026.pdf", size: 8000 });
  const [url, init] = (fetch as any).mock.calls[0];
  expect(url).toBe("/api/documents/file?account=work%20mail");
  expect(url).not.toContain("invoice");
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body)).toEqual({ folder: "INBOX/Rechnungen", uid: 7,
    name: "invoice 2026.pdf", size: 8000 });
  expect(saved).toEqual(["invoice.pdf"]);
});

test("the saved name is the UTF-8 one the server sent, else the plain one, else the list's", async () => {
  const saved = saves();
  reply(200, {}, { "Content-Disposition":
    "attachment; filename=\"_bersicht f_r M_rz.pdf\"; "
    + "filename*=UTF-8''%C3%9Cbersicht%20f%C3%BCr%20M%C3%A4rz.pdf" });
  await api.downloadDocument("INBOX", 1, { name: "x.pdf", size: 1 });
  reply(200, {}, { "Content-Disposition": "attachment; filename=\"plain.pdf\"" });
  await api.downloadDocument("INBOX", 1, { name: "x.pdf", size: 1 });
  reply(200, {});
  await api.downloadDocument("INBOX", 1, { name: "from-the-list.pdf", size: 1 });
  expect(saved).toEqual(["Übersicht für März.pdf", "plain.pdf",
    "from-the-list.pdf"]);
  // a broken escape falls back to the plain name
  const res = (cd: string) => ({ headers: new Headers({
    "Content-Disposition": cd }) }) as unknown as Response;
  expect(dispositionName(res("attachment; filename=\"a.pdf\"; filename*=UTF-8''%E0%A4%A")))
    .toBe("a.pdf");
  expect(dispositionName(res(""))).toBeNull();
});

test("a refused download throws the backend's code in the user's language", async () => {
  reply(404, { detail: "docs_gone" });
  const e: any = await api.downloadDocument("INBOX", 1,
    { name: "a.pdf", size: 1 }).catch((x) => x);
  expect(e.code).toBe("docs_gone");
  expect(e.message).toBe(
    "That document is not in the list any more. Scan again and reopen the page.");
  setLang("de");
  reply(409, { detail: "docs_too_big:mb=64" });
  const big: any = await api.downloadDocument("INBOX", 1,
    { name: "a.pdf", size: 1 }).catch((x) => x);
  expect(big.code).toBe("docs_too_big");
  expect(big.message).toBe(
    "Diese Mail ist größer als 64 MB und lässt sich hier nicht herunterladen.");
  for (const code of ["docs_not_scanned", "docs_changed", "docs_failed"]) {
    reply(409, { detail: code });
    const x: any = await api.downloadDocument("INBOX", 1,
      { name: "a.pdf", size: 1 }).catch((y) => y);
    expect(x.code).toBe(code);
    expect(x.message).not.toMatch(/^docs_/);
  }
});

test("the helpers: years, files, the row as a mail", () => {
  expect(latestYear(summary())).toBe(2026);
  expect(latestYear(null)).toBeNull();
  expect(latestYear(summary({ years: [] }))).toBeNull();
  expect(yearOf(summary(), 2025)!.files).toBe(203);
  expect(yearOf(summary(), 1999)).toBeNull();
  expect(yearLine(yearOf(summary(), 2026)!).replace(/\u00a0/g, " "))
    .toBe("312 documents in 214 mails · 2026");
  expect(filesLine(ROWS[3]).replace(/\u00a0/g, " ")).toBe("policy.pdf · 1.2 MB · terms.pdf · 380 KB");
  const m = mailOf(ROWS[5]);
  expect(m).toMatchObject({ folder: "INBOX", uid: 6, subject: "Bescheid für 2025",
    seen: false, ai: null, pinned: true });
  // a mail that cannot be pinned says nothing about a pin
  expect("pinned" in mailOf(row({ pinnable: false }))).toBe(false);
  expect(dayShort(ROWS[0].ts)).toBe("24 Nov");
  setLang("de");
  expect(dayShort(ROWS[0].ts)).toBe("24. Nov.");
});

/* ---------------------------- the year's .zip ------------------------------ */

const PLAN = { year: 2026, kinds: ["invoices", "tax"], mails: 4, files: 4,
  bytes: 1000, pinnable: 4, parts: 1, cap: 1000000, plan: "digest-1" };
const ZIP_BODY = { year: 2026, kinds: ["invoices", "tax"] as never, part: 1,
  parts: 1, plan: "digest-1", index: true, pin: false, lang: "en" };

test("the plan is asked by POST, for the account asked for", async () => {
  setAccount("work mail");
  reply(200, PLAN);
  const got = await api.documentsPlan(2026, ["invoices", "tax"]);
  const [url, init] = (fetch as any).mock.calls[0];
  expect(url).toBe("/api/documents/zip/plan?account=work%20mail");
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body)).toEqual({ year: 2026, kinds: ["invoices", "tax"] });
  expect(got.plan).toBe("digest-1");
});

test("a .zip is saved under the name the server gave it, and says what it held", async () => {
  setAccount("work mail");
  reply(200, {}, { "Content-Disposition":
    "attachment; filename=\"inboxrake-documents-2026-part-2-of-3.zip\"",
  "X-Docs-Mails": "12", "X-Docs-Files": "15", "X-Docs-Skipped": "2",
  "X-Docs-Pinned": "10" });
  const saved = saves();
  const got = await api.downloadDocumentsZip({ ...ZIP_BODY, part: 2, parts: 3,
    pin: true });
  const [url, init] = (fetch as any).mock.calls[0];
  expect(url).toBe("/api/documents/zip?account=work%20mail");
  expect(JSON.parse(init.body)).toMatchObject({ year: 2026, part: 2, parts: 3,
    plan: "digest-1", index: true, pin: true, lang: "en" });
  expect(saved).toEqual(["inboxrake-documents-2026-part-2-of-3.zip"]);
  expect(got).toEqual({ mails: 12, files: 15, skipped: 2, pinned: 10 });
  // no headers: a name from the year, zeros
  reply(200, {});
  expect(await api.downloadDocumentsZip(ZIP_BODY)).toEqual(
    { mails: 0, files: 0, skipped: 0, pinned: 0 });
  expect(saved.at(-1)).toBe("inboxrake-documents-2026.zip");
});

test("a refused plan or download throws the backend's code in the user's language", async () => {
  const cases: [string, string, RegExp, RegExp][] = [
    ["docs_nothing", "docs_nothing", /no documents of that year and kind/,
      /keine Dokumente dieses Jahres/],
    ["docs_busy", "docs_busy", /still running/, /läuft noch/],
    ["docs_changed", "docs_changed", /not the one the scan saw/,
      /nicht die, die der Scan gesehen hat/],
    ["docs_too_many:max=40,mb=256", "docs_too_many",
      /more than 40 downloads of 256 MB each/, /mehr als 40 Downloads mit je 256 MB/],
  ];
  for (const [detail, code, en, de] of cases) {
    setLang("en");
    reply(409, { detail });
    const e: any = await api.downloadDocumentsZip(ZIP_BODY).catch((x) => x);
    expect(e.code).toBe(code);
    expect(e.message).toMatch(en);
    setLang("de");
    reply(409, { detail });
    const d: any = await api.documentsPlan(2026, ["tax"]).catch((x) => x);
    expect(d.code).toBe(code);
    expect(d.message).toMatch(de);
  }
});

test("a year is downloaded part by part under one plan, and the parts add up", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
    calls.push(url.split("?")[0] + " " + (init.body ?? ""));
    if (url.startsWith("/api/documents/zip/plan"))
      return { ok: true, status: 200, json: async () => ({ ...PLAN, parts: 2 }) };
    const part = JSON.parse(init.body).part;
    return { ok: true, status: 200, blob: async () => new Blob(["z"]),
      headers: new Headers({ "X-Docs-Mails": String(part * 10),
        "X-Docs-Files": String(part * 12), "X-Docs-Skipped": String(part - 1),
        "X-Docs-Pinned": "3" }) };
  }));
  saves();
  const progress: [number, number][] = [];
  const got = await downloadYear(2026,
    { kinds: ["invoices", "tax"], index: false, pin: true },
    (n, of) => progress.push([n, of]));
  expect(got).toEqual({ parts: 2, done: 2, mails: 30, files: 36, skipped: 1,
    pinned: 6, stopped: false });
  expect(progress).toEqual([[1, 2], [2, 2]]);
  expect(calls.map((c) => c.split(" ")[0])).toEqual(["/api/documents/zip/plan",
    "/api/documents/zip", "/api/documents/zip"]);
  const bodies = calls.slice(1).map((c) => JSON.parse(c.slice(c.indexOf(" ") + 1)));
  expect(bodies).toEqual([
    { year: 2026, kinds: ["invoices", "tax"], part: 1, parts: 2,
      plan: "digest-1", index: false, pin: true, lang: "en" },
    { year: 2026, kinds: ["invoices", "tax"], part: 2, parts: 2,
      plan: "digest-1", index: false, pin: true, lang: "en" }]);
});

/** A server with `parts` downloads of which `failAt` fails once with `code`. */
const server = (parts: number, failAt = 0, code = "docs_failed") => {
  const asked: string[] = [];
  let failed = false;
  let plans = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
    if (url.startsWith("/api/documents/zip/plan")) {
      asked.push("plan");
      return { ok: true, status: 200,
        json: async () => ({ ...PLAN, parts, plan: `p${++plans}` }) };
    }
    const b = JSON.parse(init.body);
    asked.push(`${b.part}/${b.parts}@${b.plan}`);
    if (b.part === failAt && !failed) {
      failed = true;
      return { ok: false, status: 409, text: async () => JSON.stringify(
        { detail: code }) };
    }
    return { ok: true, status: 200, blob: async () => new Blob(["z"]),
      headers: new Headers({ "X-Docs-Mails": "10", "X-Docs-Files": "12",
        "X-Docs-Pinned": "10" }) };
  }));
  saves();
  return asked;
};
const ANSWER = { kinds: ["invoices"] as never, index: true, pin: true };

test("the first part that fails ends the run and nothing after it is asked for", async () => {
  const asked = server(3, 2);
  const e: any = await downloadYear(2026, ANSWER, () => {}).catch((x) => x);
  expect(e.code).toBe("docs_failed");
  expect(asked).toEqual(["plan", "1/3@p1", "2/3@p1"]);
});

test("asking again goes on at the part that failed - the earlier ones are not saved twice", async () => {
  const asked = server(4, 3);
  const run = newRun();
  await downloadYear(2026, ANSWER, () => {}, run).catch(() => {});
  expect(run.next).toBe(3);
  expect(run.total).toMatchObject({ parts: 4, done: 2, mails: 20, pinned: 20 });
  expect(partial(run)).toMatchObject({ done: 2, stopped: true, pinned: 20 });
  const got = await downloadYear(2026, ANSWER, () => {}, run);
  // one plan, parts 1 and 2 once, part 3 twice (the failed one), then 4
  expect(asked).toEqual(["plan", "1/4@p1", "2/4@p1", "3/4@p1", "3/4@p1",
    "4/4@p1"]);
  expect(got).toMatchObject({ parts: 4, done: 4, mails: 40, files: 48,
    pinned: 40, stopped: false });
});

test("a plan the server has dropped starts the run over with a new plan", async () => {
  const asked = server(2, 2, "docs_changed");
  const run = newRun();
  const e: any = await downloadYear(2026, ANSWER, () => {}, run).catch((x) => x);
  expect(e.code).toBe("docs_changed");
  // what the first part pinned is still known (the list is read again)
  expect(run.pinnedAny).toBe(true);
  const got = await downloadYear(2026, ANSWER, () => {}, run);
  expect(asked).toEqual(["plan", "1/2@p1", "2/2@p1", "plan", "1/2@p2",
    "2/2@p2"]);
  expect(got).toMatchObject({ parts: 2, done: 2, mails: 20 });
});

test("stopping ends the run after the part that is running", async () => {
  const asked = server(3);
  const run = newRun();
  const got = await downloadYear(2026, ANSWER, (n) => {
    if (n === 2) run.stop = true;               // pressed during part 2
  }, run);
  expect(asked).toEqual(["plan", "1/3@p1", "2/3@p1"]);
  expect(got).toMatchObject({ parts: 3, done: 2, mails: 20, stopped: true });
});

test("a stop asked before the first part is saved still saves that part", async () => {
  const first = server(3);
  const early = newRun();
  early.stop = true;
  await downloadYear(2026, ANSWER, () => {}, early);
  expect(first).toEqual(["plan", "1/3@p1"]);
});

test("nothing saved and nothing pinned is nothing to say", () => {
  expect(partial(newRun())).toBeNull();
});

test("what was saved is said in one sentence, in the user's language", () => {
  const plain = (x: string) => x.replace(/\u00a0/g, " ");
  const r = { parts: 1, done: 1, mails: 38, files: 51, skipped: 0, pinned: 0 };
  expect(plain(savedText(2026, r)))
    .toBe("Saved your 2026 documents: 51 files from 38 mails.");
  expect(plain(savedText(2026, { ...r, parts: 3, done: 3, skipped: 1,
    pinned: 1 })))
    .toBe("Saved your 2026 documents: 51 files from 38 mails. It came in 3 "
      + "downloads. 1 mail could not be read just now and is not in it. "
      + "1 mail is now kept safe.");
  // stopped / ended by a failure after some parts
  expect(plain(savedText(2026, { ...r, parts: 3, done: 1, pinned: 38 })))
    .toBe("Stopped after 1 of 3 downloads of your 2026 documents: 51 files from "
      + "38 mails. 38 mails are now kept safe.");
  setLang("de");
  expect(plain(savedText(2026, { ...r, skipped: 2, pinned: 38 })))
    .toBe("Deine Dokumente 2026 sind gespeichert: 51 Dateien aus 38 Mails. "
      + "2 Mails konnten gerade nicht gelesen werden und fehlen. "
      + "38 Mails werden jetzt sicher behalten.");
  expect(plain(savedText(2026, { ...r, parts: 3, done: 2 })))
    .toBe("Nach 2 von 3 Downloads angehalten (2026): 51 Dateien aus 38 Mails.");
});

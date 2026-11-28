// @vitest-environment jsdom
/* Your documents: the calls (summary, one year, one file), the file name a
 * download is saved under, the coded refusals in the user's language - and the
 * small helpers of the page. */

import { afterEach, expect, test, vi } from "vitest";
import { api, dispositionName, setAccount } from "./api";
import { dayShort, filesLine, latestYear, mailOf, yearLine, yearOf }
  from "./documents";
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

// @vitest-environment jsdom
/* Keep the mail, remove the file: the three calls (check, start, .zip), their
 * coded refusals in the user's language, the notice's reasons, the Activity
 * headline and the undo wording. */

import { afterEach, expect, test, vi } from "vitest";
import { api, noticeParams, setAccount, undoLabel } from "./api";
import { entryText } from "./activity";
import { ACTION_LOOK } from "./components/actionLook";
import { setLang } from "./i18n";
import type { AuditEntry } from "./types";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setAccount("");
  setLang("en");
});

const FILES = [{ name: "scan-1.pdf", size: 5976000 }];
const ITEMS: [string, number][] = [["INBOX", 1]];

const reply = (status: number, body: unknown) =>
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: status < 300, status, text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
    blob: () => Promise.resolve(new Blob(["zip"])),
    headers: new Headers() }));

test("check and start post the mails and the files to the account asked for",
  async () => {
  setAccount("work mail");
  reply(200, { mails: [], blocked: [], files: [], zip: { bytes: 0, cap: 1 } });
  await api.removeCheck(ITEMS, FILES);
  let [url, init] = (fetch as any).mock.calls[0];
  expect(url).toBe("/api/attachments/remove/check?account=work%20mail");
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body)).toEqual({ items: ITEMS, files: FILES });
  reply(200, { ok: true, queued: 1 });
  await api.removeFiles(ITEMS, FILES, 1, "de");
  [url, init] = (fetch as any).mock.calls[0];
  expect(url).toBe("/api/attachments/remove?account=work%20mail");
  expect(JSON.parse(init.body)).toEqual(
    { items: ITEMS, files: FILES, confirm: 1, lang: "de" });
});

test("the zip is handed to the browser as a download", async () => {
  reply(200, {});
  const saved: string[] = [];
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:zip");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const real = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const el = real(tag);
    if (el instanceof HTMLAnchorElement)
      el.addEventListener("click", () => saved.push(el.download));
    return el;
  });
  await api.removeZip(ITEMS, FILES);
  expect((fetch as any).mock.calls[0][0]).toBe("/api/attachments/remove/zip");
  expect(saved).toEqual(["inboxrake-files.zip"]);
});

test("coded refusals come back in the user's language, code kept", async () => {
  reply(409, { detail: "rm_changed" });
  const e: any = await api.removeFiles(ITEMS, FILES, 2, "en").catch((x) => x);
  expect(e.message).toBe(
    "The mails changed while you were looking. Nothing was changed - choose again.");
  expect(e.code).toBe("rm_changed");
  setLang("de");
  reply(409, { detail: "rm_zip_too_big:mb=256" });
  const z: any = await api.removeZip(ITEMS, FILES).catch((x) => x);
  expect(z.code).toBe("rm_zip_too_big");
  expect(z.message).toBe("Die Dateien sind für einen Download zu groß (über 256 MB). "
    + "Entferne sie ohne Download oder wähle weniger aus.");
  // undoing a restore that went back through a removal is refused
  reply(409, { detail: "undo_through_removal" });
  const u: any = await api.removeFiles(ITEMS, FILES, 1, "de").catch((x) => x);
  expect(u.code).toBe("undo_through_removal");
  expect(u.message).toMatch(/nicht in einem Schritt zurücknehmen/);
  setLang("en");
  expect(((await api.removeFiles(ITEMS, FILES, 1, "en").catch((x) => x)) as any)
    .message).toMatch(/cannot be undone as one step\. Nothing was moved/);
  setLang("de");
  // the pinned / protected guard is the one Move to Trash has
  reply(409, { detail: "pinned_mails" });
  expect(((await api.removeFiles(ITEMS, FILES, 1, "de").catch((x) => x)) as any)
    .code).toBe("pinned_mails");
});

test("the notice's reason is worded in the user's language", () => {
  expect(noticeParams({ n: 2, why: "signed" }).why)
    .toBe("signed mail - taking a file out would break the signature");
  setLang("de");
  expect(noticeParams({ n: 2, why: "encrypted" }).why).toBe("verschlüsselte Mail");
  // other notices are left as they are
  expect(noticeParams({ n: 2 })).toEqual({ n: 2 });
});

/** Counts keep their number and noun together with a no-break space. */
const plain = (s: string) => s.replace(/\u00a0/g, " ");

const e = (over: Partial<AuditEntry>): AuditEntry => ({
  ts: 1, account: "a", actor: "user", action: "remove_files", count: 3,
  bytes: 0, label: "Removed 2 files from 3 mails", outcome: "ok", error: "",
  ...over });

test("Activity words the step, with its own icon", () => {
  expect(plain(entryText(e({}), []).title)).toBe("Removed files from 3 mails");
  expect(plain(entryText(e({ count: 1 }), []).title)).toBe("Removed files from 1 mail");
  expect(entryText(e({}), []).detail).toBe("");
  expect(ACTION_LOOK.remove_files).toBeTruthy();
  setLang("de");
  expect(plain(entryText(e({}), []).title)).toBe("Dateien aus 3 Mails entfernt");
  expect(entryText(e({ count: 0 }), []).title).toBe("Dateien entfernt");
});

test("the undo step names its files (the mails are the step's count)", () => {
  const step = { label: "Removed 2 files from 3 mails",
    label_key: "undo.remove_files", label_params: { files: 2, n: 3 } };
  expect(plain(undoLabel(step))).toBe("2 files");
  expect(plain(undoLabel({ ...step, label_params: { files: 1, n: 1 } })))
    .toBe("1 file");
  setLang("de");
  expect(plain(undoLabel(step))).toBe("2 Dateien");
  // an older step without the structured label shows its text as it was
  expect(undoLabel({ label: "Shop News" })).toBe("Shop News");
});

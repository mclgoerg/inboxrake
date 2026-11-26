// @vitest-environment jsdom
/* Keep the mail, remove the file: the confirm (per-file ticks, Keep-safe
 * reasons, the .zip first, what stays), the stop on pinned / protected mails,
 * and the order of the calls - nothing is removed unless the files were
 * downloaded first when that was asked. */

import { cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { DialogProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog }
  from "./dialogTestUtils";
import { setLang } from "./i18n";
import { removeFiles } from "./removeFiles";
import type { RemoveCheck, RemoveFile } from "./types";

const removeCheck = vi.fn();
const removeZip = vi.fn();
const removeFilesApi = vi.fn();

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: { removeCheck: (...a: unknown[]) => removeCheck(...a),
    removeZip: (...a: unknown[]) => removeZip(...a),
    removeFiles: (...a: unknown[]) => removeFilesApi(...a) },
}));

afterEach(() => {
  cleanup();
  removeCheck.mockReset();
  removeZip.mockReset();
  removeFilesApi.mockReset();
  setLang("en");
});

const WHO = "hello@photoarchive.example";
const mail = (uid: number) => ({ folder: "INBOX", uid, addr: WHO,
  subject: `Scans ${uid}` });
const FILES: RemoveFile[] = ["scan-1.pdf", "scan-2.pdf"].map((name) => ({
  name, size: 5_976_000, kind: "pdf", mails: [mail(1), mail(2), mail(3)] }));
const IDS = [["INBOX", 1], ["INBOX", 2], ["INBOX", 3]];
const ASKED = [{ name: "scan-1.pdf", size: 5_976_000 },
  { name: "scan-2.pdf", size: 5_976_000 }];

const check = (over: Partial<RemoveCheck> = {}): RemoveCheck => ({
  mails: [1, 2, 3].map((uid) => ({ folder: "INBOX", uid, addr: WHO,
    subject: `Scans ${uid}`, size: 7_000_000, files: [0, 1], safe: "",
    skip: "" })),
  blocked: [],
  files: ASKED.map((f) => ({ ...f, mails: 3, safe: 0, classes: [] })),
  zip: { bytes: 11_952_000, cap: 256 * 1048576 }, ...over });

/** Mount the dialogs and start the flow. */
const start = (files = FILES) => {
  render(<DialogProvider><span /></DialogProvider>);
  return removeFiles(files);
};

test("the confirm: files, mails, what it frees, the zip, the note", async () => {
  removeCheck.mockResolvedValue(check());
  const outcome = start();
  const dlg = await findDialog();
  expect(removeCheck).toHaveBeenCalledWith(IDS, ASKED);
  expect(within(dlg).getByText("Remove 2 files from 3 mails?")).toBeTruthy();
  // 3 mails x 2 files x 5.7 MB
  expect(within(dlg).getByText(
    "The mails stay. Frees 34.2 MB once Trash is emptied.")).toBeTruthy();
  expect(within(dlg).getAllByText(/in 3 mails from hello@photoarchive/))
    .toHaveLength(2);
  const zip = within(dlg).getByRole("checkbox", {
    name: /^Download the files first \(\.zip, 11\.4\sMB\)$/ }) as HTMLInputElement;
  expect(zip.checked).toBe(true);
  expect(within(dlg).getByText(/Files in mails that Keep-safe covers/))
    .toBeTruthy();
  expect(within(dlg).getByText(/Each mail keeps its text, date, folder and read state/))
    .toBeTruthy();
  expect(within(dlg).getByRole("button", { name: "Remove 2 files" }))
    .toBeTruthy();
  await cancelDialog();
  expect(await outcome).toBe("cancelled");
  expect(removeFilesApi).not.toHaveBeenCalled();
});

test("Remove downloads the files first, then starts the job with the confirmed count",
  async () => {
  removeCheck.mockResolvedValue(check());
  removeZip.mockResolvedValue(undefined);
  removeFilesApi.mockResolvedValue({ ok: true, queued: 3 });
  const outcome = start();
  await pressDialog("Remove 2 files");
  expect(await outcome).toBe("started");
  expect(removeZip).toHaveBeenCalledWith(IDS, ASKED);
  expect(removeFilesApi).toHaveBeenCalledWith(IDS, ASKED, 3, "en");
  // the files first: the job is only started once the download is in
  expect(removeZip.mock.invocationCallOrder[0])
    .toBeLessThan(removeFilesApi.mock.invocationCallOrder[0]);
});

test("without the zip box nothing is downloaded", async () => {
  removeCheck.mockResolvedValue(check());
  removeFilesApi.mockResolvedValue({ ok: true, queued: 3 });
  const outcome = start();
  const dlg = await findDialog();
  fireEvent.click(within(dlg).getByRole("checkbox", { name: /Download the files first/ }));
  await pressDialog("Remove 2 files");
  expect(await outcome).toBe("started");
  expect(removeZip).not.toHaveBeenCalled();
});

test("a failed download keeps the dialog open and removes nothing", async () => {
  removeCheck.mockResolvedValue(check());
  removeZip.mockRejectedValue(new Error("The files are too big for one download"));
  const outcome = start();
  await pressDialog("Remove 2 files");
  const dlg = await findDialog();
  await waitFor(() => expect(within(dlg).getByRole("alert").textContent)
    .toMatch(/too big for one download/));
  expect(removeFilesApi).not.toHaveBeenCalled();
  // the sheet is still there: try again or cancel
  await cancelDialog();
  expect(await outcome).toBe("cancelled");
});

test("files in mails Keep-safe covers start unticked, with the reason", async () => {
  removeCheck.mockResolvedValue(check({
    files: [{ ...ASKED[0], mails: 3, safe: 1, classes: ["invoices"] },
      { ...ASKED[1], mails: 3, safe: 0, classes: [] }] }));
  removeFilesApi.mockResolvedValue({ ok: true, queued: 3 });
  const outcome = start();
  const dlg = await findDialog();
  expect(within(dlg).getByText("Remove 1 file from 3 mails?")).toBeTruthy();
  expect(within(dlg).getByText(
    "Starts unticked: one of these mails is one Keep-safe covers (Invoices & receipts).")).toBeTruthy();
  const first = within(dlg).getByRole("checkbox",
    { name: "Select scan-1.pdf" }) as HTMLInputElement;
  expect(first.checked).toBe(false);
  // only the ticked file goes; ticking the other one puts it back in
  await pressDialog("Remove 1 file");
  expect(await outcome).toBe("started");
  expect(removeFilesApi).toHaveBeenCalledWith(IDS, [ASKED[1]], 3, "en");
});

test("ticking a Keep-safe file on purpose takes it along", async () => {
  removeCheck.mockResolvedValue(check({
    files: [{ ...ASKED[0], mails: 3, safe: 3, classes: ["invoices"] },
      { ...ASKED[1], mails: 3, safe: 0, classes: [] }] }));
  removeFilesApi.mockResolvedValue({ ok: true, queued: 3 });
  const outcome = start();
  const dlg = await findDialog();
  fireEvent.click(within(dlg).getByRole("checkbox", { name: "Select scan-1.pdf" }));
  expect(within(dlg).getByText("Remove 2 files from 3 mails?")).toBeTruthy();
  await pressDialog("Remove 2 files");
  await outcome;
  expect(removeFilesApi).toHaveBeenCalledWith(IDS, ASKED, 3, "en");
});

test("mails that stay as they are are named with the reason and left out", async () => {
  removeCheck.mockResolvedValue(check({
    mails: [1, 2, 3].map((uid) => ({ folder: "INBOX", uid, addr: WHO,
      subject: `Scans ${uid}`, size: 7_000_000, files: [0, 1], safe: "" as const,
      skip: uid === 3 ? "signed" : "" })) }));
  removeFilesApi.mockResolvedValue({ ok: true, queued: 2 });
  const outcome = start();
  const dlg = await findDialog();
  expect(within(dlg).getByText("Remove 2 files from 2 mails?")).toBeTruthy();
  expect(within(dlg).getByText(
    "1 mail stays as it is: signed mail - taking a file out would break the signature."))
    .toBeTruthy();
  await pressDialog("Remove 2 files");
  await outcome;
  // the signed mail is not part of the request, the confirmed count is 2
  expect(removeFilesApi).toHaveBeenCalledWith(
    [["INBOX", 1], ["INBOX", 2]], ASKED, 2, "en");
});

test("a file in no changeable mail cannot be ticked", async () => {
  removeCheck.mockResolvedValue(check({
    mails: check().mails.map((m) => ({ ...m, files: [0], skip: "" })),
    files: [{ ...ASKED[0], mails: 3, safe: 0, classes: [] },
      { ...ASKED[1], mails: 0, safe: 0, classes: [] }] }));
  const outcome = start();
  const dlg = await findDialog();
  const second = within(dlg).getByRole("checkbox",
    { name: "Select scan-2.pdf" }) as HTMLInputElement;
  expect(second.disabled).toBe(true);
  expect(second.checked).toBe(false);
  expect(within(dlg).getByText("Remove 1 file from 3 mails?")).toBeTruthy();
  await cancelDialog();
  await outcome;
});

test("too big for one download: the box is off and says why, removing still works",
  async () => {
  removeCheck.mockResolvedValue(check({
    zip: { bytes: 300 * 1048576, cap: 256 * 1048576 } }));
  removeFilesApi.mockResolvedValue({ ok: true, queued: 3 });
  const outcome = start();
  const dlg = await findDialog();
  const zip = within(dlg).getByRole("checkbox", {
    name: /too big for one download \(over 256\.0\sMB\)/ }) as HTMLInputElement;
  expect(zip.disabled).toBe(true);
  expect(zip.checked).toBe(false);
  await pressDialog("Remove 2 files");
  expect(await outcome).toBe("started");
  expect(removeZip).not.toHaveBeenCalled();
});

test("pinned mails and protected senders stop it and are named", async () => {
  removeCheck.mockResolvedValue(check({ blocked: [
    { folder: "INBOX", uid: 2, subject: "Scans 2", addr: WHO, size: 1,
      why: "pinned" },
    { folder: "INBOX", uid: 9, subject: "", addr: "boss@work.example",
      size: 1, why: "protected" }] }));
  const outcome = start();
  const dlg = await findDialog();
  expect(within(dlg).getByText("Some of these mails are protected")).toBeTruthy();
  expect(within(dlg).getByText(/Untick them, or unpin or unprotect them first/))
    .toBeTruthy();
  expect(within(dlg).getByText(`Scans 2 · ${WHO} (pinned)`)).toBeTruthy();
  expect(within(dlg).getByText("(no subject) · boss@work.example (protected sender)"))
    .toBeTruthy();
  // no way to go on from here
  expect(within(dlg).queryByRole("button", { name: /Remove/ })).toBeNull();
  fireEvent.click(within(dlg).getByRole("button", { name: "Close" }));
  expect(await outcome).toBe("stopped");
  await expectNoDialog();
  expect(removeFilesApi).not.toHaveBeenCalled();
  expect(removeZip).not.toHaveBeenCalled();
});

test("a refused check throws its coded text and opens no dialog", async () => {
  removeCheck.mockRejectedValue(new Error("Scan the account first."));
  render(<DialogProvider><span /></DialogProvider>);
  await expect(removeFiles(FILES)).rejects.toThrow("Scan the account first.");
  await expectNoDialog();
});

test("German: title, zip, reason, button and the note's language", async () => {
  setLang("de");
  removeCheck.mockResolvedValue(check({
    files: [{ ...ASKED[0], mails: 3, safe: 1, classes: ["invoices"] },
      { ...ASKED[1], mails: 3, safe: 0, classes: [] }] }));
  removeFilesApi.mockResolvedValue({ ok: true, queued: 3 });
  const outcome = start();
  const dlg = await findDialog();
  expect(within(dlg).getByText("1 Datei aus 3 Mails entfernen?"))
    .toBeTruthy();
  expect(within(dlg).getByText(/Die Mails bleiben\. Gibt .* frei, sobald der Papierkorb geleert ist\./))
    .toBeTruthy();
  expect(within(dlg).getByText(
    "Nicht angehakt: eine dieser Mails fällt unter „Sicher behalten“ (Rechnungen & Belege)."))
    .toBeTruthy();
  expect(within(dlg).getByRole("checkbox", { name: /Dateien vorher herunterladen/ }))
    .toBeTruthy();
  expect(within(dlg).getByText(/Jede Mail behält ihren Text, ihr Datum/)).toBeTruthy();
  await pressDialog("1 Datei entfernen");
  await outcome;
  expect(removeFilesApi).toHaveBeenCalledWith(IDS, [ASKED[1]], 3, "de");
});

test("Gmail: every mail stays as it is, with the reason, and nothing can be "
  + "removed", async () => {
  removeCheck.mockResolvedValue(check({
    mails: [1, 2, 3].map((uid) => ({ folder: "INBOX", uid, addr: WHO,
      subject: `Scans ${uid}`, size: 7_000_000, files: [0, 1], safe: "" as const,
      skip: "gmail" })),
    files: ASKED.map((f) => ({ ...f, mails: 0, safe: 0, classes: [] })) }));
  const outcome = start();
  const dlg = await findDialog();
  expect(within(dlg).getByText(
    "3 mails stay as they are: Gmail keeps one mail per Message-ID, so a copy cannot be made safely there."))
    .toBeTruthy();
  expect((within(dlg).getByRole("button", { name: /^Remove 0 files$/ }) as
    HTMLButtonElement).disabled).toBe(true);
  expect((within(dlg).getByRole("checkbox", { name: "Select scan-1.pdf" }) as
    HTMLInputElement).disabled).toBe(true);
  await cancelDialog();
  await outcome;
  expect(removeFilesApi).not.toHaveBeenCalled();
});

test("German: the stop names what to do - untick, unpin or unprotect", async () => {
  setLang("de");
  removeCheck.mockResolvedValue(check({ blocked: [
    { folder: "INBOX", uid: 2, subject: "Scans 2", addr: WHO, size: 1,
      why: "pinned" }] }));
  const outcome = start();
  const dlg = await findDialog();
  expect(within(dlg).getByText(/Wähle sie ab oder löse zuerst das Anheften bzw\. den Schutz\./))
    .toBeTruthy();
  fireEvent.click(within(dlg).getByRole("button", { name: "Schließen" }));
  expect(await outcome).toBe("stopped");
});

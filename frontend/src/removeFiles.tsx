/* Keep the mail, remove the file: the flow shared by the Attachments page
 * ("Keep the mails, remove the files...") and the reader's attachment menu
 * ("Remove the file, keep the mail..."). It asks the backend what the removal
 * would do (nothing changes by asking), stops on pinned mails and protected
 * senders and names them, shows the confirm (per-file ticks, the .zip first)
 * and only then starts the job: copy each mail without the files, check the
 * copy, move the original to Trash - one Undo step puts it all back. */

import { api } from "./api";
import { getLang } from "./i18n";
import { RemoveBlocked, RemoveFilesConfirm, type RemoveAnswer }
  from "./components/RemoveFilesConfirm";
import { customDialog } from "./components/ui";
import type { RemoveFile } from "./types";

/** `started`: the job is queued (its toast with Undo follows); `stopped`: a
 *  pinned mail or protected sender stopped it; `cancelled`: the user said no. */
export type RemoveOutcome = "started" | "stopped" | "cancelled";

/** Run the whole flow for `files` (each one stands for every mail that holds
 *  it). THROWS the backend's coded refusal (already worded) when the check
 *  itself fails; a failure of the download or the job shows in the dialog. */
export async function removeFiles(files: RemoveFile[]): Promise<RemoveOutcome> {
  const asked = files.map((f) => ({ name: f.name, size: f.size }));
  const seen = new Set<string>();
  const items: [string, number][] = [];
  for (const f of files)
    for (const m of f.mails) {
      const key = `${m.folder}\0${m.uid}`;
      if (!seen.has(key)) {
        seen.add(key);
        items.push([m.folder, m.uid]);
      }
    }
  const check = await api.removeCheck(items, asked);
  if (check.blocked.length) {
    await customDialog<boolean>((done) => (
      <RemoveBlocked check={check} onClose={() => done(true)} />));
    return "stopped";
  }
  const run = async (answer: RemoveAnswer) => {
    const chosen = answer.ticked.map((i) => asked[i]);
    const mails = check.mails.filter((m) => !m.skip
      && m.files.some((i) => answer.ticked.includes(i)));
    const ids = mails.map((m) => [m.folder, m.uid] as [string, number]);
    // The files first: if the download fails nothing is removed.
    if (answer.zip) await api.removeZip(ids, chosen);
    await api.removeFiles(ids, chosen, ids.length, getLang());
  };
  const answer = await customDialog<RemoveAnswer>((done) => (
    <RemoveFilesConfirm files={files} check={check} run={run}
      onResult={done} />));
  return answer ? "started" : "cancelled";
}

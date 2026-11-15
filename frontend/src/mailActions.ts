import { mailKey } from "./api";
import { t } from "./i18n";
import { confirmDialog } from "./components/ui";
import { confirmTrash } from "./keepsafe";
import type { Mail } from "./types";

export type MailActionPlan =
  | { kind: "cancelled" }
  | { kind: "all_pinned" }
  /** The keep-safe protection could not be written: nothing was moved. */
  | { kind: "error"; error: unknown }
  /** `protectedNow`: mails the keep-safe box just protected (left out of
   *  `acting`); the caller marks them protected in its list. */
  | { kind: "go"; acting: Mail[]; force: boolean; protectedNow: Mail[] };

/** The confirm flow for acting on individually selected mails, shared by
 *  the group detail view and the flat "All mails" list so pinned mails are
 *  handled identically everywhere: ONE pinned mail acted on explicitly
 *  gets its own warning and is sent with `force`; pinned mails inside a
 *  larger selection are dropped from it (never silently moved).
 *  mark_read is non-destructive and exempt. */
export async function planMailAction(chosen: Mail[], action: string,
    verb: string): Promise<MailActionPlan> {
  let acting = chosen;
  let force = false;
  let protectedNow: Mail[] = [];
  const tone = action === "mark_read" ? "primary" : "danger";
  if (action !== "mark_read") {
    const pinned = chosen.filter((m) => m.pinned);
    if (chosen.length === 1 && pinned.length === 1) {
      if (!await confirmDialog({ title: verb, tone,
        body: t("confirm.act_pinned_mail", {
          subject: chosen[0].subject || t("(no subject)") }),
        confirmLabel: t("confirm.btn_anyway", { verb }) }))
        return { kind: "cancelled" };
      force = true;
    } else if (pinned.length) {
      acting = chosen.filter((m) => !m.pinned);
      if (!acting.length) return { kind: "all_pinned" };
    }
  }
  if (!force) {
    // A single mail is named by its subject, several by their count.
    const bullets = [acting.length === 1
      ? t("confirm.b_subject", {
          subject: acting[0].subject || t("(no subject)") })
      : t("confirm.b_selected", { n: acting.length })];
    if (acting.length !== chosen.length) {
      bullets.push(t("confirm.b_pinned_skipped",
        { n: chosen.length - acting.length }));
    }
    if (action === "trash") bullets.push(t("confirm.b_space"));
    try {
      // A big move to Trash carries the keep-safe box; the ticked mails are
      // protected first and drop out of the move.
      const answer = await confirmTrash({ title: verb, bullets, tone,
        label: (k) => t("confirm.btn_n", { verb, n: k }), n: acting.length,
        scope: action === "trash" ? { items: itemsOf(acting) } : null });
      if (!answer.ok) return { kind: "cancelled" };
      if (answer.pinned.length) {
        const gone = new Set(answer.pinned.map(([folder, uid]) =>
          mailKey({ folder, uid })));
        protectedNow = acting.filter((m) => gone.has(mailKey(m)));
        acting = acting.filter((m) => !gone.has(mailKey(m)));
        if (!acting.length) return { kind: "all_pinned" };
      }
    } catch (error) {
      return { kind: "error", error };
    }
  }
  return { kind: "go", acting, force, protectedNow };
}

export const actionVerb = (action: string, dest = ""): string =>
  ({ trash: t("Move to Trash"), archive: t("Archive"),
     move: `${t("Move")} → ${dest}`,
     mark_read: t("Mark as read") } as Record<string, string>)[action]
  ?? action;

export const itemsOf = (mails: Mail[]) =>
  mails.map((m) => [m.folder, m.uid] as [string, number]);

export { mailKey };

/** The one confirmation for "move the selected mails to Trash" in the list
 *  panels (Search, Attachments, Duplicates). */
export const confirmTrashMails = (n: number, subject?: string):
    Promise<boolean> => {
  const verb = actionVerb("trash");
  // One mail from the reader is named by its subject, as everywhere else.
  const what = n === 1 && subject !== undefined
    ? t("confirm.b_subject", { subject: subject || t("(no subject)") })
    : t("confirm.b_selected", { n });
  return confirmDialog({ title: verb, tone: "danger",
    bullets: [what, t("confirm.b_space")],
    confirmLabel: t("confirm.btn_n", { verb, n }) });
};

/** Like confirmTrashMails for a list of [folder, uid] pairs, with the
 *  keep-safe box on a big move: resolves the pairs that really move (the
 *  mails the user kept safe are protected and left out - possibly none), or
 *  null when cancelled. THROWS when the protection could not be written.
 *  `keepSafe: false` (Duplicates: a copy always stays, and a pin by
 *  Message-ID would lock every copy of the set) asks the plain confirm. */
export async function confirmTrashItems(items: [string, number][],
    subject?: string, opts: { keepSafe?: boolean } = {}):
    Promise<[string, number][] | null> {
  const n = items.length;
  const verb = actionVerb("trash");
  const what = n === 1 && subject !== undefined
    ? t("confirm.b_subject", { subject: subject || t("(no subject)") })
    : t("confirm.b_selected", { n });
  const answer = await confirmTrash({ title: verb, tone: "danger",
    bullets: [what, t("confirm.b_space")],
    label: (k) => t("confirm.btn_n", { verb, n: k }), n,
    scope: opts.keepSafe === false ? null : { items } });
  if (!answer.ok) return null;
  if (!answer.pinned.length) return items;
  const kept = new Set(answer.pinned.map(([folder, uid]) =>
    mailKey({ folder, uid })));
  return items.filter(([folder, uid]) => !kept.has(mailKey({ folder, uid })));
}

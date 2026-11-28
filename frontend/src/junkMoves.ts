/* What the Junk folder's rows do with a sender's mails: "Not junk" (back to
 * the Inbox, undoable, then offers Protect), Move to Trash (a protected sender
 * or a pinned mail needs an explicit yes) and Block (the rule first, then the
 * second question about the mails already in Junk). Shared by the Junk page
 * and the Weekly check-in's Junk step, so both ask the same questions and
 * leave the same Undo and Activity entries. Nothing here touches a list: the
 * callers keep their own. */

import { api } from "./api";
import { confirmDialog, type useToast } from "./components/ui";
import { t } from "./i18n";
import { confirmTrash } from "./keepsafe";
import type { FolderMoveResp, UndoIdent } from "./types";

type Toast = ReturnType<typeof useToast>;

export interface JunkMoveCtx {
  /** The folder's UIDVALIDITY the UIDs were listed under. */
  uv: number;
  toast: Toast;
  /** Undo the recorded move (the App's confirmed undo). */
  undo: (entry: UndoIdent) => void | Promise<void>;
  /** Protect these senders (the App's one-tap protect). */
  protect: (addrs: string[]) => Promise<boolean>;
}

/** Junk -> Inbox ("Not junk") or -> Trash: plain undoable moves, nothing is
 *  protected or blocked silently. Protected senders / pinned mails need an
 *  explicit yes before a move to Trash (declined: null). Shows the result
 *  toast (with Undo, and Protect after Not junk); other failures throw. */
export async function junkMove(ctx: JunkMoveCtx, action: "not_junk" | "trash",
    uids: number[]): Promise<FolderMoveResp | null> {
  let r: FolderMoveResp;
  try {
    r = await api.folderMove("junk", action, uids, ctx.uv);
  } catch (e: any) {
    // protected senders / pinned mails need an explicit yes (same as every
    // other Trash move)
    if (action !== "trash" || !e.code) throw e;
    if (!await confirmDialog({
      title: t("fp.confirm_protected_title"),
      body: String(e.message), tone: "danger",
      confirmLabel: t("fp.confirm_protected_btn") })) return null;
    r = await api.folderMove("junk", action, uids, ctx.uv, true);
  }
  const undo = r.undo ? { label: t("Undo"),
    onClick: () => { void ctx.undo(r.undo!); } } : undefined;
  if (action === "not_junk") {
    ctx.toast.show(t("fp.not_junk_done", { n: r.moved }), {
      variant: "success", action: undo, duration: 12000,
      action2: r.senders.length ? {
        label: t("fp.protect_sender", { n: r.senders.length }),
        onClick: () => { void ctx.protect(r.senders); },
      } : undefined,
    });
  } else {
    ctx.toast.show(t("toast.moved_trash", { n: r.moved }),
      { variant: "success", action: undo });
  }
  return r;
}

/** Block a sender seen in Junk: the app's confirmed Block (the rule), then -
 *  with mails of the sender in Junk - the second question "move them to
 *  Trash too?" ("Only block" declines; a big move carries the keep-safe box).
 *  `blocked` = the rule exists now; `uids` = what the person agreed to move
 *  (the caller moves them with `junkMove`); `error` = the protection check
 *  failed, nothing is moved, the block stands. */
export async function junkBlock(g: { addr: string; uids: number[] },
    ctx: { folder: string; block: (addr: string) => Promise<boolean> }):
    Promise<{ blocked: boolean; uids: number[]; error?: unknown }> {
  if (!await ctx.block(g.addr)) return { blocked: false, uids: [] };
  try {
    // a big move carries the keep-safe box: the mails kept safe are
    // protected (their pin keeps them out of the move)
    const answer = await confirmTrash({
      title: t("fp.block_trash", { n: g.uids.length }), bullets: [],
      tone: "danger", cancelLabel: t("fp.block_keep"),
      label: (k) => t("confirm.btn_n", { verb: t("fp.to_trash"), n: k }),
      n: g.uids.length,
      scope: { items: g.uids.map((u) => [ctx.folder, u] as [string, number]),
        role: "junk" } });
    if (!answer.ok) return { blocked: true, uids: [] };
    const kept = new Set(answer.pinned.map(([, u]) => u));
    return { blocked: true, uids: g.uids.filter((u) => !kept.has(u)) };
  } catch (error) {
    return { blocked: true, uids: [], error };
  }
}

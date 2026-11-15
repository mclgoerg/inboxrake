import { Archive, ArrowLeftRight, FolderInput, Globe, History, KeyRound, ListChecks, Mail,
  MailCheck, Pin, RefreshCw, Send, ShieldCheck, Trash2, Undo2, BellOff, VenetianMask,
  type LucideIcon } from "lucide-react";

/** Icon + tint of an action's tile in the Activity timeline and in the
 *  Time machine's step list. */
export const ACTION_LOOK: Record<string, { icon: LucideIcon; tone: string }> = {
  trash: { icon: Trash2, tone: "bg-keep-bg text-keep-fg" },
  purge: { icon: Trash2, tone: "bg-keep-bg text-keep-fg" },
  empty_trash: { icon: Trash2, tone: "bg-keep-bg text-keep-fg" },
  archive: { icon: Archive, tone: "bg-safe-bg text-safe-fg" },
  move: { icon: FolderInput, tone: "bg-safe-bg text-safe-fg" },
  move_contents: { icon: FolderInput, tone: "bg-safe-bg text-safe-fg" },
  account_copy: { icon: ArrowLeftRight, tone: "bg-info-bg text-info-fg" },
  mark_read: { icon: MailCheck, tone: "bg-chip text-chiptext" },
  rule_execute: { icon: ListChecks, tone: "bg-review-bg text-review-fg" },
  rule_report: { icon: ListChecks, tone: "bg-chip text-chiptext" },
  unsubscribe: { icon: BellOff, tone: "bg-info-bg text-info-fg" },
  undo: { icon: Undo2, tone: "bg-chip text-chiptext" },
  restore: { icon: History, tone: "bg-review-bg text-review-fg" },
  rule_paused: { icon: ListChecks, tone: "bg-chip text-chiptext" },
  digest_sent: { icon: Send, tone: "bg-chip text-chiptext" },
  alias_retired: { icon: VenetianMask, tone: "bg-keep-bg text-keep-fg" },
  alias_restored: { icon: VenetianMask, tone: "bg-safe-bg text-safe-fg" },
  alias_created: { icon: VenetianMask, tone: "bg-info-bg text-info-fg" },
  assistant_token_created: { icon: KeyRound, tone: "bg-info-bg text-info-fg" },
  assistant_token_revoked: { icon: KeyRound, tone: "bg-chip text-chiptext" },
  assistant_connected: { icon: Globe, tone: "bg-info-bg text-info-fg" },
  assistant_disconnected: { icon: Globe, tone: "bg-chip text-chiptext" },
  assistant_token_cap: { icon: KeyRound, tone: "bg-chip text-chiptext" },
  protect: { icon: ShieldCheck, tone: "bg-safe-bg text-safe-fg" },
  assistant_protect: { icon: ShieldCheck, tone: "bg-safe-bg text-safe-fg" },
  assistant_pin: { icon: Pin, tone: "bg-safe-bg text-safe-fg" },
  assistant_scan: { icon: RefreshCw, tone: "bg-chip text-chiptext" },
};
export const FALLBACK_LOOK = { icon: Mail, tone: "bg-chip text-chiptext" };


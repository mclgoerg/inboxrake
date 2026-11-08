/* The mail reader's parts, shared by the single-mail view (MessageView) and
 * the conversation view (ThreadView): frame (back, prev / next, toolbar),
 * Apple-Mail-like header, chips, plain-text body with folded quotes and the
 * unsubscribe card. PRIVACY: bodies are plain text only - no HTML is ever
 * rendered, no remote content loaded and nothing is linkified (phishing). */

import { Ban, ChevronDown, ChevronLeft, ChevronUp, Copy, EyeOff, FileText,
  FolderInput, HardDrive, Inbox, MailMinus, MessagesSquare, MousePointerClick,
  MoreHorizontal, Paperclip, Pin, ShieldCheck, Trash2, User,
  type LucideIcon } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState,
  type ReactNode } from "react";
import { api, fmtSize, mailKey } from "../api";
import { getLang, t } from "../i18n";
import { fmtDate } from "../lib";
import { nowDate } from "../clock";
import { isForward, splitQuoted } from "../quoted";
import type { Mail, MessageDetail, UnsubVia } from "../types";
import { FolderPicker } from "./FolderPicker";
import { Avatar, Button, IconTile, Menu, MenuDivider, MenuItem, Spinner, Tag,
  useMediaQuery, useOptionalToast } from "./ui";

/* ------------------------------ app seams ------------------------------- */

/** What the reader needs from the app around it. Everything is optional: a
 *  control whose capability is missing is simply not shown (tests, tools
 *  that cannot do it). */
export interface ReaderHost {
  /** The account's own addresses: "to me", and not offered for blocking. */
  selfAddrs: string[];
  /** The account (the folder picker remembers recent folders per account). */
  account: string;
  /** Folders a single mail can be moved to (value = raw name). */
  folders: { value: string; label: string }[];
  /** Does this sender exist as a group the app can open? */
  hasSender?: (addr: string) => boolean;
  /** Close whatever hosts the reader and show the sender's detail. */
  openSender?: (addr: string) => void;
  isBlocked?: (addr: string) => boolean;
  /** The sender Block flow (its own confirm); resolves true when blocked. */
  blockSender?: (addr: string) => Promise<boolean>;
  /** Can the sender be unsubscribed from here (a single-sender group that
   *  offers a method)? */
  canUnsubscribe?: (addr: string) => boolean;
  /** Open the unsubscribe sheet for the sender. */
  unsubscribe?: (addr: string) => void;
  /** "done" once the sender is unsubscribed (null = not). */
  unsubscribed?: (addr: string) => "done" | "link" | "failed" | "pending" | null;
}

const NO_HOST: ReaderHost = { selfAddrs: [], account: "", folders: [] };
const ReaderHostContext = createContext<ReaderHost>(NO_HOST);
export const ReaderHostProvider = ReaderHostContext.Provider;
export const useReaderHost = (): ReaderHost => useContext(ReaderHostContext);

/** What the mail's opener can do with it. Each handler is the opener's OWN
 *  one (its confirm, its list update); a missing one hides its button. */
export interface ReaderActions {
  /** Trash this mail: confirm, move, drop it from the opener's list and
   *  close the reader. */
  trash?: (m: Mail) => unknown;
  /** Move this mail to a folder (confirm, undo as in the opener). */
  move?: (m: Mail, dest: string) => unknown;
  /** Set the pin; resolves false when it failed. Without it the reader
   *  calls the pin endpoint itself. */
  pin?: (m: Mail, pinned: boolean) => unknown;
  /** Told after the reader pinned through the endpoint itself (no `pin`
   *  handler): lets a list that shows the pin follow. */
  pinned?: (m: Mail, pinned: boolean) => void;
}

/** The list the mail was opened from: enables previous / next. */
export interface ReaderNav {
  list: Mail[];
  onOpen: (m: Mail) => void;
}

/* ------------------------------- helpers -------------------------------- */

/** "Name <addr>" -> { name, addr }; a bare address has no name. */
export function parseFrom(from: string): { name: string; addr: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]*)>\s*$/.exec(from);
  return m ? { name: m[1].trim(), addr: m[2].trim() } : { name: "", addr: from.trim() };
}

const ADDR_RE = /[^\s<>",;]+@[^\s<>",;]+/g;

/** "to me" / "to a@x" / "to a@x and 2 more" for a To header. */
export function toLine(to: string, self: string[]): string {
  const all = (to.match(ADDR_RE) ?? []).map((a) => a.toLowerCase());
  if (!all.length) return "";
  const mine = new Set(self.map((a) => a.toLowerCase()));
  if (all.some((a) => mine.has(a))) {
    return all.length > 1
      ? t("reader.to_me_more", { n: all.length - 1 }) : t("reader.to_me");
  }
  return all.length > 1
    ? t("reader.to_more", { who: all[0], n: all.length - 1 })
    : t("reader.to", { who: all[0] });
}

/** Readable local date: "Sat 7 Nov, 18:50". The index date is the server's
 *  local time; the raw Date header is the fallback. */
export function readerDate(mail: Mail, detail?: MessageDetail | null): string {
  const iso = mail.date || "";
  const s = fmtDate(iso, nowDate(),
    { lang: getLang(), time: true, weekday: true });
  return s !== iso ? s : iso || detail?.date || "";
}

/** One line of preview text: the first non-empty, non-quoted line. */
export function previewOf(text: string): string {
  const own = splitQuoted(text).find((s) => !s.quoted && s.text.trim());
  const line = (own?.text ?? text).split("\n").find((l) => l.trim()) ?? "";
  return line.trim();
}

/* ------------------------------- pin state ------------------------------ */

export interface PinState {
  /** Pinning is possible (a scanned mail with a Message-ID, or the opener
   *  handles it). */
  can: boolean;
  on: boolean;
  toggle: () => void;
}

/** The pin of the mail open in the reader: the opener's handler when it
 *  has one, else the pin endpoint. Seeded from the mail's own flag, then
 *  from what /api/message said. */
export function useReaderPin(mail: Mail, detail: MessageDetail | null | undefined,
    actions?: ReaderActions): PinState {
  const key = mailKey(mail);
  const [override, setOverride] = useState<{ key: string; on: boolean } | null>(null);
  const toast = useOptionalToast();
  // The server's answer for the open mail beats the list's (older) flag.
  const seeded = detail?.pinned ?? mail.pinned ?? false;
  const on = override?.key === key ? override.on : seeded;
  const can = !!actions?.pin || !!detail?.pinnable
    || (mail.pinned !== undefined && !mail.sent);
  const toggle = async () => {
    const next = !on;
    try {
      const r = actions?.pin
        ? await actions.pin(mail, next)
        : await api.pin(mail.folder, mail.uid, next);
      if (r !== false) {
        setOverride({ key, on: next });
        if (!actions?.pin) actions?.pinned?.(mail, next);
      }
    } catch (e: any) {
      toast?.show(`${t("pin.error")}: ${e.message ?? e}`, { variant: "error" });
    }
  };
  return { can, on, toggle };
}

/* ------------------------------- the frame ------------------------------ */

const BAR_ITEM = `flex min-h-11 min-w-0 flex-auto cursor-pointer flex-col
  items-center justify-center gap-0.5 rounded-control px-1 type-caption
  text-accent enabled:hover:bg-chip disabled:cursor-not-allowed
  disabled:text-faint`;

interface ToolbarProps {
  mail: Mail;
  detail?: MessageDetail | null;
  actions?: ReaderActions;
  pin: PinState;
  /** Open the conversation (absent = no thread / already in it). */
  onConversation?: () => void;
  conversationCount?: number;
  headersShown?: boolean;
  onToggleHeaders?: () => void;
  onBack: () => void;
  variant: "top" | "bottom";
}

/** Trash, Pin, Move, Conversation and a More menu (Open sender, Copy
 *  address, Show headers, Block sender): a row of buttons on top at >= 768
 *  px, a bar of icon + caption columns at the bottom of a phone. */
function ReaderToolbar({ mail, detail, actions, pin, onConversation,
  conversationCount, headersShown, onToggleHeaders, onBack, variant }:
  ToolbarProps) {
  const host = useReaderHost();
  const toast = useOptionalToast();
  const addr = mail.addr;
  const top = variant === "top";
  const canOpen = !!host.openSender && !!host.hasSender?.(addr);
  const canBlock = !!host.blockSender && !host.isBlocked?.(addr)
    && !host.selfAddrs.some((a) => a.toLowerCase() === addr.toLowerCase());
  const [picking, setPicking] = useState(false);
  const canMove = !!actions?.move && host.folders.length > 0;
  const convLabel = conversationCount && conversationCount > 1
    ? (top ? t("reader.conversation_n", { n: conversationCount })
      : t("thread.n_mails", { n: conversationCount }))
    : t("thread.title");
  const copy = () => {
    const done = navigator.clipboard?.writeText(addr);
    const failed = () => toast?.show(t("reader.copy_failed"),
      { variant: "error" });
    if (!done) { failed(); return; }
    done.then(() => toast?.show(t("reader.copied"), { duration: 3000 }),
      failed);
  };

  const face = (icon: ReactNode, label: string) => top ? (
    <>{icon}<span>{label}</span></>
  ) : (
    <>{icon}<span className="whitespace-nowrap">{label}</span></>
  );
  const btn = (key: string, icon: ReactNode, label: string,
    onClick: () => void, opts: { aria?: string; title?: string;
      pressed?: boolean; danger?: boolean } = {}) => top ? (
    <Button key={key} size="sm" aria-label={opts.aria} title={opts.title}
      aria-pressed={opts.pressed}
      variant={opts.danger ? "danger-quiet" : "secondary"}
      className="inline-flex items-center gap-1.5" onClick={onClick}>
      {face(icon, label)}
    </Button>
  ) : (
    <button key={key} type="button" aria-label={opts.aria} title={opts.title}
      aria-pressed={opts.pressed} onClick={onClick}
      className={`${BAR_ITEM} ${opts.danger ? "text-danger-fg" : ""}`}>
      {face(icon, label)}
    </button>
  );
  // (icon sizes are literals: the style guard checks them)
  const ico = (Icon: LucideIcon, fill = "none") => top
    ? <Icon size={16} aria-hidden fill={fill} />
    : <Icon size={18} aria-hidden fill={fill} />;

  const moreMenu = (
    <Menu key="more" label={t("menu.more")} up={!top}
      className={top ? "" : "min-w-0 flex-auto"}
      {...(top ? { variant: "secondary" as const, icon: true as const }
        : { triggerClass: `${BAR_ITEM} w-full` })}
      trigger={top ? <MoreHorizontal size={18} aria-hidden />
        : face(<MoreHorizontal size={18} aria-hidden />, t("menu.more"))}>
      {canOpen && (
        <MenuItem onClick={() => { onBack(); host.openSender!(addr); }}>
          <User size={16} className="mr-2 inline align-text-bottom" />
          {t("reader.open_sender")}
        </MenuItem>
      )}
      <MenuItem onClick={copy}>
        <Copy size={16} className="mr-2 inline align-text-bottom" />
        {t("reader.copy_address")}
      </MenuItem>
      {onToggleHeaders && (
        <MenuItem onClick={onToggleHeaders}>
          <FileText size={16} className="mr-2 inline align-text-bottom" />
          {headersShown ? t("reader.hide_headers") : t("reader.show_headers")}
        </MenuItem>
      )}
      {canBlock && <MenuDivider />}
      {canBlock && (
        <MenuItem danger onClick={() => void host.blockSender!(addr)}>
          <Ban size={16} className="mr-2 inline align-text-bottom" />
          {t("block.btn")}
        </MenuItem>
      )}
    </Menu>
  );
  return (
    <div className={top ? "flex flex-wrap items-center gap-2"
      : "flex items-stretch gap-1"}>
      {actions?.trash && btn("trash", ico(Trash2),
        t("Trash"), () => void actions.trash!(mail),
        { aria: t("trash_this.btn"), danger: true })}
      {pin.can && btn("pin", ico(Pin, pin.on ? "currentColor" : "none"),
        t(pin.on ? "reader.unpin" : "reader.pin"), pin.toggle,
        { aria: t(pin.on ? "reader.unpin" : "reader.pin"),
          title: t(pin.on ? "pin.unprotect_tip" : "pin.protect_tip"),
          pressed: pin.on })}
      {canMove && btn("move", ico(FolderInput), t("detail.move"),
        () => setPicking(true), { aria: t("reader.move_label") })}
      {onConversation && btn("conversation",
        ico(MessagesSquare), convLabel,
        onConversation, { aria: t("thread.read") })}
      {moreMenu}
      {picking && canMove && (
        <FolderPicker count={1} folders={host.folders.map((f) => f.value)}
          labels={host.folders.map((f) => f.label)} account={host.account}
          onPick={(dest) => actions!.move!(mail, dest) as Promise<void>}
          onClose={() => setPicking(false)} />
      )}
    </div>
  );
}

/** Back, the toolbar and the previous / next arrows around a reader's
 *  content. `trailing` sits next to the arrows (e.g. "Expand all"). */
export function ReaderFrame({ mail, detail, actions, nav, pin, backLabel,
  onBack, onConversation, conversationCount, headersShown, onToggleHeaders,
  trailing, children }: Omit<ToolbarProps, "variant"> & {
  nav?: ReaderNav;
  backLabel?: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const wide = useMediaQuery("(min-width: 768px)");
  const idx = nav ? nav.list.findIndex((m) => mailKey(m) === mailKey(mail)) : -1;
  const arrows = !!nav && idx >= 0 && nav.list.length > 1;
  const toolbar = (variant: "top" | "bottom") => (
    <ReaderToolbar variant={variant} mail={mail} detail={detail}
      actions={actions} pin={pin} onConversation={onConversation}
      conversationCount={conversationCount} headersShown={headersShown}
      onToggleHeaders={onToggleHeaders} onBack={onBack} />
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b
        border-line px-3 py-1">
        <button type="button" onClick={onBack}
          className="-ml-1 inline-flex min-h-11 min-w-11 max-w-[60%] cursor-pointer
            items-center gap-0.5 rounded-control px-1 type-body-mobile
            text-accent md:type-body">
          <ChevronLeft size={18} aria-hidden className="shrink-0" />
          <span className="truncate">{backLabel ?? t("reader.back")}</span>
        </button>
        <div className="flex-1" />
        {trailing}
        {arrows && (
          <div className="flex items-center">
            <Button variant="plain" size="icon" label={t("reader.prev")}
              disabled={idx <= 0}
              onClick={() => nav!.onOpen(nav!.list[idx - 1])}>
              <ChevronUp size={18} />
            </Button>
            <Button variant="plain" size="icon" label={t("reader.next")}
              disabled={idx >= nav!.list.length - 1}
              onClick={() => nav!.onOpen(nav!.list[idx + 1])}>
              <ChevronDown size={18} />
            </Button>
          </div>
        )}
        {wide && toolbar("top")}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {!wide && (
        <div className="border-t border-line bg-panel px-2 py-1
          pb-[calc(0.25rem+env(safe-area-inset-bottom))]">
          {toolbar("bottom")}
        </div>
      )}
    </div>
  );
}

/* ------------------------- header, chips, body, card -------------------- */

/** Avatar, name, address · to, date - like a mail app. Shown from the list's
 *  own data at once; the full From / To arrive with the text. */
export function MailHeader({ mail, detail, from, compact = false }: {
  mail: Mail; detail?: MessageDetail | null; from?: string; compact?: boolean;
}) {
  const host = useReaderHost();
  const parsed = parseFrom(from ?? detail?.from ?? "");
  const addr = parsed.addr || mail.addr;
  const name = parsed.name || addr;
  const to = detail?.to ? toLine(detail.to, host.selfAddrs) : "";
  return (
    <div className="flex items-start gap-3">
      <Avatar name={name} size="md" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate type-body-mobile
            md:type-body md:font-medium">{name}</span>
          {!compact && (
            <span className="shrink-0 type-meta text-muted">
              {readerDate(mail, detail)}
            </span>
          )}
        </div>
        <div className="truncate type-meta text-muted">
          {name !== addr ? addr : ""}{name !== addr && to ? " · " : ""}{to}
        </div>
        {compact && (
          <div className="type-meta text-muted">{readerDate(mail, detail)}</div>
        )}
      </div>
    </div>
  );
}

const CHIP = "inline-flex items-center gap-1.5";
const ATT_SHOWN = 6;

/** The attachments the analysis found: name + size each. */
export function AttachmentChips({ atts }: {
  atts: { name: string; size: number }[];
}) {
  return (
    <>
      {atts.slice(0, ATT_SHOWN).map((a, i) => (
        <Tag key={i} tone="attach"><span className={CHIP}>
          <Paperclip size={14} aria-hidden />{a.name} · {fmtSize(a.size)}</span></Tag>
      ))}
      {atts.length > ATT_SHOWN && (
        <Tag tone="attach">{t("reader.more_atts", { n: atts.length - ATT_SHOWN })}</Tag>
      )}
    </>
  );
}

/** Folder, size, what the body index found (tracking pixel - never loaded,
 *  click tracking) and the attachments, each only when known. */
export function MailChips({ mail, detail }: {
  mail: Mail; detail?: MessageDetail | null;
}) {
  const tr = detail?.trackers;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tag><span className={CHIP}><Inbox size={14} aria-hidden />{mail.folder}</span></Tag>
      <Tag><span className={CHIP}><HardDrive size={14} aria-hidden />{fmtSize(mail.size)}</span></Tag>
      {tr && tr.pixel && (
        <Tag tone="review"><span className={CHIP}><EyeOff size={14} aria-hidden />
          {t("reader.pixel")}</span></Tag>
      )}
      {tr && tr.click && (
        <Tag tone="review"><span className={CHIP}><MousePointerClick size={14} aria-hidden />
          {t("reader.click")}</span></Tag>
      )}
      {tr && !tr.pixel && !tr.click && (
        <Tag tone="safe"><span className={CHIP}><ShieldCheck size={14} aria-hidden />
          {t("reader.no_trackers")}</span></Tag>
      )}
      <AttachmentChips atts={detail?.atts ?? []} />
    </div>
  );
}

/** The raw header lines (today's From / To / Date / Subject). */
export function RawHeaders({ detail }: { detail: MessageDetail }) {
  return (
    <div role="region" aria-label={t("reader.headers")}
      className="rounded-card bg-panel2 p-3 type-meta whitespace-pre-wrap
        break-words text-muted">
      {`From: ${detail.from}\nTo: ${detail.to}\nDate: ${detail.date}\nSubject: ${detail.subject}`}
    </div>
  );
}

/** Plain text, readable: the author's own text in reading size, quoted
 *  history folded behind "Show quoted text · N lines". No HTML, no links. */
export function MailText({ text, subject = "", showQuoted, onToggleQuoted }: {
  text: string; subject?: string; showQuoted: boolean;
  onToggleQuoted: () => void;
}) {
  const segs = useMemo(
    () => splitQuoted(text, { forward: isForward(subject) }), [text, subject]);
  const quotedLines = segs.filter((s) => s.quoted).reduce((n, s) =>
    n + s.text.split("\n").filter((l) => l.trim()).length, 0);
  return (
    <div className="type-reader">
      {segs.map((s, i) => (
        s.quoted ? (showQuoted && (
          <div key={i} className="my-2 whitespace-pre-wrap break-words
            border-l-2 border-line pl-3 font-sans text-muted">{s.text}</div>
        )) : (
          <div key={i} className="whitespace-pre-wrap break-words font-sans">
            {s.text}</div>
        )
      ))}
      {quotedLines > 0 && (
        <Button variant="secondary" size="sm" className="mt-2 inline-flex
          items-center gap-1.5" aria-expanded={showQuoted}
          onClick={onToggleQuoted}>
          <MoreHorizontal size={14} aria-hidden />
          <span>{showQuoted ? t("thread.hide_quoted") : t("thread.show_quoted")}</span>
          {!showQuoted && (
            <span className="text-muted">
              {" · "}{t("reader.quoted_lines", { n: quotedLines })}
            </span>
          )}
        </Button>
      )}
    </div>
  );
}

/** Loading / error placeholder of a body. */
export function BodyState({ error }: { error?: string }) {
  return error
    ? <div role="alert" className="type-body text-danger-fg">{error}</div>
    : <div className="py-6 text-center"><Spinner /></div>;
}

/** "Unsubscribe link found": how the sender unsubscribes (from the stored
 *  header) and the button running the existing sender unsubscribe flow. */
export function UnsubCard({ mail, unsub }: {
  mail: Mail; unsub: NonNullable<MessageDetail["unsub"]>;
}) {
  const host = useReaderHost();
  const status = host.unsubscribed?.(mail.addr) ?? null;
  const canRun = !!host.unsubscribe && (host.canUnsubscribe?.(mail.addr) ?? true)
    && status !== "done";
  // The button opens the unsubscribe sheet, which acts on the sender's
  // NEWEST mail: ask what it will do and say exactly that (this mail's own
  // header is the fallback while it loads / when it cannot say).
  const [via, setVia] = useState<UnsubVia | undefined>(undefined);
  useEffect(() => {
    setVia(undefined);
    if (!canRun) return;
    let alive = true;
    api.unsubscribePreview("sender", [mail.addr], true)
      .then((r) => alive && setVia(r.senders[0]?.via ?? null))
      .catch(() => alive && setVia(null));
    return () => { alive = false; };
  }, [mail.addr, canRun]);
  const sheetVia = canRun ? via : null;
  return (
    <section aria-label={t("reader.unsub_title")}
      className="flex items-center gap-3 rounded-card bg-panel2 p-3">
      <IconTile tone="neutral"><MailMinus size={16} /></IconTile>
      <div className="min-w-0 flex-1">
        <div className="type-body font-semibold">{t("reader.unsub_title")}</div>
        <div className="type-meta text-muted">
          {sheetVia ? t(`reader.unsub_${sheetVia}`)
            : via === undefined && canRun ? "\u00a0"
            : t("reader.unsub_in_mail",
              { method: t(`reader.unsub_${unsub.method}`) })}
        </div>
      </div>
      {status === "done" ? <Tag tone="info">{t("Unsubscribed")}</Tag>
        : canRun && (
          <Button variant="tinted" onClick={() => void host.unsubscribe!(mail.addr)}>
            {t("Unsubscribe")}
          </Button>
        )}
    </section>
  );
}

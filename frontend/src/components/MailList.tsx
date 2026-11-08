import { MailOpen, Pin, Trash2 } from "lucide-react";
import { Fragment, useEffect, useMemo, useState, type ReactNode }
  from "react";
import { api, fmtSize, mailKey } from "../api";
import type { Mail, MessageDetail } from "../types";
import { t } from "../i18n";
import { AiTag, Button, MailRow, PinButton, SwipeRow, useBackLayer,
  type SwipeAction } from "./ui";
import { BodyState, MailChips, MailHeader, MailText, RawHeaders, ReaderFrame,
  UnsubCard, useReaderPin, type ReaderActions, type ReaderNav }
  from "./MailReader";
import { ThreadView } from "./ThreadView";

const RENDER_CAP = 500;

/** The mail reader: header (who, when, subject, chips), readable plain text,
 *  unsubscribe card and the toolbar - used wherever a mail opens (sender
 *  detail, All mail, Search, Attachments, Duplicates, Junk / Trash).
 *  `actions` are the opener's own handlers, `nav` its list (previous /
 *  next); both optional, a missing one just hides its control. */
export function MessageView({ mail, onBack, actions, nav, backLabel }: {
  mail: Mail; onBack: () => void;
  actions?: ReaderActions;
  nav?: ReaderNav;
  /** Names where Back goes ("All mail", the sender); default "Back". */
  backLabel?: string;
}) {
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [quoted, setQuoted] = useState(false);
  const [headers, setHeaders] = useState(false);
  const pin = useReaderPin(mail, detail, actions);
  // Below 1024 px Back leaves the mail (and the thread over it first).
  useBackLayer(true, onBack);

  useEffect(() => {
    let alive = true;
    setReading(false);
    setDetail(null);
    setError("");
    setQuoted(false);
    setHeaders(false);
    api.message(mail.folder, mail.uid)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => { alive = false; };
  }, [mail.folder, mail.uid]);

  if (reading) {
    return <ThreadView mail={mail} initial={detail ?? undefined} pin={pin}
      actions={actions} nav={nav} backLabel={backLabel}
      onBack={() => setReading(false)} />;
  }

  return (
    <ReaderFrame mail={mail} detail={detail} actions={actions} nav={nav}
      pin={pin} backLabel={backLabel} onBack={onBack}
      onConversation={detail?.thread ? () => setReading(true) : undefined}
      conversationCount={detail?.thread?.count}
      headersShown={headers}
      onToggleHeaders={detail ? () => setHeaders(!headers) : undefined}>
      <article className="mx-auto w-full max-w-3xl px-4 py-4">
        <MailHeader mail={mail} detail={detail} />
        <h2 className="mt-4 break-words type-title2 md:type-largetitle">
          {detail?.subject || mail.subject || t("(no subject)")}
        </h2>
        <div className="mt-3"><MailChips mail={mail} detail={detail} /></div>
        {headers && detail && <div className="mt-3"><RawHeaders detail={detail} /></div>}
        <div className="mt-5">
          {error ? <BodyState error={error} />
            : detail ? <MailText text={detail.text} showQuoted={quoted}
              onToggleQuoted={() => setQuoted(!quoted)} />
            : <BodyState />}
        </div>
        {detail?.unsub && (
          <div className="mt-5"><UnsubCard mail={mail} unsub={detail.unsub} /></div>
        )}
      </article>
    </ReaderFrame>
  );
}

/** What swiping a mail row does (touch only): Trash on a swipe left, Pin
 *  (`onPin`) and Read on a swipe right. Each is the handler of the same
 *  action's button, so the pinned-mail warning, the confirm and the undo
 *  toast are the button's. */
export interface MailSwipe {
  trash: (m: Mail) => void;
  read: (m: Mail) => void;
  /** The row's own background, which the sliding row must cover the buttons
   *  with (default the panel's). */
  bg?: string;
}

export function MailRows({ mails, sel, onToggle, onOpen, onPin, detailed,
  paged, mark, swipe }: {
  mails: Mail[];
  sel: Set<string>;
  onToggle: (k: string) => void;
  onOpen: (m: Mail) => void;
  // Pin toggle per row; absent = no pin control (search results etc.).
  onPin?: (m: Mail) => void;
  // Always show folder and sender on the meta line (the flat all-mails
  // list), instead of only when they vary across the visible mails.
  detailed?: boolean;
  // The caller pages the list itself: no client-side render cap / "show
  // more" (it would sit next to the caller's own load-more button).
  paged?: boolean;
  // Wraps the subject and the sender address (search results highlight
  // their match with it).
  mark?: (text: string) => ReactNode;
  // Row swipe; off while mails are ticked (the selection bar is the way).
  swipe?: MailSwipe;
}) {
  const [cap, setCap] = useState(RENDER_CAP);
  const swipeActions = (m: Mail) => {
    if (!swipe) return { leading: [], trailing: [] };
    const trailing: SwipeAction[] = [
      { key: "trash", label: t("Trash"), tone: "danger",
        ariaLabel: t("trash_this.btn"), icon: <Trash2 size={18} aria-hidden />,
        onAction: () => swipe.trash(m) },
    ];
    const leading: SwipeAction[] = [
      ...(onPin ? [{ key: "pin", tone: "new" as const,
        label: t(m.pinned ? "swipe.unprotect" : "btn.protect"),
        ariaLabel: t(m.pinned ? "pin.unprotect_tip" : "pin.protect_tip"),
        icon: <Pin size={18} aria-hidden fill={m.pinned ? "currentColor" : "none"} />,
        onAction: () => onPin(m) }] : []),
      ...(!m.seen ? [{ key: "read", tone: "attach" as const,
        label: t("swipe.read"), ariaLabel: t("Mark read"),
        icon: <MailOpen size={18} aria-hidden />,
        onAction: () => swipe.read(m) }] : []),
    ];
    return { leading, trailing };
  };
  // Sender/folder only earn a spot on the meta line when they actually
  // vary across the visible mails - a single-sender group (the common
  // case) stays as uncluttered as a plain date/size line.
  const variesSender = useMemo(
    () => new Set(mails.map((m) => m.addr)).size > 1, [mails]);
  const variesFolder = useMemo(
    () => new Set(mails.map((m) => m.folder)).size > 1, [mails]);
  const multiSender = !!detailed || variesSender;
  const multiFolder = !!detailed || variesFolder;
  return (
    <>
      {(paged ? mails : mails.slice(0, cap)).map((m) => {
        const meta: ReactNode[] = [];
        if (multiFolder) meta.push(m.folder);
        if (multiSender) meta.push(mark ? mark(m.addr) : m.addr);
        meta.push(fmtSize(m.size));
        const subject = m.subject || t("(no subject)");
        const trailing = (m.ai || onPin) ? (
          <>
            {m.ai && <AiTag ai={{ verdict: m.ai, reason: "" }} />}
            {onPin && (
              <PinButton on={!!m.pinned} onClick={() => onPin(m)}
                className="justify-center pr-4 coarse:min-h-11 coarse:min-w-11 md:pr-3" />
            )}
          </>
        ) : undefined;
        const row = (
          <MailRow key={swipe ? undefined : mailKey(m)}
            checked={sel.has(mailKey(m))}
            onToggle={() => onToggle(mailKey(m))} unread={!m.seen}
            subject={mark && m.subject ? mark(subject) : subject}
            meta={meta.every((x) => typeof x === "string")
              ? meta.join(" · ")
              : <span className="min-w-0 truncate">{meta.map((x, i) => (
                <Fragment key={i}>{i > 0 && " · "}{x}</Fragment>))}</span>} dateIso={m.date || ""}
            selectLabel={t("select.named", { subject: m.subject || t("(no subject)") })}
            pinned={!!m.pinned} onOpen={() => onOpen(m)} trailing={trailing} />
        );
        return swipe ? (
          <SwipeRow key={mailKey(m)} {...swipeActions(m)}
            className={swipe.bg ?? "bg-panel"} enabled={sel.size === 0}>
            {row}
          </SwipeRow>
        ) : row;
      })}
      {!paged && mails.length > cap && (
        <div className="py-3 text-center">
          <Button variant="secondary" onClick={() => setCap(cap + RENDER_CAP)}>
            {t("show_more", { n: Math.min(RENDER_CAP, mails.length - cap),
              hidden: mails.length - cap })}
          </Button>
        </div>
      )}
    </>
  );
}

export { olderThan } from "../lib";

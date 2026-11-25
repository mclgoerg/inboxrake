import { useEffect, useMemo, useRef, useState } from "react";
import { api, mailKey } from "../api";
import { t } from "../i18n";
import type { ConversationResp, Mail, MessageDetail } from "../types";
import { Avatar, Button, Spinner, Tag, useBackLayer } from "./ui";
import { AttachmentChips, BodyState, MailText, ReaderFrame, parseFrom,
  previewOf, readerDate, toLine, useReaderHost, useReaderPin,
  type PinState, type ReaderActions, type ReaderNav } from "./MailReader";

type Body = MessageDetail | "loading" | { error: string };

/** One conversation, oldest first, as a stack of cards: the thread's scanned
 *  mails plus the user's own replies from Sent. Collapsed cards show who,
 *  when and a one-line preview; bodies are fetched live when a card is
 *  expanded (same as the single-mail view) and their quoted history is
 *  folded away. */
const BATCH = 8;                    // mails per request / IMAP connection

type ThreadViewProps = {
  mail: Mail;                       // the mail the reader was opened from
  initial?: MessageDetail;          // its text, if the caller already has it
  onBack: () => void;
  /** The opener's handlers for `mail` (Trash, Pin, Move) in the toolbar. */
  actions?: ReaderActions;
  nav?: ReaderNav;
  backLabel?: string;
  /** The pin state of `mail` when a single-mail view already owns it. */
  pin?: PinState;
};

/** Keyed by the mail: moving to another mail (previous / next) starts the
 *  conversation over, so the card that is open - and shown - is always the
 *  mail the toolbar acts on. */
export function ThreadView(props: ThreadViewProps) {
  // Below 1024 px Back closes the thread (one entry across mails).
  useBackLayer(true, props.onBack);
  return <ThreadViewFor key={mailKey(props.mail)} {...props} />;
}

function ThreadViewFor({ mail, initial, onBack, actions, nav, pin,
  backLabel }: ThreadViewProps) {
  const host = useReaderHost();
  const [conv, setConv] = useState<ConversationResp | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set([mailKey(mail)]));
  const [bodies, setBodies] = useState<Record<string, Body>>(
    () => initial ? { [mailKey(mail)]: initial } : {});
  const [busy, setBusy] = useState(false);
  const [quoted, setQuoted] = useState<Set<string>>(new Set());
  const focusRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    api.thread(mail.folder, mail.uid)
      .then((c) => alive && setConv(c))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => { alive = false; };
  }, [mail.folder, mail.uid]);

  // Fetch the text of the expanded mails: BATCH at a time, one request (and
  // one IMAP login on the server) per batch - never one connection per mail.
  useEffect(() => {
    if (!conv || busy) return;
    const todo = conv.mails.filter((m) =>
      open.has(mailKey(m)) && !bodies[mailKey(m)]).slice(0, BATCH);
    if (!todo.length) return;
    setBusy(true);
    setBodies((b) => ({ ...b, ...Object.fromEntries(
      todo.map((m) => [mailKey(m), "loading" as const])) }));
    api.messages(todo.map((m) => [m.folder, m.uid] as [string, number]))
      .then((r) => setBodies((b) => {
        const next = { ...b };
        for (const m of todo) {
          const got = r.messages.find((x) =>
            x.folder === m.folder && x.uid === m.uid);
          next[mailKey(m)] = !got || got.error
            ? { error: got?.error ?? "fetch failed" }
            : got as MessageDetail;
        }
        return next;
      }))
      .catch((e) => setBodies((b) => ({ ...b, ...Object.fromEntries(
        todo.map((m) => [mailKey(m),
          { error: String(e.message ?? e) }])) })))
      .finally(() => setBusy(false));
  }, [conv, open, bodies, busy]);

  // Bring the mail we came from into view once the list is there.
  useEffect(() => {
    if (conv) focusRef.current?.scrollIntoView?.({ block: "start" });
  }, [conv]);

  const toggle = (k: string) => {
    const next = new Set(open);
    next.has(k) ? next.delete(k) : next.add(k);
    setOpen(next);
  };
  // Display names learnt from the mails that were opened: a collapsed card
  // of the same sender reads "Name", not just the address.
  const names = useMemo(() => {
    const out = new Map<string, string>();
    for (const b of Object.values(bodies)) {
      if (b === "loading" || "error" in b) continue;
      const p = parseFrom(b.from);
      if (p.name && p.addr) out.set(p.addr.toLowerCase(), p.name);
    }
    return out;
  }, [bodies]);
  const keys = useMemo(() => (conv?.mails ?? []).map(mailKey), [conv]);
  const allOpen = keys.length > 0 && keys.every((k) => open.has(k));
  const replies = conv?.mails.filter((m) => m.sent).length ?? 0;

  // Trash / Pin / Move act on the ONE open card (marked on screen); with none
  // or several open there is no single mail, so they are off - and your own
  // Sent mails are not changed from here.
  const openMails = (conv?.mails ?? []).filter((m) => open.has(mailKey(m)));
  const target: Mail | null = !conv ? mail
    : openMails.length === 1
      ? (mailKey(openMails[0]) === mailKey(mail) ? mail : openMails[0]) : null;
  const targetKey = target ? mailKey(target) : "";
  const targetBody = targetKey ? bodies[targetKey] : undefined;
  const targetDetail = targetKey === mailKey(mail) && initial ? initial
    : targetBody && targetBody !== "loading" && !("error" in targetBody)
      ? targetBody : null;
  const ownPin = useReaderPin(target ?? mail, targetDetail, actions);
  // While the conversation loads (or failed) the toolbar is off: the opened
  // mail is not yet known to be the one on screen.
  const lockHint = !conv ? (error ? t("reader.load_failed") : undefined)
    : target === null ? t("reader.pick_single")
    : target.sent ? t("reader.sent_locked") : undefined;

  return (
    <ReaderFrame mail={target ?? mail} navFrom={mail} detail={targetDetail}
      actions={actions} nav={nav} locked={!conv || lockHint !== undefined}
      lockHint={lockHint}
      pin={pin && targetKey === mailKey(mail) ? pin : ownPin}
      backLabel={backLabel} onBack={onBack}
      trailing={conv && conv.mails.length > 1 ? (
        <Button variant="plain" size="sm"
          onClick={() => setOpen(allOpen ? new Set() : new Set(keys))}>
          {allOpen ? t("thread.collapse_all") : t("thread.expand_all")}
        </Button>
      ) : undefined}>
      <div className="mx-auto w-full max-w-3xl px-3 py-3">
        <h2 className="break-words px-1 type-title2 md:type-largetitle">
          {conv?.label ?? t("thread.title")}
        </h2>
        {conv && (
          <p className="mb-3 px-1 type-meta text-muted">
            <span>{t("thread.n_mails", { n: conv.mails.length })}</span>
            {replies > 0 && (
              <span> · {t("thread.replied_n", { n: replies })}</span>
            )}
          </p>
        )}
        {conv?.notes.map((n) => (
          <p key={n.key} className="mb-2 px-1 type-meta text-muted">
            {t(`thread.note.${n.key}`, n.params)}
          </p>
        ))}
        {error && <div role="alert" className="p-4 type-body text-danger-fg">{error}</div>}
        {!conv && !error && (
          <div className="p-6 text-center"><Spinner /></div>
        )}
        {conv?.mails.map((m) => {
          const k = mailKey(m);
          const isOpen = open.has(k);
          const body = bodies[k];
          const loaded = body && body !== "loading" && !("error" in body)
            ? body : null;
          const from = parseFrom(loaded?.from ?? "");
          const addr = from.addr || m.addr;
          const name = m.sent ? t("thread.you")
            : from.name || names.get(addr.toLowerCase()) || addr;
          const sub = isOpen
            ? [name !== addr ? addr : "",
              loaded?.to ? toLine(loaded.to, host.selfAddrs) : ""]
              .filter(Boolean).join(" · ")
            : loaded ? previewOf(loaded.text) || m.subject
              : m.subject || t("(no subject)");
          return (
            <div key={k} ref={k === mailKey(mail) ? focusRef : undefined}
              className={`mb-2 overflow-hidden rounded-card border ${
                k === targetKey ? "border-accent"
                  : m.sent ? "border-accent/40" : "border-line"} bg-panel`}>
              <button
                className="flex w-full min-w-0 cursor-pointer items-start
                  gap-3 px-3 py-3 text-left hover:bg-chip"
                aria-expanded={isOpen}
                onClick={() => toggle(k)}>
                <Avatar name={name} size="md" className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    {!m.seen && !m.sent && (
                      <span title={t("unread")} className="inline-block size-2
                        shrink-0 self-center rounded-full bg-accent" />
                    )}
                    <span className={`min-w-0 truncate type-body-mobile
                      md:type-body ${!m.seen && !m.sent ? "font-semibold"
                        : "font-medium"}`}>{name}</span>
                    {m.sent && <Tag tone="info">{t("thread.from_sent")}</Tag>}
                    {k === targetKey && !target?.sent && (
                      <Tag tone="accent">{t("reader.target")}</Tag>
                    )}
                    <span className="ml-auto shrink-0 type-meta text-muted">
                      {readerDate(m, loaded)}
                    </span>
                  </span>
                  <span className="block truncate type-meta text-muted">{sub}</span>
                </span>
              </button>
              {isOpen && (
                <div className="px-3 pb-3 pt-1">
                  {body === "loading" || !body ? <BodyState />
                    : "error" in body ? <BodyState error={body.error} />
                    : (
                      <>
                        <MailText text={body.text} subject={m.subject}
                          showQuoted={quoted.has(k)}
                          onToggleQuoted={() => {
                            const next = new Set(quoted);
                            next.has(k) ? next.delete(k) : next.add(k);
                            setQuoted(next);
                          }} />
                        {!!body.atts?.length && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <AttachmentChips atts={body.atts} />
                          </div>
                        )}
                      </>
                    )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ReaderFrame>
  );
}

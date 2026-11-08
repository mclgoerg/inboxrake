import { Info, Lock } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { fmtSize } from "../lib";
import { fmtNum } from "../numfmt";
import { nowDate } from "../clock";
import { getLang, t } from "../i18n";
import type { DupKind, DupSet, Mail } from "../types";
import { Avatar, Button, PopupSelect, SectionLabel, Segmented, Tag,
  Modal, useMediaQuery } from "./ui";

/** "42 s" / "4 min": how far apart two mails arrived. */
export const gapLabel = (seconds: number): string =>
  seconds < 60 ? t("dups.span_s", { n: Math.max(0, Math.round(seconds)) })
    : t("dups.span_min", { n: Math.round(seconds / 60) });

/** "8 Sept, 12:38:10": the stored `date` has no seconds, so the time of a
 *  mail comes from its timestamp (local time, like every other clock). */
const fmtReceived = (ts: number): string =>
  new Intl.DateTimeFormat(getLang() === "de" ? "de-DE" : "en-GB", {
    day: "numeric", month: "short",
    ...(new Date(ts * 1000).getFullYear() === nowDate().getFullYear() ? {}
      : { year: "numeric" }),
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(new Date(ts * 1000));

const letter = (i: number) => String.fromCharCode(65 + (i % 26));

/** The tail of a Message-ID, enough to tell two apart ("…8f2a@host"). */
const shortId = (id: string | undefined): string => {
  const bare = (id ?? "").replace(/^<|>$/g, "");
  if (!bare) return "-";
  return bare.length > 18 ? `…${bare.slice(-16)}` : bare;
};

/** One fact of a mail: label above, value below; when the two compared mails
 *  differ the value is highlighted AND says so to a screen reader. */
function Fact({ label, differs, children }: {
  label: string; differs: boolean; children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="type-meta text-muted">{label}</dt>
      <dd className="min-w-0 type-body tabular-nums">
        <span className={differs ? `inline-block max-w-full rounded-badge
          bg-review-bg px-1 text-review-fg` : undefined}>
          {children}
          {differs && <span className="sr-only"> ({t("dups.cmp_differs")})</span>}
        </span>
      </dd>
    </div>
  );
}

/** Two mails of a duplicate set side by side: what differs is marked, "Open"
 *  shows the mail itself. The pair switcher walks a bigger set (A<->B,
 *  B<->C ...). Sheet on phones, dialog on wider screens. The two decisions
 *  are the page's own: the older copies go to Trash through the same
 *  confirm / protected / undo path as everywhere (`onTrashOlder`), or the
 *  set is kept as it is (`onKeepAll`). */
export function DuplicateCompare({ set, kind, busy, onClose, onOpen,
  onTrashOlder, onKeepAll }: {
  set: DupSet; kind: DupKind; busy: boolean;
  onClose: () => void;
  onOpen: (m: Mail) => void;
  onTrashOlder: () => void;
  onKeepAll: () => void;
}) {
  const titleId = useId();
  const wide = useMediaQuery("(min-width: 640px)");
  const mails = set.mails;
  const [pair, setPair] = useState(0);
  if (mails.length < 2) return null;
  const at = Math.min(pair, mails.length - 2);
  const [a, b] = [mails[at], mails[at + 1]];
  const pairs = mails.slice(0, -1).map((_, k) => ({ value: String(k),
    label: `${letter(k)}↔${letter(k + 1)}` }));
  const same = {
    time: a.ts === b.ts, size: a.size === b.size, folder: a.folder === b.folder,
    seen: a.seen === b.seen, id: (a.msgid ?? "") === (b.msgid ?? ""),
  };
  // Sizes that print alike but differ (74.0 vs 74.4 KB) show their bytes.
  const sizeText = (m: Mail) => !same.size && fmtSize(a.size) === fmtSize(b.size)
    ? `${fmtNum(m.size)} B` : fmtSize(m.size);
  const gap = Math.abs(a.ts - b.ts);
  const note = kind === "possible"
    ? t(same.size ? "dups.cmp_note_same" : "dups.cmp_note_diff",
      { gap: gapLabel(gap) })
    : t("dups.cmp_note");
  const older = mails.length - 1;

  const card = (m: Mail, idx: number) => (
    <section key={idx} aria-label={t("dups.cmp_mail", { x: letter(idx) })}
      className={`flex min-w-0 flex-col gap-3 rounded-card p-3 ${idx === 0
        ? "border border-safe-fg bg-panel2" : "border border-line bg-panel2"}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="type-body font-semibold whitespace-nowrap">
          {t("dups.cmp_mail", { x: letter(idx) })}</h3>
        {idx === 0 && <Tag tone="safe">{t("dups.cmp_keep")}</Tag>}
      </div>
      <dl className="space-y-2">
        <Fact label={t("dups.cmp_received")} differs={!same.time}>
          {fmtReceived(m.ts)}
        </Fact>
        <Fact label={t("dups.cmp_size")} differs={!same.size}>
          {sizeText(m)}</Fact>
        <Fact label={t("dups.cmp_folder")} differs={!same.folder}>
          <span className="break-words">{m.folder}</span></Fact>
        <Fact label={t("dups.cmp_read")} differs={!same.seen}>
          {t(m.seen ? "dups.cmp_yes" : "dups.cmp_no")}</Fact>
        <Fact label={t("dups.cmp_id")} differs={!same.id}>
          <span className="break-all type-meta" title={m.msgid || undefined}>
            {shortId(m.msgid)}</span></Fact>
      </dl>
      <Button variant="secondary" className="mt-auto w-full"
        aria-label={t("dups.cmp_open_aria", { x: letter(idx) })}
        onClick={() => onOpen(m)}>{t("dups.cmp_open")}</Button>
    </section>
  );

  return (
    <Modal size={wide ? "md" : "sm"} labelledBy={titleId} onClose={onClose}>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <Button variant="plain" size="sm" onClick={onClose}
            className="-ml-2.5">{t("Close")}</Button>
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-center
            type-heading">{t("dups.cmp_title")}</h2>
          <span aria-hidden className="w-12" />
        </div>

        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={a.addr || "?"} size="md" />
          <div className="min-w-0">
            <div className="truncate type-body font-semibold">
              {a.subject || t("(no subject)")}</div>
            <div className="truncate type-meta text-muted">
              {a.addr} · {t("dups.n_mails", { n: mails.length })}</div>
          </div>
        </div>

        {pairs.length > 1 && (pairs.length <= 5 ? (
          <Segmented fill equal tall label={t("dups.cmp_pair_aria")}
            value={String(at)} onChange={(v) => setPair(Number(v))}
            options={pairs} />
        ) : (
          <PopupSelect name={t("dups.cmp_pair_aria")} value={String(at)}
            onChange={(v) => setPair(Number(v))} options={pairs} />
        ))}

        <div className="grid grid-cols-2 gap-2">
          {card(a, at)}{card(b, at + 1)}
        </div>

        <p className="flex items-start gap-1.5 type-meta text-muted">
          <Info size={14} aria-hidden className="mt-0.5 shrink-0" />
          <span>{note}</span>
        </p>

        <div className="space-y-2">
          <SectionLabel className="sr-only">{t("dups.cmp_actions")}</SectionLabel>
          {set.locked && (
            <p className="flex items-start gap-1.5 type-meta text-muted">
              <Lock size={14} aria-hidden className="mt-0.5 shrink-0" />
              <span>{t(`dups.cmp_locked_${set.locked}`)}</span>
            </p>
          )}
          <Button className="w-full" disabled={busy || !!set.locked}
            onClick={onTrashOlder}>
            {t("dups.cmp_keep_newest", { n: older })}
          </Button>
          <Button variant="secondary" className="w-full" disabled={busy}
            onClick={onKeepAll}>
            {t("dups.cmp_different")}
          </Button>
          <p className="text-center type-meta text-muted">
            {t("dups.cmp_footnote")}</p>
        </div>
      </div>
    </Modal>
  );
}

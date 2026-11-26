import { Archive, Ban, BellOff, ChevronRight, Info, Trash2, X }
  from "lucide-react";
import { fmtNum } from "../numfmt";
import { t } from "../i18n";
import { fmtSize } from "../lib";
import { countIn, type SameAction } from "../sameSender";
import type { SameSenderPart, SameSenderRow } from "../types";
import { ActionButton, Avatar, Button, Notice, Tag } from "./ui";

/** What the part's mails say about unsubscribing there: the method THAT
 *  account would use, or why there is none. */
function unsubText(p: SameSenderPart): string {
  if (!p.unsub) return t("allp.via_none");
  if (p.state === "done") return t("allp.via_done");
  if (p.state === "link") return t("allp.via_link");
  return p.via ? t(`allp.via_${p.via}`) : t("allp.via_none");
}

/** The pane of one sender that writes to several accounts (a split pane from
 *  1280 px, a sheet below): the four actions "<verb> in N" - one confirm, one
 *  step per account, each with its own Undo and Activity entry - and, per
 *  account, the numbers and "Open in <account>", which switches to that
 *  account and opens the sender there with every action it has (Move,
 *  Protect, labels, rules). Opening the pane changes nothing. */
export function SameSenderPane({ row, busy, onAction, onOpenIn, onClose }: {
  row: SameSenderRow;
  /** A step is running somewhere: the actions wait. */
  busy: boolean;
  onAction: (action: SameAction) => void;
  onOpenIn: (account: string, addr: string) => void;
  /** The pane's own close (the wide layout only). */
  onClose?: () => void;
}) {
  const n = row.accounts.length;
  const unsubN = countIn(row, "unsubscribe");
  const trashN = countIn(row, "trash");
  const archiveN = countIn(row, "archive");
  const blockN = countIn(row, "block");
  const allDone = row.accounts.every((p) => p.state === "done");
  return (
    <div className="flex min-h-full flex-col gap-4 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <Avatar name={row.name} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="break-words type-title2">{row.name}</h2>
          <div className="break-words type-meta text-muted">
            {t("allp.pane_sub", { n, mails: fmtNum(row.mails),
              size: fmtSize(row.size), pct: row.opened })}
          </div>
        </div>
        {onClose && (
          <Button variant="quiet" size="icon" label={t("Close")}
            onClick={onClose}><X size={18} /></Button>
        )}
      </div>

      <div className="flex flex-wrap items-start gap-y-2">
        <ActionButton className="min-w-0 flex-1 basis-16"
          disabled={busy || unsubN === 0} icon={<BellOff size={18} />}
          label={unsubN > 0 ? t("allp.unsub_in", { n: unsubN })
            : allDone ? t("allp.unsub_all_done") : t("allp.unsub_none")}
          onClick={() => onAction("unsubscribe")} />
        <ActionButton className="min-w-0 flex-1 basis-16"
          disabled={busy || trashN === 0} icon={<Trash2 size={18} />}
          label={t("allp.trash_in", { n: trashN })}
          onClick={() => onAction("trash")} />
        <ActionButton className="min-w-0 flex-1 basis-16"
          disabled={busy || archiveN === 0} icon={<Archive size={18} />}
          label={t("allp.archive_in", { n: archiveN })}
          onClick={() => onAction("archive")} />
        <ActionButton className="min-w-0 flex-1 basis-16"
          disabled={busy || blockN === 0} icon={<Ban size={18} />}
          label={t("allp.block_in", { n: blockN })}
          onClick={() => onAction("block")} />
      </div>

      <ul className="divide-y divide-line overflow-hidden rounded-card
        border border-line" aria-label={t("allp.pane_accounts")}>
        {row.accounts.map((p) => (
          <li key={p.account} className="flex items-center gap-3 px-3 py-3">
            <Avatar name={p.account} size="md" />
            <div className="min-w-0 flex-1">
              <div className="type-body font-medium">{p.account}</div>
              <div className="break-words type-meta text-muted">{p.addr}</div>
              <div className="type-meta text-muted">
                {t("n.mails", { n: p.mails })} · {fmtSize(p.size)}
                {" · "}{unsubText(p)}
              </div>
              {(p.pinned > 0 || p.blocked) && (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {p.blocked && <Tag tone="keep">{t("Blocked")}</Tag>}
                  {p.pinned > 0 && (
                    <Tag>{t("allc.pinned_stay", { n: p.pinned })}</Tag>
                  )}
                </div>
              )}
            </div>
            <Button variant="secondary" size="sm" className="shrink-0"
              aria-label={t("allp.open_in", { account: p.account })}
              onClick={() => onOpenIn(p.account, p.addr)}>
              <span className="inline-flex items-center gap-0.5">
                <span className="max-sm:hidden">
                  {t("allp.open_in", { account: p.account })}</span>
                <span className="sm:hidden">{t("allp.open")}</span>
                <ChevronRight size={14} aria-hidden />
              </span>
            </Button>
          </li>
        ))}
        {row.left_out.map((l) => (
          <li key={`out-${l.account}`} className="flex items-center gap-3 px-3
            py-3">
            <Avatar name={l.account} size="md" />
            <div className="min-w-0 flex-1">
              <div className="type-body font-medium">{l.account}</div>
              <div className="break-words type-meta text-muted">{l.addr}</div>
              <div className="type-meta text-muted">{t("allc.protected")}</div>
            </div>
            <Button variant="secondary" size="sm" className="shrink-0"
              aria-label={t("allp.open_in", { account: l.account })}
              onClick={() => onOpenIn(l.account, l.addr)}>
              <span className="inline-flex items-center gap-0.5">
                <span className="max-sm:hidden">
                  {t("allp.open_in", { account: l.account })}</span>
                <span className="sm:hidden">{t("allp.open")}</span>
                <ChevronRight size={14} aria-hidden />
              </span>
            </Button>
          </li>
        ))}
      </ul>

      <Notice tone="neutral" icon={<Info size={16} aria-hidden />}>
        {t("allp.pane_note")}
      </Notice>
    </div>
  );
}

import { AlarmClock, Info, Layers } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { nowDate } from "../clock";
import { t } from "../i18n";
import { isKind, kindLabel } from "../kinds";
import { batchWhen, whenText } from "../snooze";
import type { SnoozedBatch, SnoozedResp, SnoozedRow } from "../types";
import { Avatar, Button, confirmDialog, EmptyState, Loading, Modal, Notice,
  PanelHeader, Tag, useIsPage, useMediaQuery, useToast } from "./ui";

/* Clean up > Snoozed (the last tool of Clean up): everything out of sight -
 * the mail that waits in the account's `Snoozed` server folder until its time
 * and the senders that deliver in batches - with when it comes back, Back now
 * for mail and Turn off… for a batch (which returns what the batch holds).
 * The list is checked against the server each time the page opens (backend
 * snooze.listing), so a mail another app moved away is not listed. Rows carry
 * no pill but the "batch" one. */

/** One row of the list, batches and mail alike, in the order they come back. */
type Item =
  | { id: string; at: number; batch: SnoozedBatch }
  | { id: string; at: number; row: SnoozedRow };

export function SnoozedPanel({ account, rev, onClose, onChanged }: {
  account: string;
  /** Changes whenever the state's snoozed count does: reload the list. */
  rev: number;
  onClose: () => void;
  /** Mail came back or a batch stopped: the lists around should reload. */
  onChanged: () => void;
}) {
  const toast = useToast();
  const onPage = useIsPage();
  const phone = useMediaQuery("(width < 40rem)");
  const [data, setData] = useState<SnoozedResp | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await api.snoozed();
      if (!alive.current) return;
      setData(r);
      setError(false);
    } catch {
      if (alive.current) setError(true);
    }
  }, []);
  useEffect(() => { void load(); }, [load, rev]);

  const fail = (e: unknown) => toast.show(t("err.generic",
    { msg: e instanceof Error ? e.message : String(e) }), { variant: "error" });

  /** Back now: this row's mails come back at once, unread. */
  const back = async (id: string, msgids: string[]) => {
    setBusy(id);
    try {
      const r = await api.snoozedBack(msgids);
      toast.show(t("snooze.back_done", { n: r.returned }),
        { variant: "success" });
      onChanged();
    } catch (e) { fail(e); }
    if (alive.current) setBusy(null);
    await load();
  };
  /** Turn off…: new mail of the sender arrives as usual, what the batch holds
   *  comes back now. Asked first - it changes how a sender's mail arrives. */
  const stop = async (b: SnoozedBatch) => {
    const ok = await confirmDialog({
      title: t("snooze.stop_title", { name: b.label }),
      body: t("snooze.stop_body", { name: b.label }),
      bullets: b.held > 0 ? [t("snooze.stop_returns", { n: b.held })] : undefined,
      confirmLabel: t("snooze.stop") });
    if (!ok) return;
    setBusy(`batch:${b.key}`);
    try {
      const r = await api.snoozeBatch(b.key, "off", "", b.label);
      toast.show(t("snooze.batch_stopped", { name: b.label })
        + (r.returned ? ` ${t("snooze.batch_stopped_back",
          { n: r.returned })}` : ""), { variant: "success" });
      onChanged();
    } catch (e) { fail(e); }
    if (alive.current) setBusy(null);
    await load();
  };

  const now = nowDate();
  const batches = data?.batches ?? [];
  const rows = data?.rows ?? [];
  const items: Item[] = [
    ...batches.map((b): Item => ({ id: `batch:${b.key}`, at: b.next, batch: b })),
    ...rows.map((r): Item => ({ id: `${r.addr}:${r.until}:${r.kind}`,
      at: r.kind === "unrecorded" ? Number.MAX_SAFE_INTEGER : r.until, row: r })),
  ].sort((a, b) => a.at - b.at);
  const sub = data ? [t("snooze.out_of_sight", { n: data.count }),
    ...(batches.length ? [t("snooze.n_batches", { n: batches.length })] : []),
    t("snooze.sub_folder", { folder: data.folder ?? "Snoozed", account })]
    .join(" · ") : t("snooze.sub");
  const empty = !!data && items.length === 0;

  const line = (item: Item) => {
    if ("batch" in item) {
      const b = item.batch;
      return {
        name: b.label,
        meta: t(b.slot === "weekly" ? "snooze.batch_meta_weekly"
          : "snooze.batch_meta_daily", { when: batchWhen(b.slot, b.next) }),
        right: b.held > 0 ? t("snooze.holds", { n: b.held,
          when: whenText(b.next, now) })
          : t("snooze.holds_none", { when: whenText(b.next, now) }),
      };
    }
    const r = item.row;
    if (r.kind === "unrecorded") {
      return {
        name: r.label,
        meta: [t("n.mails", { n: r.count }),
          r.count === 1 && r.subject ? `\u201c${r.subject}\u201d` : ""]
          .filter(Boolean).join(" · "),
        right: t("snooze.unrecorded"),
      };
    }
    return {
      name: r.label,
      meta: r.kind === "mail"
        ? t("snooze.meta_mail", { subject: r.subject || t("(no subject)") })
        : [t("n.mails", { n: r.count }),
          isKind(r.what) ? kindLabel(r.what) : ""].filter(Boolean).join(" · "),
      right: t("snooze.back_when", { when: whenText(r.until, now) }),
    };
  };

  const rowEl = (item: Item) => {
    const { name, meta, right } = line(item);
    const isBatch = "batch" in item;
    return (
      <li key={item.id} data-testid="snoozed-row"
        className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t
          border-line px-4 py-3 first:border-0">
        <Avatar name={name} size="md" />
        <div className="min-w-0 flex-1 basis-40">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 break-words type-body font-medium">
              {name}</span>
            {isBatch && (
              <Tag tone="info" className="whitespace-nowrap">
                <span className="inline-flex items-center gap-1">
                  <Layers size={14} aria-hidden />{t("snooze.pill_batch")}
                </span>
              </Tag>
            )}
          </div>
          <div className="break-words type-meta text-muted">{meta}</div>
          {phone && <div className="type-meta text-muted">{right}</div>}
        </div>
        {!phone && (
          <span className="w-56 shrink-0 text-right type-meta text-muted">
            {right}</span>
        )}
        {isBatch ? (
          <Button size="sm" variant="secondary" disabled={busy !== null} className="ml-auto"
            aria-label={t("snooze.stop_named", { name })}
            onClick={() => void stop(item.batch)}>
            {t("snooze.stop_btn")}</Button>
        ) : (
          <Button size="sm" variant="secondary" disabled={busy !== null} className="ml-auto"
            aria-label={t("snooze.back_named", { name: item.row.kind === "mail"
              ? item.row.subject || name : name })}
            onClick={() => void back(item.id, item.row.msgids)}>
            {t("snooze.back_now")}</Button>
        )}
      </li>
    );
  };

  return (
    <Modal onClose={onClose} size="lg" full={!empty}>
      <PanelHeader
        title={<span className="inline-flex items-center gap-2">
          <AlarmClock size={18} aria-hidden /> {t("snooze.title")}
        </span>}
        sub={sub} onClose={onClose} />
      <div data-scroll-id="panel" className="min-h-0 flex-1 overflow-y-auto
        p-4 max-sm:pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:p-5">
        {!data ? (
          error ? (
            <div className="flex items-center gap-3 type-body text-muted">
              <span>{t("snooze.load_failed")}</span>
              <Button variant="quiet" size="sm"
                onClick={() => void load()}>{t("tab.retry")}</Button>
            </div>
          ) : <Loading />
        ) : (
          <div className="space-y-4">
            <Notice icon={<Info size={16} aria-hidden />}>
              {t("snooze.notice", { folder: data.folder ?? "Snoozed" })}
              {batches.length > 0 && <> {t("snooze.how_batch")}</>}
            </Notice>
            {data.stale && (
              <Notice tone="warn">
                {t(data.no_folder ? "snooze.stale_no_folder" : "snooze.stale")}
              </Notice>
            )}
            {empty ? (
              <EmptyState icon={<AlarmClock size={18} />}
                title={t("snooze.empty_title")} hint={t("snooze.empty_hint")} />
            ) : (
              <ul className={`overflow-hidden rounded-card
                ${onPage ? "bg-panel" : "bg-panel2"}`}>
                {items.map(rowEl)}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

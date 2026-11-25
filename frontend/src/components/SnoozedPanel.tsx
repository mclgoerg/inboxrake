import { AlarmClock, Mail as MailIcon, Package } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { nowDate } from "../clock";
import { t } from "../i18n";
import { whenText } from "../snooze";
import type { SnoozedResp } from "../types";
import { Button, EmptyState, IconTile, Loading, Modal, PanelHeader,
  useToast } from "./ui";

/* Clean up > Snoozed: what waits in the account's Snoozed folder - batches
 * (a sender whose new mail arrives together, once a day / a week) and snoozed
 * mails and senders - with when each comes back and "Back now". The list is
 * checked against the server each time the page opens (backend
 * snooze.listing), so a mail another app moved away is not listed. */

export function SnoozedPanel({ rev, onClose, onChanged }: {
  /** Changes whenever the state's snoozed count does: reload the list. */
  rev: number;
  onClose: () => void;
  /** Mail came back or a batch stopped: the lists around should reload. */
  onChanged: () => void;
}) {
  const toast = useToast();
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

  const back = async (id: string, msgids: string[], batch = "") => {
    setBusy(id);
    try {
      const r = await api.snoozedBack(msgids, batch);
      toast.show(t("snooze.back_done", { n: r.returned }),
        { variant: "success" });
      onChanged();
    } catch (e) {
      toast.show(t("err.generic", { msg: e instanceof Error ? e.message
        : String(e) }), { variant: "error" });
    }
    if (alive.current) setBusy(null);
    await load();
  };
  const stop = async (key: string, label: string) => {
    setBusy(`stop:${key}`);
    try {
      const r = await api.snoozeBatch(key, "off", "", label);
      toast.show(t("snooze.batch_stopped", { name: label })
        + (r.returned ? ` ${t("snooze.batch_stopped_back",
          { n: r.returned })}` : ""), { variant: "success" });
      onChanged();
    } catch (e) {
      toast.show(t("err.generic", { msg: e instanceof Error ? e.message
        : String(e) }), { variant: "error" });
    }
    if (alive.current) setBusy(null);
    await load();
  };

  const now = nowDate();
  const batches = data?.batches ?? [];
  const rows = data?.rows ?? [];
  const summary = data
    ? [t("n.mails", { n: data.count }),
      ...(batches.length ? [t("snooze.n_batches", { n: batches.length })] : [])]
      .join(" · ") : "";
  const empty = !!data && !batches.length && !rows.length;

  const row = (id: string, icon: ReactNode, title: string, sub: string,
      actions: ReactNode) => (
    <li key={id} data-testid="snoozed-row"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      {icon}
      <div className="min-w-0 flex-1 basis-48">
        <div className="break-words type-body font-medium">{title}</div>
        <div className="type-meta text-muted">{sub}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">{actions}</div>
    </li>
  );

  return (
    <Modal onClose={onClose} size="lg" full={!empty}>
      <PanelHeader
        title={<span className="inline-flex items-center gap-2">
          <AlarmClock size={18} aria-hidden /> {t("snooze.title")}
        </span>}
        sub={summary || t("snooze.sub")} onClose={onClose} />
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
          <div className="mx-auto max-w-2xl space-y-4">
            {data.stale && (
              <p className="type-meta text-muted">{t("snooze.stale")}</p>
            )}
            {empty ? (
              <EmptyState icon={<AlarmClock size={18} />}
                title={t("snooze.empty_title")} hint={t("snooze.empty_hint")} />
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-card
                border border-line bg-panel">
                {batches.map((b) => row(`batch:${b.key}`,
                  <IconTile tone="accent"><Package size={16} /></IconTile>,
                  t(b.slot === "weekly" ? "snooze.batch_weekly"
                    : "snooze.batch_daily", { name: b.label }),
                  b.held > 0
                    ? t("snooze.batch_sub", { n: b.held,
                      when: whenText(b.next, now) })
                    : t("snooze.batch_sub_none",
                      { when: whenText(b.next, now) }),
                  <>
                    <Button size="sm" variant="secondary"
                      disabled={b.held === 0 || busy !== null}
                      aria-label={t("snooze.back_named", { name: b.label })}
                      onClick={() => void back(`batch:${b.key}`, [], b.key)}>
                      {t("snooze.back_now")}</Button>
                    <Button size="sm" variant="quiet" disabled={busy !== null}
                      aria-label={t("snooze.stop_named", { name: b.label })}
                      onClick={() => void stop(b.key, b.label)}>
                      {t("snooze.stop")}</Button>
                  </>))}
                {rows.map((r) => {
                  const id = `${r.addr}:${r.until}`;
                  return row(id,
                    <IconTile tone={r.kind === "mail" ? "neutral" : "info"}>
                      {r.kind === "mail" ? <MailIcon size={16} />
                        : <AlarmClock size={16} />}</IconTile>,
                    r.kind === "mail" ? r.subject || t("(no subject)")
                      : r.label,
                    r.kind === "mail"
                      ? t("snooze.row_sub_mail", { sender: r.label,
                        when: whenText(r.until, now) })
                      : t("snooze.row_sub_sender", { n: r.count,
                        when: whenText(r.until, now) }),
                    <Button size="sm" variant="secondary"
                      disabled={busy !== null}
                      aria-label={t("snooze.back_named", { name: r.kind
                        === "mail" ? r.subject || r.label : r.label })}
                      onClick={() => void back(id, r.msgids)}>
                      {t("snooze.back_now")}</Button>);
                })}
              </ul>
            )}
            <div className="space-y-2 rounded-card border border-line bg-panel
              p-4">
              <h3 className="type-heading">{t("snooze.how_title")}</h3>
              <p className="type-body">{t("snooze.how_folder")}</p>
              <p className="type-meta text-muted">{t("snooze.how_batch")}</p>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

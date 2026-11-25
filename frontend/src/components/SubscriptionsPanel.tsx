import { CalendarClock, Check, Ghost, Repeat, Wallet } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, saveBlob } from "../api";
import { nowDate } from "../clock";
import { t } from "../i18n";
import { NOTIFY_KEY, pushMode } from "../push";
import { useSplitPane } from "../splitPane";
import { amountText, cadenceSentence, dayMonth, fmtMoney, icsName, LINK_TAP,
  monthlyText, monthShort, monthYear, nextDay, nextPill, pillText,
  subscriptionIcs } from "../subscriptions";
import type { Mail, Subscription, SubscriptionsResp, SubTotals } from "../types";
import { Avatar, Button, confirmDialog, EmptyState, IconTile, LINK_ACCENT,
  Loading, Modal, PanelHeader, Spinner, Tag, useIsPage, useMediaQuery,
  useToast, type TagTone } from "./ui";
import { MessageView } from "./MailList";
import { SubscriptionDetail } from "./SubscriptionDetail";

/** The use column / row marker of one subscription. */
function UseTag({ s, now }: { s: Subscription; now: Date }) {
  const u = s.use;
  const ok = u.in_use;
  const text = u.state === "signin" ? t("sub.use_signin", { date: dayMonth(u.ts) })
    : u.state === "read" ? t("sub.use_read")
    : u.state === "unused" ? t("sub.use_unused", { month: monthShort(u.ts, now) })
    : t("sub.use_never");
  const tone: TagTone = ok ? "safe" : "review";
  return (
    <Tag tone={tone}>
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        {ok ? <Check size={14} aria-hidden /> : <Ghost size={14} aria-hidden />}
        {text}
      </span>
    </Tag>
  );
}

/** Card fill: `panel` on a page (the page is `surface`), `panel2` inside a
 *  dialog / full-screen tool, whose own surface is `panel`. */
type Fill = { card: string; hover: string };

function Kpi({ label, value, suffix, sub, icon, tone, pressed, onClick, fill }: {
  label?: string; value: string; suffix?: string; sub?: ReactNode;
  icon: ReactNode; tone: TagTone; pressed?: boolean; onClick?: () => void;
  fill: Fill;
}) {
  const inner = (<>
    <div className="min-w-0">
      {label && <div className="type-meta text-muted">{label}</div>}
      <div className="flex items-baseline gap-1.5">
        <span className="type-largetitle tabular-nums">{value}</span>
        {suffix && <span className="type-meta text-muted">{suffix}</span>}
      </div>
      {sub && <div className="type-meta text-muted">{sub}</div>}
    </div>
    <IconTile tone={tone}>{icon}</IconTile>
  </>);
  const box = `flex min-h-24 items-start justify-between gap-3 rounded-card
    ${fill.card} p-4 text-left`;
  return onClick ? (
    <button type="button" aria-pressed={pressed} onClick={onClick}
      className={`${box} cursor-pointer ${fill.hover} ${pressed
        ? "ring-2 ring-review-fg" : ""}`}>{inner}</button>
  ) : <div className={box}>{inner}</div>;
}

/** The phone's two tiles: a big short figure with its line under it. */
function PhoneTile({ title, sub, icon, tone, pressed, onClick, fill }: {
  title: string; sub: string; icon: ReactNode; tone: TagTone;
  pressed?: boolean; onClick?: () => void; fill: Fill;
}) {
  const box = `flex min-h-24 flex-col gap-2 rounded-card ${fill.card} p-3 text-left
    ${pressed ? "ring-2 ring-review-fg" : ""}`;
  const inner = (<>
    <IconTile tone={tone}>{icon}</IconTile>
    <span className="min-w-0">
      <span className="block type-body-mobile font-semibold">{title}</span>
      <span className="block type-meta text-muted">{sub}</span>
    </span>
  </>);
  return onClick ? (
    <button type="button" aria-pressed={pressed} onClick={onClick}
      className={`${box} cursor-pointer`}>{inner}</button>
  ) : <div className={box}>{inner}</div>;
}

/** The sub line of a phone row: "€59.88 · yearly · in 60 days". */
function phoneSub(s: Subscription): string {
  const pill = nextPill(s);
  return [amountText(s) ?? null,
    t(s.cadence === "monthly" ? "sub.monthly_l" : "sub.yearly_l"),
    s.amount === null ? t("sub.amount_unknown") : null,
    pill && pill.kind === "in" ? pillText(pill) : null]
    .filter(Boolean).join(" · ");
}

const notificationsOn = (): boolean =>
  pushMode() || localStorage.getItem(NOTIFY_KEY) === "1";

/** Insights -> Subscriptions: the senders that bill on a schedule. A page
 *  with the table and (from 1280 px) the pane of the selected one beside it;
 *  below that the pane is a dialog. All of it is read from mail already in
 *  the scan; Inboxrake never cancels anything and never follows a link. */
export function SubscriptionsPanel({ account, scannedTs, onlyUnused = false,
  onClose, onChanged, onNotifications }: {
  account: string;
  /** The last finished scan: the list is fetched again. */
  scannedTs?: number | null;
  /** Opened from the Overview's Review: only what looks unused. */
  onlyUnused?: boolean;
  onClose: () => void;
  /** The count in the sidebar / Overview changed (hide, amounts, keep). */
  onChanged: () => void;
  /** Open Settings > Notifications (a reminder needs them on). */
  onNotifications: () => void;
}) {
  const [data, setData] = useState<SubscriptionsResp | null>(null);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [only, setOnly] = useState(onlyUnused);
  useEffect(() => setOnly(onlyUnused), [onlyUnused]);
  const [showHidden, setShowHidden] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [view, setView] = useState<Mail | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const split = useSplitPane();
  const phone = useMediaQuery("(max-width: 767px)");
  const onPage = useIsPage();
  const fill: Fill = onPage ? { card: "bg-panel", hover: "hover:bg-panel2" }
    : { card: "bg-panel2", hover: "hover:bg-chip" };
  const toast = useToast();
  const alive = useRef(true);
  // The receipts' text is read once per list (not again after a failure).
  const readTried = useRef(false);

  const load = useCallback(async () => {
    try {
      const d = await api.subscriptions();
      if (!alive.current) return;
      setData(d);
      setError("");
    } catch (e: any) {
      if (alive.current) setError(String(e.message ?? e));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    readTried.current = false;
    void load();
    return () => { alive.current = false; };
  }, [load, account, scannedTs]);

  const fail = (e: any) =>
    toast.show(t("err.generic", { msg: e.message ?? e }), { variant: "error" });

  const readAmounts = useCallback(async () => {
    readTried.current = true;
    setReading(true);
    try { await api.subscriptionAmounts(); }
    catch (e: any) { fail(e); }
    finally { if (alive.current) setReading(false); }
    await load();
    onChanged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  // With the opt-in on, the latest receipts that were not read yet are read
  // when the page opens (a few mails over one connection).
  useEffect(() => {
    if (data?.body_amounts && data.unread_amounts > 0 && !readTried.current
        && !reading) void readAmounts();
  }, [data, reading, readAmounts]);

  const now = nowDate();
  const items = data?.items ?? [];
  const hiddenCount = items.filter((s) => s.hidden).length;
  const visible = items
    .filter((s) => (showHidden || !s.hidden) && (!only || !s.use.in_use))
    .sort((a, b) => Number(a.hidden) - Number(b.hidden));
  const cur = visible.find((s) => s.key === sel)
    ?? (split ? visible[0] : undefined);
  const tot: SubTotals | null = data?.totals ?? null;

  const mailOf = (s: Subscription, i: number): Mail => {
    const r = s.latest[i] ?? s.latest[0];
    const d = new Date(r.ts * 1000);
    const p2 = (n: number) => String(n).padStart(2, "0");
    return { uid: r.uid, folder: r.folder, ts: r.ts, subject: r.subject,
      addr: s.addr, size: 0, seen: true, ai: null,
      date: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} `
        + `${p2(d.getHours())}:${p2(d.getMinutes())}` };
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); await load(); onChanged(); }
    catch (e: any) { fail(e); }
    finally { if (alive.current) setBusy(false); }
  };

  const remind = (s: Subscription) => run(async () => {
    await api.subscriptionRemind(s.key, !s.reminder);
    toast.show(t(s.reminder ? "sub.toast_remind_off" : "sub.toast_remind",
      { name: s.name }), { variant: "success" });
  });
  const keep = (s: Subscription) => run(async () => {
    const r = await api.subscriptionKeep(s.key, !s.kept);
    toast.show(t(s.kept ? "sub.toast_unkept" : "sub.toast_kept",
      { n: r.changed, name: s.name }), { variant: "success" });
  });
  const hide = (s: Subscription) => run(async () => {
    const hidden = !s.hidden;
    await api.subscriptionHide(s.key, hidden);
    if (hidden) {
      setSheet(false);
      toast.show(t("sub.toast_hidden", { name: s.name }), {
        action: { label: t("Undo"), onClick: () => {
          void api.subscriptionHide(s.key, false).then(load).then(onChanged)
            .catch(fail);
        } } });
    }
  });
  const ics = (s: Subscription) => saveBlob(icsName(s), new Blob(
    [subscriptionIcs(s, nowDate())], { type: "text/calendar;charset=utf-8" }));
  const open = (s: Subscription, i: number) => {
    setSheet(false);
    setView(mailOf(s, i));
  };
  const findAmounts = async () => {
    if (!await confirmDialog({
      title: t("sub.find_amounts"),
      bullets: [t("sub.find_confirm_read"), t("sub.find_confirm_keep"),
        t("sub.find_confirm_off")],
      confirmLabel: t("sub.find_amounts_confirm"),
    })) return;
    setBusy(true);
    try {
      await api.subscriptionSettings(true);
      await readAmounts();
    } catch (e: any) { fail(e); }
    finally { if (alive.current) setBusy(false); }
  };

  const pick = (s: Subscription) => {
    setSel(s.key);
    if (!split) setSheet(true);
  };

  const detail = (s: Subscription) => (
    <SubscriptionDetail s={s} busy={busy}
      notificationsOn={notificationsOn()}
      onRemind={() => void remind(s)} onIcs={() => ics(s)}
      onKeep={() => void keep(s)} onHide={() => void hide(s)}
      onOpenReceipt={(i) => open(s, i)}
      onFindAmounts={data && !data.body_amounts ? () => void findAmounts()
        : undefined}
      onNotifications={() => { setSheet(false); onNotifications(); }} />
  );

  const monthly = tot ? monthlyText(tot) : null;
  const unusedAbout = tot && tot.unused_monthly && tot.currency
    ? t("sub.about_month", { amount: fmtMoney(tot.unused_monthly,
      tot.currency, { whole: true }) }) : "";
  const noAmount = items.some((s) => !s.hidden && s.amount === null);

  const kpis = tot && (phone ? (
    <div className="grid grid-cols-2 gap-3">
      <PhoneTile fill={fill} icon={<Wallet size={16} />} tone="accent"
        title={monthly ? t("sub.kpi_month_short", { amount: monthly })
          : t("sub.kpi_no_amount")}
        sub={t("sub.kpi_with_amount_short", { n: tot.with_amount,
          total: tot.count })} />
      <PhoneTile fill={fill} icon={<Ghost size={16} />} tone="review" pressed={only}
        title={t("sub.kpi_unused", { n: tot.unused })}
        sub={unusedAbout || t("sub.kpi_unused_none")}
        onClick={tot.unused > 0 || only ? () => setOnly(!only) : undefined} />
    </div>
  ) : (
    <div className="grid grid-cols-3 gap-3">
      <Kpi fill={fill} label={t("sub.kpi_about")} icon={<Wallet size={18} />}
        tone="accent" value={monthly ?? "—"}
        suffix={monthly ? t("sub.a_month") : undefined}
        sub={<>
          {t("sub.kpi_with_amount", { n: tot.with_amount, total: tot.count })}
          {tot.other_currencies.length > 0 && (
            <> · {t("sub.kpi_other", { list: tot.other_currencies.join(", ") })}</>
          )}
        </>} />
      <Kpi fill={fill} icon={<Ghost size={18} />} tone="review" pressed={only}
        value={String(tot.unused)}
        sub={t("sub.kpi_unused_label", { n: tot.unused })}
        onClick={tot.unused > 0 || only ? () => setOnly(!only) : undefined} />
      <Kpi fill={fill} icon={<CalendarClock size={18} />} tone="info"
        value={String(tot.renewing)}
        sub={t("sub.kpi_renewing", { n: tot.renewing })} />
    </div>
  ));

  const table = (
    <div className={`overflow-x-auto rounded-card ${fill.card} px-4 pb-1 pt-2`}>
      <table className="w-full min-w-136 border-collapse type-body">
        <thead>
          <tr className="type-meta text-muted">
            <th scope="col" className="py-2 text-left font-medium">
              {t("sub.col_service")}</th>
            <th scope="col" className="py-2 text-left font-medium">
              {t("sub.col_every")}</th>
            <th scope="col" className="py-2 text-left font-medium">
              {t("sub.col_next")}</th>
            <th scope="col" className="py-2 text-right font-medium">
              {t("sub.col_amount")}</th>
            <th scope="col" className="py-2 text-right font-medium">
              {t("sub.col_use")}</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((s) => {
            const pill = nextPill(s);
            const price = amountText(s);
            const open_ = split && cur?.key === s.key;
            return (
              <tr key={s.key} data-testid="sub-row" onClick={() => pick(s)}
                aria-current={open_ ? "true" : undefined}
                className={`cursor-pointer border-t border-line
                  ${fill.hover} ${open_ ? "bg-panel2 shadow-open-edge" : ""}`}>
                <td className="py-2.5 pr-3">
                  <button type="button" onClick={(e) => { e.stopPropagation(); pick(s); }}
                    className="flex min-w-0 cursor-pointer items-center gap-2.5
                      text-left">
                    <Avatar name={s.name} size="md" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 font-medium">
                        <span className="truncate">{s.name}</span>
                        {s.hidden && <Tag>{t("sub.hidden_tag")}</Tag>}
                      </span>
                      <span className="block type-meta text-muted">
                        {t("sub.since", { date: monthYear(s.since) })}</span>
                    </span>
                  </button>
                </td>
                <td className="py-2.5 pr-3 whitespace-nowrap">
                  {t(s.cadence === "monthly" ? "sub.monthly" : "sub.yearly")}</td>
                <td className="py-2.5 pr-3 whitespace-nowrap">
                  <span className="tabular-nums">~{nextDay(s)}</span>
                  {pill && (
                    <Tag tone="review" className="ml-2 whitespace-nowrap">
                      {pillText(pill)}</Tag>
                  )}
                </td>
                <td className="py-2.5 pr-3 text-right whitespace-nowrap
                  tabular-nums">
                  {price !== null ? <b className="font-semibold">{price}</b>
                    : <span className="text-muted">
                      {t("sub.not_in_subject")}</span>}
                </td>
                <td className="py-2.5 text-right"><UseTag s={s} now={now} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const rows = (
    <ul className={`overflow-hidden rounded-card ${fill.card}`}>
      {visible.map((s) => (
        <li key={s.key} data-testid="sub-row"
          className="border-t border-line first:border-0">
          <button type="button" onClick={() => pick(s)}
            className={`flex min-h-16 w-full cursor-pointer items-center gap-3
              px-3 py-3 text-left ${fill.hover}`}>
            <Avatar name={s.name} size="md" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate type-body-mobile font-medium">
                  {s.name}</span>
                {s.hidden && <Tag>{t("sub.hidden_tag")}</Tag>}
              </span>
              <span className="block truncate type-meta text-muted">
                {phoneSub(s)}</span>
            </span>
            {s.use.in_use
              ? <Check size={18} aria-hidden className="shrink-0 text-safe-fg" />
              : <Ghost size={18} aria-hidden
                className="shrink-0 text-review-fg" />}
            <span className="sr-only"><UseTag s={s} now={now} /></span>
          </button>
        </li>
      ))}
    </ul>
  );

  const footnote = data && (
    <div className="space-y-2 px-1 type-meta text-muted">
      <p>{t(data.body_amounts ? "sub.note_body" : "sub.note")}</p>
      {reading && (
        <p className="flex items-center gap-2"><Spinner />
          {t("sub.reading")}</p>
      )}
      {!data.body_amounts && noAmount && (
        <p><button type="button" className={`${LINK_ACCENT} ${LINK_TAP}`}
          onClick={() => void findAmounts()}>{t("sub.find_amounts")}</button></p>
      )}
      {hiddenCount > 0 && (
        <p><Button variant="quiet" size="sm" aria-pressed={showHidden}
          onClick={() => setShowHidden(!showHidden)}>
          {showHidden ? t("sub.hide_hidden", { n: hiddenCount })
            : t("sub.show_hidden", { n: hiddenCount })}</Button></p>
      )}
    </div>
  );

  const content = () => {
    if (!data) {
      return error ? (
        <div className="flex items-center gap-3 p-4 type-body text-muted">
          <span>{t("sub.load_failed")}</span>
          <Button variant="quiet" size="sm"
            onClick={() => void load()}>{t("tab.retry")}</Button>
        </div>
      ) : <Loading />;
    }
    if (!data.scanned) {
      return <EmptyState icon={<Repeat size={18} />}
        title={t("sub.scan_first")} />;
    }
    if (!items.length) {
      return <EmptyState icon={<Repeat size={18} />}
        title={t("sub.empty_title")} hint={t("sub.empty_hint")} />;
    }
    return (
      <div className={split
        ? "grid min-h-full grid-cols-[minmax(0,1fr)_24rem] 2xl:grid-cols-[minmax(0,1fr)_26rem]"
        : ""}>
        <div className="min-w-0 space-y-4 p-4 sm:p-5">
          {kpis}
          {only && (
            <div className="flex items-center gap-2 type-meta text-muted">
              <span>{t("sub.only_unused")}</span>
              <Button variant="quiet" size="sm"
                onClick={() => setOnly(false)}>{t("sub.show_all")}</Button>
            </div>
          )}
          {visible.length === 0 ? (
            <EmptyState icon={<Repeat size={18} />}
              title={t("sub.none_shown")} />
          ) : phone ? rows : table}
          {footnote}
        </div>
        {split && (
          <aside aria-label={t("sub.pane_title")} data-testid="sub-pane"
            className="min-w-0 border-l border-line">
            {/* the page header above is 5rem: the pane fills what is left, so
                its actions stay in view however long the list is */}
            <div className="sticky top-0 h-[calc(100dvh-5rem)] overflow-y-auto">
              {cur ? detail(cur) : null}
            </div>
          </aside>
        )}
      </div>
    );
  };

  return (
    <Modal onClose={onClose} size="lg"
      full={!!view || !data || (data.scanned && items.length > 0)}>
      <PanelHeader
        title={<span className="inline-flex items-center gap-2">
          <Repeat size={18} /> {t("sub.title")}
        </span>}
        sub={phone && tot && tot.count > 0
          ? [t("sub.sub_phone", { n: tot.count }),
            monthly ? t("sub.about_month", { amount: monthly }) : ""]
            .filter(Boolean).join(" · ")
          : t("sub.sub")}
        onClose={onClose} />
      {view ? (
        <MessageView mail={view} onBack={() => setView(null)}
          backLabel={t("sub.title")} />
      ) : (
        <div data-scroll-id="panel" className="min-h-0 flex-1 overflow-y-auto
          max-sm:pb-[env(safe-area-inset-bottom)]">
          {content()}
        </div>
      )}
      {sheet && !split && cur && (
        <Modal size="md" onClose={() => setSheet(false)} label={cur.name}>
          <PanelHeader title={t("sub.pane_title")} onClose={() => setSheet(false)} />
          <div className="min-h-0 flex-1 overflow-y-auto">{detail(cur)}</div>
        </Modal>
      )}
    </Modal>
  );
}

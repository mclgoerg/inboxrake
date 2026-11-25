import { BellPlus, Check, Hourglass, MessageSquareReply, Send }
  from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { nowDate } from "../clock";
import { useCoarsePointer } from "../gestures";
import { t } from "../i18n";
import { NOTIFY_KEY, pushMode } from "../push";
import { useSplitPane } from "../splitPane";
import { dayMonth } from "../subscriptions";
import type { Mail, WaitingDetail as Detail, WaitingItem, WaitingResp }
  from "../types";
import { answeredText, daysText, tomorrow9, whenText } from "../waiting";
import { Avatar, Button, EmptyState, Loading, Modal, PanelHeader, Segmented,
  SwipeRow, Tag, tabPanelProps, useIsPage, useMediaQuery, useToast,
  type SwipeAction } from "./ui";
import { MessageView } from "./MailList";
import { ThreadView } from "./ThreadView";
import { Kpi, type Fill } from "./SubscriptionsPanel";
import { WaitingDetail } from "./WaitingDetail";

type Tab = "open" | "answered" | "needed";

const notificationsOn = (): boolean =>
  pushMode() || localStorage.getItem(NOTIFY_KEY) === "1";

/** The pill of a row: orange with the hourglass once it is overdue, grey
 *  while it is young, green with the time they took when answered. */
function Pill({ item }: { item: WaitingItem }) {
  if (item.state === "answered") {
    return (
      <Tag tone="safe" className="whitespace-nowrap">
        <span className="inline-flex items-center gap-1">
          <Check size={14} aria-hidden />{answeredText(item)}</span>
      </Tag>
    );
  }
  return item.overdue ? (
    <Tag tone="review" className="whitespace-nowrap">
      <span className="inline-flex items-center gap-1">
        <Hourglass size={14} aria-hidden />{daysText(item.days)}</span>
    </Tag>
  ) : <Tag className="whitespace-nowrap">{daysText(item.days)}</Tag>;
}

/** A mail of the conversation as the reader wants it (headers only). */
const asMail = (uid: number, folder: string, ts: number, subject: string,
  addr: string): Mail => {
  const d = new Date(ts * 1000);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return { uid, folder, ts, subject, addr, size: 0, seen: true, ai: null,
    date: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} `
      + `${p2(d.getHours())}:${p2(d.getMinutes())}` };
};

/** Insights -> Waiting for a reply: the mails you sent where the last word is
 *  yours. A page with the figures, the list and (from 1280 px) the pane of the
 *  selected mail beside it; below that the pane is a dialog. Everything is
 *  read from headers already in the scan - Inboxrake never sends mail for you
 *  and reads no mail text for this. */
export function WaitingPanel({ account, scannedTs, onClose, onChanged,
  onNotifications, onSettings }: {
  account: string;
  /** The last finished scan: the list is fetched again. */
  scannedTs?: number | null;
  onClose: () => void;
  /** The badge / Overview line changed (a decision was made). */
  onChanged: () => void;
  /** Open Settings > Notifications (a reminder needs them on). */
  onNotifications: () => void;
  /** Open Settings > Account (the tracking switch lives there). */
  onSettings: () => void;
}) {
  const [data, setData] = useState<WaitingResp | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("open");
  const [sel, setSel] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<{ mail: Mail; thread: boolean } | null>(null);
  const [detail, setDetail] = useState<{ id: string; d: Detail | null;
    failed: boolean } | null>(null);
  const split = useSplitPane();
  const phone = useMediaQuery("(max-width: 767px)");
  const coarse = useCoarsePointer();
  const onPage = useIsPage();
  const fill: Fill = onPage ? { card: "bg-panel", hover: "hover:bg-panel2" }
    : { card: "bg-panel2", hover: "hover:bg-chip" };
  const toast = useToast();
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const d = await api.waiting();
      if (!alive.current) return;
      setData(d);
      setError("");
    } catch (e: any) {
      if (alive.current) setError(String(e.message ?? e));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => { alive.current = false; };
  }, [load, account, scannedTs]);

  const fail = (e: any) =>
    toast.show(t("err.generic", { msg: e.message ?? e }), { variant: "error" });

  const items = data?.items ?? [];
  const visible = items.filter((i) => i.state === tab);
  const cur = visible.find((i) => i.id === sel)
    ?? (split ? visible[0] : undefined);
  const curId = cur?.id;

  // The conversation of the selected mail (the pane / the dialog shows it).
  useEffect(() => {
    if (!curId) { setDetail(null); return; }
    let live = true;
    setDetail({ id: curId, d: null, failed: false });
    api.waitingItem(curId)
      .then((d) => live && setDetail({ id: curId, d, failed: false }))
      .catch(() => live && setDetail({ id: curId, d: null, failed: true }));
    return () => { live = false; };
  }, [curId, scannedTs]);
  const loaded = detail && detail.id === curId ? detail : null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); await load(); onChanged(); }
    catch (e: any) { fail(e); }
    finally { if (alive.current) setBusy(false); }
  };

  const remind = (it: WaitingItem, at: number | null) => run(async () => {
    await api.waitingRemind(it.id, at);
    toast.show(at === null ? t("waiting.toast_remind_off")
      : t("waiting.toast_remind", { name: it.person.name,
        when: whenText(at, nowDate()) }), { variant: "success" });
  });
  const needed = (it: WaitingItem, on: boolean) => run(async () => {
    await api.waitingNeeded(it.id, on);
    setSheet(false);
    toast.show(t(on ? "waiting.toast_needed" : "waiting.toast_back",
      { name: it.person.name }), on ? {
      action: { label: t("Undo"), onClick: () => {
        void api.waitingNeeded(it.id, false).then(load).then(onChanged)
          .catch(fail);
      } } } : { variant: "success" });
  });
  const openConversation = () => {
    const d = loaded?.d;
    if (!d || !cur) return;
    setSheet(false);
    setView(d.thread
      ? { thread: true, mail: asMail(d.thread.uid, d.thread.folder,
        d.thread.ts, d.thread.subject, d.thread.addr) }
      : { thread: false, mail: asMail(d.sent.uid, d.sent.folder, cur.ts,
        cur.subject, cur.person.addr) });
  };

  const pick = (it: WaitingItem) => {
    setSel(it.id);
    if (!split) setSheet(true);
  };

  const swipeActions = (it: WaitingItem) => {
    if (it.state !== "open") return { leading: [], trailing: [] };
    const trailing: SwipeAction[] = [
      { key: "needed", label: t("waiting.swipe_needed"), tone: "neutral",
        ariaLabel: t("waiting.no_need"),
        icon: <Check size={18} aria-hidden />,
        onAction: () => void needed(it, true) }];
    const leading: SwipeAction[] = [
      { key: "remind", label: t("waiting.swipe_remind"), tone: "info",
        ariaLabel: t("waiting.remind"),
        icon: <BellPlus size={18} aria-hidden />,
        onAction: () => void remind(it, tomorrow9(nowDate())) }];
    return { leading, trailing };
  };

  const pane = (it: WaitingItem) => (
    <WaitingDetail item={it} detail={loaded?.d ?? null}
      failed={!!loaded?.failed} threshold={data?.days ?? 3} busy={busy}
      notificationsOn={notificationsOn()}
      onRemind={(at) => void remind(it, at)} onOpen={openConversation}
      onNeeded={(on) => void needed(it, on)}
      onNotifications={() => { setSheet(false); onNotifications(); }} />
  );

  const k = data?.kpis;
  const kpis = k && (
    <div className="grid grid-cols-3 gap-3">
      <Kpi fill={fill} icon={<Hourglass size={18} />} tone="review"
        value={String(k.overdue)} sub={t("waiting.kpi_overdue")} />
      <Kpi fill={fill} icon={<Send size={18} />} tone="info"
        value={String(k.recent)} sub={t("waiting.kpi_recent")} />
      <Kpi fill={fill} icon={<MessageSquareReply size={18} />} tone="safe"
        value={k.share === null ? "—" : `${k.share}%`}
        sub={t("waiting.kpi_share")} />
    </div>
  );

  const counts = data?.counts;
  const tabs = counts && (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Segmented value={tab} label={t("waiting.tabs")} idPrefix="waiting"
        tall={coarse}
        onChange={(v) => { setTab(v); setSheet(false); }}
        options={[
          { value: "open" as const,
            label: t("waiting.tab_open", { n: counts.open }) },
          { value: "answered" as const,
            label: t("waiting.tab_answered", { n: counts.answered }) },
          { value: "needed" as const,
            label: t("waiting.tab_needed", { n: counts.needed }) }]} />
      <span className="flex-1" />
      <span className="type-meta text-muted">
        {t(tab === "open" ? "waiting.sorted" : "waiting.newest")}</span>
    </div>
  );

  const wideRow = (it: WaitingItem) => {
    const selected = split && cur?.id === it.id;
    return (
      <button type="button" onClick={() => pick(it)}
        aria-current={selected ? "true" : undefined}
        className={`flex min-h-16 w-full cursor-pointer items-center gap-3
          px-3 py-2.5 text-left ${selected ? "bg-panel2 shadow-open-edge"
          : fill.hover}`}>
        <Avatar name={it.person.name} size="md" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 type-body font-semibold">
              {it.person.name}</span>
            <span className="truncate type-meta text-muted">
              {it.person.addr}</span>
          </span>
          <span className="block truncate type-body">
            {it.subject || t("(no subject)")}</span>
        </span>
        <span className="hidden w-24 shrink-0 text-right sm:block">
          <b className="block type-meta font-semibold">{dayMonth(it.ts)}</b>
          <span className="block type-caption text-muted">
            {t("waiting.you_wrote")}</span>
        </span>
        <span className="flex w-28 shrink-0 justify-end"><Pill item={it} /></span>
      </button>
    );
  };

  const phoneRow = (it: WaitingItem) => (
    <button type="button" onClick={() => pick(it)}
      className={`flex min-h-17 w-full cursor-pointer items-center gap-3 px-3
        py-3 text-left ${fill.hover}`}>
      <Avatar name={it.person.name} size="md" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="flex-1 truncate type-body-mobile font-medium">
            {it.person.name}</span>
          <span className={`shrink-0 type-meta ${it.overdue
            ? "font-semibold text-review-fg" : "text-muted"}`}>
            {it.state === "answered" ? answeredText(it)
              : t("waiting.d", { n: it.days })}</span>
        </span>
        <span className="block truncate type-meta text-muted">
          {it.subject || t("(no subject)")}</span>
      </span>
    </button>
  );

  const list = (
    <div {...tabPanelProps("waiting", tab)}>
      <ul className={`overflow-hidden rounded-card ${fill.card}`}>
        {visible.map((it) => (
          <li key={it.id} data-testid="waiting-row"
            className="border-t border-line first:border-0">
            {phone ? (
              <SwipeRow {...swipeActions(it)} className={fill.card}>
                {phoneRow(it)}
              </SwipeRow>
            ) : wideRow(it)}
          </li>
        ))}
      </ul>
    </div>
  );

  const emptyTab = (
    <EmptyState icon={<Hourglass size={18} />}
      title={t(`waiting.empty_${tab}`)}
      hint={tab === "open" ? t("waiting.empty_hint") : undefined} />
  );

  const content = () => {
    if (!data) {
      return error ? (
        <div className="flex items-center gap-3 p-4 type-body text-muted">
          <span>{t("waiting.load_failed")}</span>
          <Button variant="quiet" size="sm"
            onClick={() => void load()}>{t("tab.retry")}</Button>
        </div>
      ) : <Loading />;
    }
    if (!data.tracking) {
      return <EmptyState icon={<Hourglass size={18} />}
        title={t("waiting.off_title")} hint={t("waiting.off_hint")}
        action={<Button variant="secondary" onClick={onSettings}>
          {t("waiting.off_action")}</Button>} />;
    }
    if (!data.scanned) {
      return <EmptyState icon={<Hourglass size={18} />}
        title={t("waiting.scan_first")} />;
    }
    return (
      <div className={split
        ? "grid min-h-full grid-cols-[minmax(0,1fr)_24rem] 2xl:grid-cols-[minmax(0,1fr)_26rem]"
        : ""}>
        <div className="min-w-0 space-y-4 p-4 sm:p-5">
          {!phone && kpis}
          {tabs}
          {visible.length === 0 ? emptyTab : list}
          <div className="space-y-1 px-1 type-meta text-muted">
            {phone && tab === "open" && visible.length > 0 && (
              <p>{t("waiting.swipe_hint")}</p>
            )}
            <p>{t("waiting.footnote")}</p>
          </div>
        </div>
        {split && (
          <aside aria-label={t("waiting.pane_title")} data-testid="waiting-pane"
            className="min-w-0 border-l border-line">
            {/* the page header above is 5rem: the pane fills what is left, so
                its actions stay in view however long the list is */}
            <div className="sticky top-0 h-[calc(100dvh-5rem)] overflow-y-auto">
              {cur ? pane(cur) : null}
            </div>
          </aside>
        )}
      </div>
    );
  };

  const sub = phone && data && data.kpis.overdue > 0
    ? t("waiting.sub_phone", { n: data.kpis.overdue }) : t("waiting.sub");
  return (
    <Modal onClose={onClose} size="lg"
      full={!!view || !data || (data.tracking && data.scanned)}>
      <PanelHeader
        title={<span className="inline-flex items-center gap-2">
          <Hourglass size={18} /> {t("waiting.menu")}
        </span>}
        sub={sub} onClose={onClose} />
      {view ? (
        view.thread ? (
          <ThreadView mail={view.mail} onBack={() => setView(null)}
            backLabel={t("waiting.menu")} />
        ) : (
          <MessageView mail={view.mail} onBack={() => setView(null)}
            backLabel={t("waiting.menu")} />
        )
      ) : (
        <div data-scroll-id="panel" className="min-h-0 flex-1 overflow-y-auto
          max-sm:pb-[env(safe-area-inset-bottom)]">
          {content()}
        </div>
      )}
      {sheet && !split && cur && (
        <Modal size="md" onClose={() => setSheet(false)}
          label={cur.person.name}>
          <PanelHeader title={t("waiting.pane_title")}
            onClose={() => setSheet(false)} />
          <div className="min-h-0 flex-1 overflow-y-auto">{pane(cur)}</div>
        </Modal>
      )}
    </Modal>
  );
}

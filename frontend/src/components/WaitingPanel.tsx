import { Bell, BellPlus, Check, Hourglass, MessageSquareReply, Send }
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
import { pillText, shortName, tomorrow9, typicalText, whenText }
  from "../waiting";
import { Avatar, Button, EmptyState, Loading, Modal, PanelHeader, Segmented,
  SwipeRow, Tag, tabPanelProps, useIsPage, useMediaQuery, useToast,
  type SwipeAction } from "./ui";
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
          <Check size={14} aria-hidden />{pillText(item)}</span>
      </Tag>
    );
  }
  return item.overdue ? (
    <Tag tone="review" className="whitespace-nowrap">
      <span className="inline-flex items-center gap-1">
        <Hourglass size={14} aria-hidden />{pillText(item)}</span>
    </Tag>
  ) : <Tag className="whitespace-nowrap">{pillText(item)}</Tag>;
}

/** The sent mail as the conversation reader wants it (headers only): the
 *  reader finds the conversation from it, your open mail included. */
const sentMail = (it: WaitingItem, d: Detail): Mail => {
  const dt = new Date(it.ts * 1000);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return { uid: d.sent.uid, folder: d.sent.folder, ts: it.ts,
    subject: it.subject, addr: it.person.addr, size: 0, seen: true, ai: null,
    sent: true,
    date: `${dt.getFullYear()}-${p2(dt.getMonth() + 1)}-${p2(dt.getDate())} `
      + `${p2(dt.getHours())}:${p2(dt.getMinutes())}` };
};

/** Insights -> Waiting for a reply: the mails you sent where the last word is
 *  yours. A page with the figures, the list and (from 1280 px) the pane of the
 *  selected mail beside it; below that the pane is a dialog. Everything is
 *  read from headers already in the scan - Inboxrake never sends mail for you
 *  and reads no mail text for this. */
export function WaitingPanel({ account, scannedTs, focusId, hasSender,
  onClose, onChanged, onNotifications, onSettings, onOpenSender }: {
  account: string;
  /** The last finished scan: the list is fetched again. */
  scannedTs?: number | null;
  /** Select this mail when the page opens (the sender pane's Show). */
  focusId?: string | null;
  /** Mail from this address was scanned: it has a sender page. */
  hasSender: (addr: string) => boolean;
  onClose: () => void;
  /** The Overview row / phone card changed (a decision was made). */
  onChanged: () => void;
  /** Open Settings > Notifications (a reminder needs them on). */
  onNotifications: () => void;
  /** Open Settings > Account (the switch lives there). */
  onSettings: () => void;
  /** Open the person's sender page. */
  onOpenSender: (addr: string) => void;
}) {
  const [data, setData] = useState<WaitingResp | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("open");
  const [sel, setSel] = useState<string | null>(focusId ?? null);
  const [paneOff, setPaneOff] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<Mail | null>(null);
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

  // Opened from a sender pane: show that mail (on the tab it is on).
  useEffect(() => {
    if (!focusId || !data) return;
    const it = data.items.find((i) => i.id === focusId);
    if (!it) return;
    setTab(it.state);
    setSel(focusId);
    setPaneOff(false);
    setSheet(!split);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, !!data]);

  const fail = (e: any) =>
    toast.show(t("err.generic", { msg: e.message ?? e }), { variant: "error" });

  const items = data?.items ?? [];
  const visible = items.filter((i) => i.state === tab);
  const cur = visible.find((i) => i.id === sel)
    ?? (split && !paneOff ? visible[0] : undefined);
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
      : t("waiting.toast_remind", { name: shortName(it.person.name),
        when: whenText(at, nowDate()) }), { variant: "success" });
  });
  const needed = (it: WaitingItem, on: boolean) => run(async () => {
    await api.waitingNeeded(it.id, on);
    setSheet(false);
    toast.show(t(on ? "waiting.toast_needed" : "waiting.toast_back",
      { name: shortName(it.person.name) }), on ? {
      action: { label: t("Undo"), onClick: () => {
        void api.waitingNeeded(it.id, false).then(load).then(onChanged)
          .catch(fail);
      } } } : { variant: "success" });
  });
  const openConversation = () => {
    const d = loaded?.d;
    if (!d || !cur) return;
    setSheet(false);
    setView(sentMail(cur, d));
  };

  const pick = (it: WaitingItem) => {
    setSel(it.id);
    setPaneOff(false);
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
      failed={!!loaded?.failed} busy={busy}
      notificationsOn={notificationsOn()} hasSender={hasSender(it.person.addr)}
      onClose={split ? () => { setPaneOff(true); setSel(null); } : undefined}
      onRemind={(at) => void remind(it, at)} onOpen={openConversation}
      onOpenSender={() => { setSheet(false); onOpenSender(it.person.addr); }}
      onNeeded={(on) => void needed(it, on)}
      onNotifications={() => { setSheet(false); onNotifications(); }} />
  );

  const k = data?.kpis;
  const kpis = k && (
    <div className="grid grid-cols-3 gap-3">
      <Kpi fill={fill} icon={<Hourglass size={18} />} tone="review"
        value={String(k.overdue)} sub={t("waiting.tile_overdue")} />
      <Kpi fill={fill} icon={<Send size={18} />} tone="info"
        value={String(k.open)} sub={t("waiting.tile_open")} />
      <Kpi fill={fill} icon={<MessageSquareReply size={18} />} tone="safe"
        value={k.typical_days === null ? "—" : typicalText(k.typical_days)}
        sub={t("waiting.tile_usual")} />
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
          <span className="block truncate type-body font-semibold">
            {it.person.name}</span>
          <span className="block truncate type-meta text-muted">
            {it.subject || t("(no subject)")}</span>
        </span>
        <span className="hidden w-32 shrink-0 text-right type-meta
          text-muted sm:block">
          {it.reminder && it.state === "open" ? (
            <span className="inline-flex items-center gap-1 text-accent">
              <Bell size={14} aria-hidden />
              {whenText(it.reminder.at, nowDate())}</span>
          ) : t("waiting.you_wrote", { date: dayMonth(it.ts) })}
        </span>
        <span className="flex w-40 shrink-0 justify-end"><Pill item={it} /></span>
      </button>
    );
  };

  const phoneRow = (it: WaitingItem) => (
    <button type="button" onClick={() => pick(it)}
      className={`flex min-h-17 w-full cursor-pointer items-center gap-3 px-3
        py-3 text-left ${fill.hover}`}>
      <Avatar name={it.person.name} size="md" />
      <span className="min-w-0 flex-1">
        <span className="block truncate type-body-mobile font-medium">
          {it.person.name}</span>
        <span className="block truncate type-meta text-muted">
          {it.subject || t("(no subject)")}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className={`block type-meta font-semibold ${it.overdue
          ? "text-review-fg" : "text-muted"}`}>
          {it.state === "answered" ? pillText(it)
            : t("waiting.d", { n: it.days })}</span>
        {it.state === "open" && it.usual_days !== null && (
          <span className="block type-caption text-muted">
            {t("waiting.usu", { n: it.usual_days })}</span>
        )}
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
    if (!data.watching) {
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
      <div className={split && !paneOff
        ? "grid min-h-full grid-cols-[minmax(0,1fr)_24rem] 2xl:grid-cols-[minmax(0,1fr)_28rem]"
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
        {split && !paneOff && (
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

  const sub = phone && data && data.watching && data.scanned
    ? t("waiting.sub_phone", { n: data.kpis.overdue, m: data.kpis.open })
    : t("waiting.sub", { account });
  return (
    <Modal onClose={onClose} size="lg"
      full={!!view || !data || (data.watching && data.scanned)}>
      <PanelHeader
        title={<span className="inline-flex items-center gap-2">
          <Hourglass size={18} /> {t("waiting.menu")}
        </span>}
        sub={sub} onClose={onClose} />
      {view ? (
        <ThreadView mail={view} onBack={() => setView(null)}
          backLabel={t("waiting.menu")} />
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

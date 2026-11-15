import { AtSign, Ban, ChevronRight, CornerUpRight, Info, Settings as SettingsIcon,
  ShieldAlert, TriangleAlert, VenetianMask } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { addressSub, blockable, junkCount, spanText } from "../addresses";
import { getLang, t } from "../i18n";
import { fmtTs } from "../lib";
import { fmtNum } from "../numfmt";
import type { AddressKind, AddressReport, AddressRow } from "../types";
import { Avatar, Button, confirmDialog, EmptyState, Loading, Modal, Notice,
  PanelHeader, SectionLabel, StatTile, Tag, type TagTone, useBackLayer,
  useMediaQuery, useToast } from "./ui";
import { RetireDialog } from "./RetireDialog";

const date = (ts: number): string => fmtTs(ts, getLang(), false);

const KIND_TONE: Record<AddressKind, TagTone> =
  { main: "neutral", tag: "neutral", alias: "info", catchall: "neutral",
    other: "neutral" };

/** The icon in front of an address: a mask for aliases, an arrow for what is
 *  forwarded to you, an @ for the rest. */
function KindIcon({ row, size }: { row: AddressRow; size: 16 | 18 }) {
  const Icon = row.kind === "alias" ? VenetianMask
    : row.kind === "other" ? CornerUpRight : AtSign;
  const tone = row.kind === "alias" ? "bg-info-bg text-info-fg"
    : "bg-chip text-chiptext";
  const leaked = row.status === "leaked" && !row.retired;
  return (
    <span aria-hidden className={`flex size-9 shrink-0 items-center
      justify-center rounded-full ${leaked ? "bg-review-bg text-review-fg"
        : tone}`}>
      <Icon size={size} />
    </span>
  );
}

/** The status pill of a row: strangers (orange), clean (green), when it was
 *  last used (a forwarded address), or retired. */
function StatusPill({ row }: { row: AddressRow }) {
  if (row.retired) return <Tag tone="keep">{t("addr.retired")}</Tag>;
  if (row.status === "leaked") {
    return (
      <Tag tone="review" className="inline-flex items-center gap-1">
        <TriangleAlert size={14} aria-hidden />
        {t("addr.strangers", { n: row.leak?.strangers.length ?? 0 })}
      </Tag>
    );
  }
  if (row.status === "clean") return <Tag tone="safe">{t("addr.clean")}</Tag>;
  if (row.status === "last_seen" && row.days_ago != null) {
    return <Tag>{t(row.days_ago === 0 ? "addr.last_today" : "addr.last_days",
      { n: row.days_ago })}</Tag>;
  }
  return null;
}

/** The phone row's second line: the strangers, else kind and senders (the
 *  mail count is in the detail). */
const compactSub = (row: AddressRow): string =>
  row.status === "leaked" && !row.retired && row.leak
    ? t("addr.compact_leak", { strangers: t("addr.strangers",
      { n: row.leak.strangers.length }), date: date(row.leak.first_stranger.ts) })
    : row.retired ? t("addr.retired")
    : `${t(`addr.kind.${row.kind}`)} · ${t("n.senders", { n: row.senders })}`;

/** One line of the list. */
function AddressRowButton({ row, selected, onPick, compact }: {
  row: AddressRow; selected: boolean; onPick: () => void; compact: boolean;
}) {
  return (
    <button type="button" onClick={onPick}
      aria-current={selected ? "true" : undefined}
      className={`flex w-full min-w-0 cursor-pointer items-center gap-3 px-3
        py-2.5 text-left transition-colors hover:bg-chip coarse:min-h-14
        ${selected ? "bg-panel2" : ""}`}>
      <KindIcon row={row} size={16} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 truncate font-mono type-body
            font-medium">{row.address}</span>
          {!compact && (
            <Tag tone={KIND_TONE[row.kind]} className="shrink-0">
              {t(`addr.kind.${row.kind}`)}
            </Tag>
          )}
        </span>
        <span className="block truncate type-meta text-muted">
          {compact ? compactSub(row) : addressSub(row)}
        </span>
      </span>
      {!compact && (
        <span className="shrink-0 text-right">
          <span className="block type-body font-semibold tabular-nums">
            {t("n.mails", { n: row.mails })}
          </span>
          <span className="block type-meta text-muted">
            {t("n.senders", { n: row.senders })}
          </span>
        </span>
      )}
      {compact ? (
        <ChevronRight size={16} aria-hidden className="shrink-0 text-faint" />
      ) : (
        <span className="flex w-28 shrink-0 justify-end"><StatusPill row={row} /></span>
      )}
    </button>
  );
}

/** The leaked address as an orange-outlined card on top (phones). */
function LeakCard({ row, onRetire, onStrangers }: {
  row: AddressRow; onRetire: () => void; onStrangers: () => void;
}) {
  const leak = row.leak!;
  return (
    <section aria-label={t("addr.leak_card_label", { address: row.address })}
      className="mb-4 rounded-card border border-review-fg bg-panel p-3">
      <div className="flex items-start gap-3">
        <KindIcon row={row} size={18} />
        <div className="min-w-0 flex-1">
          <div className="break-all font-mono type-body font-semibold">
            {t("addr.leak_card_title", { address: row.address })}
          </div>
          <div className="type-meta text-muted">
            {t("addr.leak_card_body", { name: row.given_to?.name ?? "",
              strangers: t("addr.strangers", { n: leak.strangers.length }),
              date: date(leak.first_stranger.ts),
              mails: t("n.mails", { n: leak.stranger_mails }) })}
          </div>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        {row.kind === "alias" && !row.retired && (
          <Button className="flex-1" onClick={onRetire}>
            {t("addr.retire_short")}
          </Button>
        )}
        <Button variant="secondary" className="flex-1" onClick={onStrangers}>
          {t("addr.see_strangers")}
        </Button>
      </div>
    </section>
  );
}

function TimelineItem({ filled, last, children }: {
  filled: boolean; last?: boolean; children: ReactNode;
}) {
  return (
    <li className="relative pb-4 pl-6 last:pb-0">
      {!last && <span aria-hidden className="absolute bottom-0 left-1.25 top-3
        w-px bg-line" />}
      <span aria-hidden className={`absolute left-0 top-1.5 size-3
        rounded-full border-2 ${filled ? "border-review-fg bg-review-fg"
          : "border-faint bg-panel"}`} />
      {children}
    </li>
  );
}

/** What the detail pane says about one address. */
function Detail({ row, service, busy, onRetire, onJunk, onBlock, onNotALeak,
  onRestore, footer, inlineNote }: {
  row: AddressRow; service: AddressReport["service"]; busy: boolean;
  onRetire: () => void; onJunk: () => void; onBlock: () => void;
  onNotALeak: () => void; onRestore: () => void;
  /** Where the action buttons go (the pane's sticky footer, or inline). */
  footer: (actions: ReactNode) => ReactNode;
  /** Phone: "Not a leak?" goes into the page, not the sticky footer. */
  inlineNote: boolean;
}) {
  const leak = row.retired ? null : row.leak;
  const strangers = row.leak?.strangers ?? [];
  const name = row.given_to?.name ?? "";
  const canBlock = blockable(row).length;
  const moveN = junkCount(row);
  // "Not a leak?" sits under the buttons beside the list; on a phone it is
  // part of the scrolling page so the sticky buttons stay compact.
  const notLeakLine = row.leak && !row.retired && (inlineNote ? (
    <div className="type-meta text-muted">
      {t("addr.not_a_leak")}
      <button type="button" disabled={busy} onClick={onNotALeak}
        className="block min-h-11 w-full cursor-pointer py-2 text-left
          text-accent hover:text-accenth">
        <span className="underline">{t("addr.not_a_leak_link", { name })}</span>
        {" "}{t("addr.not_a_leak_tail")}
      </button>
    </div>
  ) : (
    <p className="type-meta text-muted">
      {t("addr.not_a_leak")}{" "}
      <button type="button" disabled={busy} onClick={onNotALeak}
        className="cursor-pointer text-accent underline hover:text-accenth">
        {t("addr.not_a_leak_link", { name })}
      </button>{" "}
      {t("addr.not_a_leak_tail")}
    </p>
  ));
  const actions = row.leak ? (
    <>
      {row.kind === "alias" && !row.retired && (
        <Button className="w-full" disabled={busy} onClick={onRetire}>
          {t("addr.retire")}
        </Button>
      )}
      {row.retired && (
        <Button className="w-full" variant="secondary" disabled={busy}
          onClick={onRestore}>{t("addr.turn_on")}</Button>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" disabled={busy || moveN === 0}
          onClick={onJunk}>
          <ShieldAlert size={16} aria-hidden className="mr-1 inline
            align-text-bottom" />
          {t("addr.to_junk")}
        </Button>
        <Button variant="secondary" disabled={busy || canBlock === 0}
          onClick={onBlock}>
          <Ban size={16} aria-hidden className="mr-1 inline
            align-text-bottom" />
          {canBlock > 0 ? t("addr.block_n", { n: canBlock })
            : t("addr.block_none")}
        </Button>
      </div>
      {!inlineNote && notLeakLine}
    </>
  ) : row.retired ? (
    <Button className="w-full" variant="secondary" disabled={busy}
      onClick={onRestore}>{t("addr.turn_on")}</Button>
  ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div data-scroll-id="address-detail"
        className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <KindIcon row={row} size={18} />
          <div className="min-w-0">
            <div className="break-all font-mono type-heading">{row.address}</div>
            <div className="type-meta text-muted">
              {t(`addr.pane_sub.${row.kind}`, { name })}
            </div>
          </div>
        </div>

        {row.retired && (
          <Notice tone="neutral" icon={<Info size={16} />}>
            {t("addr.retired_note", { date: date(row.retired_ts) })}
          </Notice>
        )}
        {leak && (
          <div className="flex items-start gap-2 rounded-card bg-review-bg p-3
            type-body text-review-fg">
            <TriangleAlert size={16} aria-hidden className="mt-0.5 shrink-0" />
            <span>
              <b>{t("addr.leak_title")}</b>{" "}
              {t("addr.leak_body", { name, n: leak.strangers.length,
                date: date(leak.first_stranger.ts) })}
            </span>
          </div>
        )}

        {row.leak ? (
          <>
            <section>
              <SectionLabel className="mb-2">{t("addr.how")}</SectionLabel>
              <ol>
                <TimelineItem filled>
                  <div className="type-body">
                    <b>{date(row.given_to?.ts ?? 0)}</b>
                    {" · "}{t("addr.tl_first", { name })}
                  </div>
                  <div className="truncate type-meta text-muted">
                    {row.given_to?.addr}
                  </div>
                  {row.given_to?.subject && (
                    <div className="truncate type-meta text-muted">
                      “{row.given_to.subject}”
                    </div>
                  )}
                </TimelineItem>
                <TimelineItem filled={false}>
                  <div className="type-body">
                    <b>{spanText(row.leak.quiet_days)}</b>
                    {" · "}{t("addr.tl_quiet", { name,
                      n: row.leak.quiet_mails })}
                  </div>
                </TimelineItem>
                <TimelineItem filled>
                  <div className="type-body">
                    <b>{date(row.leak.first_stranger.ts)}</b>
                    {" · "}{t("addr.tl_stranger",
                      { name: row.leak.first_stranger.name })}
                  </div>
                  {row.leak.followed > 0 && (
                    <div className="type-meta text-muted">
                      {t("addr.tl_followed", { n: row.leak.followed })}
                    </div>
                  )}
                </TimelineItem>
                <TimelineItem filled last>
                  <div className="type-body">
                    <b>{t("addr.today")}</b>
                    {" · "}{row.leak.dmarc_failed == null
                      ? t("addr.tl_today", { n: row.leak.stranger_mails })
                      : t("addr.tl_today_dmarc", {
                        n: row.leak.stranger_mails,
                        failed: row.leak.dmarc_failed })}
                  </div>
                </TimelineItem>
              </ol>
            </section>
            <section>
              <SectionLabel className="mb-2">{t("addr.strangers_head")}</SectionLabel>
              <ul className="divide-y divide-line rounded-card border
                border-line bg-panel">
                {strangers.map((s) => (
                  <li key={s.party} className="flex items-center gap-3 px-3
                    py-2">
                    <Avatar name={s.name} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate type-body
                        font-medium">{s.name}</span>
                      <span className="block truncate type-meta
                        text-muted">{s.addr}</span>
                    </span>
                    {s.protected && <Tag tone="safe">{t("addr.protected")}</Tag>}
                    {s.blocked && <Tag tone="keep">{t("addr.blocked")}</Tag>}
                    <span className="shrink-0 type-body tabular-nums
                      text-muted">{fmtNum(s.mails)}</span>
                  </li>
                ))}
              </ul>
            </section>
            {row.kind !== "alias" && !row.retired && (
              <p className="type-meta text-muted">{t("addr.no_retire")}</p>
            )}
          </>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <StatTile label={t("addr.stat_mails")}
                value={fmtNum(row.mails)} />
              <StatTile label={t("addr.stat_senders")}
                value={fmtNum(row.senders)} />
              <StatTile label={t("addr.stat_first")}
                value={row.first_ts ? date(row.first_ts) : "-"} />
            </div>
            <p className="type-meta text-muted">
              {row.kind === "main" ? t("addr.main_note")
                : row.kind === "tag" ? t("addr.tag_note")
                : row.kind === "other" ? t("addr.other_note")
                : t("addr.clean_note")}
            </p>
          </>
        )}
        {inlineNote && notLeakLine}
        {row.kind === "alias" && !service.connected && !row.retired
          && row.via === "service" && (
          <p className="flex items-start gap-2 type-meta text-muted">
            <Info size={14} aria-hidden className="mt-0.5 shrink-0" />
            {t("addr.no_service_note")}
          </p>
        )}
      </div>
      {actions && footer(actions)}
    </div>
  );
}

/** Insights -> Your addresses: every address mail arrived on, who it was
 *  given to and whether it leaked (the scan's `to` per mail). From 1280 px
 *  the list has a detail pane beside it; below, a row opens the detail as a
 *  page of its own (Back returns to the list). The alias service is optional:
 *  without it everything works except switching an alias off. */
export function AddressesPanel({ account, rev, onClose, onOpenAliasSettings,
  onChanged, onLeaked }: {
  account: string;
  /** The scan's revision: a new one reloads the report. */
  rev: number;
  onClose: () => void;
  onOpenAliasSettings: () => void;
  /** Something was moved or blocked: the caller refreshes its state. */
  onChanged: () => void;
  /** How many addresses look leaked (the sidebar badge). */
  onLeaked?: (n: number) => void;
}) {
  const [rep, setRep] = useState<AddressReport | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retiring, setRetiring] = useState<AddressRow | null>(null);
  const split = useMediaQuery("(min-width: 1280px)");
  const toast = useToast();
  const alive = useRef(true);

  const load = useCallback(() => {
    return api.addresses()
      .then((r) => {
        if (!alive.current) return;
        setRep(r);
        setError("");
        onLeaked?.(r.leaked);
      })
      .catch((e) => alive.current && setError(String(e.message ?? e)));
  }, [onLeaked]);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => { alive.current = false; };
  }, [load, rev]);

  const rows = rep?.addresses ?? [];
  // Beside the list the pane always shows one address: the first that
  // leaked, else the first of the list.
  const shown = rows.find((r) => r.address === selected)
    ?? (split ? rows.find((r) => r.status === "leaked" && !r.retired)
      ?? rows[0] : undefined) ?? null;
  const detailPage = !split && shown !== null;
  useBackLayer(detailPage, () => setSelected(null));

  const fail = (e: unknown) =>
    toast.show(String((e as Error).message ?? e), { variant: "error" });

  const changed = async () => { await load(); onChanged(); };

  const retire = (row: AddressRow) => {
    if (row.via === "icloud" || row.via === "relay") {
      // recognised, not managed: only its own settings can switch it off
      void confirmDialog({
        title: t("addr.hand_title", { address: row.address }),
        bullets: [t(`addr.hand_${row.via}_1`), t(`addr.hand_${row.via}_2`)],
        confirmLabel: t("OK"), cancelLabel: t("Close"),
      });
      return;
    }
    if (!rep?.service.connected) {
      void confirmDialog({
        title: t("addr.hand_title", { address: row.address }),
        bullets: [t("addr.hand_1"), t("addr.hand_2"), t("addr.hand_3")],
        confirmLabel: t("addr.hand_settings"), cancelLabel: t("Close"),
      }).then((ok) => { if (ok) onOpenAliasSettings(); });
      return;
    }
    setRetiring(row);
  };

  const toJunk = async (row: AddressRow) => {
    const n = junkCount(row);
    if (!n || !await confirmDialog({
      title: t("addr.junk_title", { n }),
      body: t("addr.junk_body", { address: row.address }),
      tone: "danger", confirmLabel: t("addr.junk_btn", { n }),
    })) return;
    setBusy(true);
    try {
      const r = await api.addressStrangersToJunk(row.address);
      toast.show(t("addr.junk_done", { n: r.queued }), { variant: "success" });
      await changed();
    } catch (e) { fail(e); }
    setBusy(false);
  };

  const block = async (row: AddressRow) => {
    const list = blockable(row);
    const capped = list.filter((s) => s.addr_total > s.addrs.length).length;
    if (!list.length || !await confirmDialog({
      title: t("addr.block_title", { n: list.length }),
      body: <>
        {t("confirm.block_body")}
        {capped > 0 && <> {t("addr.block_capped", { n: capped })}</>}
      </>,
      bullets: list.map((s) => s.name),
      tone: "danger", confirmLabel: t("Block"),
    })) return;
    setBusy(true);
    let failed = 0;
    for (const s of list) {
      for (const addr of s.to_block) {
        try { await api.block("sender", addr, s.name, false); }
        catch { failed += 1; }
      }
    }
    // every block rule ran a report and left its own notice: the one summary
    // below replaces them
    await Promise.resolve().then(() => api.clearNotice(["rule_report",
      "rule_executed", "rule_queued"])).catch(() => {});
    if (failed) toast.show(t("addr.block_failed", { n: failed }),
      { variant: "error" });
    else toast.show(t("addr.block_done", { n: list.length }),
      { variant: "success" });
    await changed();
    setBusy(false);
  };

  const notALeak = async (row: AddressRow) => {
    setBusy(true);
    try {
      const r = await api.addressNotALeak(row.address);
      await load();
      toast.show(t("addr.not_leak_done", { name: row.given_to?.name ?? "" }), {
        variant: "success",
        action: { label: t("Undo"), onClick: () => {
          api.addressNotALeak(row.address, r.previous)
            .then(() => load()).catch(fail);
        } },
      });
    } catch (e) { fail(e); }
    setBusy(false);
  };

  const restore = async (row: AddressRow) => {
    setBusy(true);
    try {
      await api.restoreAddress(row.address);
      toast.show(t("addr.turned_on", { address: row.address }),
        { variant: "success" });
      await load();
    } catch (e) { fail(e); }
    setBusy(false);
  };

  const leakedRow = rows.find((r) => r.status === "leaked" && !r.retired
    && r.leak);
  const sub = rep
    ? <>
      {t("addr.sub", { n: rep.total })} · {rep.leaked > 0
        ? t("addr.sub_leaked", { n: rep.leaked }) : t("addr.sub_none")}
    </> : undefined;

  const detail = shown && rep && (
    <Detail row={shown} service={rep.service} busy={busy}
      onRetire={() => retire(shown)} onJunk={() => toJunk(shown)}
      onBlock={() => block(shown)} onNotALeak={() => notALeak(shown)}
      onRestore={() => restore(shown)} inlineNote={!split}
      footer={(actions) => (
        <div className="space-y-2 border-t border-line p-4 sm:px-5
          max-sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {actions}
        </div>
      )} />
  );

  const list = (
    <div className="p-3 sm:p-5">
      <p className="mb-3 flex items-start gap-2 type-meta text-muted">
        <Info size={14} aria-hidden className="mt-0.5 shrink-0" />
        {t("addr.explain")}
      </p>
      {rep && rep.read < rep.mails && (
        <Notice tone="neutral" className="mb-3" icon={<Info size={16} />}>
          {t("addr.partial", { n: rep.mails - rep.read })}
        </Notice>
      )}
      {!split && leakedRow && (
        <LeakCard row={leakedRow} onRetire={() => retire(leakedRow)}
          onStrangers={() => setSelected(leakedRow.address)} />
      )}
      <ul className="divide-y divide-line overflow-hidden rounded-card border
        border-line bg-panel">
        {rows.map((r) => (
          <li key={r.address}>
            <AddressRowButton row={r} compact={!split}
              selected={split && shown?.address === r.address}
              onPick={() => setSelected(r.address)} />
          </li>
        ))}
      </ul>
      <p className="mt-3 type-meta text-muted">{t("addr.recognised")}</p>
    </div>
  );

  const body = () => {
    if (!rep) return error ? null : <Loading />;
    if (!rep.scanned) {
      return <EmptyState icon={<AtSign size={18} />}
        title={t("addr.scan_first")} />;
    }
    if (rows.length === 0) {
      return <EmptyState icon={<AtSign size={18} />}
        title={t("addr.none_title")}
        hint={rep.read < rep.mails ? t("addr.none_unread")
          : t("addr.none_hint")} />;
    }
    if (split) {
      return (
        <div className="flex min-h-0 flex-1">
          <div data-scroll-id="panel" className="min-h-0 min-w-0 flex-1
            overflow-y-auto">{list}</div>
          <aside aria-label={t("addr.pane_label")} className="flex min-h-0
            w-112 shrink-0 flex-col border-l border-line">{detail}</aside>
        </div>
      );
    }
    return detailPage
      ? <div className="flex min-h-0 flex-1 flex-col">{detail}</div>
      : <div data-scroll-id="panel" className="min-h-0 flex-1
        overflow-y-auto">{list}</div>;
  };

  return (
    <Modal onClose={detailPage ? () => setSelected(null) : onClose} size="xl">
      <PanelHeader
        title={<span className="inline-flex items-center gap-2">
          <AtSign size={18} /> {detailPage && shown ? t("addr.detail_title")
            : t("addr.title")}
        </span>}
        sub={detailPage ? undefined : sub}
        closeLabel={detailPage ? t("addr.title") : undefined}
        actions={!detailPage ? (
          <Button variant="secondary" size="sm" onClick={onOpenAliasSettings}>
            <SettingsIcon size={16} aria-hidden className="mr-1 inline
              align-text-bottom" />
            {t("addr.alias_service")}
          </Button>
        ) : undefined}
        onClose={detailPage ? () => setSelected(null) : onClose} />
      {error && <div role="alert" className="p-4 type-body
        text-danger-fg">{error}</div>}
      {body()}
      {retiring && rep && (
        <RetireDialog row={retiring}
          onClose={() => setRetiring(null)}
          onDone={() => { void changed(); }} />
      )}
    </Modal>
  );
}

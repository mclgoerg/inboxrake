import { ChevronRight, Users, X, ZoomIn } from "lucide-react";
import { useState, type ReactNode, type Ref } from "react";
import { engagementTier, fmtDate } from "../lib";
import { fmtNum } from "../numfmt";
import { t } from "../i18n";
import { domainOf, fmtBig, monthsSince, openedPct, pct, tickState, toneOf,
  type ColorBy, type MapItem } from "../spacemap";
import { Avatar, Button, Checkbox, SectionLabel } from "./ui";
import { fmtPct, nameOf, ProtectedMark, TONE_BAR, TONE_TEXT, toneText }
  from "./spaceUi";

const MAX_LIST = 20;

function Cell({ label, value, sub, valueClass = "" }: {
  label: string; value: ReactNode; sub?: ReactNode; valueClass?: string;
}) {
  return (
    <div className="min-w-0 rounded-control bg-chip p-3">
      <div className="type-caption text-muted">{label}</div>
      <div className={`break-words type-title2 tabular-nums ${valueClass}`}>
        {value}</div>
      {sub != null && <div className="type-meta text-muted">{sub}</div>}
    </div>
  );
}

/** Details of the tapped tile / segment: size and share, how much of it is
 *  opened, last mail, the AI verdict and its mail counts, and the three
 *  actions: Show in Senders (the sender list filtered to it), Select, zoom.
 *  Below the page width it sticks to the bottom edge (`docked`) and can be
 *  closed - it is no dialog, so the tiles stay tappable. */
export function SpaceDetails({ item, hasAi, totalSize, canShow, docked,
  onShow, onSelect, onZoom, onClose, cardRef }: {
  item: MapItem; hasAi: boolean; totalSize: number;
  /** The card's element (the page pads itself by its height when docked). */
  cardRef?: Ref<HTMLElement>;
  /** Something the Senders filter can express (not an "Other" bucket). */
  canShow: boolean; docked: boolean;
  onShow: () => void; onSelect: () => void;
  /** Absent for a single sender (nothing inside to zoom into). */
  onZoom?: () => void; onClose: () => void;
}) {
  const months = item.last ? monthsSince(item.last) : null;
  const tier = engagementTier(item.engagement);
  const sub = item.kind === "sender"
    ? `${domainOf(item.label)} · ${t("space.n_mails", { n: item.count })}`
    : `${t("space.n_senders", { n: item.senders })} · ${
      t("space.n_mails", { n: item.count })}`;
  return (
    <section ref={cardRef} aria-label={t("space.details", { name: nameOf(item) })}
      className={docked
        // pinned to the bottom of the scrolling page, edge to edge (sticky
        // offsets count from inside the page padding: -bottom-4 undoes it)
        ? `sticky -bottom-4 z-(--z-sticky) -mx-4 -mb-4 rounded-t-card border-t
          border-line bg-panel p-4 shadow-bar sm:-bottom-5 sm:-mx-5 sm:-mb-5 sm:px-5`
        : "rounded-card border border-line bg-panel2 p-4"}>
      <div className="flex items-center gap-3">
        <Avatar name={nameOf(item)} size="md" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate type-heading">{nameOf(item)}</h3>
          <div className="truncate type-meta text-muted">{sub}</div>
        </div>
        {docked && (
          <Button variant="quiet" size="icon" label={t("Close")}
            onClick={onClose}><X size={18} /></Button>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Cell label={t("space.d_size")} value={fmtBig(item.size)}
          sub={t("space.d_of_mailbox", { p: fmtPct(pct(item.size, totalSize)) })} />
        {/* the colour of "engagement" mode: the score, built from the read
            share, replies, newsletter status and how recent the last mail is */}
        <Cell label={t("space.d_opened")} value={t(`space.d_eng_${tier}`)}
          sub={[t("eng.read", { n: openedPct(item) }),
            t(item.replied ? "eng.replied" : "eng.never_replied")].join(" · ")} />
        <Cell label={t("space.d_last")}
          value={item.last ? fmtDate(item.last) : "-"}
          sub={months === null ? undefined : months < 1
            ? t("space.d_fresh") : t("space.d_idle", { n: months })} />
        {hasAi ? (
          <Cell label={t("space.d_ai")}
            value={toneText(item.verdict ?? "none", "ai")}
            valueClass={TONE_TEXT[item.verdict ?? "none"] ?? ""}
            sub={item.verdict ? t("space.d_ai_cover", {
              done: fmtNum(item.verdictMails), n: item.count }) : undefined} />
        ) : (
          <Cell label={t("space.d_mails")} value={fmtNum(item.count)}
            sub={t("space.n_senders", { n: item.senders })} />
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canShow && (
          <Button onClick={onShow} className="inline-flex items-center gap-1.5">
            <Users size={16} aria-hidden />{t("space.show_senders")}
          </Button>
        )}
        <Button variant="secondary" disabled={item.keys.length === 0}
          title={item.keys.length === 0 ? t("space.protected_note") : undefined}
          onClick={onSelect}>{t("space.select")}</Button>
        {onZoom && (
          <Button variant="secondary" size="icon" label={t("space.zoom_in")}
            onClick={onZoom}><ZoomIn size={18} /></Button>
        )}
      </div>
    </section>
  );
}

/** "Biggest here": the items of the level with a share bar in their colour.
 *  A row opens the item (zoom into a domain, details of a sender); in Select
 *  mode each row also has its checkbox. The complete, keyboard-reachable
 *  equivalent of the picture. */
export function SpaceList({ level, by, sel, selecting, focusId, onOpen, onTick }: {
  level: MapItem[]; by: ColorBy; sel: Set<string>; selecting: boolean;
  focusId: string | null;
  onOpen: (it: MapItem) => void; onTick: (it: MapItem) => void;
}) {
  const [all, setAll] = useState(false);
  const total = level.reduce((a, it) => a + it.size, 0);
  const max = level.reduce((a, it) => Math.max(a, it.size), 0);
  const rows = all ? level : level.slice(0, MAX_LIST);
  return (
    <section aria-label={t("space.top")}
      className="rounded-card border border-line bg-panel2 p-4">
      <SectionLabel>{t("space.top")}</SectionLabel>
      <ol className="divide-y divide-line">
        {rows.map((it) => {
          const ts = tickState(it, sel);
          return (
            <li key={it.id} className="flex items-center gap-2">
              {selecting && (
                <Checkbox aria-label={t("space.tick", { name: nameOf(it) })}
                  disabled={it.keys.length === 0}
                  checked={ts === "all"}
                  ref={(el) => { if (el) el.indeterminate = ts === "some"; }}
                  onChange={() => onTick(it)} />
              )}
              <button type="button" onClick={() => onOpen(it)}
                data-row={it.id}
                aria-current={!selecting && focusId === it.id ? "true"
                  : undefined}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-3
                  py-2 text-left hover:text-body">
                <Avatar name={nameOf(it)} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate type-body font-medium">
                      {nameOf(it)}</span>
                    {it.protectedSenders > 0 && (
                      <ProtectedMark n={it.protectedSenders}
                        className="shrink-0 text-muted" />
                    )}
                  </span>
                  <span aria-hidden className="mt-1 block h-1.5 overflow-hidden
                    rounded-full bg-chip">
                    <span className={`block h-full rounded-full
                      ${TONE_BAR[toneOf(it, by)]}`}
                    style={{ width: `${max > 0 ? (it.size / max) * 100 : 0}%` }} />
                  </span>
                </span>
                <span className="shrink-0 text-right type-meta tabular-nums
                  text-muted">
                  <span className="block">{fmtBig(it.size)}</span>
                  <span className="block">{fmtPct(pct(it.size, total))}
                    {" · "}{t("space.n_mails", { n: it.count })}</span>
                </span>
                {it.kind !== "sender"
                  ? <ChevronRight size={16} className="shrink-0 text-faint"
                    aria-hidden />
                  : <span className="w-4 shrink-0" aria-hidden />}
              </button>
            </li>
          );
        })}
      </ol>
      {level.length > MAX_LIST && (
        <Button variant="quiet" className="mt-1" onClick={() => setAll(!all)}>
          {all ? t("space.show_less")
            : t("space.show_all", { n: level.length })}
        </Button>
      )}
    </section>
  );
}


import { ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { fmtNum, fmtPct } from "../numfmt";
import { t } from "../i18n";
import { childTiles, fmtBig, pct, tickState, toneOf, type ColorBy,
  type MapItem } from "../spacemap";
import { arcCentre, arcPath, layoutRings } from "../sunburst";
import { itemLabel, nameOf, TONE_FILL, TONE_STROKE } from "./spaceUi";

// Drawing space: a 400 x 400 box around the centre. The hole holds the text.
const HOLE = 88, MID = 140, EDGE = 198, GAP_RING = 2;

/** Sunburst of the current level: the inner ring holds its items (the zoomed
 *  item alone as a full ring), the outer ring what is inside each; angle =
 *  share of the space. Plain SVG. The segments are a mouse / touch
 *  shortcut only (hover title, tap = details, double-tap = zoom): the "Biggest
 *  here" list next to it holds every figure and every action, so it is the
 *  keyboard and screen-reader route. The centre says what is shown. */
export function SpaceRings({ level, trail, by, sel, selecting, focus,
  totals, caption, onPress, onZoom }: {
  level: MapItem[]; trail: MapItem[]; by: ColorBy;
  sel: Set<string>; selecting: boolean;
  focus: MapItem | null;
  /** The whole mailbox (the centre when nothing is focused). */
  totals: { size: number; count: number };
  /** Short sentence under the centre figure ("59 % rarely opened"). */
  caption: string;
  /** `chain`: the path from the current level to the segment (parent first). */
  onPress: (it: MapItem, chain: MapItem[]) => void;
  onZoom: (it: MapItem, chain: MapItem[]) => void;
}) {
  const inner = useMemo(
    () => trail.length ? [trail[trail.length - 1]] : level, [trail, level]);
  const segs = useMemo(() => {
    const kids = inner.map((it) => ({ it, kids: childTiles(it) }));
    const arcs = layoutRings(kids.map(({ it, kids: k }) => ({
      key: it.id, value: it.size,
      children: k.map((c) => ({ key: c.id, value: c.size, children: [] })),
    })));
    const items = new Map<string, MapItem>();
    for (const { it, kids: k } of kids) {
      items.set(it.id, it);
      for (const c of k) items.set(c.id, c);
    }
    return arcs.map((a) => ({ arc: a, it: items.get(a.key)!,
      // zoomed in: the inner ring is the path's last item, already walked
      parent: a.parent && !trail.length ? items.get(a.parent)! : null }));
  }, [inner, trail.length]);

  const ticked = (it: MapItem) => tickState(it, sel) !== "none";
  const lit = (it: MapItem) => ticked(it) || (!selecting && focus?.id === it.id);
  // Highlighted segments last: their outline must not be covered.
  const ordered = [...segs].sort((a, b) =>
    Number(lit(a.it)) - Number(lit(b.it)));
  const shown = focus ?? (trail.length ? trail[trail.length - 1] : null);
  const chainOf = (s: { it: MapItem; parent: MapItem | null }) =>
    s.parent ? [s.parent, s.it] : [s.it];
  const focusChain = (it: MapItem) => {
    const hit = segs.find((s) => s.it.id === it.id);
    return hit ? chainOf(hit) : [it];
  };

  return (
    <div className="relative mx-auto aspect-square w-full max-w-lg">
      <svg viewBox="-200 -200 400 400" role="img" data-testid="space-rings"
        aria-label={t("space.rings_label")} className="size-full">
        {ordered.map(({ arc, it, parent }) => {
          const on = lit(it);
          const locked = selecting && it.keys.length === 0;
          const [r0, r1] = arc.ring === 0 ? [HOLE, MID - GAP_RING]
            : [MID, EDGE];
          const [mx, my] = arcCentre(r0, r1, arc.a0, arc.a1);
          return (
            <g key={it.id}>
              <path d={arcPath(r0, r1, arc.a0, arc.a1)} data-seg={it.id}
                strokeWidth={on ? 3 : 1.5} strokeLinejoin="round"
                onClick={() => { if (!locked) onPress(it, parent ? [parent, it] : [it]); }}
                className={`${TONE_FILL[toneOf(it, by)]}
                  ${on ? "stroke-body" : TONE_STROKE[toneOf(it, by)]}
                  transition-colors hover:brightness-110
                  ${locked ? "cursor-not-allowed" : "cursor-pointer"}`}>
                <title>{itemLabel(it, ticked(it))}</title>
              </path>
              {ticked(it) && (
                <circle cx={mx} cy={my} r={5} aria-hidden
                  className="pointer-events-none fill-body" />
              )}
            </g>
          );
        })}
      </svg>
      {/* the hole: 88 of the 200 radius units, so 28 % in from each side */}
      <div className="pointer-events-none absolute grid place-items-center
        text-center" style={{ inset: "28%" }}>
        <div className="w-full min-w-0">
          {shown && (
            <div className="truncate type-meta text-muted">{nameOf(shown)}</div>
          )}
          <div className="type-title tabular-nums">
            {fmtBig(shown ? shown.size : totals.size)}
          </div>
          <div className="type-meta text-muted">
            {shown
              ? t("space.ring_item", { share: fmtPct(pct(shown.size,
                totals.size)), mails: fmtNum(shown.count), n: shown.count })
              : t("space.ring_all", { mails: fmtNum(totals.count),
                n: totals.count })}
          </div>
          {!shown && <div className="type-meta text-accent">{caption}</div>}
          {focus && !selecting && focus.kind !== "sender" && (
            <button type="button" onClick={() => onZoom(focus, focusChain(focus))}
              className="pointer-events-auto mt-1 inline-flex min-h-8
                coarse:min-h-11 items-center gap-0.5 rounded-control px-2
                type-meta text-accent focus-visible:ring-2
                focus-visible:ring-accent">
              {t("space.zoom_in")}
              <ChevronRight size={14} aria-hidden />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

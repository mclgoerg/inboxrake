import { Check, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../i18n";
import { fmtBig, labelFits, labelLevel, pct, shortName, tickState, toneOf, type ColorBy,
  type MapItem } from "../spacemap";
import { squarify } from "../treemap";
import { fmtPct, itemLabel, nameOf, TONE_BG } from "./spaceUi";

const MAP_W_FALLBACK = 600;
/** Space between tiles; each tile is inset by half of it on every side. */
const GAP = 6;

/** The tiles of one level, sized by mail size (squarified), with room
 *  between them. Text by tile size: name + size + share, a short name, or
 *  nothing (the name is always in the accessible label and the list). */
export function SpaceTiles({ level, by, wide, sel, selecting, focusId, domainLevel,
  onPress }: {
  level: MapItem[]; by: ColorBy; wide: boolean;
  sel: Set<string>; selecting: boolean;
  /** The tile whose details are shown. */
  focusId: string | null;
  /** The tiles are the senders of one domain (short name = local part). */
  domainLevel: boolean;
  onPress: (it: MapItem) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(MAP_W_FALLBACK);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0) setCw(el.clientWidth);
    });
    ro.observe(el);
    if (el.clientWidth > 0) setCw(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const H = Math.round(cw * (wide ? 0.66 : 1.15));
  const total = useMemo(() => level.reduce((a, it) => a + it.size, 0), [level]);
  const rects = useMemo(() => new Map(squarify(
    level.map((it) => ({ key: it.id, value: it.size })),
    { x: 0, y: 0, w: cw, h: H }).map((r) => [r.key, r])), [level, cw, H]);

  return (
    <div ref={box} data-testid="space-map" role="group"
      aria-label={t("space.map")} className="relative w-full" style={{ height: H }}>
      {level.map((it) => {
        const r = rects.get(it.id);
        if (!r || r.w < 1 || r.h < 1) return null;
        // a sliver keeps most of its size: the gap never eats more than 30 %
        const gap = Math.min(GAP, 0.3 * Math.min(r.w, r.h));
        const w = r.w - gap, h = r.h - gap;
        const ts = tickState(it, sel);
        const short = shortName(it, domainLevel) || nameOf(it);
        // A tile too small for its short name carries no text (its name is in
        // the accessible label, the list and the details).
        const lvl = labelLevel(w, h);
        const text = lvl === "short" && !labelFits(short, w) ? "none" : lvl;
        const locked = selecting && it.keys.length === 0;
        const focused = focusId === it.id;
        const share = pct(it.size, total);
        return (
          <button key={it.id} type="button"
            aria-label={itemLabel(it, ts === "all")}
            aria-pressed={selecting
              ? (ts === "some" ? "mixed" : ts === "all") : undefined}
            aria-current={!selecting && focused ? "true" : undefined}
            aria-disabled={locked || undefined}
            onClick={() => { if (!locked) onPress(it); }}
            style={{ left: r.x + gap / 2, top: r.y + gap / 2, width: w,
              height: h }}
            data-item={it.id}
            className={`absolute box-border flex flex-col items-stretch
              justify-start overflow-hidden rounded-control
              p-2 text-left transition-colors hover:brightness-110
              enabled:active:translate-y-px focus-visible:z-(--z-sticky)
              focus-visible:-outline-offset-2
              ${TONE_BG[toneOf(it, by)]}
              ${ts !== "none" || (focused && !selecting)
                ? "ring-2 ring-inset ring-body" : ""}
              ${locked ? "cursor-not-allowed" : ""}`}>
            {ts !== "none" && (
              <Check size={14} aria-hidden className="absolute right-1.5 top-1.5" />
            )}
            {it.protectedSenders > 0 && text !== "none" && (
              <ShieldCheck size={14} aria-hidden
                className={`absolute right-1.5
                  ${ts !== "none" ? "top-6" : "top-1.5"}`} />
            )}
            {text !== "none" && (
              <span className="block truncate pr-4 type-meta font-medium">
                {text === "full" ? nameOf(it) : short}
              </span>
            )}
            {text !== "none" && h >= 44 && (
              <span className="block truncate type-meta tabular-nums opacity-80">
                {text === "full" ? `${fmtBig(it.size)} · ${fmtPct(share)}`
                  : fmtBig(it.size)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

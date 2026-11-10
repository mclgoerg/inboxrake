import { ShieldCheck } from "lucide-react";
import { fmtNum } from "../numfmt";
import { t } from "../i18n";
import { fmtBig, pct, toneSums, type ColorBy, type MapItem, type Tone }
  from "../spacemap";

/* Shared pieces of the Space map views (tiles, rings, details, lists). */

/** Colour of a tone as a filled tile (background + readable text). The
 *  quiet / unrated ones get a hairline: their fill alone is too close to the
 *  page colour in the light theme (>= 1.5:1 with the line). Every entry has
 *  a border so the sizes stay equal. */
export const TONE_BG: Record<Tone, string> = {
  strong: "border border-transparent bg-heat text-on-accent",
  mid: "border border-transparent bg-accent/45 text-body",
  quiet: "border border-faint bg-chiph text-body",
  delete_safe: "border border-transparent bg-safe-bg text-safe-fg",
  review: "border border-transparent bg-review-bg text-review-fg",
  keep: "border border-transparent bg-keep-bg text-keep-fg",
  none: "border border-faint bg-chiph text-muted",
};
/** The same colours as an SVG fill (ring segments) ... */
export const TONE_FILL: Record<Tone, string> = {
  strong: "fill-heat",
  mid: "fill-accent/45",
  quiet: "fill-chiph",
  delete_safe: "fill-safe-bg",
  review: "fill-review-bg",
  keep: "fill-keep-bg",
  none: "fill-chiph",
};
/** ... and the outline between segments (the page colour; a hairline for the
 *  quiet ones, see TONE_BG). */
export const TONE_STROKE: Record<Tone, string> = {
  strong: "stroke-panel", mid: "stroke-panel", quiet: "stroke-faint",
  delete_safe: "stroke-panel", review: "stroke-panel", keep: "stroke-panel",
  none: "stroke-faint",
};
/** And as the bar of a list row / the stacked bar (needs to show on a chip). */
export const TONE_BAR: Record<Tone, string> = {
  strong: "bg-heat",
  mid: "bg-accent/45",
  quiet: "bg-faint",
  delete_safe: "bg-safe-fg",
  review: "bg-review-fg",
  keep: "bg-keep-fg",
  none: "bg-faint",
};

/** Text colour for a verdict word ("Delete-safe" in the AI colour). */
export const TONE_TEXT: Partial<Record<Tone, string>> = {
  delete_safe: "text-safe-fg", review: "text-review-fg", keep: "text-keep-fg",
};

/** Legend text of a tone in a colour mode. */
export const toneText = (tone: Tone, by: ColorBy): string => {
  switch (tone) {
    case "strong": return t(by === "age" ? "space.age_old" : "space.eng_low");
    case "mid": return t(by === "age" ? "space.age_mid" : "space.eng_mid");
    case "quiet": return t(by === "age" ? "space.age_new" : "space.eng_high");
    case "delete_safe": return t("space.ai_safe");
    case "review": return t("space.ai_review");
    case "keep": return t("space.ai_keep");
    default: return t("space.ai_none");
  }
};

export const nameOf = (it: MapItem): string =>
  it.kind === "other" ? t("space.other", { n: it.children.length }) : it.label;

/** "<n> %" (the figure itself comes from `pct`). */
export const fmtPct = (p: number): string => `${fmtNum(p)} %`;

/** The shield mark of a tile / row holding protected senders. */
export function ProtectedMark({ n, className = "" }: {
  n: number; className?: string;
}) {
  return (
    <ShieldCheck size={14} className={className}
      aria-label={t("space.tile_protected", { n })} role="img" />
  );
}

/** Accessible name of a tile / segment / row. */
export const itemLabel = (it: MapItem, ticked: boolean): string =>
  [t("space.tile", { name: nameOf(it), size: fmtBig(it.size),
    mails: fmtNum(it.count), n: it.count }),
  ...(it.protectedSenders
    ? [t("space.tile_protected", { n: it.protectedSenders })] : []),
  ...(ticked ? [t("space.tile_selected")] : []),
  ].join(", ");

/** One sentence instead of a bare colour key: "59 % of your space is mail
 *  you rarely open", the stacked bar and the legend with the MB per colour.
 *  The bar is decorative - the legend carries the same numbers as text. */
export function SpaceHeadline({ items, by, where }: {
  items: MapItem[]; by: ColorBy; where: string | null;
}) {
  const { total, sums } = toneSums(items, by);
  const lead = sums[0];
  const p = pct(lead.size, total);
  return (
    <section aria-label={t("space.summary")}
      className="rounded-card border border-line bg-panel2 p-4">
      <p className="type-title2">
        <span className="text-accent">{fmtPct(p)}</span>{" "}
        {t(`space.head_${by}`, { where: where === null
          ? t("space.where_all") : t("space.where_in", { name: where }) })}
      </p>
      <div aria-hidden className="mt-3 flex h-2 gap-0.5 overflow-hidden
        rounded-full bg-chip">
        {sums.filter((s) => s.size > 0).map((s) => (
          <span key={s.tone} className={TONE_BAR[s.tone]}
            style={{ width: `${(s.size / total) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 type-meta text-muted"
        aria-label={t("space.legend")}>
        {sums.map((s) => (
          <li key={s.tone} className="inline-flex items-center gap-1.5">
            <span className={`size-3 rounded-badge ${TONE_BG[s.tone]}`}
              aria-hidden />
            {toneText(s.tone, by)}
            <span className="font-semibold tabular-nums text-body">
              {fmtBig(s.size)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

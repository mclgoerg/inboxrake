import { t } from "./i18n";
import { HUE_COUNT, hueIndex } from "./components/ui";

/** Locale key of every category the backend ships (`mailops.CATEGORY_RULES`
 *  plus the two automatic tags `newsletter` and `automated`) and of the
 *  "other" remainder. */
const KEYS = new Map<string, string>(Object.entries({
  newsletter: "overview.kind.newsletter",
  automated: "overview.kind.automated",
  other: "overview.kind.other",
  shipping: "cat.shipping",
  finance: "cat.finance",
  shopping: "cat.shopping",
  social: "cat.social",
  travel: "cat.travel",
  "dev/cloud": "cat.dev_cloud",
}));

/** Display name of a category key, in the UI language: the built-in and
 *  automatic ones translated, a category of the user's own by its own name
 *  with a capital first letter. Use it wherever a category / tag key is shown
 *  as a label (never to match or store - keys stay as they are). */
export function categoryName(key: string): string {
  const k = KEYS.get(key);
  return k ? t(k) : key.charAt(0).toUpperCase() + key.slice(1);
}

/** The chart hue (index into `hueFillAt`) each well-known category always
 *  gets, so Newsletters is the same colour on the Overview and in Statistics. */
const FIXED_HUE = new Map<string, number>([["newsletter", 0], ["shopping", 1],
  ["automated", 2], ["finance", 3], ["shipping", 4], ["social", 5]]);

/** Hue per category key for ONE chart: the well-known categories keep their
 *  own hue; the others (travel, dev/cloud, your own) take a hue no other
 *  slice of the same chart uses, starting from a stable hash of the name. */
export function categoryHues(keys: string[]): number[] {
  const out: (number | null)[] = keys.map((k) => FIXED_HUE.get(k) ?? null);
  const used = new Set<number>();
  // a repeated key (cannot happen from the backend) keeps its first hue
  out.forEach((h, i) => {
    if (h !== null && used.has(h)) out[i] = null; else if (h !== null) used.add(h);
  });
  return out.map((h, i) => {
    if (h !== null) return h;
    const start = hueIndex(keys[i]);
    for (let d = 0; d < HUE_COUNT; d++) {
      const c = (start + d) % HUE_COUNT;
      if (!used.has(c)) { used.add(c); return c; }
    }
    return start;                       // more categories than hues
  });
}

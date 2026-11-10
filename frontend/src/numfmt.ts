/* Number formatting shared by every count / size / percent / money display.
 * Automatic follows the UI language (de "1.732", en "1,732"); the user can
 * pin a style in Settings > General. Browser-side only (localStorage, like
 * the language). Kept free of imports so lib.ts and i18n.ts can use it. */

export type NumFormat = "auto" | "en" | "de" | "space";

const KEY = "pmc_numfmt";
const FORMATS: NumFormat[] = ["auto", "en", "de", "space"];

let langOf: () => string = () => "en";
/** i18n.ts registers its language getter here (avoids an import cycle). */
export const setNumLangSource = (fn: () => string): void => { langOf = fn; };

let pref: NumFormat = (() => {
  try {
    const v = typeof localStorage !== "undefined"
      && localStorage.getItem(KEY) as NumFormat;
    return v && FORMATS.includes(v) ? v : "auto";
  } catch { return "auto"; }
})();

export const getNumFormat = (): NumFormat => pref;

export function setNumFormat(next: NumFormat): void {
  pref = next;
  try {
    if (next === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch { /* private mode: applies for this session only */ }
}

/** The Intl locale for the effective style. "space" is French style: its
 *  group separator is a narrow no-break space, normalised below. */
const localeOf = (): string => {
  const f = pref === "auto" ? (langOf() === "de" ? "de" : "en") : pref;
  return f === "de" ? "de-DE" : f === "space" ? "fr-FR" : "en-US";
};

/** The UI language as registered by i18n.ts ("en" until then). */
export const uiLang = (): string => langOf();

/** No-break space: keeps a number and its unit ("60 mails", "39,1 MB") on
 *  one line. Locale strings spell it as \u00a0. */
export const NBSP = "\u00a0";

/** Decimal and group separator of the effective style. */
export function numSeparators(): { decimal: string; group: string } {
  const parts = new Intl.NumberFormat(localeOf()).formatToParts(1234567.5);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value;
  return { decimal: pick("decimal") ?? ".", group: pick("group") ?? "," };
}

const cache = new Map<string, Intl.NumberFormat>();

/** Format a number in the effective style. `digits` fixes the number of
 *  fraction digits; `max` allows up to that many (default: none shown for
 *  counts = whole numbers stay whole, fractions up to 3). */
export function fmtNum(n: number, opts: { digits?: number; max?: number;
  group?: boolean } = {}): string {
  const loc = localeOf();
  const o: Intl.NumberFormatOptions = {};
  if (opts.digits !== undefined) {
    o.minimumFractionDigits = opts.digits;
    o.maximumFractionDigits = opts.digits;
  } else if (opts.max !== undefined) o.maximumFractionDigits = opts.max;
  if (opts.group === false) o.useGrouping = false;
  const k = `${loc}|${opts.digits}|${opts.max}|${opts.group}`;
  let nf = cache.get(k);
  if (!nf) { nf = new Intl.NumberFormat(loc, o); cache.set(k, nf); }
  // Narrow no-break space (U+202F) as the group mark of the space style, so a
  // number never wraps in the middle (fr-FR already uses it; older ICU
  // versions use U+00A0).
  return nf.format(n).replace(/\u00a0/g, "\u202f");
}

/** A percentage in the effective style: "30%" in English style, "30 %" (no-break
 *  space) in German and the space style. `value` is the percent itself (30,
 *  not 0.3); options as fmtNum. */
export function fmtPct(value: number, opts: { digits?: number; max?: number }
  = {}): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  const spaced = localeOf() !== "en-US";
  return `${fmtNum(value, opts)}${spaced ? NBSP : ""}%`;
}

/** Parse what a user typed, in the chosen style (also tolerant: a lone "," or
 *  "." counts as the decimal mark when it cannot be a group separator).
 *  Returns NaN for text that is no number; "" gives NaN too. */
export function parseNum(text: string): number {
  let s = text.trim().replace(/[\s\u202f\u00a0]/g, "");
  if (!s) return NaN;
  const { decimal, group } = numSeparators();
  if (group === "." || group === ",") {
    // the group mark is dropped only when it sits between digit triplets
    const esc = (c: string) => `\\${c}`;
    const grouped = new RegExp(
      `^[+-]?\\d{1,3}(${esc(group)}\\d{3})+(${esc(decimal)}\\d*)?$`);
    if (grouped.test(s)) s = s.split(group).join("");
  }
  s = s.replace(/,/g, ".");
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : NaN;
}

/** Parse a decimal typed into a `DecimalInput`: digits with at most one
 *  "." or "," as the decimal mark. Input never has grouping, so "1.500" is
 *  1.5 in every style (never 1500). NaN for anything else (also negative). */
export function parseDecimal(text: string): number {
  const s = text.trim().replace(/[\s\u202f\u00a0]/g, "");
  return /^(\d+[.,]?\d*|[.,]\d+)$/.test(s) ? Number(s.replace(",", ".")) : NaN;
}

/** A canonical decimal string ("0.5", as sent to the API) shown with the
 *  chosen decimal mark, no grouping - for text inputs. */
export function decimalToInput(canonical: string): string {
  return canonical.replace(".", numSeparators().decimal);
}

/** What a user typed into a decimal input -> the canonical string the form
 *  state keeps ("" stays "", unparsable text is kept so the field can be
 *  marked invalid and saving blocked). */
export function inputToDecimal(text: string): string {
  if (!text.trim()) return "";
  const n = parseDecimal(text);
  return Number.isNaN(n) ? text : String(n);
}

/** Does this form value (canonical string) hold text that is no decimal? */
export const isBadDecimal = (v: string): boolean =>
  !!v.trim() && Number.isNaN(parseDecimal(v));

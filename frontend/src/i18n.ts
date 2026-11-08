/* Minimal i18n: English keys (or notice.* template keys), per-locale
 * dictionaries in ./locales/, {param} interpolation, `key_one` plurals (n/count === 1), localStorage-
 * persisted. To contribute a language, see locales/de.ts. */

import { DE } from "./locales/de";
import { EN } from "./locales/en";
import { fmtNum, setNumLangSource } from "./numfmt";

export type Lang = "en" | "de";

let lang: Lang =
  (typeof localStorage !== "undefined" &&
    (localStorage.getItem("pmc_lang") as Lang)) || "en";

export const getLang = (): Lang => lang;
setNumLangSource(getLang);

export function setLang(next: Lang): void {
  lang = next;
  localStorage.setItem("pmc_lang", next);
}

export function t(key: string,
                  params?: Record<string, string | number>): string {
  // Plural: `key_one` (same locale) wins when n (or count) is exactly 1.
  const dict = lang === "de" ? DE : EN;
  const one = params && (params.n === 1 || params.count === 1)
    ? dict[`${key}_one`] : undefined;
  let s = one ?? (lang === "de" ? DE[key] : undefined) ?? EN[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      // Numbers follow the number format (see numfmt.ts); a year is no count.
      s = s.replaceAll(`{${k}}`,
        typeof v === "number" && k !== "year" ? fmtNum(v) : String(v));
    }
  }
  return s;
}

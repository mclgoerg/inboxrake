/* Rule recipes: nine ready-made rules for New rule > From a recipe. The
 * machine parts live in recipes.json (the backend test validates every filter
 * and definition from the same file); the words are UI strings
 * (`recipe.<id>.title` / `.sub`). A recipe is only ever turned into an
 * ordinary rule body - report mode, report run once - by the server's own
 * create path, exactly as the editor would. */

import { t } from "./i18n";
import { matchGroup, parseFilter } from "./lib";
import type { Group, Rule } from "./types";
import RECIPE_DATA from "./recipes.json";

export type RecipeGroup = "tidy" | "short" | "protect";

export interface Recipe {
  id: string;
  group: RecipeGroup;
  icon: string;
  query: string;
  action: string;
  schedule: Rule["schedule"];
  older_than_days?: number;
  keep_latest?: number;
  /** A folder the recipe files into (looked up by name, never created). */
  folder?: string;
  /** What the card counts: mails (default) or the attachment size. */
  metric?: "size";
}

export const RECIPES = RECIPE_DATA as Recipe[];

export interface RecipeCount {
  mails: number;
  senders: number;
  size: number;
}

/** What a recipe would catch on the loaded Sender groups - the SAME filter
 *  code and skips the rule preview uses (protected senders out, pinned mails
 *  out unless the action only marks as read). */
export function countRecipe(r: Recipe, groups: Group[]): RecipeCount {
  const f = parseFilter(r.query);
  const hits = groups.filter((g) => matchGroup(g, f) && !g.protected);
  const pinned = (g: Group) => r.action === "mark_read" ? 0 : g.pinned ?? 0;
  return {
    mails: hits.reduce((n, g) => n + g.count - pinned(g), 0),
    senders: hits.length,
    size: hits.reduce((n, g) => n + g.att_size, 0),
  };
}

/** The recipes with their live counts, sorted by what they would catch;
 *  those that catch nothing last (`empty`). Without loaded groups (no scan
 *  yet) the counts are null and the order is the list's own. */
export function rankRecipes(groups: Group[]):
  { recipe: Recipe; count: RecipeCount | null; empty: boolean }[] {
  const rows = RECIPES.map((recipe) => {
    const count = groups.length ? countRecipe(recipe, groups) : null;
    // sorted by mails for every recipe (a size would outrank every count)
    const amount = count?.mails ?? 0;
    return { recipe, count, empty: count !== null && !amount, amount };
  });
  if (!groups.length) return rows;
  return rows.sort((a, b) =>
    Number(a.empty) - Number(b.empty) || b.amount - a.amount);
}

/** The destination folder of a recipe that files mail: the folder of that
 *  name (case-insensitive, also the last part of a path), else "". */
export function recipeFolder(r: Recipe, folders: string[], raw: string[]):
  string {
  if (!r.folder) return "";
  const want = r.folder.toLowerCase();
  const i = folders.findIndex((n) =>
    n.toLowerCase().split(/[/.]/).pop() === want);
  return i >= 0 ? raw[i] ?? "" : "";
}

/** The body `api.createRule` takes - what the editor's Create would send. */
export function recipeBody(r: Recipe, dest: string): Partial<Rule> {
  return {
    name: t(`recipe.${r.id}.title`), scope: "mail", grouping: "sender",
    query: r.query, action: r.action, dest,
    schedule: r.schedule,
    keep_latest: r.keep_latest ?? null,
    older_than_days: r.older_than_days ?? null,
  };
}

/** "move to Trash if older than 30 days" - the action in the app's words. */
export function recipeAction(r: Recipe, folder: string): string {
  const act = t(`rule.act_${r.action}`, { folder: folder || r.folder || "" });
  const ret = r.keep_latest != null
    ? t("rule.ret_keep", { n: r.keep_latest })
    : r.older_than_days != null
      ? t("rule.ret_older", { n: r.older_than_days }) : "";
  return ret ? `${act} ${ret}` : act;
}

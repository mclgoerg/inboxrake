/* Rule recipes: nine ready-made rules for New rule > From a recipe. The
 * machine parts live in recipes.json (the backend test validates every filter
 * and definition from the same file); the words are UI strings
 * (`recipe.<id>.title` / `.sub`). A recipe is only ever turned into an
 * ordinary rule body - report mode, report run once - by the server's own
 * create path, exactly as the editor would. */

import { t } from "./i18n";
import { matchGroup, parseFilter } from "./lib";
import { isProposal } from "./proposals";
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
  const matched = groups.filter((g) => matchGroup(g, f) && !g.protected);
  const pinned = (g: Group) => r.action === "mark_read" ? 0 : g.pinned ?? 0;
  // "except the newest N" leaves N mails of every sender where it is
  const acts = (g: Group) => {
    const n = g.count - pinned(g);
    return r.keep_latest ? n - Math.min(n, r.keep_latest) : n;
  };
  const hits = r.keep_latest ? matched.filter((g) => acts(g) > 0) : matched;
  return {
    mails: hits.reduce((n, g) => n + acts(g), 0),
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
  // the English name or the one in the user's language
  const want = [r.folder, recipeFolderName(r)].map((n) => n.toLowerCase());
  const i = folders.findIndex((n) =>
    want.includes(n.toLowerCase().split(/[/.]/).pop() ?? ""));
  return i >= 0 ? raw[i] ?? "" : "";
}

/** The folder a recipe files into, named in the user's language. */
export const recipeFolderName = (r: Recipe): string =>
  r.folder ? t(`recipe.${r.id}.folder`) : "";

/** Whether an ordinary rule with this recipe's definition already exists
 *  (same grouping, filter, action, folder and retention). */
export function recipeAdded(r: Recipe, rules: Rule[], dest: string): boolean {
  return rules.some((x) => (x.scope ?? "mail") === "mail"
    && !isProposal(x)    // an unapproved assistant proposal is not "added"
    && x.grouping === "sender" && x.query.trim() === r.query
    && x.action === r.action && (r.action === "move" ? x.dest === dest : true)
    && (x.keep_latest ?? null) === (r.keep_latest ?? null)
    && (x.older_than_days ?? null) === (r.older_than_days ?? null));
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
export function recipeAction(r: Recipe, folderLabel = ""): string {
  // the real folder's own name when one exists, else the localized default
  const act = t(`rule.act_${r.action}`,
    { folder: folderLabel || recipeFolderName(r) });
  const ret = r.keep_latest != null
    ? t("rule.ret_keep", { n: r.keep_latest })
    : r.older_than_days != null
      ? t("rule.ret_older", { n: r.older_than_days }) : "";
  return ret ? `${act} ${ret}` : act;
}

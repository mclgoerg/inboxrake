import { Archive, BellOff, Check, ChevronLeft, ChevronRight, Hourglass, Info, Layers,
  MailOpen, MessageCircle, Newspaper, Paperclip, Plus, Receipt, ScanSearch,
  Truck, X } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { fmtSize } from "../api";
import { t } from "../i18n";
import { rankRecipes, type Recipe, type RecipeCount, type RecipeGroup,
  recipeAction, recipeAdded, recipeFolder, RECIPES } from "../recipes";
import type { AppState, Group, Rule } from "../types";
import { Button, Modal, Notice, Segmented, Spinner, useMediaQuery } from "./ui";

/** The three ways into a new rule. */
export type NewRuleMode = "blank" | "recipe" | "describe";

const ICONS: Record<string, ReactNode> = {
  newspaper: <Newspaper size={18} />, layers: <Layers size={18} />,
  hourglass: <Hourglass size={18} />, message: <MessageCircle size={18} />,
  truck: <Truck size={18} />, mailopen: <MailOpen size={18} />,
  receipt: <Receipt size={18} />, belloff: <BellOff size={18} />,
  paperclip: <Paperclip size={18} />,
};

/** The recipes of this mailbox with their live counts (Sender groups). */
export function useRankedRecipes(state: AppState) {
  return useMemo(
    () => rankRecipes(Object.values(state.groups?.sender ?? {}) as Group[]),
    [state.groups]);
}

/** Blank / From a recipe / Describe it… - the same switch in the dialog and
 *  in the blank editor. */
export function NewRuleModes({ value, onChange, short = false, ai }: {
  value: NewRuleMode; onChange: (m: NewRuleMode) => void; short?: boolean;
  /** Describe it… needs an AI provider: absent = AI is off (no such way in),
   *  `disabled` = the demo (shown, with its hint). */
  ai?: RuleAi;
}) {
  return (
    <div className="min-w-0 max-sm:w-full">
    <Segmented value={value} onChange={onChange} label={t("rule.f_new_mode")}
      equal={short} role="radio"
      className={short ? "w-full" : ""}
      options={[
        { value: "blank", label: t("rule.mode_blank") },
        { value: "recipe", label: t(short ? "rule.mode_recipe_short"
          : "rule.mode_recipe") },
        ...(ai ? [{ value: "describe" as const, disabled: ai.disabled,
          describedBy: ai.hint ? "new-rule-ai-hint" : undefined,
          label: t(short ? "rule.mode_describe_short"
            : "rule.mode_describe") }] : [])]} />
    {ai?.disabled && ai.hint && (
      <div id="new-rule-ai-hint" className="mt-1 type-meta text-muted">
        {ai.hint}</div>)}
    </div>
  );
}

export interface RuleAi { disabled: boolean; hint?: string }

const icon = (r: Recipe) => (
  <span aria-hidden className={`flex size-9 shrink-0 items-center
    justify-center rounded-control ${r.action === "trash"
    ? "bg-review-bg text-review-fg" : "bg-chip text-chiptext"}`}>
    {r.action === "archive" ? <Archive size={18} /> : ICONS[r.icon]}
  </span>
);

/** "Now: 641 mails · 38 senders" (or "· 88.8 MB" for the size recipe). */
export function nowText(r: Recipe, c: RecipeCount | null): string | null {
  if (!c) return null;
  const amount = r.metric === "size" ? c.size : c.mails;
  if (!amount) return t("recipe.now_none");
  return t("recipe.now", { mails: t("n.mails", { n: c.mails }),
    more: r.metric === "size" ? fmtSize(c.size)
      : t("n.senders", { n: c.senders }) });
}

interface Row { recipe: Recipe; count: RecipeCount | null; empty: boolean }

/** One recipe as a card: what it is for, the filter and action in the app's
 *  words, what it would catch now, Add. */
function RecipeCard({ row, added, folderLabel, busy, error, onAdd, lead }: {
  row: Row; added: boolean; folderLabel: string; busy: boolean; error?: string;
  onAdd: () => void; lead?: boolean;
}) {
  const r = row.recipe;
  const now = nowText(r, row.count);
  return (
    <div data-recipe={r.id} data-empty={row.empty || undefined}
      className={`flex flex-col gap-2 rounded-card border bg-panel2 p-3
        ${lead ? "border-accent" : "border-line"}
        ${row.empty ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-2.5">
        {icon(r)}
        <h3 className="min-w-0 flex-1 type-body font-medium">
          {t(`recipe.${r.id}.title`)}</h3>
      </div>
      <p className="type-meta text-muted">{t(`recipe.${r.id}.sub`)}</p>
      <p className="type-meta text-muted">
        <code className="rounded-control bg-chip px-1.5 py-0.5 text-chiptext
          break-words">{r.query}</code>
        {" → "}{recipeAction(r, folderLabel)}{" · "}{t(`sched.${r.schedule}`)}
      </p>
      <div className="mt-auto flex items-center gap-2 pt-1">
        {now && <span className="inline-flex min-w-0 flex-1 items-center gap-1.5
          type-meta text-muted">
          <ScanSearch size={14} aria-hidden className="shrink-0" />
          <span className="min-w-0">{now}</span></span>}
        <Button variant={lead && !added ? "primary" : "secondary"} size="sm"
          className="ml-auto shrink-0" disabled={busy || added}
          aria-label={t(added ? "recipe.added_named" : "recipe.add_named",
            { name: t(`recipe.${r.id}.title`) })}
          onClick={onAdd}>
          {busy ? <Spinner /> : added ? <>
            <Check size={14} aria-hidden
              className="mr-1 inline align-text-bottom" />{t("recipe.added_btn")}</>
            : <>
            <Plus size={14} aria-hidden
              className="mr-1 inline align-text-bottom" />{t("recipe.add")}</>}
        </Button>
      </div>
      {error && <div role="alert" className="type-meta text-danger-fg">
        {error}</div>}
    </div>
  );
}

const FILTERS: (RecipeGroup | "all")[] = ["all", "tidy", "short", "protect"];

/** New rule > From a recipe: the nine recipes sorted by what they would
 *  catch now. Add creates an ordinary rule (report mode, report run once);
 *  the caller does that and returns an error text, or nothing. */
export function RecipeDialog({ state, ai, onClose, onMode, onAdd, highlight }: {
  state: AppState;
  /** A recipe to show first, marked and (on phones) opened - e.g. the one a
   *  "What stands out" sentence points to. */
  highlight?: string;
  ai?: RuleAi;
  onClose: () => void;
  onMode: (m: NewRuleMode) => void;
  onAdd: (r: Recipe) => Promise<string | void>;
}) {
  const phone = useMediaQuery("(max-width: 639px)");
  const ranked = useRankedRecipes(state);
  const [filter, setFilter] = useState<RecipeGroup | "all">("all");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<{ id: string; text: string } | null>(null);
  // phones: a tap opens the recipe (preview + Add)
  const [open, setOpen] = useState<string | null>(highlight ?? null);
  const rows = ranked.filter((x) => filter === "all" || x.recipe.group === filter)
    .sort((a, b) => Number(b.recipe.id === highlight) - Number(a.recipe.id === highlight));
  const known = ranked.some((x) => x.count);

  const add = async (r: Recipe) => {
    setBusy(r.id); setErr(null);
    const text = await onAdd(r);
    setBusy("");
    if (text) setErr({ id: r.id, text });
  };
  const addedAlready = (r: Recipe) => recipeAdded(r, state.rules ?? [],
    recipeFolder(r, state.folders, state.folders_raw));
  // the display name of the folder the recipe would file into, if there is one
  const folderLabel = (r: Recipe) => {
    const raw = recipeFolder(r, state.folders, state.folders_raw);
    const i = raw ? state.folders_raw.indexOf(raw) : -1;
    return i >= 0 ? state.folders[i] ?? "" : "";
  };
  const card = (row: Row, i = -1) => (
    <RecipeCard key={row.recipe.id} row={row}
      added={addedAlready(row.recipe)}
      folderLabel={folderLabel(row.recipe)}
      lead={highlight ? row.recipe.id === highlight
        : i === 0 && !row.empty && filter === "all"}
      busy={busy === row.recipe.id}
      error={err?.id === row.recipe.id ? err.text : undefined}
      onAdd={() => add(row.recipe)} />);
  const opened = open ? ranked.find((x) => x.recipe.id === open) : undefined;
  const report = (
    <p className="flex items-start gap-1.5 type-meta text-muted">
      <Info size={14} aria-hidden className="mt-0.5 shrink-0" />
      {t("recipe.every_report")}</p>);

  if (phone) return (
    <Modal onClose={onClose} size="sm" label={t("rule.new_title")}>
      <div className="flex items-center gap-3 px-4 py-3">
        {opened
          ? <button type="button" onClick={() => setOpen(null)}
              className="inline-flex min-h-11 items-center gap-0.5 text-accent">
              <ChevronLeft size={18} aria-hidden />{t("recipe.all")}</button>
          : <button type="button" onClick={onClose}
              className="min-h-11 text-accent">{t("Cancel")}</button>}
        <h2 className="flex-1 pr-12 text-center type-heading">
          {t("rule.new_title")}</h2>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        <NewRuleModes value="recipe" onChange={onMode} short ai={ai} />
        {opened ? card(opened) : <>
          <ul className="divide-y divide-line rounded-card bg-panel2">
            {ranked.map((row) => (
              <li key={row.recipe.id} data-empty={row.empty || undefined}
                className={row.empty ? "opacity-60" : ""}>
                <button type="button" onClick={() => setOpen(row.recipe.id)}
                  className="flex min-h-14 w-full items-center gap-3 px-3 py-2
                    text-left">
                  {icon(row.recipe)}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate type-body font-medium">
                      {t(`recipe.${row.recipe.id}.title`)}</span>
                    <span className="block truncate type-meta text-muted">
                      {nowText(row.recipe, row.count)
                        ?? t(`recipe.${row.recipe.id}.sub`)}</span>
                  </span>
                  <ChevronRight size={16} aria-hidden className="text-faint" />
                </button>
              </li>))}
          </ul>
          {report}
        </>}
      </div>
    </Modal>
  );

  return (
    <Modal onClose={onClose} size="xl" label={t("rule.new_title")}>
      <div className="flex flex-wrap items-center gap-3 px-5 pt-4">
        <h2 className="flex-1 type-heading">{t("rule.new_title")}</h2>
        <NewRuleModes value="recipe" onChange={onMode} ai={ai} />
        <Button variant="secondary" size="icon" label={t("Close")}
          onClick={onClose}><X size={18} /></Button>
      </div>
      <div className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented value={filter} onChange={setFilter} role="radio"
            label={t("recipe.filter")}
            options={FILTERS.map((f) => ({ value: f,
              label: f === "all" ? t("recipe.f_all", { n: RECIPES.length })
                : t(`recipe.f_${f}`) }))} />
          <span className="type-meta text-muted">
            {known ? t("recipe.counted", { account: state.account })
              : t("rule.match_unknown")}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row, i) => card(row, i))}
        </div>
        <Notice icon={<Info size={14} />}>
          {t("recipe.notice")}
        </Notice>
      </div>
    </Modal>
  );
}

/** The empty Rules page: the top three recipes right there, Add on each. */
export function RecipeStarters({ state, busy, onAdd, onAll }: {
  state: AppState; busy: string;
  onAdd: (r: Recipe) => void; onAll: () => void;
}) {
  const ranked = useRankedRecipes(state);
  const top = ranked.slice(0, 3);
  return (
    <div className="rounded-card border border-line bg-panel2 p-3 sm:p-4">
      <div className="type-body font-medium">{t("rules.empty_title")}</div>
      <div className="type-meta text-muted">{t("rules.empty_sub")}</div>
      <ul className="mt-3 space-y-2">
        {top.map(({ recipe, count }) => {
          const amount = count && (recipe.metric === "size" ? count.size
            : count.mails);
          return (
            <li key={recipe.id} data-recipe={recipe.id}
              className="flex items-center gap-3 rounded-control border
                border-line bg-panel px-3 py-2">
              {icon(recipe)}
              <span className="min-w-0 flex-1 type-body font-medium">
                {t(`recipe.${recipe.id}.title`)}</span>
              {count && <span className="shrink-0 type-meta text-muted">
                {recipe.metric === "size" ? fmtSize(amount ?? 0)
                  : t("n.mails", { n: amount ?? 0 })}</span>}
              <Button variant="secondary" size="sm" disabled={busy === recipe.id}
                aria-label={t("recipe.add_named",
                  { name: t(`recipe.${recipe.id}.title`) })}
                onClick={() => onAdd(recipe)}>
                {busy === recipe.id ? <Spinner /> : <>
                  <Plus size={14} aria-hidden
                    className="mr-1 inline align-text-bottom" />
                  {t("recipe.add")}</>}
              </Button>
            </li>);
        })}
      </ul>
      <button type="button" onClick={onAll}
        className="mt-3 type-meta text-accent hover:underline">
        {t("recipe.all_n", { n: RECIPES.length })}</button>
    </div>
  );
}

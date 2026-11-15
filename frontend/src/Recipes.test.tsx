// @vitest-environment jsdom
/* Rule recipes: New rule > From a recipe, the empty-state starters, Add. */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { RulesModal } from "./components/RulesModal";
import { DialogProvider } from "./components/ui";
import { setLang, t } from "./i18n";
import { DE } from "./locales/de";
import { EN } from "./locales/en";
import { countRecipe, RECIPES, rankRecipes, recipeAction, recipeAdded, recipeBody,
  recipeFolder } from "./recipes";
import { parseFilter } from "./lib";
import type { AppState, Group } from "./types";

const createRule = vi.fn();
const runRule = vi.fn();
const aiFilter = vi.fn();

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: { createRule: (b: unknown) => createRule(b),
         runRule: (id: string) => runRule(id),
         aiFilter: (...a: unknown[]) => aiFilter(...a),
         rules: () => Promise.resolve({ rules: [], cap: 500 }) },
}));
vi.mock("./components/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./components/ui")>()),
  ensureAiAck: () => Promise.resolve(true),
}));

const grp = (key: string, over: Partial<Group>): Group => ({
  key, label: key, sub: "", count: 10, size: 0, unread: 0, first: "2024-01-01",
  last: "2025-01-01", tags: [], samples: [], bulk: false, unsub: false,
  ai: null, ratings: null, protected: false, replied: false, att_size: 0,
  unsubscribed: null, new: false, pinned: 0, engagement: 50, ...over,
});

const baseState: AppState = {
  account: "demo", status: "idle", scanned_ts: 1, groups_rev: 0,
  progress: "", error: "", folders: ["INBOX", "Receipts"],
  groups: { sender: {}, smart: {}, domain: {}, subject: {}, thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "",
    usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: ["INBOX", "Receipts"],
  rules: [], presets: [],
};
// news.example: 40 mails (newsletter, unsub); shop.example: 7 (shopping)
const withGroups = (extra: Record<string, Group> = {}): AppState => ({
  ...baseState, groups: { ...baseState.groups, sender: {
    "a@news.example": grp("a@news.example", { count: 40, unsub: true,
      tags: ["newsletter"] }),
    "b@shop.example": grp("b@shop.example", { count: 7, tags: ["shopping"] }),
    ...extra } } });

const renderRules = (state: AppState, ai: { disabled: boolean;
  hint?: string } | null = { disabled: false }) => render(<DialogProvider>
  <RulesModal state={state} ai={ai ?? undefined} onClose={() => {}} onChanged={() => {}} />
</DialogProvider>);
const openNew = () =>
  fireEvent.click(screen.getByRole("button", { name: "New rule" }));
// the recipe cards of the open dialog (else the empty-state starters)
const scope = () => [...document.querySelectorAll('[role="dialog"]')].at(-1)
  ?? document.body;
const cards = () => [...scope().querySelectorAll<HTMLElement>("[data-recipe]")];

afterEach(() => {
  cleanup();
  createRule.mockReset();
  runRule.mockReset();
  aiFilter.mockReset();
  vi.unstubAllGlobals();
  setLang("en");
});

test("nine recipes, every filter parses and every text exists in EN and DE", () => {
  expect(RECIPES).toHaveLength(9);
  for (const r of RECIPES) {
    expect(parseFilter(r.query).text).toEqual([]);   // no stray free words
    for (const k of ["title", "sub"]) {
      expect(EN[`recipe.${r.id}.${k}`], r.id).toBeTruthy();
      expect(DE[`recipe.${r.id}.${k}`], r.id).toBeTruthy();
    }
  }
});

test("a recipe's body is what the editor sends and never asks for execute", () => {
  const body = recipeBody(RECIPES.find((r) => r.id === "keep5")!, "");
  expect(body).toEqual({ name: "Keep the latest 5 of every newsletter",
    scope: "mail", grouping: "sender", query: "tag:newsletter",
    action: "trash", dest: "", schedule: "weekly", keep_latest: 5,
    older_than_days: null });
  for (const r of RECIPES) expect(recipeBody(r, "x")).not.toHaveProperty("mode");
});

test("counts skip protected senders and pinned mails; sorted by count, empty last", () => {
  const groups = Object.values(withGroups({
    "c@news.example": grp("c@news.example", { count: 9, unsub: true,
      protected: true }),
    "d@news.example": grp("d@news.example", { count: 5, unsub: true,
      pinned: 2 }),
  }).groups.sender);
  const r = RECIPES.find((x) => x.id === "newsletters")!;
  expect(countRecipe(r, groups)).toMatchObject({ mails: 43, senders: 2 });
  const ranked = rankRecipes(groups);
  const counts = ranked.map((x) => x.count!.mails);
  const firstEmpty = ranked.findIndex((x) => x.empty);
  expect(ranked[0].recipe.id).toBe("newsletters");
  expect(ranked.slice(firstEmpty).every((x) => x.empty)).toBe(true);
  expect(ranked.slice(0, firstEmpty).map((x) => x.count!.mails))
    .toEqual([...counts.slice(0, firstEmpty)].sort((a, b) => b - a));
  expect(ranked.at(-1)!.empty).toBe(true);
});

test("the receipts recipe finds an existing folder by name, never invents one", () => {
  const r = RECIPES.find((x) => x.id === "receipts")!;
  expect(recipeFolder(r, ["INBOX", "Receipts"], ["INBOX", "Receipts"]))
    .toBe("Receipts");
  expect(recipeFolder(r, ["INBOX", "Work/receipts"], ["INBOX", "Work/receipts"]))
    .toBe("Work/receipts");
  expect(recipeFolder(r, ["INBOX"], ["INBOX"])).toBe("");
  expect(recipeAction(r)).toBe("move to Receipts");
  setLang("de");
  // the localized name is found too, and shown
  expect(recipeFolder(r, ["INBOX", "Belege"], ["INBOX", "Belege"]))
    .toBe("Belege");
  expect(recipeFolder(r, ["INBOX", "Receipts"], ["INBOX", "Receipts"]))
    .toBe("Receipts");
  expect(recipeAction(r)).toBe("in Belege verschieben");
});

test("New rule opens the recipe view: nine cards sorted by their live count", () => {
  renderRules(withGroups());
  openNew();
  const dlg = screen.getByRole("dialog", { name: "New rule" });
  expect(within(dlg).getByRole("radio", { name: "From a recipe" })
    .getAttribute("aria-checked")).toBe("true");
  expect(cards()).toHaveLength(9);
  expect(cards()[0].dataset.recipe).toBe("newsletters");
  expect(cards()[0].textContent).toContain("Now: 40 mails · 1 sender");
  // keep5 ties with newsletters (both 40): the list's own order decides
  expect(cards().slice(0, 3).map((c) => c.dataset.recipe))
    .toEqual(["newsletters", "keep5", "shop"]);
  // zero-count recipes last and dimmed
  const empty = cards().filter((c) => c.dataset.empty);
  expect(empty.length).toBe(6);
  expect(cards().slice(-6)).toEqual(empty);
  expect(empty[0].className).toContain("opacity-60");
  expect(screen.getByText(/Counted on demo just now/)).toBeTruthy();
  expect(screen.getByText(/starts in Report only/)).toBeTruthy();
});

test("the filter row narrows the cards", () => {
  renderRules(withGroups());
  openNew();
  fireEvent.click(screen.getByRole("radio", { name: "Protect" }));
  expect(cards().map((c) => c.dataset.recipe).sort())
    .toEqual(["receipts", "still"]);
  fireEvent.click(screen.getByRole("radio", { name: "All 9" }));
  expect(cards()).toHaveLength(9);
});

test("Add creates an ordinary rule (no mode), runs its report once, shows it", async () => {
  createRule.mockResolvedValue({ id: "r1" });
  runRule.mockResolvedValue({});
  const changed = vi.fn();
  render(<DialogProvider>
    <RulesModal state={withGroups()} onClose={() => {}} onChanged={changed} />
  </DialogProvider>);
  openNew();
  fireEvent.click(within(cards()[0]).getByRole("button", { name: /^Add/ }));
  await waitFor(() => expect(runRule).toHaveBeenCalledWith("r1"));
  expect(createRule).toHaveBeenCalledTimes(1);
  const body = createRule.mock.calls[0][0];
  expect(body).toMatchObject({ name: "Newsletters expire after 30 days",
    query: "is:unsub", action: "trash", older_than_days: 30,
    keep_latest: null, schedule: "weekly", grouping: "sender" });
  expect(body.mode).toBeUndefined();
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(screen.queryByRole("dialog", { name: "New rule" })).toBeNull();
});

test("a recipe card says so right after Add", async () => {
  createRule.mockResolvedValue({ id: "r1" });
  runRule.mockResolvedValue({});
  const rule = { id: "r1", name: "Newsletters expire after 30 days",
    scope: "mail" as const, grouping: "sender" as const, query: "is:unsub",
    action: "trash", dest: "", schedule: "weekly" as const,
    mode: "report" as const, keep_latest: null, older_than_days: 30,
    origin: "manual" as const, report_runs: 1, created: 0,
    last_run: { ts: 1, mode: "report" as const, groups: 38, mails: 641,
      acted: 0, capped: 0, skipped_protected: 2, skipped_pinned: 0,
      preview: [], error: "" } };
  const state = withGroups();
  const { rerender } = renderRules(state);
  openNew();
  fireEvent.click(within(cards()[0]).getByRole("button", { name: /^Add/ }));
  await waitFor(() => expect(runRule).toHaveBeenCalled());
  rerender(<DialogProvider><RulesModal state={{ ...state, rules: [rule] }}
    onClose={() => {}} onChanged={() => {}} /></DialogProvider>);
  expect(screen.getByText(EN["recipe.added_ready"])).toBeTruthy();
  expect(screen.getByRole("radio", { name: "Report only" })
    .getAttribute("aria-checked")).toBe("true");
});

test("a refused create shows the error on the card and keeps the dialog", async () => {
  createRule.mockRejectedValue(new Error("nope"));
  renderRules(withGroups());
  openNew();
  fireEvent.click(within(cards()[0]).getByRole("button", { name: /^Add/ }));
  expect((await screen.findByRole("alert")).textContent).toContain("nope");
  expect(runRule).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "New rule" })).toBeTruthy();
});

test("receipts without a folder open the editor, prefilled, to pick one", async () => {
  const state = { ...withGroups({
    "f@bank.example": grp("f@bank.example", { count: 12, tags: ["finance"] }) }),
    folders: ["INBOX"], folders_raw: ["INBOX"] };
  renderRules(state);
  openNew();
  fireEvent.click(within(cards().find((c) => c.dataset.recipe === "receipts")!)
    .getByRole("button", { name: /^Add/ }));
  expect(createRule).not.toHaveBeenCalled();
  expect((screen.getByLabelText("Name") as HTMLInputElement).value)
    .toBe("Receipts into their own folder");
  expect((screen.getByLabelText("Filter") as HTMLInputElement).value)
    .toBe("tag:finance");
  expect(screen.getByText(/no “Receipts” folder yet/)).toBeTruthy();
});

test("Blank is today's editor; Describe it… is the plain-words writer", async () => {
  renderRules(withGroups());
  openNew();
  fireEvent.click(screen.getByRole("radio", { name: "Describe it…" }));
  expect(screen.getByRole("dialog", { name: EN["aif.title"] })).toBeTruthy();
  aiFilter.mockResolvedValue({ query: "tag:shipping", explanation: "x",
    unsupported: [], cost: 0 });
  fireEvent.change(screen.getByRole("textbox"),
    { target: { value: "shipping mails" } });
  fireEvent.click(screen.getByText(EN["aif.send"]));
  fireEvent.click(await screen.findByText(EN["aif.save_rule"]));
  // only "use it for the rule" here: no Apply / Save as preset
  expect((screen.getByLabelText("Filter") as HTMLInputElement).value)
    .toBe("tag:shipping");
  // the blank editor carries the same switch (short labels)
  fireEvent.click(screen.getByRole("radio", { name: "Recipe" }));
  expect(cards()).toHaveLength(9);
  fireEvent.click(screen.getByRole("radio", { name: "Blank" }));
  expect(screen.getByLabelText("Name")).toBeTruthy();
});

test("Describe it… offers only the rule, not Apply or Save as preset", async () => {
  renderRules(withGroups());
  openNew();
  fireEvent.click(screen.getByRole("radio", { name: "Describe it…" }));
  aiFilter.mockResolvedValue({ query: "tag:shipping", explanation: "",
    unsupported: [], cost: 0 });
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
  fireEvent.click(screen.getByText(EN["aif.send"]));
  await screen.findByText(EN["aif.save_rule"]);
  expect(screen.queryByText(EN["aif.apply"])).toBeNull();
  expect(screen.queryByText(EN["aif.save_preset"])).toBeNull();
});

test("an empty Rules page shows the top three recipes; Add and All 9", async () => {
  createRule.mockResolvedValue({ id: "r1" });
  runRule.mockResolvedValue({});
  renderRules(withGroups());
  expect(screen.getByText("No rules yet")).toBeTruthy();
  const rows = cards();
  expect(rows.map((c) => c.dataset.recipe))
    .toEqual(["newsletters", "keep5", "shop"]);
  expect(rows[0].textContent).toContain("40 mails");
  fireEvent.click(within(rows[0]).getByRole("button", { name: /^Add/ }));
  await waitFor(() => expect(createRule).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByText("All 9 recipes"));
  expect(cards()).toHaveLength(9);
});

test("no starters once a rule exists", () => {
  renderRules({ ...withGroups(), rules: [{ id: "x", name: "R", scope: "mail",
    grouping: "sender", query: "", action: "trash", dest: "",
    schedule: "manual", mode: "report", keep_latest: null,
    older_than_days: 30, origin: "manual", report_runs: 1, created: 0,
    last_run: null }] });
  expect(screen.queryByText("No rules yet")).toBeNull();
  expect(cards()).toHaveLength(0);
});

test("a phone gets a sheet with Blank / Recipe / Describe; a tap previews, Add adds", async () => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q,
    addEventListener() {}, removeEventListener() {} }));
  createRule.mockResolvedValue({ id: "r1" });
  runRule.mockResolvedValue({});
  renderRules(withGroups());
  openNew();
  const dlg = screen.getByRole("dialog", { name: "New rule" });
  for (const n of ["Blank", "Recipe", "Describe"])
    expect(within(dlg).getByRole("radio", { name: n })).toBeTruthy();
  const rows = [...scope().querySelectorAll("li")];
  expect(rows.length).toBe(9);
  expect(rows[0].textContent).toContain("Newsletters expire after 30 days");
  expect(rows[0].textContent).toContain("Now: 40 mails · 1 sender");
  expect(screen.getByText("Every recipe starts in Report only.")).toBeTruthy();
  fireEvent.click(within(rows[0] as HTMLElement).getByRole("button"));
  fireEvent.click(within(cards()[0]).getByRole("button", { name: /^Add/ }));
  await waitFor(() => expect(createRule).toHaveBeenCalledTimes(1));
});

test("German: the recipe view and the three ways in are translated", () => {
  setLang("de");
  renderRules(withGroups());
  fireEvent.click(screen.getByRole("button", { name: t("rule.new_btn") }));
  expect(screen.getByRole("radio", { name: "Aus einem Rezept" })).toBeTruthy();
  expect(screen.getByRole("radio", { name: "Beschreiben…" })).toBeTruthy();
  expect(cards()[0].textContent).toContain("Newsletter verfallen nach 30 Tagen");
  expect(cards()[0].textContent).toContain("Jetzt: 40 Mails");
  createRule.mockResolvedValue({ id: "r1" });
  runRule.mockResolvedValue({});
  fireEvent.click(within(cards()[0]).getByRole("button", { name: /Rezept hinzufügen/ }));
  expect(document.body.textContent).toContain("Gezählt in demo gerade eben");
});

test("the size recipe is ranked by its mails, not by its bytes", () => {
  const groups = Object.values(withGroups({
    "z@big.example": grp("z@big.example", { count: 2, att_size: 50_000_000 }),
  }).groups.sender);
  const big = rankRecipes(groups).find((x) => x.recipe.id === "bigatt")!;
  // the (empty) size recipe has no att:/age: match here; a ranked row with
  // bytes must never outrank a bigger mail count
  expect(rankRecipes(groups)[0].recipe.id).toBe("newsletters");
  expect(big.count).not.toBeNull();
});

test("the action line names the real folder, the localized name only without one", () => {
  const r = RECIPES.find((x) => x.id === "receipts")!;
  setLang("de");
  const state = { ...withGroups({
    "f@bank.example": grp("f@bank.example", { count: 12, tags: ["finance"] }) }),
    folders: ["INBOX", "Receipts"], folders_raw: ["INBOX", "Receipts"] };
  renderRules(state);
  fireEvent.click(screen.getByRole("button", { name: t("rule.new_btn") }));
  expect(cards().find((c) => c.dataset.recipe === "receipts")!.textContent)
    .toContain("in Receipts verschieben");
  expect(recipeAction(r)).toBe("in Belege verschieben");
});

test("an unapproved assistant proposal does not count as an added recipe", () => {
  const r = RECIPES.find((x) => x.id === "newsletters")!;
  const rule = { id: "p", name: "p", scope: "mail" as const,
    grouping: "sender" as const, query: "is:unsub", action: "trash", dest: "",
    schedule: "weekly" as const, mode: "report" as const, keep_latest: null,
    older_than_days: 30, origin: "mcp" as const, report_runs: 1, created: 0,
    proposed_by: { token_id: "t", name: "Assistant", at: 1 }, last_run: null };
  expect(recipeAdded(r, [rule], "")).toBe(false);
  expect(recipeAdded(r, [{ ...rule, origin: "manual" as const,
    proposed_by: undefined }], "")).toBe(true);
});

test("Describe it… is hidden without AI and disabled with its hint in the demo", () => {
  renderRules(withGroups(), null);
  openNew();
  expect(screen.queryByRole("radio", { name: "Describe it…" })).toBeNull();
  cleanup();
  renderRules(withGroups(), { disabled: true, hint: "Not in the demo" });
  openNew();
  const d = screen.getByRole("radio", { name: "Describe it…" });
  expect((d as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Not in the demo")).toBeTruthy();
  fireEvent.click(d);
  expect(screen.queryByRole("dialog", { name: EN["aif.title"] })).toBeNull();
});

test("Keep the latest 5 counts only what is beyond the newest 5 of each sender", () => {
  const r = RECIPES.find((x) => x.id === "keep5")!;
  const groups = Object.values(withGroups({
    "s@small.example": grp("s@small.example", { count: 3, tags: ["newsletter"] }),
  }).groups.sender);
  // 40 -> 35 acted on; the sender with 3 mails keeps all of them
  expect(countRecipe(r, groups)).toMatchObject({ mails: 35, senders: 1 });
});

test("a recipe already added as a rule shows Added, disabled", () => {
  const existing = { id: "x", name: "mine", scope: "mail" as const,
    grouping: "sender" as const, query: "is:unsub", action: "trash",
    dest: "", schedule: "daily" as const, mode: "report" as const,
    keep_latest: null, older_than_days: 30, origin: "manual" as const,
    report_runs: 0, created: 0, last_run: null };
  renderRules({ ...withGroups(), rules: [existing] });
  openNew();
  const card = cards().find((c) => c.dataset.recipe === "newsletters")!;
  const btn = within(card).getByRole("button") as HTMLButtonElement;
  expect(btn.disabled).toBe(true);
  expect(btn.textContent).toContain("Added");
  const other = cards().find((c) => c.dataset.recipe === "social")!;
  expect((within(other).getByRole("button") as HTMLButtonElement).disabled)
    .toBe(false);
});

test("the folder fallback keeps From a recipe selected in the editor header", () => {
  const state = { ...withGroups({
    "f@bank.example": grp("f@bank.example", { count: 12, tags: ["finance"] }) }),
    folders: ["INBOX"], folders_raw: ["INBOX"] };
  renderRules(state);
  openNew();
  fireEvent.click(within(cards().find((c) => c.dataset.recipe === "receipts")!)
    .getByRole("button", { name: /^Add/ }));
  expect(screen.getByRole("radio", { name: "Recipe" })
    .getAttribute("aria-checked")).toBe("true");
});

test("the phone recipe view is a sheet with a grabber", () => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q,
    addEventListener() {}, removeEventListener() {} }));
  renderRules(withGroups());
  openNew();
  const dlg = screen.getByRole("dialog", { name: "New rule" });
  expect(dlg.getAttribute("data-size")).toBe("sm");
  expect(dlg.querySelector("[data-sheet-grabber]")).not.toBeNull();
});

test("a recipe handed in (What stands out) opens the recipe dialog with it first", async () => {
  render(<DialogProvider>
    <RulesModal state={withGroups()} initialRecipe="keep5" onClose={() => {}}
      onChanged={() => {}} />
  </DialogProvider>);
  await waitFor(() => expect(cards().length).toBeGreaterThan(1));
  expect(cards()[0].dataset.recipe).toBe("keep5");
});

test("the marked recipe is gone once the recipe dialog is closed", async () => {
  render(<DialogProvider>
    <RulesModal state={withGroups()} initialRecipe="keep5" onClose={() => {}}
      onChanged={() => {}} />
  </DialogProvider>);
  await waitFor(() => expect(cards()[0].dataset.recipe).toBe("keep5"));
  fireEvent.click(within(scope() as HTMLElement).getByRole("button", { name: "Close" }));
  fireEvent.click(await screen.findByRole("button", { name: "New rule" }));
  await waitFor(() => expect(cards().length).toBeGreaterThan(3));
  expect(cards()[0].dataset.recipe).not.toBe("keep5");
});

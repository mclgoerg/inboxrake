// @vitest-environment jsdom
/* The Weekly check-in's Edit… on a Rule checkup finding opens the Rules page
 * with that rule's editor (`initialEditId`), once. Without it the page is as
 * it always was: the list of rules, no editor. */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { RulesModal } from "./components/RulesModal";
import { DialogProvider, PageSlot } from "./components/ui";
import type { AppState, Rule } from "./types";

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: { rules: () => Promise.resolve({ rules: [], cap: 500 }),
    ruleCheckup: () => Promise.resolve({ account: "proton", scanned_ts: null,
      analysed: false, needs_scan: false, checked: 0, rules: 0,
      findings: [] }) },
}));

const rule = (id: string, name: string): Rule => ({
  id, name, scope: "mail", grouping: "sender", query: "tag:news",
  action: "trash", dest: "", schedule: "manual", mode: "report",
  keep_latest: null, older_than_days: 30, origin: "manual", report_runs: 1,
  created: 0, last_run: null });
const state = (rules: Rule[]): AppState => ({
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 1,
  progress: "", error: "", folders: [],
  groups: { sender: {}, smart: {}, domain: {}, subject: {}, thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "",
    usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: [], rules,
  presets: [] } as unknown as AppState);

const RULES = [rule("r1", "Sweep"), rule("r2", "Keep five")];
const mount = (initialEditId?: string) => render(
  <DialogProvider><PageSlot page>
    <RulesModal state={state(RULES)} onClose={() => {}} onChanged={() => {}}
      initialEditId={initialEditId} />
  </PageSlot></DialogProvider>);

afterEach(() => cleanup());

test("opens that rule's editor", async () => {
  mount("r2");
  expect(await screen.findByDisplayValue("Keep five")).toBeTruthy();
  expect(screen.queryByDisplayValue("Sweep")).toBeNull();
});

test("no id, or a rule that is gone: the page as it always was", async () => {
  const a = mount();
  await screen.findByText("Sweep");
  expect(screen.queryByDisplayValue("Sweep")).toBeNull();
  expect(screen.queryByDisplayValue("Keep five")).toBeNull();
  a.unmount();
  mount("gone");
  await screen.findByText("Sweep");
  expect(screen.queryByDisplayValue("Sweep")).toBeNull();
});

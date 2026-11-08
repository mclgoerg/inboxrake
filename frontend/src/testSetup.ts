import { configure } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { backStackBusy, resetBackStack } from "./backStack";

// findBy*/waitFor give up after 1 s by default. Mounting the whole App (the
// first render in a file also pays the module warm-up) took longer than that
// on a loaded runner, failing tests whose assertions were fine. Passing
// waits still return as soon as the condition holds; only a real failure
// waits the full time. Kept under testTimeout so the clear "Unable to find"
// error wins over a bare test timeout.
configure({ asyncUtilTimeout: 5000 });

// A fragment navigation fires popstate (jsdom: later, as a task of its own).
// The back stack (`backStack.ts`) would take it for a Back and close the
// overlays of whatever test is running by then: swallow exactly the ones this
// file's own hash writes cause (its listener registers first, so it runs first).
let strays = 0;
if (typeof window !== "undefined")
  window.addEventListener("popstate", (e) => {
    if (strays > 0) { strays--; e.stopImmediatePropagation(); }
  });
const hashTo = (hash: string) => {
  const was = window.location.href;
  window.location.hash = hash;
  if (window.location.href !== was) strays++;
};
// The URL hash is the app's page (nav.ts) and outlives a test's cleanup():
// reset it so one test's page never leaks into the next. Tests start on the
// Senders page (the list most of them drive); the default start page
// (Overview) is covered by App.overview.test.tsx, which clears the hash.
beforeEach(() => {
  if (typeof window !== "undefined") hashTo("#/senders");
});
afterEach(async () => {
  if (typeof window === "undefined") return;
  // Overlays that unmounted with the test pop their history entries (a
  // traversal jsdom runs as a task): let it land before the next test starts,
  // so it cannot close that test's overlays (V8, `backStack.ts`).
  for (let i = 0; backStackBusy() && i < 40; i++)
    await new Promise((r) => setTimeout(r, 5));
  resetBackStack();
  if (window.location.hash) hashTo("");
  // The popstates of this file's and the test's own hash writes land now, not
  // in the next test.
  await new Promise((r) => setTimeout(r, 0));
});

import { configure } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

// findBy*/waitFor give up after 1 s by default. Mounting the whole App (the
// first render in a file also pays the module warm-up) took longer than that
// on a loaded runner, failing tests whose assertions were fine. Passing
// waits still return as soon as the condition holds; only a real failure
// waits the full time. Kept under testTimeout so the clear "Unable to find"
// error wins over a bare test timeout.
configure({ asyncUtilTimeout: 5000 });

// The URL hash is the app's page (nav.ts) and outlives a test's cleanup():
// reset it so one test's page never leaks into the next. Tests start on the
// Senders page (the list most of them drive); the default start page
// (Overview) is covered by App.overview.test.tsx, which clears the hash.
beforeEach(() => {
  if (typeof window !== "undefined") window.location.hash = "#/senders";
});
afterEach(() => {
  if (typeof window !== "undefined" && window.location.hash)
    window.location.hash = "";
});

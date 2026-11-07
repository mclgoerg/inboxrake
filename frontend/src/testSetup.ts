import { afterEach, beforeEach } from "vitest";

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

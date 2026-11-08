// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { restoreScrollOnNext, useScrollPerPage, hashOf, isTabPage, parseHash, parseSettingsRoute, settingsHash, useNav,
  type Page } from "./nav";

beforeEach(() => { window.location.hash = ""; });
afterEach(() => { window.location.hash = ""; });

test("parseHash accepts known pages and rejects the rest", () => {
  expect(parseHash("#/senders")).toBe("senders");
  expect(parseHash("#/overview")).toBe("overview");
  expect(parseHash("#/all")).toBe("all");
  expect(parseHash("#/all?x=1")).toBe("all");
  expect(parseHash("#/cleanup")).toBe("cleanup");
  expect(parseHash("#/insights")).toBe("insights");
  expect(isTabPage("cleanup") && isTabPage("insights")).toBe(true);
  expect(isTabPage("senders") || isTabPage("all")).toBe(false);
  expect(parseHash("")).toBeNull();
  expect(parseHash("#/nope")).toBeNull();
  expect(hashOf("all")).toBe("#/all");
});

test("an empty or unknown hash shows the fallback without rewriting the URL", () => {
  const { result } = renderHook(() => useNav("all"));
  expect(result.current[0]).toBe("all");
  expect(window.location.hash).toBe("");
  window.location.hash = "#/bogus";
  const again = renderHook(() => useNav());
  expect(again.result.current[0]).toBe("overview");   // the default start page
});

test("setPage writes the hash and back/forward (hashchange) follow", () => {
  const { result } = renderHook(() => useNav());
  act(() => result.current[1]("all"));
  expect(result.current[0]).toBe("all");
  expect(window.location.hash).toBe("#/all");
  act(() => {
    window.location.hash = "#/senders";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(result.current[0]).toBe("senders");
});

test("Back to an empty hash returns to the start page", () => {
  const { result } = renderHook(() => useNav());
  act(() => result.current[1]("all"));
  act(() => {
    window.location.hash = "";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(result.current[0]).toBe("overview");
});

test("Settings routes carry a section and, for accounts, the account name", () => {
  expect(parseHash("#/settings")).toBe("settings");
  expect(parseHash("#/settings/ai")).toBe("settings");
  expect(parseSettingsRoute("#/settings")).toEqual({ section: null, account: null });
  expect(parseSettingsRoute("#/settings/ai")).toEqual({ section: "ai", account: null });
  expect(parseSettingsRoute("#/settings/account/my%20mail"))
    .toEqual({ section: "account", account: "my mail" });
  // unknown sections and other pages are no section; a stray account is dropped
  expect(parseSettingsRoute("#/settings/nope").section).toBeNull();
  expect(parseSettingsRoute("#/senders").section).toBeNull();
  expect(parseSettingsRoute("#/settings/ai/x").account).toBeNull();
  expect(parseSettingsRoute("#/settings/account/%E0%A4%A").account).toBeNull();
  expect(settingsHash()).toBe("#/settings");
  expect(settingsHash("general")).toBe("#/settings/general");
  expect(settingsHash("account", "my mail")).toBe("#/settings/account/my%20mail");
  expect(settingsHash("ai", "ignored")).toBe("#/settings/ai");
});

test("a guard can keep the page when the hash leaves it (Back / Forward)", () => {
  window.location.hash = "#/settings/ai";
  let allow = false;
  const asked: Page[] = [];
  const guard = { current: (to: Page) => { asked.push(to); return allow; } };
  const { result } = renderHook(() => useNav("overview", guard));
  expect(result.current[0]).toBe("settings");
  act(() => {
    window.location.hash = "#/senders";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(asked).toEqual(["senders"]);
  expect(result.current[0]).toBe("settings");
  expect(window.location.hash).toBe("#/settings/ai");   // the URL is put back
  // moving within the page is not leaving it
  act(() => {
    window.location.hash = "#/settings/general";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(asked).toEqual(["senders"]);
  allow = true;
  act(() => {
    window.location.hash = "#/senders";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(result.current[0]).toBe("senders");
});

// Scroll memory: a fresh open starts at the top, a return restores.
/** jsdom has no layout: give an element a scrollable height. */
const tall = (el: HTMLElement, h: number) => {
  Object.defineProperty(el, "scrollHeight", { value: h, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: 100, configurable: true });
};
const scrollTo = (el: HTMLElement, top: number) => {
  el.scrollTop = top;
  el.dispatchEvent(new Event("scroll"));
};

test("scroll: forward navigation resets, history Back restores", () => {
  const inner = document.createElement("div");
  inner.dataset.scrollId = "settings";
  document.body.append(inner);
  tall(document.body, 1000);
  tall(inner, 500);
  const { rerender } = renderHook(({ k }) => useScrollPerPage(k),
    { initialProps: { k: "settings/general" } });
  scrollTo(document.body, 120);
  scrollTo(inner, 40);
  window.history.replaceState({ scrollEntry: 900 }, "");
  // Fresh push to another section: top.
  window.history.pushState(null, "", "#/settings/signin");
  rerender({ k: "settings/signin" });
  expect(document.body.scrollTop).toBe(0);
  expect(inner.scrollTop).toBe(0);
  scrollTo(document.body, 300);
  // Back to the entry that was shown before: its position returns.
  window.history.back();
  window.history.replaceState({ scrollEntry: 900 }, "");
  rerender({ k: "settings/general" });
  expect(document.body.scrollTop).toBe(120);
  expect(inner.scrollTop).toBe(40);
  inner.remove();
});

test("scroll: an Esc-style return restores without a history entry", () => {
  tall(document.body, 1000);
  const { rerender } = renderHook(({ k }) => useScrollPerPage(k),
    { initialProps: { k: "senders//" } });
  scrollTo(document.body, 75);
  window.history.pushState(null, "", "#/settings");
  rerender({ k: "settings//" });
  expect(document.body.scrollTop).toBe(0);
  restoreScrollOnNext();
  window.history.pushState(null, "", "#/senders");
  rerender({ k: "senders//" });
  expect(document.body.scrollTop).toBe(75);
});

test("scroll: a return waits for late content, and a user scroll cancels it", async () => {
  const panel = document.createElement("div");
  panel.dataset.scrollId = "panel";
  tall(document.body, 1000);
  const { rerender } = renderHook(({ k }) => useScrollPerPage(k),
    { initialProps: { k: "duplicates//" } });
  document.body.append(panel);
  tall(panel, 600);
  scrollTo(panel, 250);
  window.history.replaceState({ scrollEntry: 901 }, "");
  window.history.pushState(null, "", "#/attachments");
  rerender({ k: "attachments//" });
  panel.remove();
  // Back: the panel is empty at first, its content arrives ~100 ms later.
  restoreScrollOnNext();
  const late = document.createElement("div");
  late.dataset.scrollId = "panel";
  tall(late, 100);
  document.body.append(late);
  rerender({ k: "duplicates//" });
  expect(late.scrollTop).toBe(0);
  await new Promise((r) => setTimeout(r, 100));
  tall(late, 600);
  await new Promise((r) => setTimeout(r, 100));
  expect(late.scrollTop).toBe(250);
  late.remove();
});

test("scroll: the user scrolling during a restore cancels it", async () => {
  tall(document.body, 1000);
  const { rerender } = renderHook(({ k }) => useScrollPerPage(k),
    { initialProps: { k: "a//" } });
  scrollTo(document.body, 200);
  window.history.pushState(null, "", "#/b");
  rerender({ k: "b//" });
  tall(document.body, 100);              // the old page is short: can't restore yet
  restoreScrollOnNext();
  rerender({ k: "a//" });
  document.dispatchEvent(new Event("wheel"));
  tall(document.body, 1000);
  await new Promise((r) => setTimeout(r, 100));
  expect(document.body.scrollTop).toBe(0);
});

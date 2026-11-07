// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { hashOf, isTabPage, parseHash, useNav } from "./nav";

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

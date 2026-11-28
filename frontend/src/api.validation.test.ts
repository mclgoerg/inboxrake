// @vitest-environment jsdom
/* A request the server refuses as malformed (FastAPI answers 422 with a LIST
   of objects) reads as its messages, never "[object Object]". */
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./api";

afterEach(() => vi.unstubAllGlobals());

const answer = (status: number, body: unknown) => vi.stubGlobal("fetch",
  vi.fn(async () => new Response(JSON.stringify(body), { status })));

test("a 422 with a list of problems says what is wrong", async () => {
  answer(422, { detail: [
    { type: "too_long", loc: ["body", "keys"], msg: "List should have at most 50000 items", input: [] },
    { type: "missing", loc: ["body", "until"], msg: "Field required" }] });
  await expect(api.snooze({ keys: ["a"] }, 1)).rejects.toThrow(
    "List should have at most 50000 items; Field required");
});

test("a coded refusal and a plain text answer read as before", async () => {
  answer(400, { detail: "snooze_full" });
  await expect(api.snooze({ keys: ["a"] }, 1)).rejects.toMatchObject({
    code: "snooze_full" });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
  await expect(api.snooze({ keys: ["a"] }, 1)).rejects.toThrow("boom");
});

// @vitest-environment jsdom
/* The unsubscribe sheet: how each sender is unsubscribed BEFORE anything is
 * sent, the optional Trash step, the per-sender result, and that every
 * action goes through the existing calls (api mocked; no mail is sent). */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "./i18n";
import type { Group, UnsubPreview, UnsubRunItem, UnsubState } from "./types";

const preview = vi.fn();
const bulk = vi.fn();
const single = vi.fn();
const results = vi.fn();
const ack = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      unsubscribePreview: (...a: unknown[]) => preview(...a),
      unsubscribeBulk: (...a: unknown[]) => bulk(...a),
      unsubscribe: (...a: unknown[]) => single(...a),
      unsubscribeResults: (...a: unknown[]) => results(...a),
      unsubscribeAck: (...a: unknown[]) => ack(...a),
    },
  };
});

import { outcomeTitle, UnsubscribeSheet, type UnsubRequest }
  from "./components/UnsubscribeSheet";
import { DialogProvider, ToastProvider } from "./components/ui";

const sender = (addr: string, name: string, via: UnsubPreview["senders"][0]["via"],
    mails = 10, size = 1000) => ({ addr, name, via, mails, size });

const PREVIEW: UnsubPreview = {
  senders: [
    sender("one@chirper.example", "Chirper", "one_click", 120, 3_000_000),
    sender("hello@gadget.example", "Gadget Weekly", "mailto", 100, 2_000_000),
    sender("news@stream.example", "Streamly", "http", 68, 4_000_000),
  ],
  skipped_protected: 0, skipped_done: 0, capped: 0, skipped_no_header: 0,
  trash: {
    groups: [
      { key: "one@chirper.example", addrs: ["one@chirper.example"],
        mails: 120, size: 3_000_000 },
      { key: "hello@gadget.example", addrs: ["hello@gadget.example"],
        mails: 100, size: 2_000_000 },
      { key: "news@stream.example", addrs: ["news@stream.example"],
        mails: 68, size: 4_000_000 },
    ],
    mails: 288, size: 9_000_000, pinned: 0,
  },
};

const idle: UnsubState = { status: "idle", progress: "", error: "", total: 0,
  done: 0, links: 0, failed: 0, skipped: 0, seq: 3 };
const item = (addr: string, status: UnsubRunItem["status"], via: UnsubRunItem["via"],
    over: Partial<UnsubRunItem> = {}): UnsubRunItem =>
  ({ addr, status, via, link: "", error: "", ...over });

const BULK: UnsubRequest = { kind: "bulk", grouping: "sender",
  keys: PREVIEW.senders.map((s) => s.addr) };

interface Props {
  request?: UnsubRequest; unsub?: UnsubState; demo?: boolean;
  groups?: Record<string, Group>;
  onTrash?: (g: string, keys: string[], addrs: string[]) => Promise<number | null>;
  onChanged?: () => void; onRun?: (r: number | null) => void;
  onClose?: () => void;
}
const tree = (p: Props = {}) => (
  <ToastProvider><DialogProvider>
    <UnsubscribeSheet request={p.request ?? BULK} groups={p.groups ?? {}}
      unsub={p.unsub ?? idle} demo={p.demo ?? false}
      onTrash={p.onTrash ?? (async () => 1)}
      onChanged={p.onChanged ?? (() => {})} onRun={p.onRun ?? (() => {})}
      onClose={p.onClose ?? (() => {})} />
  </DialogProvider></ToastProvider>);

// The button ignores a tap in the first half second (a double tap must not
// confirm unseen); a keyboard activation (detail 0) is exempt.
const press = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole("button", { name }), { detail: 0 });

beforeEach(() => {
  setLang("en");
  preview.mockReset().mockResolvedValue(PREVIEW);
  bulk.mockReset().mockResolvedValue({ queued: 3, skipped_protected: 0,
    skipped_done: 0, capped: 0, run: 7 });
  single.mockReset();
  results.mockReset();
  ack.mockReset().mockResolvedValue({ status: "done" });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("review", () => {
  it("shows how each sender is unsubscribed, and sends nothing yet", async () => {
    render(tree());
    expect(await screen.findByText("3 senders · how each one works:"))
      .toBeTruthy();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Chirper")).toBeTruthy();
    expect(within(rows[0]).getByText("One click")).toBeTruthy();
    expect(within(rows[0]).getByText("done right away")).toBeTruthy();
    expect(within(rows[1]).getByText("Sends a mail")).toBeTruthy();
    expect(within(rows[1]).getByText("from your address, via your mail server"))
      .toBeTruthy();
    expect(within(rows[2]).getByText("Web page")).toBeTruthy();
    expect(within(rows[2]).getByText("you confirm on their page")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unsubscribe 3 senders" }))
      .toBeTruthy();
    expect(preview).toHaveBeenCalledWith("sender", BULK.kind === "bulk"
      ? BULK.keys : []);
    expect(bulk).not.toHaveBeenCalled();
    expect(single).not.toHaveBeenCalled();
  });

  it("keeps today's notes: skipped, pooled, no header, still mailing", async () => {
    preview.mockResolvedValue({ ...PREVIEW, skipped_protected: 1,
      skipped_done: 2, capped: 1, skipped_no_header: 2 });
    render(tree({ request: { ...BULK, pooled: 3 } as UnsubRequest }));
    expect(await screen.findByText("4 senders are left out: already handled, "
      + "protected or over the per-run limit.")).toBeTruthy();
    expect(screen.getByText("2 groups without an unsubscribe link are left out."))
      .toBeTruthy();
    expect(screen.getByText("3 pooled rows are skipped: open one to "
      + "unsubscribe from a single sender.")).toBeTruthy();
    expect(screen.getByText(/keeps writing, Inboxrake marks it/)).toBeTruthy();
  });

  it("with nothing to do there is no button, only the reason", async () => {
    preview.mockResolvedValue({ ...PREVIEW, senders: [], skipped_done: 3,
      trash: { groups: [], mails: 0, size: 0, pinned: 0 } });
    render(tree());
    expect(await screen.findByText(/Nothing to unsubscribe from/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Unsubscribe/ })).toBeNull();
  });

  it("a failed check says so and offers no run", async () => {
    preview.mockRejectedValue(new Error("boom"));
    render(tree());
    expect((await screen.findByRole("alert")).textContent)
      .toBe("Couldn't check the senders: boom");
    expect(screen.queryByRole("button", { name: /^Unsubscribe/ })).toBeNull();
  });

  it("ignores a double tap but takes a keyboard press", async () => {
    render(tree());
    await screen.findByText("Chirper");
    fireEvent.click(screen.getByRole("button", { name: "Unsubscribe 3 senders" }),
      { detail: 1 });
    expect(bulk).not.toHaveBeenCalled();
    press("Unsubscribe 3 senders");
    await waitFor(() => expect(bulk).toHaveBeenCalledTimes(1));
  });

  it("Cancel closes without a call", async () => {
    const onClose = vi.fn();
    render(tree({ onClose }));
    await screen.findByText("Chirper");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(bulk).not.toHaveBeenCalled();
  });
});

describe("also move to Trash", () => {
  it("is off by default, sized, and its switch changes the button", async () => {
    render(tree());
    const sw = await screen.findByRole("switch",
      { name: "Also move their 288 mails to Trash" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("8.6 MB · you can undo it")).toBeTruthy();
    expect(screen.queryByText(/The button below does both/)).toBeNull();
    fireEvent.click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/The button below does both/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unsubscribe and move to Trash" }))
      .toBeTruthy();
  });

  it("names the pinned mails that stay", async () => {
    preview.mockResolvedValue({ ...PREVIEW,
      trash: { ...PREVIEW.trash, pinned: 4 } });
    render(tree());
    expect(await screen.findByText("8.6 MB · 4 pinned stay · you can undo it"))
      .toBeTruthy();
  });

  it("is not offered when there is nothing the group path could move", async () => {
    preview.mockResolvedValue({ ...PREVIEW,
      trash: { groups: [], mails: 0, size: 0, pinned: 2 } });
    render(tree());
    await screen.findByText("Chirper");
    expect(screen.queryByRole("switch")).toBeNull();
  });
});

describe("a bulk run", () => {
  const start = async (props: Props = {}) => {
    const view = render(tree(props));
    await screen.findByText("Chirper");
    return view;
  };

  it("runs the existing bulk call, then lists the outcome per sender",
    async () => {
    const onRun = vi.fn();
    const onChanged = vi.fn();
    const view = await start({ onRun, onChanged });
    press("Unsubscribe 3 senders");
    await waitFor(() => expect(bulk).toHaveBeenCalledWith("sender",
      BULK.kind === "bulk" ? BULK.keys : []));
    await waitFor(() => expect(onRun).toHaveBeenLastCalledWith(7));
    expect(screen.getByText("Unsubscribing…")).toBeTruthy();

    // a state from before this run (older id) is not "my run ended"
    view.rerender(tree({ onRun, onChanged,
      unsub: { ...idle, status: "done", seq: 6 } }));
    expect(results).not.toHaveBeenCalled();
    // its own, still running: progress shows
    view.rerender(tree({ onRun, onChanged,
      unsub: { ...idle, status: "running", seq: 7, progress: "2/3" } }));
    expect(screen.getByText("Unsubscribing… 2/3")).toBeTruthy();

    results.mockResolvedValue({ run: 7, items: [
      item("one@chirper.example", "done", "one_click"),
      item("hello@gadget.example", "done", "mailto"),
      item("news@stream.example", "link", "http",
        { link: "https://stream.example/off?u=1" }),
    ] });
    view.rerender(tree({ onRun, onChanged,
      unsub: { ...idle, status: "done", seq: 7, done: 2, links: 1 } }));
    expect(await screen.findByText("2 done · 1 needs you")).toBeTruthy();
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByText("Unsubscribed")).toBeTruthy();
    expect(within(rows[1]).getByText("Unsubscribe mail sent")).toBeTruthy();
    expect(within(rows[2]).getByText("Confirm on their page")).toBeTruthy();
    expect(within(rows[2]).getByRole("button", { name: "Open page" })).toBeTruthy();
    expect(screen.getByText(/tap Mark as done/)).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
  });

  it("a failed sender shows its reason in the user's language", async () => {
    const view = await start();
    press("Unsubscribe 3 senders");
    await waitFor(() => expect(bulk).toHaveBeenCalled());
    results.mockResolvedValue({ run: 7, items: [
      item("one@chirper.example", "failed", "one_click",
        { error: "unsub_http:status=500" }),
      item("hello@gadget.example", "done", "mailto"),
    ] });
    view.rerender(tree({ unsub: { ...idle, status: "done", seq: 7 } }));
    expect(await screen.findByText("1 done · 1 failed")).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.getByText(
      "The sender's unsubscribe page answered with error 500.")).toBeTruthy();
  });

  it("Open page opens the link; Mark as done uses the existing ack",
    async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const view = await start();
    press("Unsubscribe 3 senders");
    await waitFor(() => expect(bulk).toHaveBeenCalled());
    results.mockResolvedValue({ run: 7, items: [
      item("news@stream.example", "link", "http",
        { link: "https://stream.example/off?u=1" })] });
    view.rerender(tree({ unsub: { ...idle, status: "done", seq: 7 } }));
    await screen.findByText("1 needs you");
    fireEvent.click(screen.getByRole("button", { name: "Open page" }));
    expect(open).toHaveBeenCalledWith("https://stream.example/off?u=1",
      "_blank", "noopener");
    fireEvent.click(screen.getByRole("button", { name: "Mark as done" }));
    await waitFor(() => expect(ack).toHaveBeenCalledWith("news@stream.example"));
    expect(await screen.findByText("Marked as done")).toBeTruthy();
    expect(screen.getByText("1 done")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open page" })).toBeNull();
  });

  it("in the demo the page is explained, not opened", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const view = await start({ demo: true });
    press("Unsubscribe 3 senders");
    await waitFor(() => expect(bulk).toHaveBeenCalled());
    results.mockResolvedValue({ run: 7, items: [
      item("news@stream.example", "link", "http",
        { link: "https://stream.example/off" })] });
    view.rerender(tree({ demo: true,
      unsub: { ...idle, status: "done", seq: 7 } }));
    await screen.findByText("1 needs you");
    fireEvent.click(screen.getByRole("button", { name: "Open page" }));
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByText(/In your own install this opens/)).toBeTruthy();
  });

  it("with Trash on: moves only the groups of senders the run reports done",
    async () => {
    const onTrash = vi.fn().mockResolvedValue(97);
    const view = await start({ onTrash });
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByText(/that still needs you on its web page/)).toBeTruthy();
    press("Unsubscribe and move to Trash");
    await waitFor(() => expect(bulk).toHaveBeenCalled());
    expect(onTrash).not.toHaveBeenCalled();          // only AFTER the run
    results.mockResolvedValue({ run: 7, items: [
      item("one@chirper.example", "done", "one_click"),
      item("hello@gadget.example", "failed", "mailto",
        { error: "unsub_mail_failed" }),
      item("news@stream.example", "link", "http", { link: "https://s.example/" }),
    ] });
    view.rerender(tree({ onTrash,
      unsub: { ...idle, status: "done", seq: 7 } }));
    await waitFor(() => expect(onTrash).toHaveBeenCalledTimes(1));
    // not the failed one, not the one that needs its web page
    // and it names the addresses, so the server moves only their mails
    expect(onTrash).toHaveBeenCalledWith("sender", ["one@chirper.example"],
      ["one@chirper.example"]);
    // the number the trash path actually queued, not the preview's 120
    expect(await screen.findByText(
      "Moved their 97 mails to Trash - you can undo it.")).toBeTruthy();
  });

  it("with Trash on but nobody done, nothing is moved and it says so",
    async () => {
    const onTrash = vi.fn();
    const view = await start({ onTrash });
    fireEvent.click(screen.getByRole("switch"));
    press("Unsubscribe and move to Trash");
    await waitFor(() => expect(bulk).toHaveBeenCalled());
    results.mockResolvedValue({ run: 7, items: [
      item("news@stream.example", "link", "http", { link: "https://s.example/" }),
    ] });
    view.rerender(tree({ onTrash, unsub: { ...idle, status: "done", seq: 7 } }));
    expect(await screen.findByText(/none of these senders is done yet/))
      .toBeTruthy();
    expect(onTrash).not.toHaveBeenCalled();
  });

  it("with Trash off nothing is moved", async () => {
    const onTrash = vi.fn().mockResolvedValue(12);
    const view = await start({ onTrash });
    press("Unsubscribe 3 senders");
    await waitFor(() => expect(bulk).toHaveBeenCalled());
    results.mockResolvedValue({ run: 7, items: [
      item("one@chirper.example", "done", "one_click")] });
    view.rerender(tree({ onTrash, unsub: { ...idle, status: "done", seq: 7 } }));
    await screen.findByText("1 done");
    expect(onTrash).not.toHaveBeenCalled();
  });

  it("a trash step that was refused is reported, not hidden", async () => {
    const onTrash = vi.fn().mockResolvedValue(null);
    const view = await start({ onTrash });
    fireEvent.click(screen.getByRole("switch"));
    press("Unsubscribe and move to Trash");
    await waitFor(() => expect(bulk).toHaveBeenCalled());
    results.mockResolvedValue({ run: 7, items: [
      item("one@chirper.example", "done", "one_click")] });
    view.rerender(tree({ onTrash, unsub: { ...idle, status: "done", seq: 7 } }));
    expect(await screen.findByText("Their mails were not moved to Trash."))
      .toBeTruthy();
  });

  it("a server refusal (busy) stays on the review with the reason", async () => {
    bulk.mockRejectedValue(new Error("busy: scan running"));
    await start();
    press("Unsubscribe 3 senders");
    expect((await screen.findByRole("alert")).textContent)
      .toBe("busy: scan running");
    expect(screen.getByRole("button", { name: "Unsubscribe 3 senders" }))
      .toBeTruthy();
  });

  it("nothing queued (handled meanwhile) ends with an empty result", async () => {
    bulk.mockResolvedValue({ queued: 0, skipped_protected: 0, skipped_done: 3,
      capped: 0 });
    await start();
    press("Unsubscribe 3 senders");
    expect(await screen.findByText("Nothing was unsubscribed")).toBeTruthy();
  });

  it("hiding the sheet mid-run lets the run go on, and says Trash was skipped",
    async () => {
    const onClose = vi.fn();
    const onTrash = vi.fn();
    await start({ onClose, onTrash });
    fireEvent.click(screen.getByRole("switch"));
    press("Unsubscribe and move to Trash");
    await screen.findByText("Unsubscribing…");
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(onClose).toHaveBeenCalled();
    expect(await screen.findByText(/Their mails were not moved to Trash/))
      .toBeTruthy();
    expect(onTrash).not.toHaveBeenCalled();
  });

  // The run's end arrives while (or after) the sheet is closed: its Trash
  // step must not happen, however the sheet was closed.
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  };
  const closedBefore = (how: "hide" | "esc") => async () => {
    const onTrash = vi.fn().mockResolvedValue(5);
    const late = deferred<{ run: number; items: UnsubRunItem[] }>();
    results.mockReturnValue(late.promise);
    let view!: ReturnType<typeof render>;
    const onClose = vi.fn(() => view.unmount());
    view = render(tree({ onTrash, onClose }));
    await screen.findByText("Chirper");
    fireEvent.click(screen.getByRole("switch"));
    press("Unsubscribe and move to Trash");
    await waitFor(() => expect(bulk).toHaveBeenCalled());
    // the run ended and its results are being fetched ...
    const live = { ...idle, status: "done" as const, seq: 7 };
    view.rerender(tree({ onTrash, onClose, unsub: live }));
    await waitFor(() => expect(results).toHaveBeenCalled());
    // ... when the sheet is closed
    if (how === "hide") fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    else fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    await act(async () => {
      late.resolve({ run: 7, items: [item("one@chirper.example", "done", "one_click")] });
      await late.promise;
    });
    expect(onTrash).not.toHaveBeenCalled();
  };
  it("Hide while the results are on their way: no Trash step",
    closedBefore("hide"));
  it("Esc / Back while the results are on their way: no Trash step",
    closedBefore("esc"));

  it("closing a single unsubscribe mid-call: no Trash step either", async () => {
    const onTrash = vi.fn().mockResolvedValue(5);
    const call = deferred<unknown>();
    single.mockReturnValue(call.promise);
    preview.mockResolvedValue({ ...PREVIEW, senders: [PREVIEW.senders[0]] });
    let view!: ReturnType<typeof render>;
    const onClose = vi.fn(() => view.unmount());
    view = render(tree({ request: { kind: "single", grouping: "sender",
      key: "one@chirper.example" }, onTrash, onClose }));
    await screen.findByText("Chirper");
    fireEvent.click(screen.getByRole("switch"));
    press("Unsubscribe and move to Trash");
    fireEvent.click(await screen.findByRole("button", { name: "Hide" }));
    await act(async () => {
      call.resolve({ action: "done", method: "m", detail: "",
        addr: "one@chirper.example", via: "one_click" });
      await call.promise;
    });
    expect(onTrash).not.toHaveBeenCalled();
  });

  it("does not spin for ever when its run's state never shows up", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      results.mockResolvedValue({ run: 7, items: [
        item("one@chirper.example", "done", "one_click")] });
      const view = await start();
      press("Unsubscribe 3 senders");
      await waitFor(() => expect(bulk).toHaveBeenCalled());
      // the server was restarted: the state carries another id, idle
      view.rerender(tree({ unsub: { ...idle, status: "idle", seq: 99 } }));
      expect(screen.getByText("Unsubscribing…")).toBeTruthy();
      await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
      expect(await screen.findByText("1 done")).toBeTruthy();
    } finally { vi.useRealTimers(); }
  });

  it("... and says so when the stored results are another run's", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      results.mockResolvedValue({ run: 8, items: [] });
      const view = await start();
      press("Unsubscribe 3 senders");
      await waitFor(() => expect(bulk).toHaveBeenCalled());
      view.rerender(tree({ unsub: { ...idle, status: "idle", seq: 8 } }));
      await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
      expect((await screen.findByRole("alert")).textContent)
        .toBe("The result of this run is no longer available.");
      expect(screen.getByText("Nothing was unsubscribed")).toBeTruthy();
    } finally { vi.useRealTimers(); }
  });

  it("a run's skipped senders still show in the result (Triage)", async () => {
    results.mockResolvedValue({ run: 9, items: [
      item("one@chirper.example", "done", "one_click")] });
    const req: UnsubRequest = { kind: "run", run: 9, skipped: 3 };
    render(tree({ request: req,
      unsub: { ...idle, status: "done", seq: 9 } }));
    expect(await screen.findByText("1 done")).toBeTruthy();
    expect(screen.getByText("3 senders are left out: already handled, "
      + "protected or over the per-run limit.")).toBeTruthy();
  });

  it("hands the run over to the app while it shows it, and lets go", async () => {
    const onRun = vi.fn();
    const view = await start({ onRun });
    press("Unsubscribe 3 senders");
    await waitFor(() => expect(onRun).toHaveBeenLastCalledWith(7));
    view.unmount();
    expect(onRun).toHaveBeenLastCalledWith(null);
  });
});

describe("one sender", () => {
  const ONE: UnsubRequest = { kind: "single", grouping: "sender",
    key: "one@chirper.example" };
  const ONE_PREVIEW: UnsubPreview = { ...PREVIEW,
    senders: [PREVIEW.senders[0]],
    trash: { ...PREVIEW.trash, groups: [PREVIEW.trash.groups[0]],
      mails: 120, size: 3_000_000 } };

  beforeEach(() => { preview.mockResolvedValue(ONE_PREVIEW); });

  it("asks for the single preview and runs the single call", async () => {
    single.mockResolvedValue({ action: "done", method: "one-click POST",
      detail: "", addr: "one@chirper.example", via: "one_click" });
    const onChanged = vi.fn();
    render(tree({ request: ONE, onChanged }));
    expect(await screen.findByText("1 sender · how it works:")).toBeTruthy();
    expect(preview).toHaveBeenCalledWith("sender", ["one@chirper.example"], true);
    press("Unsubscribe 1 sender");
    expect(await screen.findByText("1 done")).toBeTruthy();
    expect(single).toHaveBeenCalledWith("sender", "one@chirper.example");
    expect(bulk).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();
  });

  it("a page to confirm is offered with Open page", async () => {
    single.mockResolvedValue({ action: "link", method: "open link",
      detail: "https://chirper.example/off", addr: "one@chirper.example",
      via: "http" });
    render(tree({ request: ONE }));
    await screen.findByText("Chirper");
    press("Unsubscribe 1 sender");
    expect(await screen.findByRole("button", { name: "Open page" })).toBeTruthy();
    expect(screen.getByText("1 needs you")).toBeTruthy();
  });

  for (const demo of [true, false]) {
    it(`Unsubscribe returning a link: Open page, demo=${demo}`, async () => {
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      single.mockResolvedValue({ action: "link", method: "open link",
        detail: "https://chirper.example/off", addr: "one@chirper.example",
        via: "http" });
      render(tree({ request: ONE, demo }));
      await screen.findByText("Chirper");
      press("Unsubscribe 1 sender");
      fireEvent.click(await screen.findByRole("button", { name: "Open page" }));
      if (demo) {
        expect(open).not.toHaveBeenCalled();
        expect(screen.getByText(
          "In your own install this opens the sender's unsubscribe page."))
          .toBeTruthy();
      } else {
        expect(open).toHaveBeenCalledWith("https://chirper.example/off",
          "_blank", "noopener");
      }
    });
  }

  it("a failure shows the reason and moves nothing to Trash", async () => {
    single.mockRejectedValue(new Error("The sender's unsubscribe page could "
      + "not be reached."));
    const onTrash = vi.fn();
    render(tree({ request: ONE, onTrash }));
    await screen.findByText("Chirper");
    fireEvent.click(screen.getByRole("switch"));
    press("Unsubscribe and move to Trash");
    expect(await screen.findByText("1 failed")).toBeTruthy();
    expect(screen.getByText(/could not be reached/)).toBeTruthy();
    expect(onTrash).not.toHaveBeenCalled();
  });

  it("with Trash on, moves that sender's group after it worked", async () => {
    single.mockResolvedValue({ action: "done", method: "one-click POST",
      detail: "", addr: "one@chirper.example", via: "one_click" });
    const onTrash = vi.fn().mockResolvedValue(12);
    render(tree({ request: ONE, onTrash }));
    await screen.findByText("Chirper");
    fireEvent.click(screen.getByRole("switch"));
    press("Unsubscribe and move to Trash");
    await waitFor(() => expect(onTrash).toHaveBeenCalledWith("sender",
      ["one@chirper.example"], ["one@chirper.example"]));
  });

  it("a refusal of the check (e.g. a pooled row) is shown", async () => {
    preview.mockRejectedValue(new Error("A combined row has no single sender "
      + "to unsubscribe from - open one of its senders."));
    render(tree({ request: ONE }));
    expect((await screen.findByRole("alert")).textContent)
      .toContain("A combined row has no single sender");
  });
});

describe("a run started elsewhere (Triage)", () => {
  it("follows it and lists the senders by their group names", async () => {
    const groups = { "one@chirper.example": { label: "Chirper" } } as
      unknown as Record<string, Group>;
    results.mockResolvedValue({ run: 9, items: [
      item("one@chirper.example", "done", "one_click"),
      item("x@other.example", "done", "mailto")] });
    const req: UnsubRequest = { kind: "run", run: 9 };
    const view = render(tree({ request: req, groups,
      unsub: { ...idle, status: "running", seq: 9, progress: "0/2" } }));
    expect(screen.getByText("Unsubscribing… 0/2")).toBeTruthy();
    expect(preview).not.toHaveBeenCalled();
    view.rerender(tree({ request: req, groups,
      unsub: { ...idle, status: "done", seq: 9 } }));
    expect(await screen.findByText("2 done")).toBeTruthy();
    expect(screen.getByText("Chirper")).toBeTruthy();
    expect(screen.getByText("x@other.example")).toBeTruthy();   // no name known
  });

  it("a run that ended with an error says so", async () => {
    results.mockResolvedValue({ run: 9, items: [] });
    const req: UnsubRequest = { kind: "run", run: 9 };
    render(tree({ request: req,
      unsub: { ...idle, status: "error", seq: 9, error: "unsub_failed" } }));
    expect((await screen.findByRole("alert")).textContent)
      .toContain("failed unexpectedly");
  });
});

describe("German", () => {
  it("words the chips and the title in German", async () => {
    setLang("de");
    render(tree());
    expect(await screen.findByText("3 Absender · so funktioniert jeder:"))
      .toBeTruthy();
    expect(screen.getByText("Ein Klick")).toBeTruthy();
    expect(screen.getByText("Sendet eine Mail")).toBeTruthy();
    expect(screen.getByText("Webseite")).toBeTruthy();
    expect(screen.getByRole("button", { name: "3 Absender abbestellen" }))
      .toBeTruthy();
  });
});

describe("outcomeTitle", () => {
  const s = (...st: ("done" | "link" | "failed")[]) =>
    st.map((status) => ({ status }));
  it("joins only the non-empty parts", () => {
    expect(outcomeTitle(s("done", "done", "link"))).toBe("2 done · 1 needs you");
    expect(outcomeTitle(s("link", "link"))).toBe("2 need you");
    expect(outcomeTitle(s("done", "failed", "failed"))).toBe("1 done · 2 failed");
    expect(outcomeTitle(s())).toBe("Nothing was unsubscribed");
  });
});

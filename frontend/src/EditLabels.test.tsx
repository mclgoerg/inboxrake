// @vitest-environment jsdom
/* "Edit labels": the user's own verdict, categories and Smart group for one
 * sender - staged until Done, Reset puts verdict + categories back to
 * automatic, a protected sender can never be set to "safe", and the pill says
 * "set by you". */

import { cleanup, fireEvent, render, screen, waitFor } from
  "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const labels = vi.fn();
const labelsPut = vi.fn();
const knowledge = vi.fn();
vi.mock("./api", () => ({ api: {
  labels: (k: string) => labels(k),
  labelsPut: (b: unknown) => labelsPut(b),
  knowledge: () => knowledge(),
} }));

import { EditLabels } from "./components/EditLabels";
import { AiTag } from "./components/ui";
import { setLang } from "./i18n";
import { popupPick } from "./toolTestUtils";
import type { Group, SenderLabels } from "./types";

const info = (over: Partial<SenderLabels> = {}): SenderLabels => ({
  key: "a@solo.example", verdict: null, tags: null,
  tags_now: ["newsletter", "shopping"], auto_tags: ["newsletter", "shopping"],
  ai: { verdict: "delete_safe", reason: "x" }, protected: false,
  suggestions: ["fashion", "loyalty"], ...over,
});
const sender = (): Group => ({
  key: "a@solo.example", label: "a", sub: "", count: 3, size: 3000, unread: 1,
  first: "2024-01-01", last: "2024-06-01", tags: [], samples: [], bulk: false,
  unsub: false, ai: null, ratings: null, protected: false, replied: false,
  att_size: 0, unsubscribed: null, new: false, pinned: 0, engagement: 50,
  smart_key: "k:other", smart_why: { r: "none" },
});

const onSaved = vi.fn();
const onClose = vi.fn();
const onFile = vi.fn();
const onReset = vi.fn();
const mount = (over: { withSender?: boolean } = {}) => render(
  <EditLabels senderKey="a@solo.example"
    sender={over.withSender ? sender() : undefined} categories={["hobby"]}
    onFile={onFile} onReset={onReset} onSaved={onSaved} onClose={onClose} />);
const radio = (name: string) => screen.getByRole("radio", { name });
const ready = () => screen.findByRole("radio", { name: "Safe to delete" });
const done = () => screen.getByRole("button", { name: "Done" });

beforeEach(() => {
  setLang("en");
  labels.mockReset().mockResolvedValue(info());
  labelsPut.mockReset().mockResolvedValue(info());
  knowledge.mockReset().mockResolvedValue({ entries: [], complete: true,
    unscanned: [], categories: [], max: 5000, ai_running: false });
  onSaved.mockReset();
  onClose.mockReset();
  onFile.mockReset().mockResolvedValue(true);
  onReset.mockReset().mockResolvedValue(true);
});
afterEach(cleanup);

describe("the sheet", () => {
  it("is portaled to <body>, not rendered inside the pane it was opened from",
    async () => {
      const { container } = mount();
      await ready();
      expect(container.querySelector('[role="dialog"]')).toBeNull();
      expect(document.body.querySelector(':scope > div [role="dialog"]'))
        .toBeTruthy();
    });

  it("shows the verdict (none picked while automatic), what the AI said, the "
    + "categories and suggestions", async () => {
    mount();
    await ready();
    for (const n of ["Safe to delete", "Review", "Keep"]) {
      expect(radio(n).getAttribute("aria-checked")).toBe("false");
    }
    expect(screen.getByText(/Automatic\./)).toBeTruthy();
    expect(screen.getByText("newsletter")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove shopping" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add fashion" })).toBeTruthy();
  });

  it("says the user's choice wins once one is picked, and names the AI's "
    + "answer", async () => {
    mount();
    await ready();
    fireEvent.click(radio("Keep"));
    expect(radio("Keep").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/your choice wins and survives rescans/))
      .toBeTruthy();
    expect(screen.getByText("The AI said", { exact: false })).toBeTruthy();
  });

  it("stages everything until Done: Cancel saves nothing", async () => {
    mount();
    await ready();
    fireEvent.click(radio("Keep"));
    fireEvent.click(screen.getByRole("button", { name: "Remove shopping" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
    expect(labelsPut).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("Done saves only what changed, in one request, then reloads", async () => {
    mount();
    await ready();
    fireEvent.click(radio("Keep"));
    fireEvent.click(done());
    await waitFor(() => expect(labelsPut).toHaveBeenCalledWith({
      key: "a@solo.example", verdict: "keep" }));
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("adds a category by typing (lowercase, no duplicate) and by suggestion",
    async () => {
      mount();
      await ready();
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
      const input = screen.getByRole("textbox", { name: "Add a category" });
      fireEvent.change(input, { target: { value: "  Loyalty Club " } });
      fireEvent.submit(input.closest("form")!);
      fireEvent.click(screen.getByRole("button", { name: "Add fashion" }));
      fireEvent.click(done());
      await waitFor(() => expect(labelsPut).toHaveBeenCalledWith({
        key: "a@solo.example",
        tags: ["newsletter", "shopping", "loyalty club", "fashion"] }));
    });

  it("Esc in the add field closes the field, not the sheet", async () => {
    mount();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const input = screen.getByRole("textbox", { name: "Add a category" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("going back to the automatic categories stores no override (null)",
    async () => {
      labels.mockResolvedValue(info({ tags: ["x"], tags_now: ["x"] }));
      mount();
      await ready();
      fireEvent.click(screen.getByRole("button", { name: "Remove x" }));
      for (const n of ["newsletter", "shopping"]) {
        fireEvent.click(screen.getByRole("button", { name: "Add" }));
        const input = screen.getByRole("textbox", { name: "Add a category" });
        fireEvent.change(input, { target: { value: n } });
        fireEvent.submit(input.closest("form")!);
      }
      fireEvent.click(done());
      await waitFor(() => expect(labelsPut).toHaveBeenCalledWith({
        key: "a@solo.example", tags: null }));
    });

  it("Reset to automatic puts verdict and categories back and sends null",
    async () => {
      labels.mockResolvedValue(info({ verdict: "keep", tags: ["x"],
        tags_now: ["x"] }));
      mount();
      await ready();
      expect(radio("Keep").getAttribute("aria-checked")).toBe("true");
      fireEvent.click(screen.getByRole("button", { name: "Reset to automatic" }));
      expect(radio("Keep").getAttribute("aria-checked")).toBe("false");
      expect(screen.getByText("shopping")).toBeTruthy();
      fireEvent.click(done());
      await waitFor(() => expect(labelsPut).toHaveBeenCalledWith({
        key: "a@solo.example", verdict: null, tags: null }));
    });

  it("Reset is off while everything is automatic", async () => {
    mount();
    await ready();
    expect((screen.getByRole("button", { name: "Reset to automatic" }) as
      HTMLButtonElement).disabled).toBe(true);
  });

  it("a protected sender cannot be set to safe to delete", async () => {
    labels.mockResolvedValue(info({ protected: true }));
    mount();
    await ready();
    expect((radio("Safe to delete") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Protected senders are never safe to delete."))
      .toBeTruthy();
    expect((radio("Keep") as HTMLButtonElement).disabled).toBe(false);
  });

  it("Done with nothing changed just closes", async () => {
    mount();
    await ready();
    fireEvent.click(done());
    expect(onClose).toHaveBeenCalled();
    expect(labelsPut).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("a refused save keeps the sheet open and says why", async () => {
    labelsPut.mockRejectedValue(new Error("That verdict is not available."));
    mount();
    await ready();
    fireEvent.click(radio("Review"));
    fireEvent.click(done());
    expect((await screen.findByRole("alert")).textContent)
      .toContain("That verdict is not available.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("says so when the labels cannot be loaded", async () => {
    labels.mockRejectedValue(new Error("x"));
    mount();
    expect((await screen.findByRole("alert")).textContent)
      .toContain("could not be loaded");
  });
});

describe("the Smart group row (the existing sender filing)", () => {
  it("is not offered without a sender record", async () => {
    mount();
    await ready();
    expect(screen.queryByText("Smart group")).toBeNull();
  });

  it("files the sender through the knowledge handlers on Done", async () => {
    mount({ withSender: true });
    await screen.findByText("Smart group");
    popupPick(screen.getByRole("button", { name: /^Filed under/ }),
      "Support & inquiries");
    expect(onFile).not.toHaveBeenCalled();                 // staged
    fireEvent.click(done());
    await waitFor(() => expect(onFile).toHaveBeenCalledWith(
      [{ key: "a:a@solo.example", kind: "support" }], 1));
    expect(labelsPut).not.toHaveBeenCalled();              // labels untouched
    expect(onSaved).toHaveBeenCalled();
  });

  it("Automatic removes the sender's own entry", async () => {
    knowledge.mockResolvedValue({ entries: [{ key: "a:a@solo.example",
      kind: "orders", src: "user", ts: 1, note: "", status: "active",
      reason: "", senders: 1, filed: 1, mails: 1, rows: ["k:orders"] }], complete: true,
    unscanned: [], categories: [], max: 5000, ai_running: false });
    mount({ withSender: true });
    await screen.findByText("Smart group");
    await waitFor(() => expect(screen.getByRole("button",
      { name: /^Filed under/ }).textContent).toContain("Orders"));
    popupPick(screen.getByRole("button", { name: /^Filed under/ }), "Automatic");
    fireEvent.click(done());
    await waitFor(() => expect(onReset).toHaveBeenCalledWith(
      ["a:a@solo.example"]));
  });
});

describe("the pill", () => {
  it("reads '<verdict> · set by you' for a verdict the user set", () => {
    render(<AiTag ai={{ verdict: "keep", reason: "", src: "user" }} />);
    expect(screen.getByText("Keep · set by you")).toBeTruthy();
  });

  it("stays the plain verdict for the AI's", () => {
    render(<AiTag ai={{ verdict: "delete_safe", reason: "r" }} />);
    expect(screen.getByText("Safe to delete")).toBeTruthy();
    expect(screen.queryByText(/set by you/)).toBeNull();
  });

  it("is told apart in German too", () => {
    setLang("de");
    render(<AiTag ai={{ verdict: "review", reason: "", src: "user" }} />);
    expect(screen.getByText("Prüfen · von dir gesetzt")).toBeTruthy();
  });
});

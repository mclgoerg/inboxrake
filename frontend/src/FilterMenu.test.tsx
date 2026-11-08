// @vitest-environment jsdom
/* Filter menu (desktop) and sheet (phone) of the Senders toolbar: rows with
 * counts, tap = apply / tap again = clear, saved-filter actions, the active
 * token inside the search field. */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { activeFilter, activeFilterLabel, FilterField, FilterMenu, FilterToken }
  from "./components/FilterMenu";
import { SelectMatches } from "./components/SelectMatches";
import type { FilterPreset } from "./types";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const quick = (k: string) => ({ aisafe: "ai:safe", older6: "age:>6m",
  older12: "age:>1y", older24: "age:>2y", unsub_pending: "is:unsub",
  new: "is:new", still: "is:still-mailing" } as Record<string, string>)[k]
  ?? "";
const saved: FilterPreset[] = [
  { id: "p1", name: "Old news", query: "from:news.example age:>1y",
    account: "a" }];
const matchCount = (q: string) => q.length;   // distinct, deterministic

const stubPhone = () => vi.stubGlobal("matchMedia", (q: string) => ({
  matches: q.includes("48rem"), addEventListener: () => {},
  removeEventListener: () => {},
}));

const setup = (over: Partial<Parameters<typeof FilterMenu>[0]> = {}) => {
  const p = { onQuick: vi.fn(), onApply: vi.fn(), onEdit: vi.fn(),
    onDelete: vi.fn(), onSave: vi.fn(), onClear: vi.fn(), onBuild: vi.fn(),
    run: vi.fn() };
  render(<FilterMenu filter="" quick={quick} newCount={0} stillCount={0}
    presets={saved} matchCount={matchCount} onQuick={p.onQuick}
    onApply={p.onApply} onEdit={p.onEdit} onDelete={p.onDelete}
    onSave={p.onSave} onClear={p.onClear} onBuild={p.onBuild}
    onAi={{ run: p.run }} {...over} />);
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  return p;
};

test("quick filters, the Inactive rows and saved filters call back", () => {
  const p = setup();
  fireEvent.click(screen.getByRole("menuitemradio", { name: /^AI-safe groups/ }));
  expect(p.onQuick).toHaveBeenLastCalledWith("aisafe");
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: /^1\+ year/ }));
  expect(p.onQuick).toHaveBeenLastCalledWith("older12");
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: /^Old news/ }));
  expect(p.onApply).toHaveBeenCalledWith(saved[0]);
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Edit: Old news" }));
  expect(p.onEdit).toHaveBeenCalledWith(saved[0]);
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete: Old news" }));
  expect(p.onDelete).toHaveBeenCalledWith(saved[0]);
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /^Build a filter/ }));
  expect(p.onBuild).toHaveBeenCalled();
});

test("Inactive for is its own group of three rows, each with its count", () => {
  setup();
  const g = screen.getByRole("group", { name: "Inactive for" });
  const rows = within(g).getAllByRole("menuitemradio");
  expect(rows.map((r) => r.textContent)).toEqual([
    `6+ months${"age:>6m".length}`, `1+ year${"age:>1y".length}`,
    `2+ years${"age:>2y".length}`]);
  // no mini segment any more
  expect(screen.queryByRole("button", { name: "6 mo" })).toBeNull();
});

test("Still mailing / New senders appear only with senders; exactly the "
  + "active row is checked", () => {
  setup();
  expect(screen.queryByRole("menuitemradio", { name: /^New senders/ }))
    .toBeNull();
  cleanup();
  setup({ newCount: 3, stillCount: 2, filter: "is:new" });
  expect(screen.getByRole("menuitemradio", { name: /^New senders/ })
    .getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("menuitemradio", { name: /^Still mailing/ })
    .getAttribute("aria-checked")).toBe("false");
  expect(screen.getAllByRole("menuitemradio")
    .filter((r) => r.getAttribute("aria-checked") === "true")).toHaveLength(1);
});

test("Save current filter is disabled without a filter; the AI entry is "
  + "absent, off or live as given", () => {
  setup({ onAi: undefined });
  expect((screen.getByRole("menuitem", { name: /^Save current filter/ }) as
    HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("menuitem", { name: /Describe a filter/ }))
    .toBeNull();
  cleanup();
  setup({ onAi: { disabled: true, hint: "Not in the demo", run: vi.fn() } });
  expect((screen.getByRole("menuitem", { name: /Describe a filter/ }) as
    HTMLButtonElement).disabled).toBe(true);
});

test("an applied filter turns the trigger into a dot-marked tinted button",
  () => {
    setup();
    expect(screen.queryByTestId("filter-dot")).toBeNull();
    cleanup();
    setup({ filter: "from:x.example" });
    expect(screen.getByTestId("filter-dot")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filter" }).className)
      .toContain("bg-accent-tint");
    fireEvent.click(screen.getByRole("menuitem",
      { name: /^Save current filter/ }));
  });

test("the active row is the one the filter equals, in menu order", () => {
  const counts = { new: 2, still: 0 };
  const key = (f: string) => activeFilter(f, saved, quick, counts)?.key ?? null;
  expect(key("")).toBeNull();
  expect(key("ai:safe")).toBe("aisafe");
  expect(key("age:>1y")).toBe("older12");
  expect(key("is:new")).toBe("new");
  expect(key("is:still-mailing")).toBeNull();      // none -> no row
  expect(key("from:news.example age:>1y")).toBe("saved:p1");
  expect(key("from:typed.example")).toBeNull();
});

test("the token label names a quick or saved filter, not a typed one", () => {
  const counts = { new: 2, still: 0 };
  const label = (f: string) => activeFilterLabel(f, saved, quick, counts);
  expect(label("")).toBeNull();
  expect(label("ai:safe")).toBe("AI-safe groups");
  expect(label("age:>6m")).toBe("Inactive 6+ months");
  expect(label("is:new")).toBe("New senders");
  expect(label("is:still-mailing")).toBeNull();
  expect(label("from:news.example age:>1y")).toBe("Old news");
  expect(label("from:typed.example")).toBeNull();
});

test("a saved filter row shows its check and keeps a long name to one line",
  () => {
    const long: FilterPreset = { id: "p2", account: "a",
      name: "Newsletters I stopped reading", query: "from:long.example" };
    setup({ presets: [long], filter: "from:long.example" });
    const row = screen.getByRole("menuitemradio",
      { name: /^Newsletters I stopped reading/ });
    expect(row.getAttribute("aria-checked")).toBe("true");
    expect(row.querySelector("svg.lucide-check")).toBeTruthy();   // visible
    expect(row.querySelector(".truncate")).toBeTruthy();
  });

test("saved-filter edit / delete show on row hover AND keyboard focus", () => {
  setup();
  const edit = screen.getByRole("menuitem", { name: "Edit: Old news" });
  const cls = edit.parentElement!.className;
  expect(cls).toContain("group-hover/frow:opacity-100");
  expect(cls).toContain("group-focus-within/frow:opacity-100");
});

test("phone: the Filter button opens a sheet (Reset - Filter - Done) that "
  + "applies live and stays open", () => {
  stubPhone();
  const p = setup({ filter: "ai:safe", newCount: 1 });
  const sheet = screen.getByRole("dialog", { name: "Filter" });
  fireEvent.click(within(sheet).getByRole("button", { name: /^1\+ year/ }));
  expect(p.onQuick).toHaveBeenCalledWith("older12");
  expect(screen.getByRole("dialog", { name: "Filter" })).toBeTruthy();
  const ai = within(sheet).getByRole("button", { name: /^AI-safe groups/ });
  expect(ai.getAttribute("aria-pressed")).toBe("true");
  expect(within(sheet).getByText("No mail from the sender for that long."))
    .toBeTruthy();
  fireEvent.click(within(sheet).getByRole("button", { name: "Reset" }));
  expect(p.onClear).toHaveBeenCalled();
  fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("phone: Reset is disabled without a filter; saved rows get a ... menu; "
  + "Build / Edit close the sheet first", () => {
  stubPhone();
  const p = setup();
  const sheet = screen.getByRole("dialog", { name: "Filter" });
  expect((within(sheet).getByRole("button", { name: "Reset" }) as
    HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(within(sheet).getByRole("button",
    { name: "More for “Old news”" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
  expect(p.onEdit).toHaveBeenCalledWith(saved[0]);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  fireEvent.click(screen.getByRole("button", { name: /^Build a filter/ }));
  expect(p.onBuild).toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("phone: an applied filter tints the Filter icon and adds the dot", () => {
  stubPhone();
  render(<FilterMenu filter="ai:safe" quick={quick} newCount={0}
    stillCount={0} presets={[]} matchCount={matchCount} onQuick={() => {}}
    onApply={() => {}} onEdit={() => {}} onDelete={() => {}} onSave={() => {}}
    onClear={() => {}} onBuild={() => {}} />);
  const b = screen.getByRole("button", { name: "Filter" });
  expect(screen.getByTestId("filter-circle").className)
    .toContain("bg-accent-tint");
  expect(b.className).toContain("coarse:size-11");   // 44 px hit area
  expect(screen.getByTestId("filter-dot")).toBeTruthy();
});

test("FilterToken: the name edits, the labelled x removes", () => {
  const onRemove = vi.fn();
  const onEdit = vi.fn();
  render(<FilterToken label="Old news" onRemove={onRemove} onEdit={onEdit} />);
  fireEvent.click(screen.getByRole("button",
    { name: "Remove filter “Old news”" }));
  expect(onRemove).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",
    { name: "Edit the filter text: Old news" }));
  expect(onEdit).toHaveBeenCalled();
});

const field = (value: string, token: string | null, onChange = vi.fn()) => {
  const ref = createRef<HTMLInputElement>();
  render(<FilterField value={value} onChange={onChange} token={token}
    inputRef={ref} builder={<button>build</button>} />);
  return { ref, onChange };
};

test("the field shows the token instead of the DSL text; tapping it brings "
  + "the text back with the caret at the end", () => {
  const { ref } = field("age:>6m", "Inactive 6+ months");
  expect(screen.getByTestId("filter-token").textContent)
    .toContain("Inactive 6+ months");
  expect(ref.current!.className).toContain("sr-only");
  expect(screen.queryByLabelText("Clear filter")).toBeNull();
  fireEvent.click(screen.getByRole("button",
    { name: "Edit the filter text: Inactive 6+ months" }));
  expect(document.activeElement).toBe(ref.current);
  expect(ref.current!.className).not.toContain("sr-only");
  expect(ref.current!.selectionStart).toBe("age:>6m".length);
  expect(screen.getByDisplayValue("age:>6m")).toBeTruthy();
  fireEvent.blur(ref.current!);                    // leaving puts it back
  expect(ref.current!.className).toContain("sr-only");
});

test("a typed filter shows as text with a clear button", () => {
  const { onChange } = field("from:typed.example", null);
  expect(screen.queryByTestId("filter-token")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
  expect(onChange).toHaveBeenCalledWith("");
});

test("SelectMatches: select, then 'All N matches selected' with Clear", () => {
  const onSelect = vi.fn();
  const onClear = vi.fn();
  const { rerender } = render(<SelectMatches n={14} skipped={1}
    allSelected={false} onSelect={onSelect} onClear={onClear} />);
  expect(screen.getByText("1 protected stays unselected")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Select all 14 matches/ }));
  expect(onSelect).toHaveBeenCalled();
  rerender(<SelectMatches n={14} skipped={0} allSelected
    onSelect={onSelect} onClear={onClear} />);
  expect(screen.getByText("All 14 matches selected")).toBeTruthy();
  expect(screen.queryByText(/protected/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(onClear).toHaveBeenCalled();
});

test("phone: the last saved filter's ... menu is not clipped, so Delete is "
  + "reachable and works", () => {
  stubPhone();
  const p = setup();
  const sheet = screen.getByRole("dialog", { name: "Filter" });
  const more = within(sheet).getByRole("button", { name: "More for “Old news”" });
  fireEvent.click(more);
  const del = screen.getByRole("menuitem", { name: "Delete" });
  // no ancestor up to the sheet clips overflow (the menu opens upwards)
  for (let el: HTMLElement | null = del; el && el !== sheet; el = el.parentElement)
    expect(el.className).not.toContain("overflow-clip");
  expect(del.closest("[role=menu]")!.className).toContain("bottom-full");
  fireEvent.click(del);
  expect(p.onDelete).toHaveBeenCalledWith(saved[0]);
});

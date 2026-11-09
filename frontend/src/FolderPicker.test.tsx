// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildFolderTree, FolderPicker, loadRecent, rememberRecent,
  searchFolders } from "./components/FolderPicker";
import { ToastProvider } from "./components/ui";
import { findPicker } from "./folderPickerTestUtil";

const folders = vi.fn();
const createRule = vi.fn();
vi.mock("./api", () => ({
  api: {
    folders: (...a: unknown[]) => folders(...a),
    createRule: (...a: unknown[]) => createRule(...a),
  },
}));

const RAW = ["INBOX", "Archive", "Finance", "Finance/Taxes", "Orders"];
const INFO = {
  special: [{ role: "archive", raw: "Archive", name: "Archive" }],
  folders: RAW.map((raw) => ({ raw, name: raw, delim: "/", role: null,
    excluded: false })),
  wildcards: [],
  mail_counts: { INBOX: 412, Archive: 1021, Finance: 96, "Finance/Taxes": 12,
    Orders: 210 },
};

beforeEach(() => {
  localStorage.clear();
  folders.mockResolvedValue(INFO);
  createRule.mockResolvedValue({});
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("buildFolderTree", () => {
  it("nests children under their parent by the folder's delimiter", () => {
    const tree = buildFolderTree(
      ["INBOX", "Finance/Taxes", "Finance", "Orders"],
      [], { "Finance/Taxes": "/", Finance: "/" }, { Finance: 3 });
    expect(tree.map((n) => [n.path, n.depth, n.raw])).toEqual([
      ["INBOX", 0, "INBOX"],
      ["Finance", 0, "Finance"],
      ["Finance / Taxes", 1, "Finance/Taxes"],
      ["Orders", 0, "Orders"],
    ]);
    expect(tree[1].count).toBe(3);
  });

  it("a parent the server does not offer is a heading, not a target", () => {
    const tree = buildFolderTree(["[Mail]/Sent"], ["[Mail]/Sent"],
      { "[Mail]/Sent": "/" });
    expect(tree.map((n) => [n.name, n.raw])).toEqual([
      ["[Mail]", null], ["Sent", "[Mail]/Sent"]]);
  });

  it("uses the readable names, and a flat list without a delimiter", () => {
    const tree = buildFolderTree(["a&AOQ-b"], ["aäb"]);
    expect(tree).toEqual([{ raw: "a&AOQ-b", name: "aäb", path: "aäb",
      depth: 0, count: undefined }]);
  });
});

describe("searchFolders", () => {
  const tree = buildFolderTree(RAW, [], { "Finance/Taxes": "/" });
  it("matches the full path, case-insensitively, targets only", () => {
    expect(searchFolders(tree, "tax").map((n) => n.raw))
      .toEqual(["Finance/Taxes"]);
    expect(searchFolders(tree, "FIN").map((n) => n.raw))
      .toEqual(["Finance", "Finance/Taxes"]);
  });
});

describe("recent folders", () => {
  it("keeps the newest first, de-duplicated, per account", () => {
    rememberRecent("a", "X");
    rememberRecent("a", "Y");
    rememberRecent("a", "X");
    rememberRecent("b", "Z");
    expect(loadRecent("a").map((r) => r.raw)).toEqual(["X", "Y"]);
    expect(loadRecent("b").map((r) => r.raw)).toEqual(["Z"]);
  });
  it("survives garbage in storage", () => {
    localStorage.setItem("pmc_move_recent:a", "{nope");
    expect(loadRecent("a")).toEqual([]);
  });
});

const mount = (over: Partial<Parameters<typeof FolderPicker>[0]> = {}) => {
  const onPick = vi.fn().mockResolvedValue(true);
  const onClose = vi.fn();
  render(<ToastProvider><FolderPicker count={88} folders={RAW} account="acc"
    onPick={onPick} onClose={onClose} {...over} /></ToastProvider>);
  return { onPick, onClose };
};
const row = (dlg: HTMLElement, name: string) => {
  const rows = within(dlg).getAllByRole("button", {
    name: new RegExp(`^${name}[\\d,]*$`) });
  return rows[rows.length - 1];
};

describe("FolderPicker", () => {
  it("is titled with the count and lists exactly the offered folders, "
    + "with counts and the tree", async () => {
    mount();
    const dlg = await findPicker();
    expect(within(dlg).getByRole("heading", { name: "Move 88 mails" }))
      .toBeTruthy();
    await waitFor(() => expect(within(dlg).getAllByText("1,021")).toHaveLength(2));
    // Archive shows up twice (Suggested + All), the rest once
    expect(within(dlg).getAllByText("210")).toHaveLength(1);
    expect(within(dlg).getByText("Taxes")).toBeTruthy();
    expect(within(dlg).queryByText("Drafts")).toBeNull();
  });

  it("singular title", async () => {
    mount({ count: 1 });
    expect(await findPicker()).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Move 1 mail" })).toBeTruthy();
  });

  it("suggests the Archive role folder and the recently used ones", async () => {
    rememberRecent("acc", "Orders");
    rememberRecent("acc", "Gone");      // not offered any more: skipped
    mount();
    const dlg = await findPicker();
    await within(dlg).findByText("where you archive");
    expect(within(dlg).getByText(/^used .* ago$/)).toBeTruthy();
    expect(within(dlg).queryByText("Gone")).toBeNull();
  });

  it("Move stays disabled until a folder is picked, then moves and "
    + "remembers it", async () => {
    const { onPick, onClose } = mount();
    const dlg = await findPicker();
    const move = within(dlg).getByRole("button", { name: "Move" });
    expect((move as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(row(dlg, "Orders"));
    expect(row(dlg, "Orders").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(move);
    expect(onPick).toHaveBeenCalledWith("Orders");
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(loadRecent("acc")[0].raw).toBe("Orders"));
  });

  it("does not remember the folder when the move was declined", async () => {
    const { onPick } = mount({
      onPick: vi.fn().mockResolvedValue(false) as any });
    const dlg = await findPicker();
    fireEvent.click(row(dlg, "Orders"));
    fireEvent.click(within(dlg).getByRole("button", { name: "Move" }));
    await new Promise((r) => setTimeout(r, 10));
    expect(loadRecent("acc")).toEqual([]);
    void onPick;
  });

  it("search filters to matching folders with their full path", async () => {
    const { onPick } = mount();
    const dlg = await findPicker();
    fireEvent.change(within(dlg).getByRole("textbox", { name: "Find a folder" }),
      { target: { value: "tax" } });
    expect(within(dlg).getByText("Finance / Taxes")).toBeTruthy();
    expect(within(dlg).queryByText("Orders")).toBeNull();
    expect(within(dlg).queryByText("Suggested")).toBeNull();
    fireEvent.change(within(dlg).getByRole("textbox", { name: "Find a folder" }),
      { target: { value: "zzz" } });
    expect(within(dlg).getByText("No folder matches.")).toBeTruthy();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("Cancel closes without moving", async () => {
    const { onPick, onClose } = mount();
    const dlg = await findPicker();
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("works without /api/folders (flat list, no counts)", async () => {
    folders.mockRejectedValue(new Error("offline"));
    const { onPick } = mount();
    const dlg = await findPicker();
    fireEvent.click(row(dlg, "Finance/Taxes"));
    fireEvent.click(within(dlg).getByRole("button", { name: "Move" }));
    expect(onPick).toHaveBeenCalledWith("Finance/Taxes");
  });

  describe("move rule", () => {
    const rule = { kind: "sender" as const, value: "news@x.example",
      label: "News" };

    it("is only offered with a rule target", async () => {
      mount();
      await findPicker();
      expect(screen.queryByRole("switch")).toBeNull();
    });

    it("creates a never-armed move rule after the move went through, "
      + "and the toast links to Rules", async () => {
      const onOpenRules = vi.fn();
      mount({ rule, onOpenRules });
      const dlg = await findPicker();
      fireEvent.click(within(dlg).getByRole("switch",
        { name: /Always move new mail from News here/ }));
      fireEvent.click(row(dlg, "Orders"));
      fireEvent.click(within(dlg).getByRole("button", { name: "Move" }));
      await waitFor(() => expect(createRule).toHaveBeenCalledTimes(1));
      expect(createRule).toHaveBeenCalledWith({
        name: "Move News to Orders", scope: "mail", grouping: "sender",
        query: "from:news@x.example", action: "move", dest: "Orders",
        schedule: "manual", account: "acc" });
      // no `mode`: the backend always starts a new rule in report mode
      expect(createRule.mock.calls[0][0]).not.toHaveProperty("mode");
      fireEvent.click(await screen.findByRole("button", { name: "Rules" }));
      expect(onOpenRules).toHaveBeenCalled();
    });

    it("uses domain: for a domain row", async () => {
      mount({ rule: { kind: "domain", value: "x.example", label: "x.example" } });
      const dlg = await findPicker();
      fireEvent.click(within(dlg).getByRole("switch"));
      fireEvent.click(row(dlg, "Orders"));
      fireEvent.click(within(dlg).getByRole("button", { name: "Move" }));
      await waitFor(() => expect(createRule).toHaveBeenCalled());
      expect(createRule.mock.calls[0][0]).toMatchObject({
        grouping: "domain", query: "domain:x.example" });
    });

    it("creates nothing when the switch is off or the move was declined",
      async () => {
      const a = mount({ rule });
      let dlg = await findPicker();
      fireEvent.click(row(dlg, "Orders"));
      fireEvent.click(within(dlg).getByRole("button", { name: "Move" }));
      await waitFor(() => expect(a.onPick).toHaveBeenCalled());
      cleanup();
      const b = mount({ rule });
      b.onPick.mockResolvedValue(false);
      dlg = await findPicker();
      fireEvent.click(within(dlg).getByRole("switch"));
      fireEvent.click(row(dlg, "Orders"));
      fireEvent.click(within(dlg).getByRole("button", { name: "Move" }));
      await waitFor(() => expect(b.onPick).toHaveBeenCalled());
      await Promise.resolve();
      expect(createRule).not.toHaveBeenCalled();
    });

    it("says so when the rule could not be created", async () => {
      createRule.mockRejectedValue(new Error("nope"));
      mount({ rule });
      const dlg = await findPicker();
      fireEvent.click(within(dlg).getByRole("switch"));
      fireEvent.click(row(dlg, "Orders"));
      fireEvent.click(within(dlg).getByRole("button", { name: "Move" }));
      expect(await screen.findByText(/rule was not created: nope/)).toBeTruthy();
    });
  });

  describe("wide screens: a popover", () => {
    beforeEach(() => {
      vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true,
        addEventListener() {}, removeEventListener() {} }));
    });
    it("has the same content, Esc closes it and a click outside too",
      async () => {
      const { onClose, onPick } = mount();
      const dlg = await findPicker();
      expect(within(dlg).getByRole("textbox", { name: "Find a folder" }))
        .toBeTruthy();
      fireEvent.click(row(dlg, "Orders"));
      fireEvent.click(within(dlg).getByRole("button", { name: "Move" }));
      expect(onPick).toHaveBeenCalledWith("Orders");
      onClose.mockClear();
      cleanup();
      const m = mount();
      const d2 = await findPicker();
      fireEvent.keyDown(within(d2).getByRole("textbox"), { key: "Escape" });
      expect(m.onClose).toHaveBeenCalledTimes(1);
      m.onClose.mockClear();
      fireEvent.mouseDown(document.body);
      expect(m.onClose).toHaveBeenCalledTimes(1);
    });
    it("an outside press does not also activate what it hit", async () => {
      const hit = vi.fn();
      render(<button onClick={hit}>behind</button>);
      mount();
      await findPicker();
      const b = screen.getByText("behind");
      fireEvent.mouseDown(b);
      fireEvent.click(b);
      expect(hit).not.toHaveBeenCalled();
    });
    it("keys typed in it never reach the app's list shortcuts behind it",
      async () => {
      const behind = vi.fn();
      window.addEventListener("keydown", behind);
      try {
        mount();
        const dlg = await findPicker();
        const firstRow = dlg.querySelector<HTMLElement>("[data-folder-row]")!;
        firstRow.focus();
        for (const key of ["x", "#", "Enter", "j"]) {
          fireEvent.keyDown(firstRow, { key });
        }
        expect(behind).not.toHaveBeenCalled();
      } finally { window.removeEventListener("keydown", behind); }
    });
    it("Tab wraps inside the popover", async () => {
      mount();
      const dlg = await findPicker();
      const input = within(dlg).getByRole("textbox");
      input.focus();
      fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
      // from the first stop backwards: to the last one (the rule-less end)
      const stops = [...dlg.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input")];
      expect(document.activeElement).toBe(stops[stops.length - 1]);
    });
  });
});

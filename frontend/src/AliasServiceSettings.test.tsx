// @vitest-environment jsdom
/* Settings > Alias service: the service choice, the key as a secret
 * ("•••• set · Change…", never prefilled), the connection row with its result
 * or coded error, disconnect with its confirm, and German. */

import { cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AliasServiceSection } from "./components/AliasServiceSettings";
import { DialogProvider } from "./components/ui";
import { expectNoDialog, findDialog, pressDialog } from "./dialogTestUtils";
import { setLang } from "./i18n";
import type { AliasServiceStatus } from "./types";

const aliasService = vi.fn();
const put = vi.fn();
const refresh = vi.fn();
const disconnect = vi.fn();

vi.mock("./api", () => ({
  api: {
    aliasService: () => aliasService(),
    aliasServicePut: (...a: unknown[]) => put(...a),
    aliasServiceRefresh: () => refresh(),
    aliasServiceDisconnect: () => disconnect(),
  },
  errorText: (c: string) => `worded:${c}`,
}));

const st = (over: Partial<AliasServiceStatus> = {}): AliasServiceStatus => ({
  service: "simplelogin", key_set: true, aliases: 142, synced_ts: 1,
  error: "", services: ["simplelogin", "addy"], ...over });
const show = () => render(<DialogProvider><AliasServiceSection /></DialogProvider>);
const rx = (t: string) => new RegExp(t.replace(/ /g, "\\s"));

beforeEach(() => setLang("en"));
afterEach(() => {
  cleanup();
  for (const m of [aliasService, put, refresh, disconnect]) m.mockReset();
  setLang("en");
});

test("connected: service, key as a secret, and the number of aliases", async () => {
  aliasService.mockResolvedValue(st());
  show();
  expect(await screen.findByText(rx("142 aliases found"))).toBeTruthy();
  expect(screen.getByRole("radio", { name: "SimpleLogin" })
    .getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("radio", { name: "addy.io" })
    .getAttribute("aria-checked")).toBe("false");
  // the key is never shown or prefilled: a "set" row with Change…
  expect(screen.getByText("•••• set")).toBeTruthy();
  expect(document.querySelector("input")).toBeNull();
  expect(screen.getByText(/Without it Inboxrake still finds leaks/)).toBeTruthy();
});

test("Change… reveals an empty field; Connect sends the key and the service",
  async () => {
    aliasService.mockResolvedValue(st());
    put.mockResolvedValue(st({ aliases: 3 }));
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Change…" }));
    const field = screen.getByLabelText("API key") as HTMLInputElement;
    expect(field.value).toBe("");
    expect(field.type).toBe("password");
    fireEvent.change(field, { target: { value: "  new-key-123 " } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(put).toHaveBeenCalledWith("simplelogin",
      "new-key-123"));
    expect(await screen.findByText(rx("3 aliases found"))).toBeTruthy();
    expect(document.querySelector("input")).toBeNull();
  });

test("nothing is connected: pick a service first, then the key", async () => {
  aliasService.mockResolvedValue(st({ service: "", key_set: false,
    aliases: null, synced_ts: 0 }));
  put.mockResolvedValueOnce(st({ service: "addy", key_set: false,
    aliases: null, synced_ts: 0 }));
  show();
  expect(await screen.findByText("Not connected")).toBeTruthy();
  const key = screen.getByLabelText("API key") as HTMLInputElement;
  expect(key.disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement)
    .disabled).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: "addy.io" }));
  await waitFor(() => expect(put).toHaveBeenCalledWith("addy"));
  await waitFor(() => expect((screen.getByLabelText("API key") as
    HTMLInputElement).disabled).toBe(false));
});

test("a refused key shows its coded error in the Connection row", async () => {
  aliasService.mockResolvedValue(st({ error: "alias_key", aliases: null }));
  show();
  expect(await screen.findByText("worded:alias_key")).toBeTruthy();
  refresh.mockResolvedValue(st());
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  expect(await screen.findByText(rx("142 aliases found"))).toBeTruthy();
});

test("Disconnect asks first and forgets the key", async () => {
  aliasService.mockResolvedValue(st());
  disconnect.mockResolvedValue(undefined);
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
  const dlg = await findDialog();
  expect(within(dlg).getByText("Disconnect the alias service?")).toBeTruthy();
  fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
  await expectNoDialog();
  expect(disconnect).not.toHaveBeenCalled();
  aliasService.mockResolvedValue(st({ service: "", key_set: false,
    aliases: null, synced_ts: 0 }));
  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
  await pressDialog("Disconnect");
  await waitFor(() => expect(disconnect).toHaveBeenCalledOnce());
  expect(await screen.findByText("Not connected")).toBeTruthy();
});

test("a failed load shows the error", async () => {
  aliasService.mockRejectedValue(new Error("offline"));
  show();
  expect(await screen.findByText("offline")).toBeTruthy();
});

test("German", async () => {
  setLang("de");
  aliasService.mockResolvedValue(st());
  show();
  expect(await screen.findByText(rx("142 Aliase gefunden"))).toBeTruthy();
  expect(screen.getByText("•••• gesetzt")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Ändern…" })).toBeTruthy();
  expect(screen.getByText("Verbindung")).toBeTruthy();
});

test("switching the service with a key set asks before the key is forgotten",
  async () => {
    aliasService.mockResolvedValue(st());
    put.mockResolvedValue(st({ service: "addy", key_set: false,
      aliases: null, synced_ts: 0 }));
    show();
    fireEvent.click(await screen.findByRole("radio", { name: "addy.io" }));
    const dlg = await findDialog();
    expect(within(dlg).getByText("Switch to addy.io?")).toBeTruthy();
    expect(within(dlg).getByText(/The API key of SimpleLogin is forgotten/))
      .toBeTruthy();
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    await expectNoDialog();
    expect(put).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "addy.io" }));
    await pressDialog("Switch service");
    await waitFor(() => expect(put).toHaveBeenCalledWith("addy"));
  });

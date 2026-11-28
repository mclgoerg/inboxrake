// @vitest-environment jsdom
/* "Mute this conversation…": the dialog says what the rule will do (archive +
 * mark read after each scan, like Block), offers the one extra step (also
 * archive what is there, one step with Undo) and what is never touched. */

import { cleanup, fireEvent, render, screen, within } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { MuteDialog } from "./components/MuteDialog";
import { DIALOG_ARM_MS } from "./components/ui";
import { setLang } from "./i18n";
import type { MutePreview } from "./types";

const preview = (over: Partial<MutePreview> = {}): MutePreview => ({
  key: "4f9c1e0a7b2d3c58", label: "Team dinner on Friday", mails: 23,
  people: 7, now: 4, protected: 0, pinned: 0, archive: true, muted: null,
  ...over,
});

afterEach(() => { cleanup(); setLang("en"); });

const armed = () => new Promise((r) => setTimeout(r, DIALOG_ARM_MS + 30));

const show = (p = preview()) => {
  const onResult = vi.fn();
  render(<MuteDialog preview={p} onResult={onResult} />);
  return onResult;
};

test("the title names the conversation, with its mails and people", () => {
  show();
  const dlg = screen.getByRole("dialog");
  expect(within(dlg).getByText("Mute “Team dinner on Friday”?"))
    .toBeTruthy();
  expect(within(dlg).getByText(/23\smails/)).toBeTruthy();
  expect(within(dlg).getByText(/7\speople/)).toBeTruthy();
});

test("the rule is on and fixed; archiving what is there is off by default",
  () => {
    show();
    const rule = screen.getByRole("checkbox", {
      name: /Archive new mail of this conversation and mark it as read/ });
    expect((rule as HTMLInputElement).checked).toBe(true);
    expect((rule as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/after each scan/)).toBeTruthy();
    expect(screen.getByText(/a rule like Block/)).toBeTruthy();
    const more = screen.getByRole("checkbox", {
      name: /Also archive the 4 mails already in your inbox/ });
    expect((more as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText("one step with Undo")).toBeTruthy();
  });

test("what is never touched is said in the dialog", () => {
  show();
  const note = screen.getByText(/Only mail of this conversation/);
  expect(note.textContent).toMatch(/never a new conversation from the same people/);
  expect(note.textContent).toMatch(/never pinned mail or protected senders/);
  expect(note.textContent).toMatch(/wasn't in the conversation yet is let through/);
  expect(note.textContent).toMatch(/Without an Archive folder it only marks as read/);
  expect(note.textContent).toMatch(/Nothing is ever trashed/);
});

test("pinned and protected mail already there is counted as left alone",
  () => {
    show(preview({ pinned: 1, protected: 2 }));
    expect(screen.getByText(
      "Left alone now: 1 pinned, 2 from protected senders.")).toBeTruthy();
    cleanup();
    show();
    expect(screen.queryByText(/Left alone now/)).toBeNull();
  });

test("Mute answers without the extra step unless it is ticked", async () => {
  const onResult = show();
  await armed();
  fireEvent.click(screen.getByRole("button", { name: "Mute" }));
  expect(onResult).toHaveBeenCalledWith({ archiveExisting: false });
  cleanup();

  const again = show();
  fireEvent.click(screen.getByRole("checkbox", {
    name: /Also archive the 4 mails/ }));
  await armed();
  fireEvent.click(screen.getByRole("button", { name: "Mute" }));
  expect(again).toHaveBeenCalledWith({ archiveExisting: true });
});

test("Cancel, Esc and the backdrop answer null", () => {
  const onResult = show();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onResult).toHaveBeenCalledWith(null);
});

test("with nothing in the inbox the extra step is not offered", () => {
  show(preview({ now: 0 }));
  expect(screen.queryByRole("checkbox", { name: /Also archive/ })).toBeNull();
  expect(screen.getAllByRole("checkbox")).toHaveLength(1);
});

test("a singular count reads right", () => {
  show(preview({ now: 1, mails: 1, people: 1 }));
  expect(screen.getByRole("checkbox", {
    name: /Also archive the 1 mail already in your inbox/ })).toBeTruthy();
  expect(screen.getByText(/1\sperson/)).toBeTruthy();
});

test("without an Archive folder it says it only marks as read", async () => {
  const onResult = show(preview({ archive: false, now: 2 }));
  expect(screen.getByRole("checkbox", {
    name: /Mark new mail of this conversation as read/ })).toBeTruthy();
  expect(screen.getByText(/no Archive folder, so it stays where it is/))
    .toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", {
    name: /Also mark the 2 unread mails already in it as read/ }));
  await armed();
  fireEvent.click(screen.getByRole("button", { name: "Mute" }));
  expect(onResult).toHaveBeenCalledWith({ archiveExisting: true });
});

test("German: the same dialog, in du-form", () => {
  setLang("de");
  show(preview({ pinned: 1, protected: 1 }));
  const dlg = screen.getByRole("dialog");
  expect(within(dlg).getByText(
    "„Team dinner on Friday“ stummschalten?")).toBeTruthy();
  expect(within(dlg).getByText(/23\sMails/)).toBeTruthy();
  expect(within(dlg).getByText(/7\sPersonen/)).toBeTruthy();
  expect(within(dlg).getByRole("checkbox", { name:
    /Neue Mails dieser Konversation archivieren und als gelesen markieren/ }))
    .toBeTruthy();
  expect(within(dlg).getByRole("checkbox", { name:
    /Auch die 4 Mails archivieren, die schon in deinem Posteingang liegen/ }))
    .toBeTruthy();
  expect(within(dlg).getByText(/Nichts wird je in den Papierkorb/))
    .toBeTruthy();
  expect(within(dlg).getByText(/Bleibt jetzt unangetastet: 1 angeheftete, 1 von geschützten/))
    .toBeTruthy();
  expect(within(dlg).getByRole("button", { name: "Abbrechen" })).toBeTruthy();
  expect(within(dlg).getByRole("button", { name: "Stummschalten" })).toBeTruthy();
});

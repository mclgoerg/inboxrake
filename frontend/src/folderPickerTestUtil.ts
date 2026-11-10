import { fireEvent, screen, within } from "@testing-library/react";

/** The open FolderPicker ("Move N mails"). */
export const findPicker = () =>
  screen.findByRole("dialog", { name: /^(Move|Restore) (\d+\u00a0mails|1\u00a0mail)$/ });

/** Tick `folder` in the open picker (by its row's name) and press Move. */
export async function pickFolder(folder: string): Promise<void> {
  const dlg = await findPicker();
  const rows = within(dlg).getAllByRole("button", {
    name: new RegExp(`^${folder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\d,]*$`) });
  fireEvent.click(rows[rows.length - 1]);
  fireEvent.click(within(dlg).getByRole("button", { name: /^(Move|Restore)$/ }));
}

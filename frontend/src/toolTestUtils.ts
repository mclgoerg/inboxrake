import { fireEvent, screen, within } from "@testing-library/react";

/** Phone / tablet shell (< 1024, which is what jsdom without matchMedia
 *  renders): the tools live on the Clean up / Insights tab pages. */
export const openTab = (name: "Clean up" | "Insights" | "Senders") =>
  fireEvent.click(screen.getByRole("link", { name }));

/** Open one tool: its tab, then its row. */
export const openTool = (tab: "Clean up" | "Insights",
    row: string | RegExp) => {
  openTab(tab);
  fireEvent.click(screen.getByRole("button", { name: row }));
};

/** Choose an option of a `PopupSelect` (the pop-up button that replaced a
 *  native select): open it, then click the item. `button` is the trigger
 *  (an element, or its accessible name / text). */
export const popupPick = (button: HTMLElement | string | RegExp,
    option: string | RegExp) => {
  const b = button instanceof HTMLElement ? button
    : screen.getByRole("button", { name: button });
  fireEvent.click(b);
  fireEvent.click(within(screen.getByRole("menu"))
    .getByRole("menuitemradio", { name: option }));
};

/** The option labels of a `PopupSelect`, in order (opens it, then closes). */
export const popupOptions = (button: HTMLElement) => {
  fireEvent.click(button);
  const out = within(screen.getByRole("menu")).getAllByRole("menuitemradio")
    .map((o) => o.textContent);
  fireEvent.keyDown(document, { key: "Escape" });
  return out;
};

/** One item of a `PopupSelect` menu (opens it; the caller closes it or acts). */
export const popupItem = (button: HTMLElement, option: string | RegExp) => {
  fireEvent.click(button);
  const item = within(screen.getByRole("menu"))
    .getByRole("menuitemradio", { name: option }) as HTMLButtonElement;
  return item;
};

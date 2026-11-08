// @vitest-environment jsdom
/* The grouped-row primitives of the Settings page: SettingsGroup /
 * SettingsRow, Switch, Stepper, and the appearance thumbnails. */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { AppearanceControl, getAppearance, IconTile, RadioRow, SettingsGroup,
  SettingsRow, Stepper, Switch } from "./components/ui";

afterEach(() => { cleanup(); localStorage.clear(); });

test("a group is named by its header; rows sit inside it, the footnote under", () => {
  render(<SettingsGroup header="Senders" footnote="Applies right away.">
    <SettingsRow label="First" sub="Explained" />
    <SettingsRow label="Second" />
  </SettingsGroup>);
  const group = screen.getByRole("group", { name: "Senders" });
  expect(within(group).getByText("First")).toBeTruthy();
  expect(within(group).getByText("Explained")).toBeTruthy();
  expect(screen.getByText("Applies right away.")).toBeTruthy();
  // a header-less group is just the list
  cleanup();
  render(<SettingsGroup><SettingsRow label="Only" /></SettingsGroup>);
  expect(screen.getByText("Only")).toBeTruthy();
  expect(screen.queryByRole("heading")).toBeNull();
});

test("a row with onClick is one button with a value and a chevron; its icon is decoration", () => {
  const go = vi.fn();
  render(<SettingsGroup><SettingsRow label="Weekly digest" value="Mon 08:00"
    icon={<IconTile tone="info">i</IconTile>} onClick={go} /></SettingsGroup>);
  const row = screen.getByRole("button", { name: /^Weekly digest.*Mon 08:00$/ });
  fireEvent.click(row);
  expect(go).toHaveBeenCalledTimes(1);
  expect(row.querySelector("svg")).toBeTruthy();   // the chevron
});

test("a control inside a row is named by the row's label and described by its sub text", () => {
  render(<SettingsGroup><SettingsRow label="Desktop notifications"
    sub="When a scan finishes"><Switch checked={false} onChange={() => {}} />
  </SettingsRow></SettingsGroup>);
  const sw = screen.getByRole("switch", { name: "Desktop notifications" });
  expect(sw.getAttribute("aria-describedby")).toBeTruthy();
  expect(document.getElementById(sw.getAttribute("aria-describedby")!)!
    .textContent).toBe("When a scan finishes");
});

test("a switch reports the new state, keeps a 44 px hit area and can be disabled", () => {
  const on = vi.fn();
  const { rerender } = render(<Switch label="Auto" checked={false} onChange={on} />);
  const sw = screen.getByRole("switch", { name: "Auto" });
  expect(sw.getAttribute("aria-checked")).toBe("false");
  expect(sw.className).toContain("min-h-11");
  expect(sw.className).toContain("min-w-11");
  fireEvent.click(sw);
  expect(on).toHaveBeenLastCalledWith(true);
  rerender(<Switch label="Auto" checked onChange={on} />);
  fireEvent.click(screen.getByRole("switch", { name: "Auto" }));
  expect(on).toHaveBeenLastCalledWith(false);
  rerender(<Switch label="Auto" checked disabled onChange={on} />);
  on.mockClear();
  fireEvent.click(screen.getByRole("switch", { name: "Auto" }));
  expect(on).not.toHaveBeenCalled();
});

function Counter({ min = 1, max = 5, start = 3 }) {
  const [v, setV] = useState(start);
  return <Stepper label="Days" value={v} min={min} max={max}
    format={(n) => `${n} days`} onChange={setV} />;
}
const spin = () => screen.getByRole("spinbutton", { name: "Days" });

test("a stepper shows the formatted value and steps with the buttons, stopping at the bounds", () => {
  render(<Counter />);
  expect(spin().textContent).toBe("3 days");
  expect(spin().getAttribute("aria-valuemin")).toBe("1");
  expect(spin().getAttribute("aria-valuemax")).toBe("5");
  expect(spin().getAttribute("aria-valuetext")).toBe("3 days");
  fireEvent.click(screen.getByRole("button", { name: "Increase" }));
  fireEvent.click(screen.getByRole("button", { name: "Increase" }));
  expect(spin().textContent).toBe("5 days");
  expect((screen.getByRole("button", { name: "Increase" }) as HTMLButtonElement)
    .disabled).toBe(true);
  for (let i = 0; i < 4; i++)
    fireEvent.click(screen.getByRole("button", { name: "Decrease" }));
  expect(spin().textContent).toBe("1 days");
  expect((screen.getByRole("button", { name: "Decrease" }) as HTMLButtonElement)
    .disabled).toBe(true);
});

test("a stepper is a keyboard control: arrows, Page keys, Home and End, clamped", () => {
  render(<Counter min={0} max={30} start={7} />);
  fireEvent.keyDown(spin(), { key: "ArrowUp" });
  expect(spin().textContent).toBe("8 days");
  fireEvent.keyDown(spin(), { key: "ArrowLeft" });
  expect(spin().textContent).toBe("7 days");
  fireEvent.keyDown(spin(), { key: "PageUp" });
  expect(spin().textContent).toBe("17 days");
  fireEvent.keyDown(spin(), { key: "PageUp" });
  fireEvent.keyDown(spin(), { key: "PageUp" });
  expect(spin().textContent).toBe("30 days");
  fireEvent.keyDown(spin(), { key: "Home" });
  expect(spin().textContent).toBe("0 days");
  fireEvent.keyDown(spin(), { key: "ArrowDown" });
  expect(spin().textContent).toBe("0 days");
  fireEvent.keyDown(spin(), { key: "End" });
  expect(spin().textContent).toBe("30 days");
  // the buttons are for pointers: the spin button is the one tab stop
  expect(spin().tabIndex).toBe(0);
  expect(screen.getByRole("button", { name: "Increase" }).tabIndex).toBe(-1);
});

test("a stepper without a format shows the bare number", () => {
  render(<Stepper label="N" value={6} min={1} max={9} onChange={() => {}} />);
  expect(screen.getByRole("spinbutton", { name: "N" }).textContent).toBe("6");
});

test("the appearance thumbnails are a radio group: tap or arrows pick, one tab stop", () => {
  render(<AppearanceControl />);
  const group = screen.getByRole("radiogroup", { name: "Appearance" });
  const radios = within(group).getAllByRole("radio");
  expect(radios.map((r) => r.textContent)).toEqual(["System", "Light", "Dark"]);
  expect(getAppearance()).toBe("system");
  expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  fireEvent.click(screen.getByRole("radio", { name: "Light" }));
  expect(getAppearance()).toBe("light");
  expect(screen.getByRole("radio", { name: "Light" })
    .getAttribute("aria-checked")).toBe("true");
  fireEvent.keyDown(group, { key: "ArrowRight" });
  expect(getAppearance()).toBe("dark");
  fireEvent.keyDown(group, { key: "ArrowRight" });   // wraps to System
  expect(getAppearance()).toBe("system");
  expect(localStorage.getItem("pmc_theme")).toBeNull();
});

test("radio rows choose one option: one tab stop, arrows move and choose, disabled rows are skipped", () => {
  const Demo = () => {
    const [v, setV] = useState("none");
    return (
      <SettingsGroup radioGroup header="Login method">
        <RadioRow label="None" sub="Trusted network" checked={v === "none"}
          onSelect={() => setV("none")} />
        <RadioRow label="Password" checked={v === "password"}
          onSelect={() => setV("password")} />
        <RadioRow label="SSO" checked={v === "sso"} disabled
          onSelect={() => setV("sso")} />
      </SettingsGroup>
    );
  };
  render(<Demo />);
  const radios = within(screen.getByRole("radiogroup",
    { name: "Login method" })).getAllByRole("radio");
  expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  expect(screen.getByRole("radio", { name: "None" })
    .getAttribute("aria-describedby")).toBeTruthy();
  fireEvent.click(radios[1]);
  expect(radios[1].getAttribute("aria-checked")).toBe("true");
  expect(radios[0].getAttribute("aria-checked")).toBe("false");
  expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
  fireEvent.keyDown(radios[1], { key: "ArrowDown" });   // SSO is disabled
  expect(radios[1].getAttribute("aria-checked")).toBe("true");
  fireEvent.keyDown(radios[1], { key: "ArrowUp" });
  expect(radios[0].getAttribute("aria-checked")).toBe("true");
  expect(document.activeElement).toBe(radios[0]);
});

test("a plain row shows its value as text before its control", () => {
  render(<SettingsGroup><SettingsRow label="API key" value="•••• set">
    <button type="button">Change…</button></SettingsRow></SettingsGroup>);
  // the value belongs to its label: the row is a group named by it
  const row = screen.getByRole("group", { name: "API key" });
  expect(row.getAttribute("aria-describedby")).toBeTruthy();
  expect(document.getElementById(row.getAttribute("aria-describedby")!)!
    .textContent).toBe("•••• set");
  expect(screen.getByRole("button", { name: "Change…" })).toBeTruthy();
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, test } from "vitest";
import { DecimalInput } from "./components/ui";
import { setNumFormat } from "./numfmt";

afterEach(() => { cleanup(); setNumFormat("auto"); });

function Host({ onValue }: { onValue: (v: string) => void }) {
  const [v, setV] = useState("");
  return <DecimalInput aria-label="budget" value={v}
    onChange={(x) => { setV(x); onValue(x); }} />;
}

test("DecimalInput shows what is typed and reports the canonical string", () => {
  setNumFormat("de");
  const seen: string[] = [];
  render(<Host onValue={(v) => seen.push(v)} />);
  const input = screen.getByLabelText("budget") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "0," } });
  expect(input.value).toBe("0,");          // the typed comma survives
  fireEvent.change(input, { target: { value: "0,5" } });
  expect(input.value).toBe("0,5");
  expect(seen.at(-1)).toBe("0.5");
  fireEvent.change(input, { target: { value: "" } });
  expect(seen.at(-1)).toBe("");
});

test("DecimalInput marks text that is no number as invalid", () => {
  render(<Host onValue={() => {}} />);
  const input = screen.getByLabelText("budget") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "abc" } });
  expect(input.getAttribute("aria-invalid")).toBe("true");
  fireEvent.change(input, { target: { value: "2" } });
  expect(input.getAttribute("aria-invalid")).toBeNull();
});

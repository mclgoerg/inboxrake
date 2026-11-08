import { describe, expect, test } from "vitest";
import { arcPath, layoutRings, type RingNode } from "./sunburst";

const node = (key: string, value: number, kids: [string, number][] = []):
  RingNode => ({ key, value,
  children: kids.map(([k, v]) => ({ key: k, value: v, children: [] })) });
const TAU = Math.PI * 2;

describe("layoutRings", () => {
  const arcs = layoutRings([
    node("a", 60, [["a1", 40], ["a2", 20]]),
    node("b", 30, [["b1", 30]]),
    node("c", 10)]);
  const get = (k: string) => arcs.find((a) => a.key === k)!;

  test("the angle of a segment is its share of the whole", () => {
    expect(get("a").a1 - get("a").a0).toBeCloseTo(TAU * 0.6, 9);
    expect(get("b").a1 - get("b").a0).toBeCloseTo(TAU * 0.3, 9);
    expect(get("a1").a1 - get("a1").a0).toBeCloseTo(TAU * 0.4, 9);
  });
  test("inner ring runs around once, in order, without gaps", () => {
    expect(get("a").a0).toBe(0);
    expect(get("b").a0).toBeCloseTo(get("a").a1, 9);
    expect(get("c").a1).toBeCloseTo(TAU, 9);
  });
  test("children start where their parent starts and stay inside it", () => {
    expect(get("a1").a0).toBeCloseTo(get("a").a0, 9);
    expect(get("a2").a0).toBeCloseTo(get("a1").a1, 9);
    for (const a of arcs.filter((x) => x.ring === 1)) {
      const p = get(a.parent!);
      expect(a.a0).toBeGreaterThanOrEqual(p.a0 - 1e-9);
      expect(a.a1).toBeLessThanOrEqual(p.a1 + 1e-9);
    }
    expect(get("a1").ring).toBe(1);
    expect(get("a").ring).toBe(0);
  });
  test("one item fills the whole ring; no value, no arcs", () => {
    const [only] = layoutRings([node("x", 5)]);
    expect(only.a1 - only.a0).toBeCloseTo(TAU, 9);
    expect(layoutRings([node("z", 0)])).toEqual([]);
    expect(layoutRings([])).toEqual([]);
  });
  test("children that overshoot the parent are cut at its end", () => {
    const [p, k] = layoutRings([node("p", 10, [["k", 10], ["k2", 10]])]);
    expect(k.a1).toBeLessThanOrEqual(p.a1 + 1e-9);
  });
});

describe("arcPath", () => {
  test("a partial segment is one closed outline of two arcs", () => {
    const d = arcPath(50, 100, 0, Math.PI / 2);
    expect(d.startsWith("M0.00 -100.00A100.00 100.00 0 0 1 100.00")).toBe(true);
    expect((d.match(/A/g) ?? []).length).toBe(2);
    expect(d.endsWith("Z")).toBe(true);
  });
  test("more than a half turn uses the large-arc flag", () => {
    expect(arcPath(50, 100, 0, Math.PI * 1.5)).toContain("0 1 1");
  });
  test("a full turn is a closed annulus (two circles), not one arc", () => {
    const d = arcPath(50, 100, 0, TAU);
    expect((d.match(/Z/g) ?? []).length).toBe(2);
    expect((d.match(/A/g) ?? []).length).toBe(4);
  });
});

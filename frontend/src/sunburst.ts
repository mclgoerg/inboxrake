/* Sunburst layout (two rings): pure geometry, no DOM. The inner ring holds
 * the items of a level, the outer ring the items inside each of them; the
 * angle of a segment is its share of the whole. The panel
 * (components/SpaceRings.tsx) draws the arcs as SVG paths. */

export interface RingNode { key: string; value: number; children: RingNode[] }
export interface Arc {
  key: string;
  /** Angles in radians, clockwise from twelve o'clock. */
  a0: number; a1: number;
  ring: 0 | 1;
  /** The inner arc this segment sits in (outer ring only). */
  parent?: string;
}

const TAU = Math.PI * 2;

/** Arcs of both rings for `nodes` (inner ring) and their `children` (outer
 *  ring). An inner segment's children start at its own start angle and
 *  never run past its end, so a child is always inside its parent. */
export function layoutRings(nodes: RingNode[]): Arc[] {
  const total = nodes.reduce((a, n) => a + Math.max(0, n.value), 0);
  const out: Arc[] = [];
  if (!(total > 0)) return out;
  let a = 0;
  for (const n of nodes) {
    if (!(n.value > 0)) continue;
    const span = (n.value / total) * TAU;
    out.push({ key: n.key, a0: a, a1: a + span, ring: 0 });
    let c = a;
    for (const k of n.children) {
      if (!(k.value > 0)) continue;
      const w = Math.min((k.value / total) * TAU, a + span - c);
      if (w <= 0) break;
      out.push({ key: k.key, a0: c, a1: c + w, ring: 1, parent: n.key });
      c += w;
    }
    a += span;
  }
  return out;
}

const pt = (r: number, a: number): [number, number] =>
  [r * Math.sin(a), -r * Math.cos(a)];
const f = (n: number): string => n.toFixed(2);

/** SVG path of the ring segment between radii `r0` < `r1` and angles
 *  `a0` < `a1` around (0, 0). A full turn is drawn as a closed annulus
 *  (one arc cannot span 360 degrees). */
export function arcPath(r0: number, r1: number, a0: number, a1: number): string {
  if (a1 - a0 >= TAU - 1e-6) {
    return `M0 ${f(-r1)}A${f(r1)} ${f(r1)} 0 1 1 0 ${f(r1)}`
      + `A${f(r1)} ${f(r1)} 0 1 1 0 ${f(-r1)}Z`
      + `M0 ${f(-r0)}A${f(r0)} ${f(r0)} 0 1 0 0 ${f(r0)}`
      + `A${f(r0)} ${f(r0)} 0 1 0 0 ${f(-r0)}Z`;
  }
  const big = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = pt(r1, a0), [x1, y1] = pt(r1, a1);
  const [x2, y2] = pt(r0, a1), [x3, y3] = pt(r0, a0);
  return `M${f(x0)} ${f(y0)}A${f(r1)} ${f(r1)} 0 ${big} 1 ${f(x1)} ${f(y1)}`
    + `L${f(x2)} ${f(y2)}A${f(r0)} ${f(r0)} 0 ${big} 0 ${f(x3)} ${f(y3)}Z`;
}

/** Middle of a segment (for a marker). */
export const arcCentre = (r0: number, r1: number, a0: number, a1: number):
  [number, number] => pt((r0 + r1) / 2, (a0 + a1) / 2);

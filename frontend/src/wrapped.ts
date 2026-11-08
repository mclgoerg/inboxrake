/* Your year in mail: the pure helpers behind the summary image. The SVG is
 * built from the API response and the caller's already-translated strings,
 * drawn onto a canvas and saved as a PNG - all local, nothing is uploaded.
 * Sender names are masked unless `showNames` is set. */

import type { WrappedResp } from "./types";

/** `ann@shop.example` -> `a...@...example`: first letter and the last
 *  domain label are all that is left. */
export function maskAddr(addr: string): string {
  const at = addr.lastIndexOf("@");
  if (at < 1) return `${addr.slice(0, 1)}...`;
  const tld = addr.slice(at + 1).split(".").pop() ?? "";
  return `${addr[0]}...@...${tld}`;
}

export const SVG_W = 1080;
export const SVG_H = 1920;

export interface SummaryPalette {
  bg: string; panel: string; line: string; body: string; muted: string;
  accent: string;
}
export interface SummaryStrings {
  title: string;          // "Your year in mail 2026"
  lead: string;           // "You received"
  big: string;            // the formatted mail count (UI language)
  unit: string;           // "mails in 2026"
  note: string;           // "Based on the mail in your mailbox now"
  stats: { value: string; label: string }[];
  topTitle: string;       // "Loudest senders"
  topRows: string[];      // "12 mails" (aligned with top_senders)
  footer: string;         // "Made locally with Inboxrake"
}

// Control characters are not valid XML 1.0 (the image would fail to load).
// eslint-disable-next-line no-control-regex
const esc = (s: string): string => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
  .replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const STORY_TEXT = "#ffffff";
const STORY_MUTED = "rgba(255,255,255,0.72)";
const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

/** Display name of a top-sender row in the image. */
export const senderName = (
  s: { label: string; addr: string }, showNames: boolean,
): string => (showNames ? s.label || s.addr : maskAddr(s.addr));

/** The summary card as a standalone SVG document (pure). It carries the
 *  story's look: the same deep gradient, light text, translucent tiles and
 *  the month bars - fixed colours, like the story, not the theme's. */
export function buildSummarySvg(
  d: WrappedResp, str: SummaryStrings, _pal: SummaryPalette,
  showNames: boolean,
): string {
  const text = (x: number, y: number, size: number, weight: number,
    fill: string, s: string, anchor = "start") =>
    `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" `
    + `fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;
  const parts: string[] = [
    `<defs><linearGradient id="g" x1="0.2" y1="0" x2="0.8" y2="1">`
    + `<stop offset="0" stop-color="#8a3f8f"/>`
    + `<stop offset="0.5" stop-color="#3b2b8c"/>`
    + `<stop offset="1" stop-color="#151540"/></linearGradient></defs>`,
    `<rect width="${SVG_W}" height="${SVG_H}" fill="url(#g)"/>`,
    text(90, 200, 44, 600, STORY_TEXT, str.title),
    text(90, 330, 48, 500, STORY_MUTED, str.lead),
    text(90, 500, 190, 700, STORY_TEXT, str.big),
    text(90, 580, 52, 500, STORY_TEXT, str.unit),
  ];
  const months = d.by_month ?? [];
  if (months.some((v) => v > 0)) {
    const max = Math.max(...months);
    const peak = months.indexOf(max);
    months.forEach((v, i) => {
      const h = Math.max(8, (200 * v) / max);
      parts.push(`<rect x="${90 + i * 75}" y="${680 - h}" width="63" `
        + `height="${h}" rx="8" fill="${i === peak ? STORY_TEXT
          : "rgba(255,255,255,0.38)"}"/>`);
    });
  }
  str.stats.slice(0, 6).forEach((s, i) => {
    const x = 90 + (i % 2) * 450;
    const y = 740 + Math.floor(i / 2) * 170;
    parts.push(
      `<rect x="${x}" y="${y}" width="420" height="145" rx="24" `
      + `fill="rgba(255,255,255,0.14)"/>`,
      text(x + 30, y + 72, 60, 700, STORY_TEXT, s.value),
      text(x + 30, y + 116, 32, 400, STORY_MUTED, s.label));
  });
  const top = d.top_senders.slice(0, 5);
  if (top.length) {
    parts.push(text(90, 1340, 36, 600, STORY_TEXT, str.topTitle));
    top.forEach((s, i) => {
      const y = 1410 + i * 80;
      parts.push(
        text(90, y, 42, 500, STORY_TEXT, `${i + 1}. ${senderName(s, showNames)}`),
        text(990, y, 38, 400, STORY_MUTED, str.topRows[i] ?? "", "end"));
    });
  }
  parts.push(text(90, 1840, 30, 400, STORY_MUTED, str.note));
  parts.push(text(990, 1840, 30, 600, STORY_TEXT, str.footer, "end"));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_W}" `
    + `height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}" `
    + `font-family="${FONT}">${parts.join("")}</svg>`;
}

/** Rasterise an SVG document to a PNG blob (browser only). A data: URL
 *  keeps the canvas untainted in every browser. */
export function svgToPngBlob(svg: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = SVG_W;
      canvas.height = SVG_H;
      canvas.getContext("2d")!.drawImage(img, 0, 0, SVG_W, SVG_H);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("png"))),
        "image/png");
    };
    img.onerror = () => reject(new Error("svg"));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/** The theme colours as the image palette (read from the CSS tokens). */
export function paletteFromTheme(): SummaryPalette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) =>
    css.getPropertyValue(`--color-${name}`).trim() || fb;
  return { bg: v("surface", "#181716"), panel: v("panel2", "#2c2a27"),
    line: v("line", "#36322d"), body: v("body", "#f4f0ea"),
    muted: v("muted", "#a19b93"), accent: v("accenth", "#e49a3a") };
}

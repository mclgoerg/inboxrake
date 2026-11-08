/* The link preview: renders website/public/og.png (1200x630, what Reddit,
 * Slack & co. show for inboxrake.com) from the contract images in
 * docs/screenshots/ (desktop-overview-light.png, phone-senders-dark.png -
 * regenerate those with screenshots.mjs first) plus the app icon. Layout:
 * logo, slogan, "Try the demo in your browser" on the left, the desktop
 * window with the phone overlapping on the right.
 *
 * Run from the repo root (same rig as screenshots.mjs: puppeteer-core and
 * a Chromium, Inter + the emoji font for stable text; no demo needed):
 *
 *   docker run --rm -v "$PWD":/repo -w /tmp node:26 \
 *     bash -c "apt-get update -q && apt-get install -yq --no-install-recommends \
 *       chromium pngquant fonts-inter fonts-noto-core || exit 1; \
 *       mkdir rig && cd rig && npm i -s puppeteer-core \
 *       && cp /repo/scripts/*.mjs . && node og-image.mjs /repo \
 *       && chown $(id -u):$(id -g) /repo/website/public/og.png"
 *
 * The argument is the repo root (default: the current directory); CHROME_PATH
 * picks the browser. With pngquant on the PATH the PNG is palette-compressed.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { launch } from "./capture-lib.mjs";

const ROOT = (process.argv[2] ?? ".").replace(/\/$/, "");
const uri = (path, mime = "image/png") =>
  `data:${mime};base64,${readFileSync(`${ROOT}/${path}`).toString("base64")}`;
const desktop = uri("docs/screenshots/desktop-overview-light.png");
const phone = uri("docs/screenshots/phone-senders-dark.png");
const icon = uri("frontend/public/icon.svg", "image/svg+xml");

// Tokens as in the app / landing page: warm surface, caramel accent.
const html = `<!doctype html><meta charset="utf-8"><style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { width: 1200px; height: 630px; position: relative; overflow: hidden;
  font-family: Inter, system-ui, sans-serif; color: #1f1c19;
  background: radial-gradient(1200px 700px at 85% 110%, #f1dcc0 0%, #faf9f7 55%); }
.copy { position: absolute; left: 72px; top: 84px; width: 520px;
  display: grid; gap: 22px; }
.logo { display: flex; align-items: center; gap: 10px; font-weight: 750;
  font-size: 28px; letter-spacing: -.01em; }
.logo img { width: 52px; height: 52px; border-radius: 13px; }
h1 { font-size: 62px; line-height: 1.02; font-weight: 800; letter-spacing: -.035em; }
.lead { font-size: 22px; line-height: 1.5; color: #6e6862; }
.cta { justify-self: start; display: inline-flex; align-items: center;
  gap: 8px; height: 36px; padding: 0 16px; border-radius: 999px;
  background: rgb(148 87 10 / .1); color: #94570a; font-size: 16px;
  font-weight: 650; }
.win { position: absolute; left: 640px; top: 70px; width: 720px;
  border-radius: 14px; overflow: hidden; background: #fff;
  box-shadow: 0 30px 70px rgb(60 40 10 / .22), 0 0 0 1px rgb(0 0 0 / .08); }
.bar { height: 30px; background: #efedea; display: flex; align-items: center;
  gap: 8px; padding: 0 14px; }
.bar i { width: 9px; height: 9px; border-radius: 50%; background: #d3cfc9; }
.win img { display: block; width: 100%; }
.ph { position: absolute; left: 930px; top: 230px; width: 200px; padding: 9px;
  border-radius: 38px; background: #121110;
  box-shadow: 0 30px 60px rgb(0 0 0 / .35); }
.ph img { display: block; width: 100%; border-radius: 30px; }
</style>
<div class="copy">
  <div class="logo"><img src="${icon}" alt="">Inboxrake</div>
  <h1>Rake your mailbox into tidy piles.</h1>
  <div class="lead">Self-hosted, open source. Clean up by sender - preview first, Undo after.</div>
  <span class="cta"><svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round"
    stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>Try the demo in your browser</span>
</div>
<div class="win"><div class="bar"><i></i><i></i><i></i></div><img src="${desktop}" alt=""></div>
<div class="ph"><img src="${phone}" alt=""></div>`;

const out = `${ROOT}/website/public/og.png`;
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "load" });
await page.evaluate(() => Promise.all(
  [...document.images].map((i) => i.decode())));
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: out });
await browser.close();
try {
  execFileSync("pngquant", ["--quality=85-100", "--force", "--skip-if-larger",
    "--ext", ".png", out], { stdio: "inherit" });
} catch { /* no pngquant: keep the plain PNG */ }
console.log(out);

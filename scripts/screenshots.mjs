/* High-resolution README / docs / landing-page screenshots against
 * scripts/demo.py. The file names are a contract: docs/screenshots/*.png are
 * imported by the README, the docs and website/landing, and og-image.mjs
 * composes website/public/og.png from them - do not rename them.
 *
 * Run from the repo root. The demo needs a writable /data and read access to
 * the checkout (repo files are mode 600), hence --user and the tmpfs; build
 * the frontend first if you want your working tree's UI instead of the
 * release image's bundle (use `-e STATIC_DIR=/app/static` for the image's).
 *
 *   (cd frontend && npm ci && npx vite build)
 *   docker network create mb-docs-net || true
 *   docker run -d --name mb-docs-demo --network mb-docs-net \
 *     --user "$(id -u):$(id -g)" -e HOME=/tmp \
 *     -e INBOXRAKE_ALLOWED_HOSTS=mb-docs-demo \
 *     --tmpfs /data:uid=$(id -u),gid=$(id -g) \
 *     -v "$PWD":/repo:ro -e STATIC_DIR=/repo/frontend/dist \
 *     ghcr.io/mclgoerg/inboxrake:latest python /repo/scripts/demo.py
 *   docker run --rm --network mb-docs-net -v "$PWD":/repo -w /tmp node:26 \
 *     bash -c "apt-get update -q && apt-get install -yq --no-install-recommends \
 *       chromium pngquant fonts-noto-color-emoji fonts-noto-core fonts-roboto \
 *       || exit 1; \
 *       mkdir rig && cd rig && npm i -s puppeteer-core \
 *       && cp /repo/scripts/*.mjs . && node screenshots.mjs \
 *            http://mb-docs-demo:8765 \
 *       && cp out/*.png /repo/docs/screenshots/ \
 *       && chown -R $(id -u):$(id -g) /repo/docs/screenshots"
 *   docker rm -f mb-docs-demo
 *
 * The colour-emoji font is required: without it the emoji in the rows
 * render as empty boxes. Start from a fresh demo container (the demo keeps
 * state in memory, e.g. a dismissed notice or a trashed group). Every shot
 * pins the demo account "proton", English and one theme (`pmc_theme`).
 * Output: PNGs in ./out - desktop 1440x900 at 2x, phones 390x844 at 3x
 * (mobile.png: three 3x phones side by side); with pngquant on the PATH they
 * are palette-compressed (quality 85-100) to stay well below ~400 KB each.
 * Optional OUT=<dir> overrides the output folder.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import {
  byRole, click, dismissNotice, goNav, hideCaret, launch, open, openGroup,
  settle, sleep, waitText,
} from "./capture-lib.mjs";

const BASE = process.argv[2] ?? "http://127.0.0.1:8765";
const OUT = process.env.OUT ?? "out";
mkdirSync(OUT, { recursive: true });

const DESKTOP = { width: 1440, height: 900, scale: 2 };
const PHONE = { width: 390, height: 844, scale: 3, mobile: true };

const browser = await launch();
const save = async (page, name) => {
  await hideCaret(page);
  await page.screenshot({ path: `${OUT}/${name}` });
  console.log(name);
};
/** A page at `route` with the notices dismissed and everything settled. */
const view = async (opts, route, theme) => {
  const page = await open(browser, BASE, { ...opts, route, theme });
  await dismissNotice(page);
  await settle(page);
  return page;
};

// Desktop ------------------------------------------------------------------

// The Overview, the start page (light).
let page = await view(DESKTOP, "overview", "light");
await waitText(page, /Biggest senders|Next steps/);
await save(page, "desktop-overview-light.png");
await page.close();

// Senders with a sender open beside the list (split pane, >= 1280 px).
page = await view(DESKTOP, "senders", "dark");
await openGroup(page, "ACME Store");
await save(page, "desktop-senders-dark.png");
await page.close();

// The space map (Insights).
page = await view(DESKTOP, "space", "dark");
await waitText(page, /Click for details/);
await save(page, "desktop-space-map-dark.png");
await page.close();

// Phone --------------------------------------------------------------------

page = await view(PHONE, "overview", "light");
await waitText(page, /Biggest senders|Next steps/);
await save(page, "phone-overview-light.png");
await page.close();

page = await view(PHONE, "senders", "dark");
await save(page, "phone-senders-dark.png");
await page.close();

page = await view(PHONE, "duplicates", "dark");
await waitText(page, /Remove \d+ copies/);
await save(page, "phone-duplicates-dark.png");
await page.close();

page = await view(PHONE, "trackers", "dark");
await save(page, "phone-trackers-dark.png");
await page.close();

// A mail open in the reader: sender detail -> first mail.
page = await view(PHONE, "senders", "dark");
await openGroup(page, "ACME Store");
await page.evaluate(() => [...document.querySelectorAll(
  '[role="dialog"] button')].find((b) => /^unread|Weekend SALE/
    .test((b.textContent || "").trim()))?.click());
await waitText(page, /Unsubscribe link found|Tracking pixel/);
await settle(page);
await save(page, "phone-reader-dark.png");
await page.close();

// Your year in mail: the first card of the story (Insights tab -> row).
page = await view(PHONE, "insights", "dark");
await click(page, "button", /^Your year in mail/);
await sleep(1200);                       // the first card animates in
await save(page, "phone-year-dark.png");
await page.close();

// mobile.png: Senders, a sender's details, the Trash confirm sheet.
const phones = [];
page = await view(PHONE, "senders", "dark");
await save(page, "_phone-list.png");
phones.push("_phone-list.png");
await page.close();

page = await view(PHONE, "senders", "dark");
await openGroup(page, "ACME Store");
await save(page, "_phone-detail.png");
phones.push("_phone-detail.png");
await page.close();

page = await view(PHONE, "senders", "dark");
await click(page, "button", "Select");
for (const who of ["PaketFix", "TechDigest"]) {   // the "Safe to delete" ones
  await page.evaluate((who) => [...document.querySelectorAll("[data-gidx]")]
    .find((e) => e.offsetParent && e.textContent.includes(who))
    ?.querySelector('input[type="checkbox"], [role="checkbox"], button')
    ?.click(), who);
  await sleep(250);
}
await click(page, "button", /^Trash \d+$/);
await byRole(page, "dialog", /Trash/);
await settle(page);
await save(page, "_phone-confirm.png");
phones.push("_phone-confirm.png");
await page.close();

// Compose the phones side by side on the app's dark surface colour, with
// rounded corners - laid out by a plain page, so no extra tooling.
const surface = "#171310";
const imgs = phones.map((f) =>
  `data:image/png;base64,${readFileSync(`${OUT}/${f}`).toString("base64")}`);
const sheet = await browser.newPage();
const GAP = 40, PAD = 56, W = 390, H = 844;
await sheet.setViewport({
  width: PAD * 2 + W * imgs.length + GAP * (imgs.length - 1),
  height: PAD * 2 + H, deviceScaleFactor: 2,
});
await sheet.setContent(`<body style="margin:0;background:${surface};
  display:flex;gap:${GAP}px;padding:${PAD}px">${imgs.map((src) =>
  `<img src="${src}" width="${W}" height="${H}" style="border-radius:36px;
   box-shadow:0 0 0 1px #3a2f25">`).join("")}</body>`);
await sheet.evaluate(() => Promise.all(
  [...document.images].map((i) => i.decode())));
await sheet.screenshot({ path: `${OUT}/mobile.png` });
console.log("mobile.png");
await sheet.close();
phones.forEach((f) => unlinkSync(`${OUT}/${f}`));

await browser.close();

// Palette-compress when pngquant is available (keeps the README light);
// --skip-if-larger leaves an image alone if quantising would not shrink it.
try {
  execFileSync("pngquant", ["--quality=85-100", "--speed=1", "--force",
    "--skip-if-larger", "--ext", ".png", ...[
      "desktop-overview-light", "desktop-senders-dark",
      "desktop-space-map-dark", "phone-overview-light", "phone-senders-dark",
      "phone-duplicates-dark", "phone-reader-dark", "phone-trackers-dark",
      "phone-year-dark", "mobile"].map((n) => `${OUT}/${n}.png`)],
  { stdio: "inherit" });
} catch (e) {
  console.log("pngquant not used:", e.status ?? e.code);
}

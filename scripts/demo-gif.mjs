/* README demo GIF: the main workflow in ten frames - Overview, Senders list,
 * Filter menu, the AI-safe groups filtered, Select + selection bar, confirm
 * sheet, result toast with Undo, the mails back after Undo, a sender open in
 * the split pane - assembled with ffmpeg at 1200 px wide.
 *
 * Same demo setup as screenshots.mjs (see its header for the demo
 * container). This script really trashes mails in the demo, so use a FRESH
 * demo container for each run (docker rm -f mb-docs-demo; start it again).
 *
 *   docker run --rm --network mb-docs-net -v "$PWD":/repo -w /tmp node:26 \
 *     bash -c "apt-get update -q && apt-get install -yq --no-install-recommends \
 *       chromium ffmpeg fonts-noto-color-emoji fonts-noto-core fonts-roboto || exit 1; \
 *       mkdir rig && cd rig && npm i -s puppeteer-core \
 *       && cp /repo/scripts/*.mjs . && node demo-gif.mjs \
 *            http://mb-docs-demo:8765 \
 *       && cp out/demo.gif /repo/docs/screenshots/ \
 *       && chown $(id -u):$(id -g) /repo/docs/screenshots/demo.gif"
 *
 * Frames are captured at 1280x800 with deviceScaleFactor 2 (dark theme) and
 * scaled down by ffmpeg (crisper text than a 1x capture). Optional
 * OUT=<dir> overrides the output folder.
 */
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  byRole, click, dismissNotice, goNav, hideCaret, launch, open, openGroup,
  settle, sleep, waitText,
} from "./capture-lib.mjs";

const BASE = process.argv[2] ?? "http://127.0.0.1:8765";
const OUT = process.env.OUT ?? "out";
const FRAMES = `${OUT}/frames`;
rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const browser = await launch();
const page = await open(browser, BASE, {
  width: 1280, height: 800, scale: 2, route: "overview", theme: "dark",
});
await dismissNotice(page);
await waitText(page, /Next steps|What fills/);
await settle(page);

let n = 0;
const shot = async (what) => {
  await hideCaret(page);
  await sleep(300);
  await page.screenshot({ path: `${FRAMES}/f${String(++n).padStart(2, "0")}.png` });
  console.log("frame", n, what);
};

await shot("1 Overview");

await goNav(page, "Senders");
await page.waitForSelector("[data-gidx]", { timeout: 30000 });
await settle(page);
await shot("2 Senders list");

await click(page, "button", "Filter");
await byRole(page, "menuitemradio", /^AI-safe groups/);
await shot("3 Filter menu");

// A quick filter narrows the list; "Select all N matches" ticks the lot.
await click(page, "menuitemradio", /^AI-safe groups/);
await settle(page);
await shot("4 filtered list");
await click(page, "button", /^Select all \d+ matches$/);
const trash = await byRole(page, "button", /^Trash \d+$/);
await settle(page);
await shot("5 selection bar");

await trash.click();
await byRole(page, "dialog", /Trash/);
await settle(page);
await shot("6 confirm sheet");

const confirm = await byRole(page, "button", /^Move to Trash \(\d+\)$/);
await confirm.click();
await waitText(page, /Moved \d+ mails? to Trash/);
await byRole(page, "button", "Undo");
// The trashed groups are gone: drop the filter so the toast sits over the
// rest of the list instead of an empty result.
await click(page, "button", "Clear filter");
await settle(page);
await sleep(900);                        // let the toast finish sliding in
await shot("7 result toast with undo");

// The toast's Undo is the last one in the DOM (the header also has an
// "Undo" history menu).
await page.evaluate(() => [...document.querySelectorAll("button")]
  .filter((b) => b.textContent.trim() === "Undo").at(-1).click());
await waitText(page, /Undone|Restored|Moved back|back to/i);
await settle(page);
await sleep(900);
await shot("8 undone - the mails are back");

await click(page, "button", "Dismiss").catch(() => {});  // keep the toast off the pane footer
await click(page, "button", "Done");     // leave Select mode
await openGroup(page, "ACME Store");    // beside the list (>= 1280 px)
await shot("9 sender in the split pane");
await browser.close();

// ffmpeg: ~1.4 s per frame, a palette tuned to the frames, 1200 px wide.
const frames = readdirSync(FRAMES).length;
execFileSync("ffmpeg", [
  "-y", "-v", "error", "-framerate", "1/1.4", "-i", `${FRAMES}/f%02d.png`,
  "-vf", "scale=1200:-1:flags=lanczos,split[a][b];"
    + "[a]palettegen=max_colors=256:stats_mode=diff[p];"
    + "[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
  "-loop", "0", `${OUT}/demo.gif`,
], { stdio: "inherit" });
console.log(`demo.gif (${frames} frames)`);

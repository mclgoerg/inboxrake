/* Shared helpers for screenshots.mjs and demo-gif.mjs (see their headers for
 * how to run them). Everything is found by role / accessible name / visible
 * text, so the scripts survive restyling - they only break when the UI's
 * words change.
 */
import puppeteer from "puppeteer-core";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const launch = () => puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars",
         "--force-color-profile=srgb"],
});

/** New page with a pinned account, theme and language (English). The app
 *  starts on the Overview; `route` picks the page by its hash ("overview",
 *  "senders", ...), and for "senders" this waits for the list. */
export async function open(browser, base, {
  width, height, scale, theme = "dark", mobile = false, route = "senders",
}) {
  const page = await browser.newPage();
  await page.setViewport({
    width, height, deviceScaleFactor: scale, isMobile: mobile, hasTouch: mobile,
  });
  await page.evaluateOnNewDocument((th) => {
    localStorage.setItem("pmc_account", "proton");
    localStorage.setItem("pmc_theme", th);
    localStorage.setItem("pmc_lang", "en");
  }, theme);
  await page.goto(`${base.replace(/\/$/, "")}/#/${route}`,
    { waitUntil: "networkidle2" });
  if (route === "senders")
    await page.waitForSelector("[data-gidx]", { timeout: 30000 });
  else await page.waitForSelector("h1, h2", { timeout: 30000 });
  await settle(page);
  return page;
}

/** Quiet page: no spinners, no running job strip, fonts and layout done. */
export async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(
    () => !document.querySelector('[role="status"][aria-label]'
      + ', [role="progressbar"]'), { timeout: 30000 });
  await sleep(400);
}

/** The visible element with this role whose accessible name matches `name`
 *  (string = exact, RegExp = test). */
export async function byRole(page, role, name, timeout = 15000) {
  const sel = {
    button: "button", link: "a", tab: '[role="tab"]', menuitem: '[role="menuitem"]',
    menuitemradio: '[role="menuitemradio"]',
    checkbox: 'input[type="checkbox"]', dialog: '[role="dialog"]',
    status: '[role="status"]',
  }[role];
  const found = await page.waitForFunction((sel, name, isRe, flags) => {
    const re = isRe ? new RegExp(name, flags) : null;
    const label = (e) => (e.getAttribute("aria-label")
      || e.textContent || "").replace(/\s+/g, " ").trim();
    const hit = [...document.querySelectorAll(sel)].find((e) => {
      if (!e.offsetParent && getComputedStyle(e).position !== "fixed")
        return false;
      const l = label(e);
      return re ? re.test(l) : l === name;
    });
    return hit ?? null;
  }, { timeout }, sel, name instanceof RegExp ? name.source : name,
  name instanceof RegExp, name instanceof RegExp ? name.flags : "");
  return found.asElement();
}

export async function click(page, role, name) {
  const el = await byRole(page, role, name);
  await el.evaluate((e) => e.scrollIntoView({ block: "nearest" }));
  await el.click();
  await sleep(250);
}

/** Click an item of the main navigation (the sidebar from 1024 px wide) by
 *  its visible name, whether it is a link or a button - tools open as
 *  panels or pages depending on the app version. Counts after the name
 *  ("Trash 70") are ignored. */
export async function goNav(page, name) {
  const handle = await page.waitForFunction((name) => {
    const nav = document.querySelector('nav[aria-label="Main navigation"]');
    return [...(nav?.querySelectorAll("a, button") ?? [])].find((e) =>
      (e.getAttribute("aria-label") || e.textContent || "")
        .replace(/\s*\d+$/, "").replace(/\s+/g, " ").trim() === name) ?? null;
  }, { timeout: 15000 }, name);
  await handle.asElement().click();
  await sleep(250);
}

/** Wait until visible page text matches. */
export const waitText = (page, re, timeout = 20000) =>
  page.waitForFunction((src, flags) => new RegExp(src, flags)
    .test(document.body.innerText), { timeout }, re.source, re.flags);

/** The "12 cached AI verdicts applied" notice is dismissible; tidy shots
 *  don't show it. */
export async function dismissNotice(page) {
  const btn = await page.$('[role="status"] button[aria-label="Dismiss"]');
  if (btn) { await btn.click(); await sleep(300); }
}

/** Open the first group of the current list the way a keyboard user would
 *  (j, Enter) and wait for its mails and footer actions. */
export async function openGroup(page, label) {
  if (label) {
    // Table rows have a button named after the sender; the phone cards are
    // whole-row targets, so find the row by its text.
    const row = await page.waitForFunction((l) => [...document
      .querySelectorAll("[data-gidx]")].find((e) => e.offsetParent
        && e.textContent.includes(l))
      ?? null, { timeout: 15000 }, label);
    const el = row.asElement();
    await el.evaluate((e) => e.scrollIntoView({ block: "center" }));
    await el.click();
    await sleep(250);
  } else {
    await page.keyboard.press("j");
    await page.keyboard.press("Enter");
  }
  await byRole(page, "button", /^Move (\d+ mails|1 mail) to Trash$/);
  await page.waitForFunction(() => document.querySelector(
    '[data-split-pane] input[type="checkbox"], '
    + '[role="dialog"] input[type="checkbox"]'), { timeout: 20000 });
  await settle(page);
}

export async function hideCaret(page) {
  await page.evaluate(() => document.activeElement?.blur?.());
}

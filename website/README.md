# Website (landing page + documentation)

Static site for <https://inboxrake.com/>: the landing page at `/` and the
documentation at <https://inboxrake.com/docs/>. The docs are built with
[Astro Starlight](https://starlight.astro.build/) from the Markdown in
[`../docs`](../docs) (the single source - there is no copy under
`website/`). Search is Pagefind, light/dark comes with the theme.

This directory is self-contained tooling: nothing here is part of the app
image, `backend/requirements*.txt` or `frontend/package.json`.

```bash
cd website
npm ci
npm run build      # builds both: docs -> dist/ (URLs rooted at /docs/),
                   #                landing -> dist-landing/ (rooted at /)
npm run dev        # docs live preview on http://127.0.0.1:4321/docs/
npm run dev:landing
```

The two outputs never share a directory; the deploy step puts
`dist-landing/` at the site root and `dist/` under `docs/`.

## Deploying

`scripts/build-site.sh` builds the landing page (with the demo button), the
docs, the demo UI and the demo bundle and lays them out as one tree in
`site-dist/` (`/`, `/docs/`, `/demo/`, `/demo/bundle/`, `_headers` at the
root), then checks it. `wrangler.jsonc` publishes that tree as Cloudflare
Workers static assets (wrangler is pinned in `package.json`). The
`deploy-site` workflow does both on every release tag and on a manual run
(only from `main` or a `v*` tag): a `build` job without secrets uploads the
tree, a `deploy` job in the `production` environment installs only wrangler
and publishes it, then `scripts/smoke-site.sh` checks the live site (pages, and the cache
headers and MIME types the demo depends on). Pull requests only build and
dry-run. It needs `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` as secrets of the `production` environment; without them it fails up front saying so.

## Landing page

`landing/` is a second, plain Astro build (no framework; the only client JS
is a tiny inline script for the install Copy button and the dots of the
swipeable feature cards - the page works without it). The page is
`landing/src/pages/index.astro`. Look: the app's tokens (caramel accent, warm
surfaces, system fonts, no external requests), light/dark by
`prefers-color-scheme`. The screenshots are imported from
`../docs/screenshots/` (the demo captures, see the image contract in
`scripts/screenshots.mjs`) and turned into responsive webp by `Shot.astro`.

The docs theme is `src/styles/inboxrake.css`: Starlight's variables are
mapped onto the app's tokens (`--ir-*`, caramel accent, warm surfaces, light
+ dark, system fonts). Starlight components are overridden in
`src/components/` - `Header` (logo + version, search, Home, GitHub, theme
switch, "Try the demo" under the same `INBOXRAKE_DEMO_LIVE` switch),
`Sidebar` (two groups, one icon per page, the areas of Features as
sub-items), `MobileMenuFooter`, `PageTitle` (breadcrumb), `ThemeSelect` (one
round light/dark button); icons are inlined Lucide paths (`icons.mjs`).
Code blocks use Expressive Code with one warm dark theme in both modes.

The **Try the demo** button is a build-time switch: it is only emitted when
`INBOXRAKE_DEMO_LIVE=1` is set for the build (off by default, so no dead
`/demo/` link ships; the docs header button and the closing demo card follow it). The deploy step flips it once the demo is live.

Serve `dist/` under `/docs/` (`BASE` in `site.config.mjs`, shared by the
Astro config and the link plugin).

`@astrojs/markdown-remark` is listed although nothing imports it: Astro 7
requires it to be installed for `markdown.remarkPlugins` to run.

## Writing pages

- Pages are `docs/*.md`. Each needs `title:` (and ideally `description:`)
  frontmatter; the leading `# Heading` stays for GitHub readers and is
  dropped on the site (Starlight renders the title).
- Link pages as `other.md#anchor` and repository files as `../path` - the
  plugin in `plugins/docs-links.mjs` turns them into site URLs and GitHub
  links.
- A new page also needs an entry in the `sidebar` of `astro.config.mjs` (and an
  icon in `Sidebar.astro`).
- GitHub alerts (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`,
  `[!CAUTION]`) render as calm cards on the site (red tint for warning and
  caution) and natively on GitHub.
- The first paragraph of a page is styled as its lead.
- `features.md` is written as plain Markdown with light inline HTML that the
  site CSS turns into cards: one `##` per area, then
  `<div class="area">` holding the area's phone screenshot (first), then
  each feature as `###` + `<small class="where">where in the app</small>` +
  text, closed by `</div>`; the chips at the top are the
  `<nav class="area-chips">` list. A new area needs an icon in `inboxrake.css`.
- The start page (`index.md`) is plain Markdown too: the lists inside
  `<div class="cards">` / `<div class="cards cards--small">` become cards (a
  `**[Title](page.md)**\` line, then the text; the icon follows the link
  target, see `src/styles/inboxrake-pages.css`). The blockquote between
  `<!-- demo:start -->` and `<!-- demo:end -->` becomes the "Try it before you
  install" banner, and is dropped while the demo is not live (the plugin reads
  the same `INBOXRAKE_DEMO_LIVE` switch). Astro caches rendered Markdown in
  `node_modules/.astro`: delete it when you flip the switch locally.
- `faq.md` is one `##` per group, then each question as
  `<details class="faq-q"><summary><h3 id="...">Question</h3><span
  class="faq-short">short answer</span></summary>` + the full answer as
  Markdown + `</details>`. The short answer must be text that is already in
  the full answer; keep the `id` (it is the old heading anchor, search results
  and links use it - a small head script opens the card a link points to).
- A GitHub alert that opens with a bold lead-in (`> **Title.** text`) shows
  the lead-in as the callout's title.
- The 404 page (search field + links) is `src/components/Hero.astro`.
- Invented `.example` data only (see CONTRIBUTING.md, "Privacy").

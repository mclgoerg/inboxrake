import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { docsLinks } from "./plugins/docs-links.mjs";
import { BASE } from "./site.config.mjs";

// The documentation site is a static build of ../docs, served under
// https://inboxrake.com/docs/ (the deploy PR merges it with the landing
// page and the demo into one tree).
export default defineConfig({
  site: "https://inboxrake.com",
  base: BASE,
  trailingSlash: "always",
  markdown: { remarkPlugins: [docsLinks] },
  integrations: [
    starlight({
      title: "Inboxrake",
      logo: { src: "./public/favicon.svg", replacesTitle: false },
      customCss: ["./src/styles/inboxrake.css", "./src/styles/inboxrake-pages.css"],
      components: {
        Header: "./src/components/Header.astro",
        SiteTitle: "./src/components/SiteTitle.astro",
        ThemeSelect: "./src/components/ThemeSelect.astro",
        MobileMenuFooter: "./src/components/MobileMenuFooter.astro",
        MobileTableOfContents: "./src/components/MobileTableOfContents.astro",
        Sidebar: "./src/components/Sidebar.astro",
        PageTitle: "./src/components/PageTitle.astro",
        Hero: "./src/components/Hero.astro",
      },
      // Code blocks are dark-warm in both themes (like the landing page's
      // install card); the page-specific darkness is set in inboxrake.css.
      expressiveCode: {
        themes: ["github-dark-default"],
        useStarlightUiThemeColors: false,
        styleOverrides: {
          borderRadius: "16px",
          borderColor: "transparent",
          codeBackground: "#1d1b19",
          codeForeground: "#eae4da",
          frames: {
            frameBoxShadowCssValue: "none",
            editorTabBarBackground: "#1d1b19",
            editorActiveTabBackground: "#3a3632",
            editorActiveTabForeground: "#d9d2c6",
            editorActiveTabBorderColor: "transparent",
            editorActiveTabIndicatorTopColor: "#d98d2b",
            editorTabBarBorderBottomColor: "transparent",
            terminalBackground: "#1d1b19",
            terminalTitlebarBackground: "#1d1b19",
            terminalTitlebarForeground: "#d9d2c6",
            terminalTitlebarDotsForeground: "#5f5951",
            terminalTitlebarBorderBottomColor: "transparent",
            inlineButtonBackground: "#2f2c29",
            inlineButtonForeground: "#d9d2c6",
          },
        },
      },
      description:
        "Self-hosted cleanup for a mailbox that piled up: see which senders fill it, then trash, block or unsubscribe in bulk.",
      head: [
        // FAQ: a link to a question (search result, shared URL) opens its card
        {
          tag: "script",
          content:
            'addEventListener("DOMContentLoaded",function(){function o(){var e=location.hash.length>1&&document.getElementById(decodeURIComponent(location.hash.slice(1))),d=e&&e.closest("details");if(d&&!d.open){d.open=true;e.scrollIntoView()}}addEventListener("hashchange",o);o()})',
        },
        { tag: "meta", attrs: { property: "og:image", content: "https://inboxrake.com/og.png" } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
      ],
      editLink: {
        baseUrl: "https://github.com/mclgoerg/inboxrake/edit/main/docs/",
      },
      sidebar: [
        {
          label: "Get started",
          items: [
            { label: "Introduction", slug: "" },
            { label: "Install", slug: "install" },
            { label: "Configuration", slug: "configuration" },
            { label: "Providers & OAuth", slug: "providers" },
          ],
        },
        {
          label: "Using Inboxrake",
          items: [
            { label: "Filter syntax", slug: "filters" },
            { label: "Features", slug: "features" },
            { label: "Security & privacy", slug: "security" },
            { label: "FAQ", slug: "faq" },
          ],
        },
      ],
    }),
  ],
});

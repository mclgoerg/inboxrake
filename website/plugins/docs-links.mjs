import { BASE } from "../site.config.mjs";
import { DEMO_LIVE } from "../landing/site.mjs";

const REPO = "https://github.com/mclgoerg/inboxrake/blob/main/";

function visitLinks(node, fn) {
  if (node.type === "link") fn(node);
  for (const child of node.children ?? []) visitLinks(child, fn);
}

function plain(node) {
  return node.value ?? (node.children ?? []).map(plain).join("");
}

// GitHub alert kinds (`> [!WARNING]`), shown as calm cards on the site.
const ALERTS = {
  NOTE: "Note",
  TIP: "Tip",
  IMPORTANT: "Important",
  WARNING: "Warning",
  CAUTION: "Caution",
};

function visitBlockquotes(node, fn) {
  if (node.type === "blockquote") fn(node);
  for (const child of node.children ?? []) visitBlockquotes(child, fn);
}

/**
 * Remark plugin that lets docs/*.md read well on GitHub AND on the site:
 *  - drops the leading `# H1` (Starlight renders the frontmatter title),
 *  - `page.md#x` -> the page's site URL,
 *  - `../path` (outside docs/) -> the file on GitHub,
 *  - GitHub alerts (`> [!WARNING]` ...) -> `<aside class="ir-aside ...">`
 *    with a title (GitHub renders the same markdown natively); an alert
 *    that opens with a bold lead-in ("**Title.** text") takes it as its title,
 *  - the blockquote between `<!-- demo:start -->` and `<!-- demo:end -->`
 *    (index.md) -> the "Try it before you install" banner, or nothing while
 *    the demo is not live (same build switch as the header button).
 */
export function docsLinks() {
  return (tree, file) => {
    const base = `${BASE}/`;
    const first = tree.children.findIndex(
      (n) => n.type === "heading" && n.depth === 1,
    );
    if (first === 0) tree.children.splice(0, 1);

    const isComment = (n, what) => n.type === "html" && n.value.trim() === `<!-- ${what} -->`;
    const from = tree.children.findIndex((n) => isComment(n, "demo:start"));
    const to = tree.children.findIndex((n) => isComment(n, "demo:end"));
    if (from >= 0 && to > from) {
      const banner = tree.children.slice(from + 1, to);
      if (DEMO_LIVE) {
        for (const q of banner) {
          if (q.type !== "blockquote") continue;
          q.data = { hName: "aside", hProperties: { className: ["demo-banner"] } };
          visitLinks(q, (a) => { a.url = a.url.replace(/^https:\/\/inboxrake\.com(?=\/demo\/)/, ""); });
        }
        tree.children.splice(from, to - from + 1, ...banner);
      } else {
        tree.children.splice(from, to - from + 1);
      }
    }

    visitBlockquotes(tree, (node) => {
      const para = node.children[0];
      const text = para?.type === "paragraph" ? para.children[0] : null;
      const m = text?.type === "text" && text.value.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/);
      if (!m) return;
      let label = ALERTS[m[1]];
      text.value = text.value.slice(m[0].length);
      if (!text.value) para.children.shift();
      // "**Typos can widen a filter.** ..." -> the bold lead-in is the title
      const lead = para.children[0];
      if (lead?.type === "strong") {
        label = lead.children.map(plain).join("").replace(/\.$/, "");
        para.children.shift();
        const next = para.children[0];
        if (next?.type === "text") next.value = next.value.replace(/^\s+/, "");
      }
      node.data = {
        hName: "aside",
        hProperties: { className: ["ir-aside", `ir-aside--${m[1].toLowerCase()}`], "aria-label": label },
      };
      node.children.unshift({
        type: "paragraph",
        data: { hProperties: { className: ["ir-aside-title"], "aria-hidden": "true" } },
        children: [{ type: "text", value: label }],
      });
    });

    visitLinks(tree, (node) => {
      const url = node.url;
      if (/^([a-z]+:|#|\/)/i.test(url)) return;
      if (url.startsWith("../")) {
        node.url = REPO + url.replace(/^(\.\.\/)+/, "");
        return;
      }
      const m = url.match(/^([\w-]+)\.md(#.*)?$/);
      if (m) {
        const slug = m[1] === "index" ? "" : `${m[1]}/`;
        node.url = `${base}${slug}${m[2] ?? ""}`;
      }
    });
  };
}

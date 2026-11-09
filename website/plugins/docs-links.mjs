import { BASE } from "../site.config.mjs";

const REPO = "https://github.com/mclgoerg/inboxrake/blob/main/";

function visitLinks(node, fn) {
  if (node.type === "link") fn(node);
  for (const child of node.children ?? []) visitLinks(child, fn);
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
 *    with a title (GitHub renders the same markdown natively).
 */
export function docsLinks() {
  return (tree, file) => {
    const base = `${BASE}/`;
    const first = tree.children.findIndex(
      (n) => n.type === "heading" && n.depth === 1,
    );
    if (first === 0) tree.children.splice(0, 1);

    visitBlockquotes(tree, (node) => {
      const para = node.children[0];
      const text = para?.type === "paragraph" ? para.children[0] : null;
      const m = text?.type === "text" && text.value.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/);
      if (!m) return;
      const label = ALERTS[m[1]];
      text.value = text.value.slice(m[0].length);
      if (!text.value) para.children.shift();
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

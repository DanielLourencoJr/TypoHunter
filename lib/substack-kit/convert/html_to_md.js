import { escapeMd, decodeEntities, normalizeNewlines } from "../args.js";

// ---------- Tiny HTML tokenizer -> tree ----------

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr"
]);

const SKIP_TAGS = new Set([
  "script", "style", "svg", "button", "form", "input", "noscript",
  "template", "textarea", "select", "option"
]);

function parseAttrs(raw) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(raw))) {
    const val = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : "";
    attrs[m[1]] = val
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#x27;/g, "'");
  }
  return attrs;
}

function tokenize(html) {
  const tokens = [];
  let i = 0;
  const n = html.length;
  while (i < n) {
    if (html[i] !== "<") {
      const end = html.indexOf("<", i);
      const e = end === -1 ? n : end;
      if (e > i) tokens.push({ t: "text", v: html.slice(i, e) });
      i = e;
      continue;
    }
    if (html.startsWith("<!--", i)) {
      const e = html.indexOf("-->", i);
      i = e === -1 ? n : e + 3;
      continue;
    }
    if (/^<!doctype/i.test(html.slice(i))) {
      const e = html.indexOf(">", i);
      i = e === -1 ? n : e + 1;
      continue;
    }
    if (html.startsWith("</", i)) {
      const m = /^<\/([a-zA-Z0-9-]+)\s*>/.exec(html.slice(i));
      if (m) {
        tokens.push({ t: "close", name: m[1].toLowerCase() });
        i += m[0].length;
        continue;
      }
    }
    let j = i + 1;
    let inq = null;
    for (; j < n; j++) {
      const c = html[j];
      if (inq) {
        if (c === inq) inq = null;
      } else if (c === '"' || c === "'") {
        inq = c;
      } else if (c === ">") {
        break;
      }
    }
    if (j >= n) {
      if (i + 1 < n) tokens.push({ t: "text", v: html.slice(i + 1) });
      break;
    }
    const raw = html.slice(i + 1, j);
    const nameMatch = /^([a-zA-Z0-9-]+)/.exec(raw);
    const name = nameMatch ? nameMatch[1].toLowerCase() : "";
    const attrsRaw = nameMatch ? raw.slice(nameMatch[0].length) : raw;
    tokens.push({
      t: "open",
      name,
      attrs: parseAttrs(attrsRaw),
      self: /\/\s*$/.test(attrsRaw) || VOID_TAGS.has(name)
    });
    i = j + 1;
  }
  return tokens;
}

function buildTree(tokens) {
  const root = { name: "#root", attrs: {}, children: [] };
  const stack = [root];
  for (const tk of tokens) {
    const top = stack[stack.length - 1];
    if (tk.t === "text") {
      top.children.push({ name: "#text", text: tk.v, children: [] });
    } else if (tk.t === "open") {
      const node = { name: tk.name, attrs: tk.attrs, children: [] };
      top.children.push(node);
      if (!tk.self && !VOID_TAGS.has(tk.name)) stack.push(node);
    } else if (tk.t === "close") {
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s].name === tk.name) {
          stack.length = s;
          break;
        }
      }
    }
  }
  return root;
}

// ---------- Markdown rendering ----------

function imageMd(node) {
  let src = "";
  const da = node.attrs["data-attrs"];
  if (da) {
    try {
      const j = JSON.parse(da);
      if (j && j.src) src = j.src;
    } catch {}
  }
  if (!src) src = node.attrs.src || "";
  const alt = escapeMd(decodeEntities(node.attrs.alt || ""));
  return `![${alt || src}](${src})`;
}

function inline(node) {
  if (!node) return "";
  if (node.name === "#text") return escapeMd(decodeEntities(node.text));
  const inner = node.children.map(inline).join("");
  switch (node.name) {
    case "br": return "  \n";
    case "strong": case "b": return `**${inner}**`;
    case "em": case "i": return `*${inner}*`;
    case "s": case "strike": case "del": return `~~${inner}~~`;
    case "code": return `\`${inner}\``;
    case "mark": return inner;
    case "a": {
      const href = node.attrs.href || node.attrs.url || "";
      return href ? `[${inner}](${href})` : inner;
    }
    case "img": return imageMd(node);
    default: return inner;
  }
}

function blockText(node) {
  return node.children.map(inline).join("").replace(/\s+/g, " ").trim();
}

function renderPre(node) {
  const collect = (nd) => {
    let t = "";
    for (const c of nd.children) {
      if (c.name === "#text") t += c.text;
      else if (c.name === "br") t += "\n";
      else t += collect(c);
    }
    return t;
  };
  const code = collect(node).replace(/^\n+|\n+$/g, "");
  return ["```\n" + code + "\n```"];
}

function renderTable(node) {
  const rows = [];
  const collectRows = (nd) => {
    for (const ch of nd.children || []) {
      if (ch.name === "tr") {
        const cells = [];
        for (const td of ch.children || []) {
          if (td.name === "td" || td.name === "th") cells.push(blockText(td));
        }
        rows.push(cells);
      } else collectRows(ch);
    }
  };
  collectRows(node);
  if (!rows.length) return [];
  const cols = Math.max(...rows.map((r) => r.length));
  const norm = (r) => {
    const c = r.slice();
    while (c.length < cols) c.push("");
    return c.map((x) => x.replace(/\|/g, "\\|"));
  };
  const header = rows[0];
  const body = rows.slice(1).filter((r) => r.some(Boolean));
  const lines = [
    `| ${norm(header).join(" | ")} |`,
    `| ${norm(header).map(() => "---").join(" | ")} |`
  ];
  for (const r of body) lines.push(`| ${norm(r).join(" | ")} |`);
  return [lines.join("\n")];
}

function renderList(node, level = 0, ctx = {}) {
  const indent = "  ".repeat(level);
  const lines = [];
  let n = 0;
  const items = (node.children || []).filter((c) => c.name === "li");
  for (const li of items) {
    const marker = node.name === "ol" ? `${++n}. ` : "- ";
    const lists = (li.children || []).filter((c) => c.name === "ul" || c.name === "ol");
    const rest = (li.children || []).filter((c) => c.name !== "ul" && c.name !== "ol");
    const blocks = renderBlocks(rest, ctx);
    const first = blocks.find((b) => String(b).trim());
    if (first) {
      const [firstLine, ...restLines] = String(first).split("\n");
      lines.push(indent + marker + firstLine);
      for (const rl of restLines) lines.push(indent + "    " + rl);
    } else {
      lines.push(indent + marker);
    }
    for (const list of lists) {
      const sub = renderList(list, level + 1, ctx);
      for (const s of sub) lines.push(indent + s);
    }
  }
  return lines;
}

function minHeadingLevel(root) {
  let min = 7;
  const walk = (nd) => {
    for (const ch of nd.children || []) {
      if (/^h[1-6]$/.test(ch.name)) {
        min = Math.min(min, parseInt(ch.name[1]));
      }
      walk(ch);
    }
  };
  walk(root);
  return min;
}

function renderBlockquote(node, ctx) {
  const blocks = renderBlocks(node.children, ctx);
  const out = [];
  for (const b of blocks) {
    for (const l of String(b).split("\n")) {
      out.push(l ? `> ${l}` : ">");
    }
  }
  return [out.join("\n")];
}

function isWidget(node) {
  const cls = node.attrs.class || "";
  return (
    SKIP_TAGS.has(node.name) ||
    cls.includes("subscription-widget") ||
    cls.includes("pencraft") ||
    cls.includes("header-") ||
    cls.includes("footer-") ||
    cls.includes("tabs-header")
  );
}

function renderBlocks(children, ctx = {}) {
  const out = [];
  for (const c of children) {
    if (!c) continue;
    if (c.name === "#text") {
      const t = decodeEntities(c.text).trim();
      if (t) out.push(t);
      continue;
    }
    switch (c.name) {
      case "p": {
        const t = blockText(c);
        if (t) out.push(t);
        break;
      }
      case "h1": case "h2": case "h3":
      case "h4": case "h5": case "h6": {
        const raw = parseInt(c.name[1]);
        const level = Math.min(raw + (ctx.offset || 0), 6);
        const t = blockText(c);
        if (t) out.push(`${"#".repeat(level)} ${t}`);
        break;
      }
      case "hr":
        out.push("---");
        break;
      case "br":
        break;
      case "ul": case "ol": {
        const list = renderList(c, 0, ctx);
        const listStr = list.join("\n").replace(/\n{3,}/g, "\n\n");
        if (listStr.trim()) out.push(listStr);
        break;
      }
      case "blockquote": {
        const q = renderBlockquote(c, ctx)[0];
        if (q) out.push(q);
        break;
      }
      case "pre":
        out.push(...renderPre(c));
        break;
      case "img":
        out.push(imageMd(c));
        break;
      case "figure": {
        let img = null;
        let caption = "";
        const walk = (nd) => {
          for (const ch of nd.children || []) {
            if (ch.name === "img") img = img || ch;
            else if (ch.name === "figcaption") {
              caption = blockText(ch);
            } else walk(ch);
          }
        };
        walk(c);
        if (img) {
          out.push(imageMd(img));
          if (caption) out.push(`*${caption}*`);
        } else if (caption) {
          out.push(`*${caption}*`);
        }
        break;
      }
      case "table":
        out.push(...renderTable(c));
        break;
      case "a": {
        const href = c.attrs.href || "";
        const t = c.children.map(inline).join("");
        out.push(href ? `[${t}](${href})` : t);
        break;
      }
      case "div": {
        if (isWidget(c)) break;
        const nested = renderBlocks(c.children, ctx).join("\n\n");
        if (nested.trim()) out.push(nested);
        break;
      }
      default: {
        if (SKIP_TAGS.has(c.name)) break;
        const nested = renderBlocks(c.children, ctx).join("\n\n");
        if (nested.trim()) out.push(nested);
        break;
      }
    }
  }
  return out;
}

/**
 * Convert a post's body_html to Markdown.
 */
export function htmlToMarkdown(html) {
  const cleaned = String(html ?? "").replace(/<!--[\s\S]*?-->/g, "");
  const root = buildTree(tokenize(cleaned));
  const minLevel = minHeadingLevel(root);
  const ctx = { offset: minLevel <= 1 ? 1 : 0 };
  const blocks = renderBlocks(root.children, ctx);
  const text = blocks
    .filter(Boolean)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return normalizeNewlines(text) + "\n";
}

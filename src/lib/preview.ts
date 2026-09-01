export type ProjectFile = { path: string; content: string };
export type Project = {
  name: string;
  summary: string;
  entry: string;
  files: ProjectFile[];
};

function normalize(path: string) {
  const parts: string[] = [];
  for (const seg of path.replace(/^\.?\//, "").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

function resolveRelative(from: string, spec: string) {
  const base = from.split("/").slice(0, -1).join("/");
  return normalize(base ? `${base}/${spec}` : spec);
}

function toDataUrl(content: string, mime: string) {
  const bytes = new TextEncoder().encode(content);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return `data:${mime};base64,${btoa(binary)}`;
}

const JS_MIME = "text/javascript";

const ERROR_HOOK = `<script>
(function(){
  // sandboxed iframes have an opaque origin: storage access throws, so shim it.
  try { window.localStorage.getItem('__velix'); } catch (err) {
    var store = {};
    var shim = {
      getItem: function(k){ return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function(k, v){ store[k] = String(v); },
      removeItem: function(k){ delete store[k]; },
      clear: function(){ store = {}; },
      key: function(i){ return Object.keys(store)[i] || null; },
      get length(){ return Object.keys(store).length; }
    };
    try { Object.defineProperty(window, 'localStorage', { value: shim, configurable: true }); } catch (e2) {}
    try { Object.defineProperty(window, 'sessionStorage', { value: shim, configurable: true }); } catch (e3) {}
  }
  function post(kind, message, stack){
    try { parent.postMessage({ __velix: true, kind: kind, message: String(message||''), stack: String(stack||'') }, '*'); } catch(e){}
  }
  window.addEventListener('error', function(e){ post('error', e.message, (e.error && e.error.stack) || (e.filename + ':' + e.lineno)); });
  window.addEventListener('unhandledrejection', function(e){ post('error', (e.reason && e.reason.message) || e.reason, (e.reason && e.reason.stack) || ''); });
  var ce = console.error.bind(console);
  console.error = function(){ post('console', Array.prototype.map.call(arguments, String).join(' '), ''); ce.apply(null, arguments); };
})();
</script>`;

/**
 * Inline every project file into a single self-contained HTML document so the
 * generated app runs inside a sandboxed iframe with no server and no bundler.
 */
export function buildPreviewHtml(project: Project): string {
  const map = new Map<string, string>();
  for (const f of project.files) map.set(normalize(f.path), f.content);

  const entry = normalize(project.entry || "index.html");
  let html = map.get(entry) ?? map.get("index.html") ?? "";
  if (!html) {
    const firstHtml = [...map.entries()].find(([p]) => p.endsWith(".html"));
    html = firstHtml?.[1] ?? "<h1>No index.html generated</h1>";
  }

  const moduleCache = new Map<string, string>();

  function moduleUrl(path: string, seen: Set<string> = new Set()): string {
    const key = normalize(path);
    const cached = moduleCache.get(key);
    if (cached) return cached;
    let source = map.get(key);
    if (source === undefined) {
      for (const ext of [".js", ".jsx", ".ts", ".tsx", "/index.js"]) {
        const alt = map.get(key + ext);
        if (alt !== undefined) {
          source = alt;
          break;
        }
      }
    }
    if (source === undefined) return key;
    if (seen.has(key)) return toDataUrl("", JS_MIME);
    seen.add(key);

    const rewritten = source.replace(
      /(\bfrom\s*|\bimport\s*|\bimport\(\s*)(["'])(\.\.?\/[^"']+)\2/g,
      (_m, prefix: string, quote: string, spec: string) => {
        const target = resolveRelative(key, spec);
        if (/\.(css)$/.test(target)) return `${prefix}${quote}${toDataUrl(map.get(target) ?? "", "text/css")}${quote}`;
        return `${prefix}${quote}${moduleUrl(target, seen)}${quote}`;
      },
    );

    const url = toDataUrl(rewritten, JS_MIME);
    moduleCache.set(key, url);
    return url;
  }

  // inline stylesheets
  html = html.replace(
    /<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi,
    (tag) => {
      const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
      if (!href || /^(https?:)?\/\//.test(href) || href.startsWith("data:")) return tag;
      const css = map.get(resolveRelative(entry, href)) ?? map.get(normalize(href));
      return css === undefined ? tag : `<style>\n${css}\n</style>`;
    },
  );

  // inline scripts (module / babel / classic)
  html = html.replace(/<script\b([^>]*)>\s*<\/script>/gi, (tag, attrs: string) => {
    const src = /src=["']([^"']+)["']/i.exec(attrs)?.[1];
    if (!src || /^(https?:)?\/\//.test(src) || src.startsWith("data:")) return tag;
    const path = resolveRelative(entry, src);
    const isModule = /type=["'](module|text\/babel)["']/i.test(attrs) || /data-type=["']module["']/i.test(attrs);
    if (isModule) {
      const rest = attrs.replace(/\ssrc=["'][^"']+["']/i, "");
      return `<script${rest} src="${moduleUrl(path)}"></script>`;
    }
    const code = map.get(path);
    if (code === undefined) return tag;
    const rest = attrs.replace(/\ssrc=["'][^"']+["']/i, "");
    return `<script${rest}>\n${code}\n</script>`;
  });

  if (/<head[^>]*>/i.test(html)) html = html.replace(/<head([^>]*)>/i, `<head$1>${ERROR_HOOK}`);
  else html = ERROR_HOOK + html;

  return html;
}

/** Turn a flat file list into a nested tree for the explorer. */
export type TreeNode = {
  name: string;
  path: string;
  children?: TreeNode[];
};

export function buildTree(files: ProjectFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const segs = normalize(file.path).split("/");
    let level = root;
    segs.forEach((seg, i) => {
      const isLeaf = i === segs.length - 1;
      const path = segs.slice(0, i + 1).join("/");
      let node = level.find((n) => n.name === seg && !!n.children === !isLeaf);
      if (!node) {
        node = isLeaf ? { name: seg, path } : { name: seg, path, children: [] };
        level.push(node);
      }
      if (!isLeaf) level = node.children!;
    });
  }
  const sort = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .sort((a, b) => Number(!!b.children) - Number(!!a.children) || a.name.localeCompare(b.name))
      .map((n) => (n.children ? { ...n, children: sort(n.children) } : n));
  return sort(root);
}

/** Repair a JSON object that was cut off mid-generation. */
function repairJson(text: string): string {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let out = text;
  if (inString) out += '"';
  out = out.replace(/,\s*$/, "");
  while (stack.length) out += stack.pop() === "{" ? "}" : "]";
  return out;
}

/** Extract a JSON project object from a model reply that may contain noise. */
export function parseProject(raw: string): Project {
  let text = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1] && fenced[1].trim().startsWith("{")) text = fenced[1].trim();

  const start = text.indexOf("{");
  let parsed: (Partial<Project> & { files?: ProjectFile[] | Record<string, string> }) | null = null;

  if (start !== -1) {
    const body = text.slice(start);
    const candidates = [body.slice(0, body.lastIndexOf("}") + 1), repairJson(body)];
    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        parsed = JSON.parse(candidate);
        break;
      } catch {
        /* try the next candidate */
      }
    }
  }

  let files: ProjectFile[] = [];
  if (Array.isArray(parsed?.files))
    files = parsed.files.filter((f) => f && f.path && typeof f.content === "string");
  else if (parsed?.files && typeof parsed.files === "object")
    files = Object.entries(parsed.files).map(([path, content]) => ({
      path,
      content: String(content),
    }));

  // Fallback: the model returned raw HTML instead of a JSON project.
  if (files.length === 0) {
    const html =
      /<!DOCTYPE html[\s\S]*<\/html>/i.exec(raw)?.[0] ?? (/^\s*<[\s\S]+>/.test(raw) ? raw : "");
    if (html.trim()) files = [{ path: "index.html", content: html.trim() }];
  }

  if (files.length === 0) throw new Error("Model did not return a project. Try sending again.");

  return {
    name: parsed?.name || "velix-app",
    summary: parsed?.summary ?? "",
    entry: parsed?.entry || "index.html",
    files,
  };
}

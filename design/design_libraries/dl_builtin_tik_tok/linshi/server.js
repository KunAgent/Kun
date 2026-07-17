'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const TOOL_DIR = __dirname;
const TOKENS_FILE = path.join(PROJECT_ROOT, 'colors_and_type.css');
const PORT = process.env.PORT ? Number(process.env.PORT) : 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({ 'Cache-Control': 'no-store' }, headers || {}));
  res.end(body);
}

function sendJSON(res, obj) {
  send(res, 200, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

// Build the resource tree the tool exposes in the left navigation.
function buildTree() {
  const tree = [];

  // icons/*.svg — collapsed into a single gallery entry
  const iconsDir = path.join(PROJECT_ROOT, 'icons');
  if (fs.existsSync(iconsDir)) {
    const icons = fs.readdirSync(iconsDir)
      .filter((f) => f.toLowerCase().endsWith('.svg'))
      .sort()
      .map((f) => ({ name: f, url: '/icons/' + f }));
    tree.push({
      group: 'Icons',
      kind: 'icons',
      items: [{ name: 'Icon Library', type: 'icon-gallery', url: '/icons/', icons }],
    });
  }

  // preview/*.html
  const previewDir = path.join(PROJECT_ROOT, 'preview');
  if (fs.existsSync(previewDir)) {
    const items = fs.readdirSync(previewDir)
      .filter((f) => f.toLowerCase().endsWith('.html'))
      .sort()
      .map((f) => ({ name: f, type: 'html', url: '/preview/' + f }));
    tree.push({ group: 'Component Previews', kind: 'html', items });
  }

  // ui_kits/**/*.html (recursive)
  const uiDir = path.join(PROJECT_ROOT, 'ui_kits');
  if (fs.existsSync(uiDir)) {
    const items = [];
    const walk = (dir, rel) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const abs = path.join(dir, entry.name);
        const r = rel ? rel + '/' + entry.name : entry.name;
        if (entry.isDirectory()) walk(abs, r);
        else if (entry.name.toLowerCase().endsWith('.html')) {
          items.push({ name: r, type: 'html', url: '/ui_kits/' + r });
        }
      }
    };
    walk(uiDir, '');
    tree.push({ group: 'UI Kits', kind: 'html', items });
  }

  // Single files: css + markdown docs
  const docs = [];
  if (fs.existsSync(path.join(PROJECT_ROOT, 'colors_and_type.css'))) {
    docs.push({ name: 'colors_and_type.css', type: 'css', url: '/colors_and_type.css' });
  }
  if (fs.existsSync(path.join(PROJECT_ROOT, 'README.md'))) {
    docs.push({ name: 'README.md', type: 'md', url: '/README.md' });
  }
  if (fs.existsSync(path.join(PROJECT_ROOT, 'SKILL.md'))) {
    docs.push({ name: 'SKILL.md', type: 'md', url: '/SKILL.md' });
  }
  if (docs.length) tree.push({ group: 'Foundations & Docs', kind: 'doc', items: docs });

  return tree;
}

// ---- colors_and_type.css token parsing & writeback ----
//
// We parse the CSS into an ordered list of blocks (`:root`, `.dark`). Each
// block keeps its tokens in source order, and every token remembers the most
// recent comment group it belongs to so the editor can render and reorder
// within groups and we can serialize the file back with structure intact.

function parseTokens(css) {
  const blocks = [];
  // Match `selector { ... }` blocks (e.g. :root, .dark).
  const blockRe = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = blockRe.exec(css))) {
    // Selector may carry preceding comments/whitespace; keep the trailing token.
    const selector = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim().split(/\s+/).pop();
    const body = m[2];
    if (!/^(:root|\.dark)$/.test(selector)) continue;
    const tokens = [];
    let group = '';
    // Walk the body line-ish: comments set the current group, --decls are tokens.
    const partRe = /\/\*([\s\S]*?)\*\/|(--[\w- ]+)\s*:\s*([^;]+);/g;
    let p;
    while ((p = partRe.exec(body))) {
      if (p[1] !== undefined) {
        const c = p[1].trim();
        // Ignore the boilerplate "Source: ..." comment as a group label.
        if (!/^source\s*:/i.test(c)) group = c;
      } else if (p[2] !== undefined) {
        tokens.push({ name: p[2].trim(), value: p[3].trim(), group });
      }
    }
    blocks.push({ selector, tokens });
  }
  return blocks;
}

function isColor(v) {
  return /^#([0-9a-f]{3,8})$/i.test(v) || /^(rgb|rgba|hsl|hsla)\(/i.test(v);
}

function serializeTokens(blocks) {
  let out = '/* TikTok color and type tokens */\n/* Source: structured-spec */\n';
  blocks.forEach((block) => {
    out += '\n' + block.selector + ' {\n';
    out += '  /* Source: structured-spec */\n';
    let lastGroup = null;
    block.tokens.forEach((t) => {
      const group = t.group || '';
      if (group !== lastGroup) {
        if (lastGroup !== null) out += '\n';
        if (group) out += '  /* ' + group + ' */\n';
        lastGroup = group;
      }
      out += '  ' + t.name + ': ' + t.value + ';\n';
    });
    out += '}\n';
  });
  return out;
}

// Resolve a request URL to an absolute path, blocking traversal outside the root.
function resolveSafe(base, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const target = path.normalize(path.join(base, decoded));
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}

function serveFile(res, absPath) {
  fs.stat(absPath, (err, stat) => {
    if (err || !stat.isFile()) {
      send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }
    const ext = path.extname(absPath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    fs.createReadStream(absPath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  const pathname = url.split('?')[0];

  // Tool entry
  if (pathname === '/' || pathname === '/index.html') {
    serveFile(res, path.join(TOOL_DIR, 'index.html'));
    return;
  }

  // Tool static assets
  if (pathname === '/app.js' || pathname === '/style.css') {
    serveFile(res, path.join(TOOL_DIR, pathname.slice(1)));
    return;
  }

  // API: resource tree
  if (pathname === '/api/tree') {
    sendJSON(res, { root: PROJECT_ROOT, tree: buildTree() });
    return;
  }

  // API: raw file source (text) for source view of css/md/html
  if (pathname === '/api/raw') {
    const q = new URL(url, 'http://localhost').searchParams.get('path') || '';
    const abs = resolveSafe(PROJECT_ROOT, q);
    if (!abs) { send(res, 400, 'Bad path', { 'Content-Type': 'text/plain' }); return; }
    fs.readFile(abs, 'utf8', (err, data) => {
      if (err) { send(res, 404, 'Not found', { 'Content-Type': 'text/plain' }); return; }
      send(res, 200, data, { 'Content-Type': 'text/plain; charset=utf-8' });
    });
    return;
  }

  // API: token editor for colors_and_type.css (GET parse, POST writeback)
  if (pathname === '/api/tokens') {
    if (req.method === 'GET') {
      fs.readFile(TOKENS_FILE, 'utf8', (err, data) => {
        if (err) { send(res, 404, 'Not found', { 'Content-Type': 'text/plain' }); return; }
        const blocks = parseTokens(data).map((b) => ({
          selector: b.selector,
          tokens: b.tokens.map((t) => ({ name: t.name, value: t.value, group: t.group, isColor: isColor(t.value) })),
        }));
        sendJSON(res, { blocks });
      });
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(body); } catch (e) { send(res, 400, 'Bad JSON', { 'Content-Type': 'text/plain' }); return; }
        if (!parsed || !Array.isArray(parsed.blocks)) { send(res, 400, 'Bad payload', { 'Content-Type': 'text/plain' }); return; }
        const css = serializeTokens(parsed.blocks);
        fs.writeFile(TOKENS_FILE, css, 'utf8', (err) => {
          if (err) { send(res, 500, 'Write failed', { 'Content-Type': 'text/plain' }); return; }
          sendJSON(res, { ok: true });
        });
      });
      return;
    }
    send(res, 405, 'Method not allowed', { 'Content-Type': 'text/plain' });
    return;
  }

  // Everything else is served from the project root so preview relative
  // paths (e.g. ../colors_and_type.css) resolve correctly inside iframes.
  const abs = resolveSafe(PROJECT_ROOT, pathname);
  if (!abs) { send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain' }); return; }
  serveFile(res, abs);
});

server.listen(PORT, () => {
  console.log('TikTok asset preview tool running at http://localhost:' + PORT + '/');
  console.log('Serving project root: ' + PROJECT_ROOT);
});

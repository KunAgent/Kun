#!/usr/bin/env node
import fs from 'fs';
import http from 'http';
import path from 'path';
import { pathToFileURL } from 'url';
import { injectPreviewWatermark } from './watermark-utils.mjs';

let MarkdownIt = null;
try {
  MarkdownIt = (await import('markdown-it')).default;
} catch {
  MarkdownIt = null;
}
const markdownRenderer = MarkdownIt ? new MarkdownIt({ html: false, linkify: true, typographer: true }) : null;

function parseArgs(argv) {
  const options = {
    file: null,
    root: null,
    entry: null,
    host: '127.0.0.1',
    port: 4173,
    json: false,
    stateFile: null,
    ttlMs: 0,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--file') options.file = argv[++i] || null;
    else if (arg === '--root') options.root = argv[++i] || null;
    else if (arg === '--entry') options.entry = argv[++i] || null;
    else if (arg === '--host') options.host = argv[++i] || options.host;
    else if (arg === '--port') options.port = Number(argv[++i] || options.port);
    else if (arg === '--state-file') options.stateFile = argv[++i] || null;
    else if (arg === '--ttl-ms') options.ttlMs = Number(argv[++i] || options.ttlMs);
    else if (arg === '--json') options.json = true;
  }
  return options;
}

function validateArgs(options) {
  if (!options.file && !options.root) {
    throw new Error('用法: node scripts/presentation-preview-server.mjs --file <html或md文件> [--host 127.0.0.1] [--port 4173] [--ttl-ms 600000] [--state-file <json>] [--json]');
  }
  if (options.file) {
    const filePath = path.resolve(options.file);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`展示文件不存在：${filePath}`);
    }
    return {
      ...options,
      file: filePath,
      root: path.dirname(filePath),
      entry: options.entry || path.basename(filePath),
    };
  }
  const rootDir = path.resolve(options.root);
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    throw new Error(`静态目录不存在：${rootDir}`);
  }
  if (!options.entry) {
    throw new Error('使用 --root 时必须同时提供 --entry');
  }
  return { ...options, root: rootDir, entry: options.entry.replace(/^\/+/, '') };
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.md') return 'text/markdown; charset=utf-8';
  if (ext === '.txt') return 'text/plain; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function normalizeRequestPath(requestUrl, entry) {
  const url = new URL(requestUrl, 'http://127.0.0.1');
  const pathname = decodeURIComponent(url.pathname);
  if (pathname === '/' || pathname === '') return entry;
  return pathname.replace(/^\/+/, '');
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildMarkdownDocument(filePath, markdown) {
  const title = path.basename(filePath, path.extname(filePath));
  const bodyHtml = markdownRenderer
    ? markdownRenderer.render(markdown)
    : `<pre>${escapeHtml(markdown)}</pre>`;
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0;
      background: #f6f8fb;
      color: #172b4d;
      font-family: "PingFang SC", "Microsoft YaHei", Arial, sans-serif;
    }
    .page {
      max-width: 980px;
      margin: 0 auto;
      padding: 40px 24px 80px;
    }
    .doc {
      background: #fff;
      border-radius: 18px;
      box-shadow: 0 20px 48px rgba(15, 58, 110, 0.10);
      padding: 40px 44px;
      line-height: 1.78;
    }
    h1,h2,h3,h4,h5,h6 { color: #0f67ca; line-height: 1.35; }
    h1 { font-size: 2rem; margin-top: 0; }
    h2 { margin-top: 2rem; border-bottom: 1px solid #e7eef8; padding-bottom: .35rem; }
    p, li { font-size: 16px; }
    code, pre {
      font-family: Consolas, "SFMono-Regular", monospace;
      background: #f4f7fa;
      border-radius: 8px;
    }
    code { padding: 0.12em 0.35em; }
    pre { padding: 16px; overflow: auto; }
    blockquote {
      margin: 1rem 0;
      padding: 0.75rem 1rem;
      border-left: 4px solid #8ab8ff;
      background: #f7fbff;
      color: #39516f;
    }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th, td { border: 1px solid #dbe5f1; padding: 10px 12px; }
    th { background: #f4f8fc; }
    img { max-width: 100%; }
  </style>
</head>
<body>
  <div class="page"><article class="doc">${bodyHtml}</article></div>
</body>
</html>`;
  return injectPreviewWatermark(html);
}

function shouldRenderMarkdownAsHtml(filePath, req) {
  if (path.extname(filePath).toLowerCase() !== '.md') return false;
  const accept = String(req.headers.accept || '');
  return accept.includes('text/html') || accept.includes('*/*');
}

/**
 * 绑定 HTTP 服务；若显式端口被占用（EADDRINUSE），自动改用端口 0 由系统分配。
 */
function bindServerWithPortFallback(options) {
  const requestedPort = options.port;
  const tryListen = (port) => {
    const server = createHttpServer({ root: options.root, entry: options.entry });
    return new Promise((resolve, reject) => {
      const onError = (err) => {
        server.removeListener('error', onError);
        if (err.code === 'EADDRINUSE' && requestedPort !== 0 && port === requestedPort) {
          console.error(
            `[presentation-preview-server] 端口 ${requestedPort} 已被占用，改用系统分配端口`
          );
          tryListen(0).then(resolve).catch(reject);
          return;
        }
        reject(err);
      };
      server.once('error', onError);
      server.listen(port, options.host, () => {
        server.removeListener('error', onError);
        const addr = server.address();
        const listeningPort = typeof addr === 'object' && addr ? addr.port : port;
        resolve({
          server,
          listeningPort,
          portConflictResolved: requestedPort !== 0 && listeningPort !== requestedPort,
        });
      });
    });
  };
  return tryListen(requestedPort);
}

function createHttpServer({ root, entry }) {
  return http.createServer((req, res) => {
    try {
      const requestPath = normalizeRequestPath(req.url || '/', entry);
      const resolvedPath = path.resolve(root, requestPath);
      const normalizedRoot = `${path.resolve(root)}${path.sep}`;
      if (resolvedPath !== path.resolve(root) && !resolvedPath.startsWith(normalizedRoot)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }
      if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }

      if (shouldRenderMarkdownAsHtml(resolvedPath, req)) {
        const markdown = fs.readFileSync(resolvedPath, 'utf8');
        const html = buildMarkdownDocument(resolvedPath, markdown);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(html);
        return;
      }

      const mimeType = getMimeType(resolvedPath);
      if (mimeType.startsWith('text/html')) {
        const html = fs.readFileSync(resolvedPath, 'utf8');
        res.writeHead(200, { 'Content-Type': mimeType, 'Cache-Control': 'no-store' });
        res.end(injectPreviewWatermark(html));
        return;
      }

      res.writeHead(200, { 'Content-Type': mimeType });
      fs.createReadStream(resolvedPath).pipe(res);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Server Error: ${error.message}`);
    }
  });
}

export async function startPresentationPreviewServer(rawArgs = parseArgs(process.argv)) {
  const options = validateArgs(rawArgs);
  const { server, listeningPort, portConflictResolved } = await bindServerWithPortFallback(options);

  const route = `/${options.entry.replace(/^\/+/, '')}`;
  const url = `http://${options.host}:${listeningPort}${route}`;
  const payload = {
    pid: process.pid,
    url,
    rootDir: options.root,
    entry: options.entry.replace(/^\/+/, ''),
    route,
    ttlMs: options.ttlMs,
    requestedPort: options.port,
    listeningPort,
    portConflictResolved: !!portConflictResolved,
  };

  if (options.stateFile) {
    const stateFilePath = path.resolve(options.stateFile);
    fs.mkdirSync(path.dirname(stateFilePath), { recursive: true });
    fs.writeFileSync(stateFilePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  }

  if (options.ttlMs > 0) {
    const timer = setTimeout(() => {
      server.close(() => process.exit(0));
    }, options.ttlMs);
    timer.unref();
  }

  if (options.json) process.stdout.write(`${JSON.stringify(payload)}\n`);
  else process.stdout.write(`Presentation preview ready: ${url}\n`);
  return { server, ...payload };
}

export async function main() {
  try {
    await startPresentationPreviewServer();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  await main();
}

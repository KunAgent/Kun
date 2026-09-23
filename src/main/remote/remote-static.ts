import { createReadStream, existsSync, statSync, readFileSync } from 'node:fs'
import { extname, normalize, resolve, sep } from 'node:path'
import { createGzip } from 'node:zlib'
import type { IncomingMessage, ServerResponse } from 'node:http'

const REMOTE_STATIC_MAX_FILE_BYTES = 256 * 1024 * 1024

const REMOTE_MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
}

export function remoteMimeType(filePath: string): string {
  return REMOTE_MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

const REMOTE_GZIP_EXTENSIONS = new Set([
  '.html',
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.json',
  '.map',
  '.svg',
  '.txt',
  '.webmanifest'
])

const REMOTE_MODULE_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.map',
  '.wasm',
  '.ts',
  '.tsx',
  '.jsx',
  '.mts',
  '.cts',
  '.json'
])

export type ServeRemoteStaticOptions = {
  acceptEncoding?: string
}

export type RemoteStaticSource = 'bundle' | 'vite' | 'missing-bundle'

/** Asset extensions must 404 instead of receiving the SPA HTML shell. */
export function canFallbackToRemoteIndex(pathname: string): boolean {
  const ext = extname(pathname.split('?')[0] ?? '').toLowerCase()
  return ext === '' || ext === '.html' || ext === '.htm'
}

export function isRemoteModulePathname(pathname: string): boolean {
  if (
    pathname.startsWith('/@') ||
    pathname.startsWith('/src/') ||
    pathname.startsWith('/node_modules/')
  ) {
    return true
  }
  return REMOTE_MODULE_EXTENSIONS.has(extname(pathname.split('?')[0] ?? '').toLowerCase())
}

export function remoteResponseLooksLikeHtml(contentType: string): boolean {
  return /text\/html/i.test(contentType)
}

/** iPhone browsers and desktop Safari share WebKit's module-import failures. */
export function isWebKitRemoteClient(userAgent: string): boolean {
  if (/iP(?:hone|ad|od)/i.test(userAgent)) return true
  if (/Macintosh/i.test(userAgent) && /Mobile/i.test(userAgent)) return true
  return /Safari/i.test(userAgent) && !/Chrom(?:e|ium)|Android/i.test(userAgent)
}

export function shouldGzipRemoteAsset(ext: string, acceptEncoding = ''): boolean {
  return REMOTE_GZIP_EXTENSIONS.has(ext) && /\bgzip\b/i.test(acceptEncoding)
}

/**
 * Vite's unbundled graph dies on Safari/iPhone. Those clients always take the
 * packaged renderer; other browsers may still proxy to the dev server.
 */
export function chooseRemoteStaticSource(input: {
  hasBundledRenderer: boolean
  devUrl?: string
  userAgent?: string
}): RemoteStaticSource {
  const useVite = Boolean(input.devUrl) && !isWebKitRemoteClient(input.userAgent ?? '')
  if (useVite) return 'vite'
  return input.hasBundledRenderer ? 'bundle' : 'missing-bundle'
}

export const REMOTE_BUNDLE_REQUIRED_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Kun Remote</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: #0b0f1a; color: #e8ecf4; }
  main { width: min(420px, 100%); display: flex; flex-direction: column; gap: 12px; }
  h1 { font-size: 20px; margin: 0; }
  p { margin: 0; color: #9aa7bd; line-height: 1.55; font-size: 14px; }
  pre { margin: 0; padding: 12px 14px; border-radius: 10px; background: #171c29; color: #d7def0; }
</style>
</head>
<body>
<main>
  <h1>Remote needs a bundled workbench</h1>
  <p>Safari and iPhone cannot load the Vite development module graph. Build the renderer, then reopen this page.</p>
  <pre>npm run build</pre>
  <p>Packaged Kun already includes this bundle. If this page appears there, the install is incomplete.</p>
</main>
</body>
</html>
`

export function resolveRemoteStaticPath(root: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const rootResolved = resolve(root)
  const resolved = resolve(rootResolved, `.${normalize(`/${decoded}`)}`)
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + sep)) return null
  return resolved
}

/**
 * Serves the bundled renderer. Returns false when the path does not resolve
 * to a file so the caller can apply the SPA index.html fallback.
 */
export function serveRemoteStaticFile(
  root: string,
  pathname: string,
  res: ServerResponse,
  options: ServeRemoteStaticOptions = {}
): boolean {
  const resolved = resolveRemoteStaticPath(root, pathname)
  if (!resolved) return false
  let stat
  try {
    stat = statSync(resolved)
  } catch {
    return false
  }
  if (!stat.isFile() || stat.size > REMOTE_STATIC_MAX_FILE_BYTES) return false
  const ext = extname(resolved).toLowerCase()
  const isHashedAsset = /[./\\]assets[./\\]/.test(resolved) && ext !== '.html'
  const gzip = shouldGzipRemoteAsset(ext, options.acceptEncoding)
  const headers: Record<string, string | number> = {
    'content-type': remoteMimeType(resolved),
    'cache-control': ext === '.html'
      ? 'no-cache'
      : isHashedAsset
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    'x-content-type-options': 'nosniff'
  }
  if (REMOTE_GZIP_EXTENSIONS.has(ext)) headers.vary = 'accept-encoding'
  if (gzip) headers['content-encoding'] = 'gzip'
  else headers['content-length'] = stat.size
  res.writeHead(200, headers)
  const stream = createReadStream(resolved)
  if (gzip) stream.pipe(createGzip()).pipe(res)
  else stream.pipe(res)
  return true
}

export function serveRemoteIndex(
  root: string,
  res: ServerResponse,
  options: ServeRemoteStaticOptions = {}
): boolean {
  return serveRemoteStaticFile(root, '/index.html', res, options)
}

let cachedBridgeSource: { path: string; source: string } | null = null

const REMOTE_BRIDGE_CLIPBOARD_NAME = 'remote-bridge-clipboard.js'

/**
 * The Remote bridge script served to browsers. The source file ships inside
 * the renderer bundle (public/); the bootstrap JSON is prepended per host so
 * platform/homeDir/appEnvironment match the desktop preload constants.
 * The clipboard helper is served ahead of the bridge so the bridge file
 * itself stays under the tracked-file line limit.
 */
export function remoteBridgeScript(
  bridgePath: string,
  bootstrap: unknown,
  noCache = false
): string | null {
  try {
    if (noCache || !cachedBridgeSource || cachedBridgeSource.path !== bridgePath) {
      const source = readFileSync(bridgePath, 'utf8')
      cachedBridgeSource = { path: bridgePath, source }
    }
  } catch {
    return null
  }
  let clipboardSource = ''
  try {
    clipboardSource = readFileSync(resolve(bridgePath, '..', REMOTE_BRIDGE_CLIPBOARD_NAME), 'utf8')
  } catch {
    // Optional helper; the bridge degrades gracefully without it.
  }
  const bootstrapJson = JSON.stringify(bootstrap ?? {}).replace(/</g, '\\u003c')
  return `globalThis.__KUN_REMOTE_BOOTSTRAP__=${bootstrapJson};\n${clipboardSource}${cachedBridgeSource.source}`
}

export const REMOTE_LOGIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Kun Remote</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; min-height: 100dvh;
    display: grid; place-items: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    color: #e8ecf4;
    background:
      radial-gradient(60vw 60vh at 75% -10%, rgba(79, 124, 255, 0.22), transparent 60%),
      radial-gradient(50vw 50vh at 15% 110%, rgba(91, 155, 213, 0.14), transparent 60%),
      #0b0f1a;
    padding: 24px 16px calc(24px + env(safe-area-inset-bottom, 0px));
  }
  .card {
    width: min(380px, 100%);
    display: flex; flex-direction: column; align-items: center; gap: 14px;
    padding: 34px 26px 26px;
    border-radius: 22px;
    background: rgba(23, 28, 41, 0.72);
    border: 1px solid rgba(120, 145, 200, 0.18);
    box-shadow: 0 24px 64px rgba(4, 8, 20, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
  }
  .mascot { width: 132px; height: auto; animation: bob 3.2s ease-in-out infinite; filter: drop-shadow(0 10px 20px rgba(79, 124, 255, 0.35)); }
  @keyframes bob { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
  @media (prefers-reduced-motion: reduce) { .mascot { animation: none } }
  h1 { font-size: 21px; font-weight: 650; margin: 0; letter-spacing: 0.2px; }
  .sub { font-size: 13.5px; color: #9aa7bd; margin: -6px 0 2px; text-align: center; line-height: 1.55; }
  form { width: 100%; display: flex; flex-direction: column; gap: 12px; margin-top: 6px; }
  input {
    width: 100%; min-height: 48px; padding: 12px 14px; border-radius: 12px;
    border: 1px solid #2c364a; background: rgba(11, 15, 26, 0.8); color: inherit;
    font-size: 16px; transition: border-color 0.15s, box-shadow 0.15s;
  }
  input:focus { border-color: #4f7cff; outline: none; box-shadow: 0 0 0 3px rgba(79, 124, 255, 0.22); }
  button {
    min-height: 48px; padding: 12px 14px; border-radius: 12px; border: 0;
    background: linear-gradient(180deg, #5a86ff, #4f7cff); color: #fff;
    font-size: 16px; font-weight: 600; cursor: pointer;
    box-shadow: 0 6px 20px rgba(79, 124, 255, 0.35);
    transition: transform 0.08s, box-shadow 0.15s, filter 0.15s;
  }
  button:hover { filter: brightness(1.06); }
  button:active { transform: translateY(1px); }
  .error { color: #ff9c9c; font-size: 14px; min-height: 1.2em; margin: -2px 0 0; text-align: center; }
  .foot { font-size: 11.5px; color: #647089; margin: 4px 0 0; text-align: center; line-height: 1.5; }
</style>
</head>
<body>
<main class="card">
  <img class="mascot" src="__KUN_LOGIN_ART__" alt="Kun" draggable="false" />
  <h1>Kun Remote</h1>
  <p class="sub">Enter the Remote access password<br/>configured on the host.</p>
  <form id="login" method="post">
    <input id="password" type="password" autocomplete="current-password" placeholder="Password" required autofocus />
    <button type="submit">Sign in</button>
    <p class="error" id="error"></p>
  </form>
  <p class="foot">Runs on your local network &middot; secured by the host password</p>
</main>
<script>
document.getElementById('login').addEventListener('submit', async (event) => {
  event.preventDefault()
  const error = document.getElementById('error')
  error.textContent = ''
  try {
    const response = await fetch('/remote/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-kun-remote-request': '1' },
      body: JSON.stringify({ password: document.getElementById('password').value })
    })
    if (response.ok) { location.href = '/'; return }
    const body = await response.json().catch(() => ({}))
    error.textContent = body && body.error ? body.error : 'Sign-in failed.'
  } catch {
    error.textContent = 'Network error.'
  }
})
</script>
</body>
</html>
`

/** Dev mode: proxy asset requests to the Vite dev server instead of out/renderer. */
export async function proxyRemoteDevRequest(
  devUrl: string,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const target = new URL(req.url ?? '/', devUrl)
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (name === 'host' || name === 'connection' || name === 'content-length') continue
    headers.set(name, Array.isArray(value) ? value.join(', ') : value)
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  const body = hasBody
    ? await new Promise<Buffer>((resolveBody, rejectBody) => {
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => chunks.push(chunk))
        req.on('end', () => resolveBody(Buffer.concat(chunks)))
        req.on('error', rejectBody)
      })
    : undefined
  const init: RequestInit & { duplex?: 'half' } = {
    method: req.method,
    headers,
    body: body ? new Uint8Array(body) : undefined
  }
  // Node fetch requires duplex when a streaming body is present.
  if (body) init.duplex = 'half'
  const response = await fetch(target, init)
  const contentType = response.headers.get('content-type') ?? ''
  if (isRemoteModulePathname(target.pathname) && remoteResponseLooksLikeHtml(contentType)) {
    res.writeHead(404, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    })
    res.end('Remote module not found')
    return
  }
  const responseHeaders: Record<string, string> = {}
  response.headers.forEach((value, name) => {
    if (name === 'transfer-encoding' || name === 'connection') return
    responseHeaders[name] = value
  })
  res.writeHead(response.status, responseHeaders)
  const data = Buffer.from(await response.arrayBuffer())
  res.end(data)
}

export function remoteBridgeFileExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile()
  } catch {
    return false
  }
}

import { createReadStream, existsSync, statSync, readFileSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
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
export function serveRemoteStaticFile(root: string, pathname: string, res: ServerResponse): boolean {
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
  res.writeHead(200, {
    'content-type': remoteMimeType(resolved),
    'content-length': stat.size,
    'cache-control': ext === '.html'
      ? 'no-cache'
      : isHashedAsset
        ? 'public, max-age=31536000, immutable'
        : 'no-cache'
  })
  createReadStream(resolved).pipe(res)
  return true
}

export function serveRemoteIndex(root: string, res: ServerResponse): boolean {
  return serveRemoteStaticFile(root, '/index.html', res)
}

let cachedBridgeSource: { path: string; source: string } | null = null

/**
 * The Remote bridge script served to browsers. The source file ships inside
 * the renderer bundle (public/); the bootstrap JSON is prepended per host so
 * platform/homeDir/appEnvironment match the desktop preload constants.
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
  const bootstrapJson = JSON.stringify(bootstrap ?? {}).replace(/</g, '\\u003c')
  return `globalThis.__KUN_REMOTE_BOOTSTRAP__=${bootstrapJson};\n${cachedBridgeSource.source}`
}

export const REMOTE_LOGIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Kun Remote</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #10141f; color: #e6e9ef; font-family: -apple-system, system-ui, sans-serif; }
  form { width: min(320px, 86vw); display: flex; flex-direction: column; gap: 12px; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 4px; }
  p { font-size: 13px; color: #9aa3b5; margin: 0 0 8px; }
  input { padding: 10px 12px; border-radius: 10px; border: 1px solid #2c3444; background: #171c29; color: inherit; font-size: 15px; }
  button { padding: 10px 12px; border-radius: 10px; border: 0; background: #4f7cff; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; }
  .error { color: #ff8a8a; font-size: 13px; min-height: 1em; margin: 0; }
</style>
</head>
<body>
<form id="login" method="post">
  <h1>Kun Remote</h1>
  <p>Enter the Remote access password configured on the host.</p>
  <input id="password" type="password" autocomplete="current-password" placeholder="Password" required autofocus />
  <button type="submit">Sign in</button>
  <p class="error" id="error"></p>
</form>
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

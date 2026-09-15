import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { app, type BrowserWindow, type WebContents } from 'electron'
import type { AppSettingsV1, RemoteAccessSettingsPatchV1 } from '../../shared/app-settings'
import {
  REMOTE_ACCESS_STATUS_CHANNEL,
  type RemoteAccessStatus,
  type RemoteAccessUrls
} from '../../shared/remote-access'
import { appEnvironment } from '../main-app-context'
import {
  hashRemoteAccessPassword,
  parseCookies,
  RemoteLoginRateLimiter,
  RemoteSessionRegistry,
  REMOTE_CLIENT_HEADER,
  REMOTE_CSRF_HEADER,
  REMOTE_SESSION_COOKIE,
  verifyRemoteAccessPassword
} from './remote-auth'
import { RemoteEventHub, remoteSseHeaders, startSseHeartbeat } from './remote-events'
import { dispatchRemoteInvoke, RemoteInvokeError } from './remote-invoke'
import { lanUrlsForPort } from './remote-lan-urls'
import { KUN_LOGIN_ART_DATA_URL } from './remote-login-art'
import {
  proxyRemoteDevRequest,
  REMOTE_LOGIN_HTML,
  remoteBridgeFileExists,
  remoteBridgeScript,
  remoteMimeType,
  serveRemoteIndex,
  serveRemoteStaticFile
} from './remote-static'
import {
  readRemoteRequestBody,
  remoteAddressOf,
  remoteRequestPathname,
  RemoteRequestBodyTooLargeError,
  sendRemoteJson,
  sendRemoteText
} from './remote-http-utils'
import { resolveOpenTargetPath } from '../services/workspace-paths'
import { createReadStream } from 'node:fs'
import { mkdtemp, stat, writeFile } from 'node:fs/promises'

const REMOTE_PORT_SCAN_START = 18_900
const REMOTE_PORT_RANDOM_ATTEMPTS = 25
const REMOTE_PORT_SCAN_LIMIT = 50

export type RemoteAccessServiceOptions = {
  getSettings: () => Promise<AppSettingsV1>
  /** Persists service-owned remote fields (e.g. the auto-picked port). */
  persistRemotePatch: (patch: RemoteAccessSettingsPatchV1) => Promise<unknown>
  getMainWindow: () => BrowserWindow | null
  logError: (category: string, message: string, detail?: Record<string, unknown>) => void
}

function findFreePort(port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer()
    probe.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' && port < 65_535) {
        resolve(findFreePort(port + 1, host))
        return
      }
      reject(error)
    })
    probe.once('listening', () => probe.close(() => resolve(port)))
    probe.listen(port, host)
  })
}

async function findInitialRemotePort(preferred: number, host: string): Promise<number> {
  if (preferred > 0) {
    for (let candidate = preferred; candidate < preferred + REMOTE_PORT_SCAN_LIMIT && candidate <= 65_535; candidate += 1) {
      try {
        return await findFreePort(candidate, host)
      } catch { /* best-effort */ }
    }
  }
  for (let attempt = 0; attempt < REMOTE_PORT_RANDOM_ATTEMPTS; attempt += 1) {
    const candidate = 20_000 + Math.floor(Math.random() * 30_000)
    try {
      return await findFreePort(candidate, host)
    } catch { /* best-effort */ }
  }
  return findFreePort(REMOTE_PORT_SCAN_START, host)
}

export class RemoteAccessService {
  private readonly getSettings: RemoteAccessServiceOptions['getSettings']
  private readonly persistRemotePatch: RemoteAccessServiceOptions['persistRemotePatch']
  private readonly getMainWindow: RemoteAccessServiceOptions['getMainWindow']
  private readonly logError: RemoteAccessServiceOptions['logError']
  private readonly hub = new RemoteEventHub()
  private readonly sessions = new RemoteSessionRegistry()
  private readonly loginLimiter = new RemoteLoginRateLimiter()
  private readonly mirroredContents = new WeakSet<WebContents>()

  private server: Server | null = null
  private syncQueue: Promise<void> = Promise.resolve()
  private appliedBind = ''
  private appliedPort = 0
  private lastError = ''
  private onBrowserWindowCreated: ((event: Electron.Event, window: BrowserWindow) => void) | null = null

  constructor(options: RemoteAccessServiceOptions) {
    this.getSettings = options.getSettings
    this.persistRemotePatch = options.persistRemotePatch
    this.getMainWindow = options.getMainWindow
    this.logError = options.logError
  }

  get running(): boolean {
    return this.server !== null
  }

  /** Serializes syncs so the auto-port persist round-trip cannot double-listen. */
  sync(): Promise<void> {
    this.syncQueue = this.syncQueue.then(() => this.syncInternal(), () => this.syncInternal())
    return this.syncQueue
  }

  private async syncInternal(): Promise<void> {
    const settings = await this.getSettings().catch(() => null)
    const remote = settings?.remote
    const shouldRun = Boolean(remote?.enabled) && Boolean(remote?.passwordHash)
    if (!shouldRun) {
      await this.stopServer()
      this.emitStatus()
      return
    }
    const bind = remote!.bind === 'loopback' ? 'loopback' : 'lan'
    const host = bind === 'loopback' ? '127.0.0.1' : '0.0.0.0'
    let port = remote!.port
    if (!Number.isInteger(port) || port <= 0) {
      try {
        port = await findInitialRemotePort(0, host)
      } catch (error) {
        this.lastError = `no free Remote port: ${error instanceof Error ? error.message : String(error)}`
        this.emitStatus()
        return
      }
      await this.persistRemotePatch({ port }).catch((error: unknown) => {
        this.logError('remote', 'failed to persist the picked Remote port', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
    }
    if (this.server && (this.appliedBind !== bind || this.appliedPort !== port)) {
      await this.stopServer()
    }
    if (!this.server) {
      try {
        await this.listen(port, host)
        this.appliedBind = bind
        this.appliedPort = port
        this.lastError = ''
      } catch (error) {
        // A persisted port may have been claimed by another process between
        // runs (dev servers grab ephemeral ports); fall back to a fresh one.
        if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
          this.lastError = error instanceof Error ? error.message : String(error)
          this.emitStatus()
          return
        }
        try {
          port = await findInitialRemotePort(0, host)
          await this.listen(port, host)
          this.appliedBind = bind
          this.appliedPort = port
          this.lastError = ''
          await this.persistRemotePatch({ port }).catch(() => undefined)
        } catch (retryError) {
          this.lastError = retryError instanceof Error ? retryError.message : String(retryError)
          this.emitStatus()
          return
        }
      }
    }
    this.attachWindowMirroring()
    this.emitStatus()
  }

  private listen(port: number, host: string): Promise<void> {
    return new Promise((resolveListen, reject) => {
      const server = http.createServer((req, res) => {
        void this.handleRequest(req, res).catch((error: unknown) => {
          this.logError('remote', 'Remote request failed', {
            path: req.url ?? '',
            message: error instanceof Error ? error.message : String(error)
          })
          if (!res.headersSent) sendRemoteJson(res, 500, { error: 'Remote request failed' })
          else res.end()
        })
      })
      server.once('error', reject)
      server.listen(port, host, () => {
        this.server = server
        resolveListen()
      })
    })
  }

  async stopServer(): Promise<void> {
    const server = this.server
    this.server = null
    this.hub.disconnectAll()
    if (server) {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
      server.closeAllConnections?.()
    }
  }

  async destroy(): Promise<void> {
    if (this.onBrowserWindowCreated) app.off('browser-window-created', this.onBrowserWindowCreated)
    await this.stopServer()
  }

  status(settings?: AppSettingsV1): RemoteAccessStatus {
    const remote = settings?.remote
    const port = this.appliedPort || remote?.port || 0
    const bind = this.appliedBind || remote?.bind || 'lan'
    const urls = this.urlsFor(port, bind)
    return {
      enabled: remote?.enabled === true,
      running: this.running,
      bind: bind === 'loopback' ? 'loopback' : 'lan',
      port,
      urls,
      passwordSet: Boolean(remote?.passwordHash),
      clients: this.hub.clientInfos(),
      lastError: this.lastError,
      devMode: Boolean(process.env.ELECTRON_RENDERER_URL)
    }
  }

  revokeAllSessions(): void {
    this.sessions.revokeAll()
    this.hub.disconnectAll()
    this.emitStatus()
  }

  private urlsFor(port: number, bind: string): RemoteAccessUrls {
    const local = port ? `http://127.0.0.1:${port}` : ''
    const listen = port ? `http://${bind === 'loopback' ? '127.0.0.1' : '0.0.0.0'}:${port}` : ''
    const lan = bind === 'lan' && port ? lanUrlsForPort(port) : []
    return { local, lan, listen, primary: lan[0] ?? local ?? listen }
  }

  /** Mirrors main-window broadcasts to Remote clients; safe to call repeatedly. */
  attachWindowMirroring(): void {
    if (!this.onBrowserWindowCreated) {
      this.onBrowserWindowCreated = (_event, window) => this.patchWebContentsSend(window.webContents)
      app.on('browser-window-created', this.onBrowserWindowCreated)
    }
    const window = this.getMainWindow()
    if (window && !window.isDestroyed()) this.patchWebContentsSend(window.webContents)
  }

  private patchWebContentsSend(contents: WebContents): void {
    if (this.mirroredContents.has(contents)) return
    this.mirroredContents.add(contents)
    const originalSend = contents.send.bind(contents)
    contents.send = ((channel: string, ...args: unknown[]) => {
      this.hub.broadcast(channel, args.length <= 1 ? args[0] : args)
      return originalSend(channel, ...args)
    }) as typeof contents.send
  }

  private emitStatus(): void {
    void this.getSettings()
      .then((settings) => {
        const window = this.getMainWindow()
        if (window && !window.isDestroyed()) {
          window.webContents.send(REMOTE_ACCESS_STATUS_CHANNEL, this.status(settings))
        }
      })
      .catch(() => undefined)
  }

  private sessionFor(req: IncomingMessage) {
    const token = parseCookies(req.headers.cookie)[REMOTE_SESSION_COOKIE]
    return this.sessions.verify(token)
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const pathname = remoteRequestPathname(req)
    const method = req.method ?? 'GET'
    const remoteAddress = remoteAddressOf(req)

    if (pathname === '/remote/auth/login' && method === 'POST') {
      await this.handleLogin(req, res, remoteAddress)
      return
    }
    if (pathname === '/remote/auth/logout' && method === 'POST') {
      const token = parseCookies(req.headers.cookie)[REMOTE_SESSION_COOKIE]
      this.sessions.revoke(token)
      sendRemoteJson(res, 200, { ok: true })
      return
    }
    if (pathname === '/remote/auth/status' && method === 'GET') {
      sendRemoteJson(res, 200, { authed: Boolean(this.sessionFor(req)) })
      return
    }
    if (pathname === '/remote/login' && method === 'GET') {
      if (this.sessionFor(req)) {
        res.writeHead(302, { location: '/' })
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(REMOTE_LOGIN_HTML.replace('__KUN_LOGIN_ART__', KUN_LOGIN_ART_DATA_URL))
      return
    }
    if (pathname === '/remote-bridge.js' && method === 'GET') {
      this.serveBridge(res)
      return
    }

    if (!this.sessionFor(req)) {
      const acceptsHtml = String(req.headers.accept ?? '').includes('text/html')
      if (method === 'GET' && acceptsHtml && !pathname.startsWith('/remote/')) {
        res.writeHead(302, { location: '/remote/login' })
        res.end()
        return
      }
      sendRemoteJson(res, 401, { error: 'Remote session required' })
      return
    }

    if (pathname === '/remote/events' && method === 'GET') {
      this.handleEvents(req, res)
      return
    }
    if (pathname === '/remote/file-preview' && method === 'GET') {
      await this.handleFilePreview(req, res)
      return
    }
    if (pathname === '/remote/invoke' && method === 'POST') {
      await this.handleInvoke(req, res)
      return
    }
    if (pathname === '/remote/upload' && method === 'POST') {
      await this.handleUpload(req, res)
      return
    }
    if (pathname === '/remote/status' && method === 'GET') {
      const settings = await this.getSettings().catch(() => undefined)
      sendRemoteJson(res, 200, this.status(settings))
      return
    }
    if (method === 'GET' || method === 'HEAD') {
      await this.serveStatic(req, res, pathname)
      return
    }
    sendRemoteJson(res, 404, { error: 'Not found' })
  }

  private async handleLogin(req: IncomingMessage, res: ServerResponse, remoteAddress: string): Promise<void> {
    const blockedFor = this.loginLimiter.blockedSecondsRemaining(remoteAddress)
    if (blockedFor > 0) {
      sendRemoteJson(res, 429, { error: `Too many attempts. Try again in ${blockedFor}s.` })
      return
    }
    let password = ''
    try {
      const body = await readRemoteRequestBody(req, 8 * 1024)
      const parsed = JSON.parse(body || '{}') as { password?: unknown }
      password = typeof parsed.password === 'string' ? parsed.password : ''
    } catch {
      sendRemoteJson(res, 400, { error: 'Invalid login request' })
      return
    }
    const settings = await this.getSettings()
    if (!password || !verifyRemoteAccessPassword(password, settings.remote.passwordHash)) {
      this.loginLimiter.recordFailure(remoteAddress)
      sendRemoteJson(res, 403, { error: 'Incorrect password' })
      return
    }
    this.loginLimiter.recordSuccess(remoteAddress)
    const session = this.sessions.create(remoteAddress, settings.remote.sessionTtlHours)
    sendRemoteJson(res, 200, { ok: true }, {
      'set-cookie':
        `${REMOTE_SESSION_COOKIE}=${session.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(settings.remote.sessionTtlHours * 3600)}`
    })
  }

  /**
   * Streams a workspace file to the browser. Replaces the kun-workspace-preview
   * custom protocol that only exists inside Electron; the workspace boundary
   * is still enforced by resolveOpenTargetPath.
   */
  private async handleFilePreview(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const params = new URL(req.url ?? '/', 'http://remote.local').searchParams
    const workspaceRoot = params.get('workspaceRoot') ?? ''
    const path = params.get('path') ?? ''
    // A workspace root is mandatory: without it the boundary check would not
    // apply and any absolute host path could be streamed to the browser.
    if (!workspaceRoot.trim() || !path.trim() || workspaceRoot.length > 4096 || path.length > 4096) {
      sendRemoteJson(res, 400, { error: 'workspaceRoot and path are required' })
      return
    }
    try {
      const resolved = await resolveOpenTargetPath(path, workspaceRoot, { allowBasenameFallback: false })
      const info = await stat(resolved)
      if (!info.isFile() || info.size > 512 * 1024 * 1024) {
        sendRemoteJson(res, 404, { error: 'File not previewable' })
        return
      }
      res.writeHead(200, {
        'content-type': remoteMimeType(resolved),
        'content-length': info.size,
        'cache-control': 'no-store'
      })
      createReadStream(resolved).pipe(res)
    } catch {
      sendRemoteJson(res, 404, { error: 'File not found' })
    }
  }

  /**
   * Accepts one file from a Remote browser ({ name, dataBase64 }) and writes
   * it to a per-upload temp directory so downstream flows can reference a real
   * host path, matching the desktop webUtils.getPathForFile contract.
   */
  private async handleUpload(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await readRemoteRequestBody(req, 64 * 1024 * 1024)
      const parsed = JSON.parse(body || '{}') as { name?: unknown; dataBase64?: unknown }
      const rawName = typeof parsed.name === 'string' ? parsed.name : ''
      const dataBase64 = typeof parsed.dataBase64 === 'string' ? parsed.dataBase64 : ''
      if (!dataBase64) {
        sendRemoteJson(res, 400, { error: 'Missing file data' })
        return
      }
      const safeName = rawName.replaceAll(/[^\w. -]/gu, '_').replaceAll('..', '_').slice(-120) || 'upload.bin'
      const dir = await mkdtemp(join(tmpdir(), 'kun-remote-upload-'))
      const target = join(dir, safeName)
      await writeFile(target, Buffer.from(dataBase64, 'base64'), { mode: 0o600 })
      sendRemoteJson(res, 200, { ok: true, path: target, name: safeName })
    } catch (error) {
      sendRemoteJson(res, error instanceof RemoteRequestBodyTooLargeError ? 413 : 400, {
        error: error instanceof Error ? error.message : 'Upload failed'
      })
    }
  }

  private handleEvents(req: IncomingMessage, res: ServerResponse): void {
    const clientId = new URL(req.url ?? '/', 'http://remote.local').searchParams.get('client') ?? ''
    if (!clientId || clientId.length > 128) {
      sendRemoteJson(res, 400, { error: 'Missing Remote client id' })
      return
    }
    res.writeHead(200, remoteSseHeaders())
    res.write(': ok\n\n')
    startSseHeartbeat(res)
    this.hub.attachStream(clientId, res, {
      remoteAddress: remoteAddressOf(req),
      userAgent: String(req.headers['user-agent'] ?? '')
    })
    this.emitStatus()
  }

  private async handleInvoke(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!req.headers[REMOTE_CSRF_HEADER]) {
      sendRemoteJson(res, 403, { error: 'Missing Remote request header' })
      return
    }
    const clientId = String(req.headers[REMOTE_CLIENT_HEADER] ?? '')
    if (!clientId || clientId.length > 128) {
      sendRemoteJson(res, 400, { error: 'Missing Remote client id' })
      return
    }
    let body
    try {
      body = JSON.parse(await readRemoteRequestBody(req) || '{}')
    } catch (error) {
      if (error instanceof RemoteRequestBodyTooLargeError) {
        sendRemoteJson(res, 413, { error: 'Request body too large' })
        return
      }
      sendRemoteJson(res, 400, { error: 'Invalid invoke body' })
      return
    }
    const sender = this.hub.clientFor(clientId, {
      remoteAddress: remoteAddressOf(req),
      userAgent: String(req.headers['user-agent'] ?? '')
    })
    try {
      const result = await dispatchRemoteInvoke(body, sender)
      sendRemoteJson(res, 200, { ok: true, result })
    } catch (error) {
      const status = error instanceof RemoteInvokeError ? error.status : 500
      sendRemoteJson(res, status === 500 ? 200 : status, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private serveBridge(res: ServerResponse): void {
    const devMode = Boolean(process.env.ELECTRON_RENDERER_URL)
    const bridgePath = devMode
      ? join(app.getAppPath(), 'src', 'renderer', 'public', 'remote-bridge.js')
      : join(this.rendererRoot(), 'remote-bridge.js')
    const script = remoteBridgeFileExists(bridgePath)
      ? remoteBridgeScript(bridgePath, {
          platform: process.platform,
          homeDir: homedir(),
          appEnvironment,
          desktopTitleBarMode: 'system'
        }, devMode)
      : null
    if (!script) {
      sendRemoteText(res, 404, 'remote bridge unavailable')
      return
    }
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-store'
    })
    res.end(script)
  }

  private rendererRoot(): string {
    return join(app.getAppPath(), 'out', 'renderer')
  }

  private async serveStatic(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string
  ): Promise<void> {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl) {
      try {
        await proxyRemoteDevRequest(devUrl, req, res)
        return
      } catch {
        // Vite may be gone while the Electron main process still runs (orphaned
        // dev session). Fall through to the last bundled renderer instead of
        // leaving Remote clients with a dead 502 page.
      }
    }
    const root = this.rendererRoot()
    if (serveRemoteStaticFile(root, pathname, res)) return
    if (serveRemoteIndex(root, res)) return
    sendRemoteJson(res, 404, { error: 'Not found' })
  }
}

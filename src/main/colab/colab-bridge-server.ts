import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { KunColabSettingsV1 } from '../../shared/app-settings-colab'
import { COLAB_ACCELERATOR_SPECS, type ColabAccelerator } from '../../shared/colab/colab-types'
import type { ColabNotebookAgentRelay } from './colab-notebook-agent-relay'
import type { ColabService } from './colab-service'

/** Each notebook long-poll stays well below the Kun tool's 30s request timeout. */
const NOTEBOOK_POLL_MS = 20_000

export const KUN_COLAB_BRIDGE_URL_ENV = 'KUN_COLAB_BRIDGE_URL'
export const KUN_COLAB_BRIDGE_TOKEN_ENV = 'KUN_COLAB_BRIDGE_TOKEN'

export type ColabBridgeLaunch = {
  url: string
  token: string
}

export class ColabBridgeServer {
  private server?: Server
  private launch?: ColabBridgeLaunch

  constructor(
    private readonly service: ColabService,
    private readonly getSettings: () => KunColabSettingsV1,
    private readonly getNotebookRelay: () => ColabNotebookAgentRelay | null = () => null
  ) {}

  async start(): Promise<ColabBridgeLaunch> {
    if (this.launch) return this.launch
    const token = randomBytes(32).toString('base64url')
    const server = createServer((req, res) => {
      void this.handle(req, res)
    })
    server.maxHeadersCount = 32
    server.headersTimeout = 5_000
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
        server.off('error', reject)
        resolve()
      })
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      throw new Error('Colab GUI bridge failed to bind a loopback port.')
    }
    this.server = server
    this.launch = { url: `http://127.0.0.1:${address.port}`, token }
    return this.launch
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = undefined
    this.launch = undefined
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }

  private validToken(authHeader: string | undefined, expected: string): boolean {
    if (!authHeader?.startsWith('Bearer ')) return false
    const provided = Buffer.from(authHeader.slice('Bearer '.length))
    const target = Buffer.from(expected)
    return provided.length === target.length && timingSafeEqual(provided, target)
  }

  private sendJson(res: ServerResponse, status: number, payload: unknown): void {
    const body = JSON.stringify(payload)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body)
    })
    res.end(body)
  }

  private async readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += buf.length
      if (bytes > 128 * 1024) throw new Error('Request body too large')
      chunks.push(buf)
    }
    if (chunks.length === 0) return {}
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const launch = this.launch
    if (!launch || !this.validToken(req.headers.authorization, launch.token)) {
      this.sendJson(res, 401, { error: 'unauthorized' })
      return
    }
    try {
      const url = new URL(req.url ?? '/', launch.url)
      if (req.method === 'POST' && url.pathname === '/v1/colab/preview') {
        const body = await this.readBody(req)
        const workspaceRoot = typeof body.workspaceRoot === 'string' ? body.workspaceRoot : ''
        const connId = typeof body.connectionId === 'string' ? body.connectionId : ''
        const snap = await this.service.getSnapshot()
        const conn = connId
          ? snap.connections.find((c) => c.id === connId)
          : snap.connections.find(
              (c) => c.id === snap.workspaceConnections[workspaceRoot.trim().replace(/[\\/]+$/, '')]
            ) ?? snap.connections.find((c) => c.status === 'connected')
        const settings = this.getSettings()
        const accel = (typeof body.accelerator === 'string' ? body.accelerator : 'T4') as ColabAccelerator
        const spec = COLAB_ACCELERATOR_SPECS[accel] ?? COLAB_ACCELERATOR_SPECS.T4
        this.sendJson(res, 200, {
          requireApprovalForAgent: settings.requireApprovalForAgent,
          connection: conn
            ? {
                id: conn.id,
                name: conn.name,
                email: conn.email,
                balanceCu: conn.balanceCu,
                status: conn.status
              }
            : null,
          acceleratorSpec: spec
        })
        return
      }

      if (req.method === 'POST' && url.pathname === '/v1/colab/status') {
        const body = await this.readBody(req)
        const workspaceRoot = typeof body.workspaceRoot === 'string' ? body.workspaceRoot : ''
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
        const snap = await this.service.getSnapshot()
        const sessions = sessionId
          ? snap.sessions.filter((s) => s.id === sessionId || s.sessionName === sessionId)
          : workspaceRoot
            ? snap.sessions.filter((s) => s.workspaceRoot === workspaceRoot.trim().replace(/[\\/]+$/, ''))
            : snap.sessions
        this.sendJson(res, 200, {
          cli: snap.cli,
          connections: snap.connections.map((c) => ({
            id: c.id,
            name: c.name,
            email: c.email,
            balanceCu: c.balanceCu,
            burnRateCuPerHour: c.burnRateCuPerHour,
            status: c.status,
            activeSessionsCount: c.activeSessions.length
          })),
          activeConnectionId:
            snap.workspaceConnections[workspaceRoot.trim().replace(/[\\/]+$/, '')] ??
            snap.connections.find((c) => c.status === 'connected')?.id ??
            null,
          sessions
        })
        return
      }

      if (req.method === 'POST' && url.pathname === '/v1/colab/start') {
        const body = await this.readBody(req)
        const workspaceRoot = typeof body.workspaceRoot === 'string' ? body.workspaceRoot : ''
        const snap = await this.service.getSnapshot()
        const explicitId = typeof body.connectionId === 'string' ? body.connectionId.trim() : ''
        const resolvedConn = explicitId
          ? snap.connections.find((c) => c.id === explicitId || c.name === explicitId)
          : snap.connections.find(
              (c) => c.id === snap.workspaceConnections[workspaceRoot.trim().replace(/[\\/]+$/, '')]
            ) ?? snap.connections.find((c) => c.status === 'connected')

        if (!resolvedConn) {
          this.sendJson(res, 400, {
            ok: false,
            code: 'no_connection',
            message: '尚未连接 Google 账号。请在右侧 Colab 面板底部「连接」中登录 Google 账号。'
          })
          return
        }
        const accelRaw = typeof body.accelerator === 'string' ? body.accelerator.toUpperCase() : 'T4'
        const accelerator: ColabAccelerator =
          accelRaw === 'T4' || accelRaw === 'L4' || accelRaw === 'A100' || accelRaw === 'CPU'
            ? accelRaw
            : 'T4'
        const syncPaths = Array.isArray(body.syncPaths)
          ? body.syncPaths.filter((p): p is string => typeof p === 'string')
          : []

        const started = await this.service.startRun({
          workspaceRoot,
          connectionId: resolvedConn.id,
          entryCommand: typeof body.entryCommand === 'string' ? body.entryCommand : 'python train.py',
          accelerator,
          syncPaths,
          outputRemoteDir: typeof body.outputRemoteDir === 'string' ? body.outputRemoteDir : 'outputs/',
          outputLocalDir: typeof body.outputLocalDir === 'string' ? body.outputLocalDir : './outputs',
          maxRuntimeHours: typeof body.maxRuntimeHours === 'number' ? body.maxRuntimeHours : 3,
          autoStop: typeof body.autoStop === 'boolean' ? body.autoStop : true,
          mountDrive: typeof body.mountDrive === 'boolean' ? body.mountDrive : true
        })
        this.sendJson(res, started.ok ? 200 : 400, started)
        return
      }

      if (req.method === 'POST' && url.pathname === '/v1/colab/stop') {
        const body = await this.readBody(req)
        const targetId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
        const snap = await this.service.getSnapshot()
        const found = snap.sessions.find((s) => s.id === targetId || s.sessionName === targetId)
        if (!found) {
          this.sendJson(res, 404, { ok: false, message: `未找到会话 ${targetId}` })
          return
        }
        const stopped = await this.service.stopSession(found.id)
        this.sendJson(res, 200, { ...stopped, sessionId: found.id, sessionName: found.sessionName })
        return
      }

      if (req.method === 'POST' && url.pathname.startsWith('/v1/notebook/')) {
        await this.handleNotebook(url.pathname, await this.readBody(req), res)
        return
      }

      this.sendJson(res, 404, { error: 'not_found' })
    } catch (error) {
      this.sendJson(res, 500, {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private async handleNotebook(
    pathname: string,
    body: Record<string, unknown>,
    res: ServerResponse
  ): Promise<void> {
    const relay = this.getNotebookRelay()
    if (!relay) {
      this.sendJson(res, 503, { error: 'Notebook bridge is not ready.' })
      return
    }
    const workspaceRoot = typeof body.workspaceRoot === 'string' ? body.workspaceRoot : ''
    const requestId = typeof body.requestId === 'string' ? body.requestId : ''
    let pollId = ''
    if (pathname === '/v1/notebook/run') {
      const cells = Array.isArray(body.cells)
        ? body.cells.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0).slice(0, 200)
        : undefined
      pollId = relay.start({
        kind: 'run',
        workspaceRoot,
        ...(typeof body.path === 'string' && body.path.trim() ? { path: body.path.trim() } : {}),
        ...(cells && cells.length > 0 ? { cells } : {})
      })
    } else if (pathname === '/v1/notebook/variables') {
      pollId = relay.start({ kind: 'variables', workspaceRoot })
    } else if (pathname === '/v1/notebook/interrupt') {
      pollId = relay.start({ kind: 'interrupt', workspaceRoot })
    } else if (pathname === '/v1/notebook/result') {
      pollId = requestId
    } else {
      this.sendJson(res, 404, { error: 'not_found' })
      return
    }
    const poll = await relay.wait(pollId, NOTEBOOK_POLL_MS)
    if (!poll) {
      this.sendJson(res, 404, { error: `Unknown notebook request ${pollId}.` })
      return
    }
    this.sendJson(res, 200, poll)
  }
}

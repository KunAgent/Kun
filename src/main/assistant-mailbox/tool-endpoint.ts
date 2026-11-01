// Local endpoint for the Kun tool bridge (the `kun_assistants` MCP server that the runtime
// starts). It listens on a Unix socket (a named pipe on Windows) that only this user can open,
// and every request must carry a secret that Main rewrites to a 0600 file on each launch.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { secureWindowsDirectory, type WindowsPrivatePipe } from '@kun/assistant-agent'
import { startWindowsToolEndpoint } from './tool-endpoint-windows'

const MAX_BODY_BYTES = 64 * 1024

export type AssistantToolEndpointPaths = { socketPath: string; secretPath: string }
export type AssistantToolHandler = (route: string, body: Record<string, unknown>) => Promise<unknown>

/** Deterministic per user-data directory, so the runtime's MCP config stays stable across launches. */
export function assistantToolEndpointPaths(userDataDir: string, platform: NodeJS.Platform = process.platform): AssistantToolEndpointPaths {
  const dir = join(userDataDir, 'assistant-mailbox')
  const hash = createHash('sha256').update(userDataDir).digest('hex').slice(0, 16)
  const socket = join(dir, 'tools.sock')
  return {
    // Unix socket paths are limited to about 104 bytes on macOS.
    socketPath: platform === 'win32'
      ? `\\\\.\\pipe\\kun-assistant-mailbox-${hash}`
      : Buffer.byteLength(socket) <= 100 ? socket : join(tmpdir(), `kun-assistant-${hash}.sock`),
    secretPath: join(dir, 'tools.secret')
  }
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) throw new Error('REQUEST_TOO_LARGE')
    chunks.push(chunk as Buffer)
  }
  const value = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_REQUEST')
  return value as Record<string, unknown>
}

export class AssistantToolEndpoint {
  private server: Server | null = null
  private windowsServer: WindowsPrivatePipe | null = null
  private secret = ''

  constructor(
    private readonly paths: AssistantToolEndpointPaths,
    private readonly routes: ReadonlySet<string>,
    private readonly handle: AssistantToolHandler,
    private readonly platform: NodeJS.Platform = process.platform
  ) {}

  private authorized(header: string | undefined): boolean {
    const expected = Buffer.from(`Bearer ${this.secret}`)
    const actual = Buffer.from(header ?? '')
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  }

  async start(): Promise<void> {
    if (this.server || this.windowsServer) return
    this.secret = randomBytes(32).toString('hex')
    if (this.platform === 'win32') await secureWindowsDirectory(dirname(dirname(this.paths.secretPath)), 'desktop')
    await mkdir(join(this.paths.secretPath, '..'), { recursive: true, mode: 0o700 })
    const temporary = `${this.paths.secretPath}.${randomBytes(4).toString('hex')}.tmp`
    await writeFile(temporary, this.secret, { mode: 0o600 })
    await rename(temporary, this.paths.secretPath)
    if (this.platform === 'win32') {
      this.windowsServer = await startWindowsToolEndpoint(this.paths.socketPath, this.secret, this.routes, this.handle)
      return
    }
    await rm(this.paths.socketPath, { force: true })
    const server = createServer((request, response) => {
      const reply = (status: number, value: unknown) => {
        response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        response.end(JSON.stringify(value))
      }
      const route = new URL(request.url ?? '/', 'http://assistant.local').pathname
      if (request.method !== 'POST' || !this.routes.has(route)) return reply(404, { ok: false, error: 'NOT_FOUND' })
      if (!this.authorized(request.headers.authorization)) return reply(401, { ok: false, error: 'UNAUTHORIZED' })
      readBody(request)
        .then((body) => this.handle(route, body))
        .then((result) => reply(200, { ok: true, result }))
        .catch((error: unknown) => reply(200, { ok: false, error: error instanceof Error ? error.message : String(error) }))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.paths.socketPath, () => { server.off('error', reject); resolve() })
    })
    await chmod(this.paths.socketPath, 0o600)
    this.server = server
  }

  async stop(): Promise<void> {
    if (this.windowsServer) { this.windowsServer.close(); this.windowsServer = null; return }
    const server = this.server
    this.server = null
    if (!server) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (this.platform !== 'win32') await rm(this.paths.socketPath, { force: true })
  }
}

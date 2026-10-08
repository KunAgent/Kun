import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { atomicWriteFile } from '../file/atomic-write.js'
import type { McpServerConfig } from '../../contracts/capabilities.js'
import type { McpClientLike, McpClientLifecycleHandlers, McpToolDescriptor } from './mcp-types.js'

type ClientFactory = (serverId: string, server: McpServerConfig) => Promise<McpClientLike>
type CacheEntry = { fingerprint: string; tools: McpToolDescriptor[]; savedAt: string }
type CacheFile = { version: 1; servers: Record<string, CacheEntry> }

const SAVE_DEBOUNCE_MS = 500
const MAX_CACHED_TOOLS_PER_SERVER = 2_000

/** Identity of one stdio server launch; any config change invalidates its catalog. */
export function mcpServerFingerprint(server: McpServerConfig): string {
  return createHash('sha256').update(JSON.stringify(server)).digest('hex')
}

/**
 * Last tool catalog each stdio MCP server reported, keyed by server id and
 * launch fingerprint. It lets the Runtime advertise tools without spawning
 * the server until a tool is actually called.
 */
export class McpCatalogCache {
  private loaded: Promise<CacheFile> | undefined
  private file: CacheFile = { version: 1, servers: {} }
  private timer: ReturnType<typeof setTimeout> | undefined
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  async get(serverId: string, fingerprint: string): Promise<McpToolDescriptor[] | undefined> {
    const file = await this.load()
    const entry = file.servers[serverId]
    return entry && entry.fingerprint === fingerprint ? entry.tools : undefined
  }

  async save(serverId: string, fingerprint: string, tools: McpToolDescriptor[]): Promise<void> {
    const file = await this.load()
    const current = file.servers[serverId]
    if (current?.fingerprint === fingerprint && JSON.stringify(current.tools) === JSON.stringify(tools)) return
    file.servers[serverId] = {
      fingerprint,
      tools: tools.slice(0, MAX_CACHED_TOOLS_PER_SERVER),
      savedAt: new Date().toISOString()
    }
    this.schedule()
  }

  private load(): Promise<CacheFile> {
    this.loaded ??= readFile(this.path, 'utf8').then((raw) => {
      const parsed = JSON.parse(raw) as Partial<CacheFile>
      if (parsed?.version === 1 && parsed.servers && typeof parsed.servers === 'object') {
        this.file = { version: 1, servers: parsed.servers as Record<string, CacheEntry> }
      }
      return this.file
    }, () => this.file).catch(() => this.file)
    return this.loaded
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      const snapshot = `${JSON.stringify(this.file)}\n`
      this.writing = this.writing.then(async () => {
        try {
          await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
          await atomicWriteFile(this.path, snapshot)
        } catch {
          // A lost cache only means the next start connects eagerly once.
        }
      })
    }, SAVE_DEBOUNCE_MS)
    this.timer.unref?.()
  }
}

/**
 * Wraps the client factory so stdio servers with a cached catalog start
 * deferred: their tools are advertised from the cache and the subprocess is
 * spawned on the first call (or explicit catalog refresh). Servers without a
 * matching cache connect eagerly as before and seed the cache. Remote
 * transports are untouched; they hold no local process.
 */
export function withDeferredStdioConnect(factory: ClientFactory, cache: McpCatalogCache): ClientFactory {
  return async (serverId, server) => {
    if (server.transport !== 'stdio') return factory(serverId, server)
    const fingerprint = mcpServerFingerprint(server)
    const record = (tools: McpToolDescriptor[]) => { void cache.save(serverId, fingerprint, tools) }
    const cached = await cache.get(serverId, fingerprint)
    if (!cached) return recordingClient(await factory(serverId, server), record)
    return new DeferredMcpClient(() => factory(serverId, server), cached, record)
  }
}

/** Records every complete tools/list result so the next start can defer. */
function recordingClient(client: McpClientLike, record: (tools: McpToolDescriptor[]) => void): McpClientLike {
  let pages: McpToolDescriptor[] = []
  const listTools: McpClientLike['listTools'] = async (options) => {
    const listed = await client.listTools(options)
    if (!options?.cursor) pages = []
    pages.push(...listed.tools)
    if (listed.nextCursor === undefined) record(pages)
    return listed
  }
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === 'listTools') return listTools
      const value = Reflect.get(target, property, receiver) as unknown
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    }
  })
}

export class DeferredMcpClient implements McpClientLike {
  private real: McpClientLike | undefined
  private connecting: Promise<McpClientLike> | undefined
  private handlers: McpClientLifecycleHandlers | undefined
  private closed = false

  constructor(
    private readonly connect: () => Promise<McpClientLike>,
    private readonly cached: McpToolDescriptor[],
    private readonly record: (tools: McpToolDescriptor[]) => void
  ) {}

  get connected(): boolean { return Boolean(this.real) }
  get protocolEra() { return this.real?.protocolEra }
  get protocolVersion() { return this.real?.protocolVersion }
  get serverInfo() { return this.real?.serverInfo }
  get serverCapabilities() { return this.real?.serverCapabilities }

  /** Spawns and initializes the server; callers invoke it before sending a request. */
  async ready(): Promise<void> {
    await this.ensure()
  }

  async listTools(options?: Parameters<McpClientLike['listTools']>[0]) {
    if (!this.real && options?.cacheMode !== 'refresh' && !options?.cursor) {
      return { tools: this.cached.map((tool) => ({ ...tool })) }
    }
    return recordingClient(await this.ensure(), this.record).listTools(options)
  }

  async callTool(...args: Parameters<McpClientLike['callTool']>) {
    return (await this.ensure()).callTool(...args)
  }

  async listResources(...args: Parameters<NonNullable<McpClientLike['listResources']>>) {
    return required(await this.ensure(), 'listResources').call(this.real, ...args)
  }

  async readResource(...args: Parameters<NonNullable<McpClientLike['readResource']>>) {
    return required(await this.ensure(), 'readResource').call(this.real, ...args)
  }

  async listResourceTemplates(...args: Parameters<NonNullable<McpClientLike['listResourceTemplates']>>) {
    return required(await this.ensure(), 'listResourceTemplates').call(this.real, ...args)
  }

  async listPrompts(...args: Parameters<NonNullable<McpClientLike['listPrompts']>>) {
    return required(await this.ensure(), 'listPrompts').call(this.real, ...args)
  }

  async getPrompt(...args: Parameters<NonNullable<McpClientLike['getPrompt']>>) {
    return required(await this.ensure(), 'getPrompt').call(this.real, ...args)
  }

  setLifecycleHandlers(handlers: McpClientLifecycleHandlers): void {
    this.handlers = handlers
    this.real?.setLifecycleHandlers?.(handlers)
  }

  async close(): Promise<void> {
    this.closed = true
    const pending = this.connecting
    this.connecting = undefined
    const real = this.real ?? await pending?.catch(() => undefined)
    this.real = undefined
    await real?.close()
  }

  private ensure(): Promise<McpClientLike> {
    if (this.real) return Promise.resolve(this.real)
    if (this.closed) return Promise.reject(new Error('MCP client is closed'))
    this.connecting ??= this.connect().then(async (client) => {
      if (this.closed) {
        await client.close().catch(() => undefined)
        throw new Error('MCP client is closed')
      }
      this.real = client
      if (this.handlers) client.setLifecycleHandlers?.(this.handlers)
      // Refresh the cached catalog for the next start; this session keeps the
      // catalog it already advertised.
      void refreshCatalog(client, this.record).catch(() => undefined)
      return client
    }, (error: unknown) => {
      this.connecting = undefined
      throw error
    })
    return this.connecting
  }
}

async function refreshCatalog(client: McpClientLike, record: (tools: McpToolDescriptor[]) => void): Promise<void> {
  const tools: McpToolDescriptor[] = []
  let cursor: string | undefined
  for (let page = 0; page < 50; page += 1) {
    const listed = await client.listTools({ cacheMode: 'refresh', ...(cursor ? { cursor } : {}) })
    tools.push(...listed.tools)
    cursor = listed.nextCursor
    if (cursor === undefined) {
      record(tools)
      return
    }
  }
}

function required<K extends keyof McpClientLike>(client: McpClientLike, method: K): NonNullable<McpClientLike[K]> {
  const value = client[method]
  if (typeof value !== 'function') throw new Error(`MCP server does not support ${String(method)}`)
  return value as NonNullable<McpClientLike[K]>
}

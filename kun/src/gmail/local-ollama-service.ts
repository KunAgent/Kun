import type { ChildProcess } from 'node:child_process'
import { constants } from 'node:fs'
import { access, lstat, mkdir } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { isOwnedProcess, spawnOwnedProcess, stopOwnedProcess } from '../process/owned-process.js'
import { GoogleWorkspaceModelPolicyError } from '../domain/google-workspace-model-policy.js'
import {
  KUN_GMAIL_LOCAL_MODEL, type VerifiedLocalOllamaProof
} from '../adapters/model/verified-local-ollama-model-client.js'
import { assertEncryptedGmailStorage } from './data-protection.js'
import { assertLocalOllamaPortOwner, createDirectLocalOllamaFetch, reserveLocalOllamaPort } from './local-ollama-transport.js'

export const KUN_GMAIL_OLLAMA_BINARY = '/Applications/Ollama.app/Contents/Resources/ollama'
export type ManagedLocalGmailOllamaStatus = {
  installed: boolean
  running: boolean
  ready: boolean
  preparing: boolean
  model: typeof KUN_GMAIL_LOCAL_MODEL
  error?: 'storage_unavailable' | 'local_server_unavailable' | 'model_unavailable' | 'model_download_failed' | 'stopped'
}
export type LocalOllamaDependencies = {
  platform: NodeJS.Platform
  installed(): Promise<boolean>
  assertEncrypted(path: string): Promise<void>
  reservePort(): Promise<number>
  spawn: typeof spawnOwnedProcess
  stop: typeof stopOwnedProcess
  isOwned: typeof isOwnedProcess
  assertPortOwner(port: number, pid: number): Promise<void>
  directFetch(origin: string, assertCurrent: () => void): typeof fetch
  now(): number
  pause(ms: number): Promise<void>
  /** Existing network proxy is used only by a private public-asset downloader. */
  downloadProxy?(): Promise<string>
}

/** A separate app-owned, cloud-disabled Ollama process; existing user servers are untouched. */
export class ManagedLocalGmailOllama {
  private child?: ChildProcess
  private observedNoCloud = false
  private localModelVerified = false
  private ownerVerified = false
  private serverVersion?: string
  private disposed = false
  private downloading?: Promise<void>
  private downloader?: ManagedLocalGmailOllama
  private readonly shutdown = new AbortController()
  private error?: ManagedLocalGmailOllamaStatus['error']
  private startupTail = ''
  private readonly fetchImpl: typeof fetch
  readonly origin: string
  readonly cacheDirectory: string

  private constructor(private readonly dataDir: string, private readonly port: number,
    private readonly deps: LocalOllamaDependencies, private readonly assetDownloadProxy?: string) {
    this.origin = `http://127.0.0.1:${port}`
    this.cacheDirectory = join(dirname(resolve(dataDir)), 'gmail-model-cache')
    const physical = deps.directFetch(this.origin, () => this.assertServerLive())
    this.fetchImpl = async (input, init) => {
      if (this.assetDownloadProxy !== undefined) {
        const request = new Request(input, init)
        const path = new URL(request.url).pathname
        if (!['/api/version', '/api/show', '/api/pull'].includes(path)) {
          throw new GoogleWorkspaceModelPolicyError('The asset downloader does not accept inference requests')
        }
      }
      return physical(input, init)
    }
  }

  static async start(dataDir: string, overrides: Partial<LocalOllamaDependencies> = {}): Promise<ManagedLocalGmailOllama | undefined> {
    const deps = { ...defaultDependencies, ...overrides }
    if (deps.platform !== 'darwin' || !await deps.installed()) return undefined
    let port: number
    try { port = await deps.reservePort() }
    catch { return undefined }
    if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined
    const service = new ManagedLocalGmailOllama(dataDir, port, deps)
    try { await service.launch() }
    catch {
      if (!service.error) service.error = 'local_server_unavailable'
      if (service.child) await deps.stop(service.child, { graceMs: 0, timeoutMs: 3_000 }).catch(() => undefined)
    }
    return service
  }

  status(): ManagedLocalGmailOllamaStatus {
    const running = this.serverLive() && this.observedNoCloud && this.ownerVerified
    return { installed: true, running, ready: running && this.localModelVerified,
      preparing: Boolean(this.downloading) && running, model: KUN_GMAIL_LOCAL_MODEL,
      ...(this.disposed ? { error: 'stopped' as const } : this.error ? { error: this.error } : {}) }
  }

  proof(): VerifiedLocalOllamaProof {
    if (this.assetDownloadProxy !== undefined) throw new GoogleWorkspaceModelPolicyError('The asset downloader cannot provide a Gmail model proof')
    const directFetch: typeof fetch = async (input, init) => {
        this.assertCurrent()
        const request = new Request(input, init)
        const url = new URL(request.url)
        if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
          throw new GoogleWorkspaceModelPolicyError('Only the managed local Gmail inference endpoint is available')
        }
        return this.fetchImpl(request)
      }
    return Object.freeze({ origin: this.origin, model: KUN_GMAIL_LOCAL_MODEL,
      assertCurrent: () => this.assertCurrent(), directFetch })
  }

  /** Explicit human preparation starts a background model download and returns immediately. */
  prepare(): ManagedLocalGmailOllamaStatus {
    if (this.disposed || !this.status().running || this.localModelVerified || this.downloading) return this.status()
    this.error = undefined
    this.downloading = this.prepareModel().catch(() => {
      this.localModelVerified = false
      if (!this.disposed) this.error = 'model_download_failed'
    }).finally(() => { this.downloading = undefined })
    return this.status()
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.localModelVerified = false
    this.shutdown.abort()
    await this.downloader?.dispose()
    if (this.child) await this.deps.stop(this.child, { graceMs: 200, timeoutMs: 4_000 })
    await this.downloading
  }

  private async launch(): Promise<void> {
    try {
      await this.deps.assertEncrypted(this.cacheDirectory)
      await mkdir(this.cacheDirectory, { recursive: true, mode: 0o700 })
      await this.deps.assertEncrypted(this.cacheDirectory)
    } catch { this.error = 'storage_unavailable'; throw new Error('Encrypted local model storage is required') }
    if (this.disposed) throw new Error('Local model startup was cancelled')
    const env = localEnvironment(this.origin, this.cacheDirectory)
    if (this.assetDownloadProxy !== undefined) {
      env.HTTPS_PROXY = this.assetDownloadProxy
      env.NO_PROXY = '127.0.0.1,localhost'
    }
    this.child = await this.deps.spawn(KUN_GMAIL_OLLAMA_BINARY, ['serve'], {
      env, cwd: this.cacheDirectory,
      stdio: ['ignore', 'pipe', 'pipe'], ownerLossGraceMs: 1_000,
      beforeLaunch: () => this.deps.assertEncrypted(this.cacheDirectory)
    })
    const observe = (chunk: Buffer | string) => {
      if (this.observedNoCloud) return
      // Keep only a bounded startup proof in memory. Prompt/response logs are disabled.
      this.startupTail = (this.startupTail + String(chunk)).slice(-4_096)
      if (/Ollama cloud disabled:\s*true/iu.test(this.startupTail)) {
        this.observedNoCloud = true
        this.startupTail = ''
      }
    }
    this.child.stdout?.on('data', observe)
    this.child.stderr?.on('data', observe)
    this.child.once('error', () => { this.ownerVerified = false; this.localModelVerified = false; this.error = 'local_server_unavailable' })
    this.child.once('exit', () => { this.ownerVerified = false; this.localModelVerified = false; if (!this.disposed) this.error = 'local_server_unavailable' })
    const deadline = this.deps.now() + 12_000
    while (this.deps.now() < deadline) {
      this.assertServerLive()
      if (this.observedNoCloud) {
        try {
          const response = await this.fetchImpl(`${this.origin}/api/version`, { signal: AbortSignal.timeout(1_000) })
          if (response.ok) {
            const version = await localJson(response)
            if (typeof version.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-.][A-Za-z0-9.-]+)?$/u.test(version.version)) {
              throw new Error('The owned local server version is unavailable')
            }
            await this.deps.assertPortOwner(this.port, this.child.pid!)
            this.serverVersion = version.version
            this.ownerVerified = true
            const available = await this.checkModel()
            if (!available) this.error = 'model_unavailable'
            return
          }
          await response.body?.cancel()
        } catch { /* Continue only while the owned process remains live. */ }
      }
      await this.deps.pause(100)
    }
    throw new Error('The managed local server did not prove cloud-disabled startup')
  }

  private async prepareModel(): Promise<void> {
    const proxy = validateAssetProxy(await this.deps.downloadProxy?.() ?? '')
    if (!proxy) { await this.pullModel(); return }
    if (this.disposed) throw new Error('Local model preparation was cancelled')
    const port = await this.deps.reservePort()
    if (!Number.isInteger(port) || port < 1 || port > 65535 || port === this.port) throw new Error('The private download port is unavailable')
    const sibling = new ManagedLocalGmailOllama(this.dataDir, port, this.deps, proxy)
    this.downloader = sibling
    try {
      if (this.disposed) throw new Error('Local model preparation was cancelled')
      await sibling.launch()
      if (!sibling.status().running) throw new Error('The asset downloader did not prove ownership')
      if (!sibling.localModelVerified) await sibling.pullModel()
    } finally {
      await sibling.dispose()
      if (this.downloader === sibling) this.downloader = undefined
    }
    await this.deps.assertEncrypted(this.cacheDirectory)
    if (!await this.checkModel()) throw new Error('The downloaded model is not local')
    this.error = undefined
  }

  private async pullModel(): Promise<void> {
    await this.deps.assertEncrypted(this.cacheDirectory)
    this.assertServerLive()
    if (!this.observedNoCloud || !this.ownerVerified) throw new Error('Local model ownership is unavailable')
    const response = await this.fetchImpl(`${this.origin}/api/pull`, {
      method: 'POST', signal: this.shutdown.signal,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: KUN_GMAIL_LOCAL_MODEL, stream: false })
    })
    const result = await localJson(response)
    if (!response.ok || result.status !== 'success') throw new Error('The local model download failed')
    await this.deps.assertEncrypted(this.cacheDirectory)
    if (!await this.checkModel()) throw new Error('The downloaded model is not local')
    this.error = undefined
  }

  private async checkModel(): Promise<boolean> {
    const response = await this.fetchImpl(`${this.origin}/api/show`, {
      method: 'POST', signal: AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(5_000)]),
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: KUN_GMAIL_LOCAL_MODEL })
    })
    if (!response.ok) { await response.body?.cancel(); this.localModelVerified = false; return false }
    const model = await localJson(response)
    this.assertServerLive()
    this.localModelVerified = Boolean(model.model_info && typeof model.model_info === 'object' &&
      !containsRemoteModel(model) && localModelfile(model.modelfile, this.cacheDirectory))
    return this.localModelVerified
  }

  private serverLive(): boolean {
    const child = this.child
    return Boolean(!this.disposed && child && this.deps.isOwned(child) && child.pid &&
      child.exitCode === null && child.signalCode === null && !child.killed)
  }
  private assertServerLive(): void {
    if (!this.serverLive()) throw new GoogleWorkspaceModelPolicyError('The app-owned local Gmail model is not running')
  }
  private assertCurrent(): void {
    this.assertServerLive()
    if (!this.observedNoCloud || !this.serverVersion || !this.ownerVerified || !this.localModelVerified) {
      throw new GoogleWorkspaceModelPolicyError('Prepare Kun’s cloud-disabled local Gmail model before using it')
    }
  }
}

function validateAssetProxy(value: string): string {
  const candidate = value.trim()
  if (!candidate) return ''
  if (candidate.length > 2_048) throw new Error('The model download proxy is invalid')
  const url = new URL(candidate)
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('The model download proxy is invalid')
  }
  return url.toString()
}

function localEnvironment(origin: string, cacheDirectory: string): NodeJS.ProcessEnv {
  // Use an allowlist so OAuth tokens, API keys, proxies and unrelated Ollama preferences are not inherited.
  return {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME, USER: process.env.USER,
    TMPDIR: process.env.TMPDIR, LC_ALL: 'C',
    OLLAMA_HOST: origin, OLLAMA_MODELS: cacheDirectory, OLLAMA_ORIGINS: '',
    OLLAMA_NO_CLOUD: '1', OLLAMA_DEBUG: '0', OLLAMA_DEBUG_LOG_REQUESTS: '0', OLLAMA_CREATE_REMOTE: '0',
    OLLAMA_CONTEXT_LENGTH: '32768', OLLAMA_NUM_PARALLEL: '1', OLLAMA_MAX_LOADED_MODELS: '1', OLLAMA_MAX_QUEUE: '16'
  }
}
function containsRemoteModel(value: unknown, depth = 0): boolean {
  if (depth > 10) return true
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(([key, item]) =>
    ((key === 'remote_model' || key === 'remote_host') && item !== null && item !== '' && item !== false) || containsRemoteModel(item, depth + 1))
}
function localModelfile(value: unknown, cacheDirectory: string): boolean {
  if (typeof value !== 'string') return false
  let source = /^\s*FROM\s+(.+)\s*$/imu.exec(value)?.[1].trim()
  if (!source) return false
  if (source.startsWith('"') && source.endsWith('"')) source = source.slice(1, -1)
  const cache = resolve(cacheDirectory) + sep
  return source.startsWith(cache) && /^blobs\/sha256[:-][a-f0-9]{64}$/u.test(source.slice(cache.length))
}
async function localJson(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('The local model returned an incomplete response')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const value = await reader.read()
      if (value.done) break
      size += value.value.length
      if (size > 2 * 1024 * 1024) throw new Error('The local model metadata exceeds its limit')
      chunks.push(value.value)
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid local model metadata')
    return parsed as Record<string, unknown>
  } catch (error) { await reader.cancel().catch(() => undefined); throw error }
  finally { reader.releaseLock() }
}
const defaultDependencies: LocalOllamaDependencies = {
  platform: process.platform,
  installed: async () => {
    try { const info = await lstat(KUN_GMAIL_OLLAMA_BINARY); await access(KUN_GMAIL_OLLAMA_BINARY, constants.X_OK); return info.isFile() }
    catch { return false }
  },
  assertEncrypted: assertEncryptedGmailStorage, reservePort: reserveLocalOllamaPort,
  spawn: spawnOwnedProcess, stop: stopOwnedProcess, isOwned: isOwnedProcess,
  assertPortOwner: assertLocalOllamaPortOwner, directFetch: createDirectLocalOllamaFetch,
  now: Date.now, pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}

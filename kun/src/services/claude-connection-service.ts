import { spawnOwnedProcess, stopOwnedProcess } from '../process/owned-process.js'
import { createWriteStream } from 'node:fs'
import { access, chmod, mkdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import {
  ClaudeSdkInstallStatusSchema,
  type ClaudeSdkInstallStatus
} from '../contracts/model-connections.js'

const SDK_VERSION = '0.3.193'
const REGISTRY = 'https://registry.npmjs.org'
const TOKEN_PATTERN = /sk-ant-oat[\w-]+/u

export class ClaudeConnectionService {
  private state: ClaudeSdkInstallStatus = {
    installed: false,
    status: 'idle',
    receivedBytes: 0,
    totalBytes: 0
  }
  private installPromise?: Promise<void>

  constructor(private readonly options: {
    dataDir: string
    fetch?: typeof fetch
  }) {}

  async status(): Promise<ClaudeSdkInstallStatus> {
    const path = await this.resolveBinary()
    return ClaudeSdkInstallStatusSchema.parse({
      ...this.state,
      installed: Boolean(path),
      ...(path ? { path } : {})
    })
  }

  async install(): Promise<ClaudeSdkInstallStatus> {
    const current = await this.status()
    if (current.installed || this.installPromise) return current
    const pkg = platformPackage()
    if (!pkg) {
      this.state = { ...this.state, status: 'error', message: `Unsupported platform: ${process.platform}/${process.arch}` }
      return this.status()
    }
    this.state = { installed: false, status: 'downloading', receivedBytes: 0, totalBytes: 0 }
    this.installPromise = this.download(pkg).then(
      (path) => {
        process.env.KUN_CLAUDE_BINARY = path
        this.state = { ...this.state, installed: true, path, status: 'done' }
      },
      (error) => {
        this.state = { ...this.state, installed: false, status: 'error', message: safeError(error) }
      }
    ).finally(() => { this.installPromise = undefined })
    return this.status()
  }

  async setupToken(timeoutMs = 10 * 60 * 1000, signal?: AbortSignal): Promise<string> {
    const binary = await this.resolveBinary()
    if (!binary) throw new Error('Claude Code is not installed')
    const child = await spawnOwnedProcess(binary, ['setup-token'], {
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false, env: process.env
    })
    return new Promise((resolve, reject) => {
      let settled = false
      let output = ''
      let timer: ReturnType<typeof setTimeout> | undefined
      const done = (error?: Error, token?: string): void => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        if (error) reject(error)
        else resolve(token!)
      }
      const inspect = (chunk: Buffer | string): void => {
        output = `${output}${String(chunk)}`.slice(-64 * 1024)
        const token = output.match(TOKEN_PATTERN)?.[0]
        if (token) done(undefined, token)
      }
      child.stdout?.on('data', inspect)
      child.stderr?.on('data', inspect)
      child.once('error', (error) => done(error))
      child.once('exit', (code) => {
        const token = output.match(TOKEN_PATTERN)?.[0]
        if (token) done(undefined, token)
        else done(new Error(`claude setup-token exited with code ${code ?? 'unknown'}`))
      })
      timer = setTimeout(() => {
        void stopOwnedProcess(child).catch(reject)
        done(new Error('Claude login timed out'))
      }, timeoutMs)
      const abort = (): void => {
        void stopOwnedProcess(child).catch(reject)
        done(new Error('Claude login cancelled'))
      }
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
    })
  }

  private async resolveBinary(): Promise<string | undefined> {
    const candidates = [
      process.env.KUN_CLAUDE_BINARY,
      this.downloadedPath(),
      optionalPackageBinary()
    ].filter((value): value is string => Boolean(value))
    for (const candidate of candidates) {
      try {
        await access(candidate)
        return candidate
      } catch { /* try the next source */ }
    }
    return undefined
  }

  private downloadedPath(): string {
    return join(this.options.dataDir, 'agent-sdk', binaryName())
  }

  private async download(pkg: string): Promise<string> {
    const fetchImpl = this.options.fetch ?? fetch
    const metadata = await fetchImpl(`${REGISTRY}/${pkg}/${SDK_VERSION}`, {
      signal: AbortSignal.timeout(30_000)
    })
    if (!metadata.ok) throw new Error(`Claude SDK registry request failed with HTTP ${metadata.status}`)
    const value = await metadata.json() as { dist?: { tarball?: string } }
    if (!value.dist?.tarball) throw new Error('Claude SDK registry response has no tarball')
    const response = await fetchImpl(value.dist.tarball, { signal: AbortSignal.timeout(30 * 60 * 1000) })
    if (!response.ok || !response.body) throw new Error(`Claude SDK download failed with HTTP ${response.status}`)
    const destination = this.downloadedPath()
    const archive = join(tmpdir(), `kun-claude-sdk-${process.pid}-${Date.now()}.tgz`)
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
    const totalBytes = Number(response.headers.get('content-length')) || 0
    let receivedBytes = 0
    const counter = new Transform({
      transform: (chunk, _encoding, callback) => {
        receivedBytes += chunk.length
        this.state = { ...this.state, receivedBytes, totalBytes }
        callback(null, chunk)
      }
    })
    try {
      await pipeline(
        Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
        counter,
        createWriteStream(archive, { mode: 0o600 })
      )
      await runTar(['-xzf', archive, '-C', dirname(destination), '--strip-components=1', `package/${binaryName()}`])
      if ((await stat(destination)).size <= 0) throw new Error('Downloaded Claude binary is empty')
      if (process.platform !== 'win32') await chmod(destination, 0o755)
      return destination
    } finally {
      await rm(archive, { force: true }).catch(() => undefined)
    }
  }
}

async function runTar(args: string[]): Promise<void> {
  const child = await spawnOwnedProcess('tar', args, { stdio: 'ignore', windowsHide: true })
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`tar exited with code ${code}`)))
  })
}

function platformPackage(): string | undefined {
  const platform = process.platform === 'darwin' ? 'darwin'
    : process.platform === 'win32' ? 'win32'
      : process.platform === 'linux' ? 'linux' : undefined
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : undefined
  return platform && arch ? `@anthropic-ai/claude-agent-sdk-${platform}-${arch}` : undefined
}

function binaryName(): string { return process.platform === 'win32' ? 'claude.exe' : 'claude' }

function optionalPackageBinary(): string | undefined {
  const pkg = platformPackage()
  if (!pkg) return undefined
  const kunRoot = fileURLToPath(new URL('../../', import.meta.url))
  return join(kunRoot, 'node_modules', pkg, binaryName())
}

function safeError(error: unknown): string { return error instanceof Error ? error.message : String(error) }

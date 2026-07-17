import { execFile, spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { request as httpsRequest } from 'node:https'
import { join } from 'node:path'

type ManagedProcess = {
  exitCode: number | null
  killed: boolean
  kill(signal?: NodeJS.Signals | number): boolean
  once(event: 'exit', listener: (...args: unknown[]) => void): unknown
}
type LocalServerState = {
  state: 'stopped' | 'starting' | 'running' | 'error'
  serverUrl: string
  enrollmentToken?: string
  error?: string
}

export class LocalCollaborationServer {
  private child: ManagedProcess | null = null
  private current: LocalServerState

  constructor(private readonly options: {
    binaryPath: string
    dataDir: string
    listen?: string
    isInitialized?: () => Promise<boolean>
    run?: (binaryPath: string, args: string[]) => Promise<{ stdout: string }>
    spawn?: (binaryPath: string, args: string[], options: { windowsHide: boolean; stdio: 'ignore' }) => ManagedProcess
    waitUntilReady?: (serverUrl: string) => Promise<void>
  }) {
    this.current = { state: 'stopped', serverUrl: this.serverUrl() }
  }

  status(): LocalServerState {
    if (this.child && (this.child.exitCode !== null || this.child.killed)) {
      this.child = null
      this.current = { state: 'stopped', serverUrl: this.serverUrl() }
    }
    return { ...this.current }
  }

  async start(): Promise<LocalServerState> {
    if (this.status().state === 'running') return this.status()
    this.current = { state: 'starting', serverUrl: this.serverUrl() }
    try {
      let enrollmentToken: string | undefined
      const initialized = await (this.options.isInitialized ?? (() => fileExists(join(this.options.dataDir, 'tls-cert.pem'))))()
      if (!initialized) {
        const result = await (this.options.run ?? runBinary)(
          this.options.binaryPath,
          ['init', '--data-dir', this.options.dataDir]
        )
        enrollmentToken = result.stdout.match(/^operatorEnrollmentToken=(.+)$/m)?.[1]?.trim()
      }
      const args = ['serve', '--data-dir', this.options.dataDir, '--listen', this.options.listen ?? '127.0.0.1:19443']
      const child = (this.options.spawn ?? spawnBinary)(this.options.binaryPath, args, {
        windowsHide: true,
        stdio: 'ignore'
      })
      this.child = child
      child.once('exit', () => {
        if (this.child !== child) return
        this.child = null
        if (this.current.state === 'running') this.current = { state: 'stopped', serverUrl: this.serverUrl() }
      })
      await (this.options.waitUntilReady ?? waitForLocalTlsHealth)(this.serverUrl())
      this.current = {
        state: 'running',
        serverUrl: this.serverUrl(),
        ...(enrollmentToken ? { enrollmentToken } : {})
      }
      return this.status()
    } catch (cause) {
      this.child?.kill()
      this.child = null
      this.current = {
        state: 'error', serverUrl: this.serverUrl(),
        error: cause instanceof Error ? cause.message : String(cause)
      }
      throw cause
    }
  }

  async stop(): Promise<LocalServerState> {
    const child = this.child
    if (child && child.exitCode === null && !child.killed) {
      await new Promise<void>((resolve) => {
        child.once('exit', () => resolve())
        if (!child.kill()) resolve()
      })
    }
    this.child = null
    this.current = { state: 'stopped', serverUrl: this.serverUrl() }
    return this.status()
  }

  private serverUrl(): string {
    return `https://${this.options.listen ?? '127.0.0.1:19443'}`
  }
}

async function fileExists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false)
}

function runBinary(binaryPath: string, args: string[]): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(binaryPath, args, { windowsHide: true, encoding: 'utf8' }, (error, stdout) => {
      if (error) reject(error)
      else resolve({ stdout })
    })
  })
}

function spawnBinary(
  binaryPath: string,
  args: string[],
  options: { windowsHide: boolean; stdio: 'ignore' }
): ManagedProcess {
  return spawn(binaryPath, args, options)
}

async function waitForLocalTlsHealth(serverUrl: string): Promise<void> {
  const url = new URL(serverUrl)
  if (url.protocol !== 'https:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('The built-in Collaboration server must use local HTTPS')
  }
  const deadline = Date.now() + 8_000
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const health = await requestLocalHealth(url)
      if (health && typeof health === 'object' && (health as { ok?: unknown }).ok === true) return
      lastError = new Error('Local Collaboration server returned an invalid health response')
    } catch (cause) {
      lastError = cause
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('Local Collaboration server did not become ready', { cause: lastError })
}

function requestLocalHealth(baseUrl: URL): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(new URL('/health', baseUrl), {
      method: 'GET', rejectUnauthorized: false, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3'
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
      response.once('error', reject)
      response.once('end', () => {
        if (response.statusCode !== 200) return reject(new Error(`Local Collaboration health failed with HTTP ${response.statusCode}`))
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (cause) { reject(cause) }
      })
    })
    request.once('error', reject)
    request.end()
  })
}

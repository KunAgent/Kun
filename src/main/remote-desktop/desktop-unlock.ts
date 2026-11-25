import { execFile, spawn, spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import {
  directBase64, openDesktopUnlockPassword, validateDesktopUnlockBox, x25519PublicKey,
  type DesktopLockState, type DesktopUnlockBox, type DesktopUnlockChallenge
} from '@kun/remote-protocol'
import type { DesktopAuthority } from '@kun/control-runtime/desktop'
import { desktopHelperAvailable, desktopHelperPath } from './native-input'

const exec = promisify(execFile)
const CHALLENGE_TTL_MS = 60_000
const MAX_CHALLENGES = 16
const FAILURE_WINDOW_MS = 60_000
const MAX_FAILURES_PER_WINDOW = 5

export type DesktopHostLockState = { lockState: DesktopLockState; inputReady: boolean }

let cachedSupported: boolean | undefined
export function desktopUnlockSupported(): boolean {
  if (cachedSupported !== undefined) return cachedSupported
  if (process.platform !== 'darwin' || !desktopHelperAvailable()) return (cachedSupported = false)
  const probe = spawnSync(desktopHelperPath(), ['--unlock-probe'], { encoding: 'utf8', timeout: 2000, windowsHide: true })
  cachedSupported = probe.status === 0 && probe.stdout?.trim() === 'kun-desktop-unlock-v1'
  return cachedSupported
}

export async function readDesktopLockState(): Promise<DesktopHostLockState> {
  if (process.platform !== 'darwin' || !desktopHelperAvailable()) return { lockState: 'inactive', inputReady: false }
  try {
    const { stdout } = await exec(desktopHelperPath(), ['--lock-state'], { timeout: 2000, maxBuffer: 4096, windowsHide: true })
    const parsed = JSON.parse(stdout.trim()) as { lockState?: unknown; inputReady?: unknown }
    const lockState: DesktopLockState = parsed.lockState === 'unlocked' || parsed.lockState === 'locked' ? parsed.lockState : 'inactive'
    return { lockState, inputReady: parsed.inputReady === true }
  } catch {
    return { lockState: 'inactive', inputReady: false }
  }
}

export async function runDesktopUnlockHelper(password: string): Promise<void> {
  if (!desktopUnlockSupported()) throw new Error('DESKTOP_UNSUPPORTED')
  await new Promise<void>((resolve, reject) => {
    const child = spawn(desktopHelperPath(), ['--unlock'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
    let stdout = ''
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(new Error('DESKTOP_UNLOCK_FAILED'))
    }, 12_000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (stdout.length > 4096) {
        child.kill('SIGKILL')
        finish(new Error('DESKTOP_UNLOCK_FAILED'))
      }
    })
    child.once('error', () => finish(new Error('DESKTOP_UNLOCK_FAILED')))
    child.once('close', (code) => {
      if (settled) return
      try {
        const result = JSON.parse(stdout.trim()) as { ok?: unknown; error?: unknown }
        if (code === 0 && result.ok === true) finish()
        else finish(new Error(typeof result.error === 'string' && /^[A-Z_]+$/.test(result.error) ? result.error : 'DESKTOP_UNLOCK_FAILED'))
      } catch {
        finish(new Error('DESKTOP_UNLOCK_FAILED'))
      }
    })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify({ password }) + '\n')
  })
}

type StoredChallenge = {
  accountId: string
  deviceId: string
  hostId: string
  authorizationId: string
  secretKey: Uint8Array
  expiresAt: number
}

export type DesktopUnlockCoordinatorDeps = {
  supported?(): boolean
  readLockState?(): Promise<DesktopHostLockState>
  runUnlock?(password: string): Promise<void>
  now?(): number
  random?(size: number): Uint8Array
  id?(): string
  diagnostic?(event: { event: 'unlock_prepared' | 'unlocked' | 'unlock_failed'; code?: string }): void
}

/** Issues single-use ephemeral X25519 challenges; passwords never enter storage, argv, or logs. */
export class DesktopUnlockCoordinator {
  private readonly challenges = new Map<string, StoredChallenge>()
  private readonly failures: number[] = []
  private inFlight = false
  constructor(private readonly deps: DesktopUnlockCoordinatorDeps = {}) {}
  private now() { return this.deps.now?.() ?? Date.now() }
  private supported() { return (this.deps.supported ?? desktopUnlockSupported)() }
  private lockState() { return (this.deps.readLockState ?? readDesktopLockState)() }
  private unlock(password: string) { return (this.deps.runUnlock ?? runDesktopUnlockHelper)(password) }
  private record(event: 'unlock_prepared' | 'unlocked' | 'unlock_failed', code?: string) {
    try { this.deps.diagnostic?.({ event, ...(code ? { code } : {}) }) } catch { /* Diagnostics never block unlock cleanup. */ }
  }
  private prune() {
    const now = this.now()
    for (const [key, entry] of this.challenges) {
      if (entry.expiresAt <= now) { entry.secretKey.fill(0); this.challenges.delete(key) }
    }
    while (this.failures.length > 0 && now - this.failures[0]! >= FAILURE_WINDOW_MS) this.failures.shift()
  }
  private rateLimited() {
    this.prune()
    return this.failures.length >= MAX_FAILURES_PER_WINDOW
  }
  clear() {
    for (const entry of this.challenges.values()) entry.secretKey.fill(0)
    this.challenges.clear()
  }
  revokePeer(deviceId: string) {
    for (const [key, entry] of this.challenges) {
      if (entry.deviceId === deviceId) { entry.secretKey.fill(0); this.challenges.delete(key) }
    }
  }
  async prepare(authority: DesktopAuthority): Promise<DesktopUnlockChallenge> {
    this.prune()
    if (!authority.current() || !authority.hostId) throw new Error('DESKTOP_AUTHORITY_CHANGED')
    if (!this.supported()) throw new Error('DESKTOP_UNSUPPORTED')
    if (this.inFlight) throw new Error('DESKTOP_BUSY')
    if (this.rateLimited()) throw new Error('DESKTOP_UNLOCK_RATE_LIMITED')
    const state = await this.lockState()
    if (!authority.current()) throw new Error('DESKTOP_AUTHORITY_CHANGED')
    if (state.lockState === 'unlocked') throw new Error('DESKTOP_ALREADY_UNLOCKED')
    if (state.lockState !== 'locked') throw new Error('DESKTOP_HOST_INACTIVE')
    if (!state.inputReady) throw new Error('INPUT_PERMISSION_REQUIRED')
    for (const [key, entry] of this.challenges) {
      if (entry.deviceId === authority.deviceId) { entry.secretKey.fill(0); this.challenges.delete(key) }
    }
    if (this.challenges.size >= MAX_CHALLENGES) throw new Error('BACKPRESSURE')
    const secretKey = Uint8Array.from((this.deps.random ?? randomBytes)(32))
    const publicKey = directBase64(x25519PublicKey(secretKey))
    const challengeId = (this.deps.id ?? randomUUID)()
    this.challenges.set(challengeId, {
      accountId: authority.accountId,
      deviceId: authority.deviceId,
      hostId: authority.hostId,
      authorizationId: authority.authorizationId,
      secretKey,
      expiresAt: this.now() + CHALLENGE_TTL_MS
    })
    this.record('unlock_prepared')
    return { challengeId, publicKey, expiresInMs: CHALLENGE_TTL_MS }
  }
  async submit(authority: DesktopAuthority, rawBox: DesktopUnlockBox): Promise<{ unlocked: true }> {
    this.prune()
    if (!authority.current() || !authority.hostId) throw new Error('DESKTOP_AUTHORITY_CHANGED')
    if (!this.supported()) throw new Error('DESKTOP_UNSUPPORTED')
    if (this.rateLimited()) throw new Error('DESKTOP_UNLOCK_RATE_LIMITED')
    const box = validateDesktopUnlockBox(rawBox)
    const challenge = this.challenges.get(box.challengeId)
    if (!challenge) throw new Error('DESKTOP_SESSION_EXPIRED')
    this.challenges.delete(box.challengeId)
    try {
      if (challenge.accountId !== authority.accountId || challenge.deviceId !== authority.deviceId ||
          challenge.hostId !== authority.hostId || challenge.authorizationId !== authority.authorizationId) {
        throw new Error('DESKTOP_AUTHORITY_CHANGED')
      }
      if (this.inFlight) throw new Error('DESKTOP_BUSY')
      let password: string
      try {
        password = openDesktopUnlockPassword({
          challengeId: box.challengeId,
          hostId: challenge.hostId,
          hostSecretKey: challenge.secretKey,
          box
        })
      } catch {
        throw new Error('INVALID_REQUEST')
      }
      this.inFlight = true
      try {
        await this.unlock(password)
        this.record('unlocked')
        return { unlocked: true }
      } catch (error) {
        const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'DESKTOP_UNLOCK_FAILED'
        if (code === 'DESKTOP_UNLOCK_DENIED') this.failures.push(this.now())
        this.record('unlock_failed', code)
        throw new Error(code)
      } finally {
        this.inFlight = false
      }
    } finally {
      challenge.secretKey.fill(0)
    }
  }
}

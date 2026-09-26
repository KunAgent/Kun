import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { REMOTE_ACCESS_PASSWORD_HASH_PREFIX } from '../../shared/app-settings-remote'

const SCRYPT_N = 16_384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEY_LENGTH = 32
const SALT_BYTES = 16

export const REMOTE_SESSION_COOKIE = 'kun_remote_session'
export const REMOTE_CLIENT_HEADER = 'x-kun-remote-client'
export const REMOTE_CSRF_HEADER = 'x-kun-remote-request'

export function hashRemoteAccessPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES)
  const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P
  })
  return `${REMOTE_ACCESS_PASSWORD_HASH_PREFIX}$${SCRYPT_N}$${salt.toString('hex')}$${derived.toString('hex')}`
}

export function verifyRemoteAccessPassword(password: string, storedHash: string): boolean {
  if (typeof storedHash !== 'string' || !storedHash.startsWith(`${REMOTE_ACCESS_PASSWORD_HASH_PREFIX}$`)) {
    return false
  }
  const parts = storedHash.split('$')
  if (parts.length !== 4) return false
  const [, nRaw, saltHex, hashHex] = parts
  const n = Number(nRaw)
  if (!Number.isInteger(n) || n <= 0) return false
  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(saltHex, 'hex')
    expected = Buffer.from(hashHex, 'hex')
  } catch {
    return false
  }
  if (salt.length === 0 || expected.length !== SCRYPT_KEY_LENGTH) return false
  try {
    const derived = scryptSync(password, salt, expected.length, { N: n, r: SCRYPT_R, p: SCRYPT_P })
    return timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {}
  if (!header) return cookies
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const name = part.slice(0, eq).trim()
    if (!name) continue
    cookies[name] = part.slice(eq + 1).trim()
  }
  return cookies
}

type RemoteSession = {
  token: string
  createdAt: number
  expiresAt: number
  remoteAddress: string
}

const MAX_REMOTE_SESSIONS = 128
// setTimeout cannot hold delays past ~24.8 days; long TTLs re-arm as needed.
const MAX_EXPIRY_TIMER_MS = 2_147_000_000

export class RemoteSessionRegistry {
  private readonly sessions = new Map<string, RemoteSession>()
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>()
  private onRemoved: ((token: string | null) => void) | null = null

  constructor(private readonly now: () => number = () => Date.now()) {}

  /**
   * Called once per removed session, for every removal path: explicit
   * revoke, timer-driven expiry, lazy expiry inside verify/eviction, and
   * oldest-session eviction. `null` means every session was cleared.
   */
  setOnRemoved(cb: (token: string | null) => void): void {
    this.onRemoved = cb
  }

  create(remoteAddress: string, ttlHours: number): RemoteSession {
    if (this.sessions.size >= MAX_REMOTE_SESSIONS) this.evictExpiredAndOldest()
    const now = this.now()
    const session: RemoteSession = {
      token: randomBytes(24).toString('base64url'),
      createdAt: now,
      expiresAt: now + Math.max(1, ttlHours) * 3_600_000,
      remoteAddress
    }
    this.sessions.set(session.token, session)
    this.armExpiry(session)
    return session
  }

  verify(token: string | undefined | null): RemoteSession | null {
    if (!token) return null
    const session = this.sessions.get(token)
    if (!session) return null
    if (session.expiresAt <= this.now()) {
      this.remove(token)
      return null
    }
    return session
  }

  revoke(token: string | undefined | null): void {
    if (!token) return
    this.remove(token)
  }

  revokeAll(): void {
    if (this.sessions.size === 0) return
    this.sessions.clear()
    for (const timer of this.expiryTimers.values()) clearTimeout(timer)
    this.expiryTimers.clear()
    this.onRemoved?.(null)
  }

  get size(): number {
    this.evictExpired()
    return this.sessions.size
  }

  /** Timer-driven expiry so open connections die at expiry even without a
   *  later request noticing the dead session. */
  private armExpiry(session: RemoteSession): void {
    const delay = Math.min(session.expiresAt - this.now(), MAX_EXPIRY_TIMER_MS)
    const timer = setTimeout(() => {
      this.expiryTimers.delete(session.token)
      if (session.expiresAt <= this.now()) this.remove(session.token)
      else this.armExpiry(session)
    }, delay)
    timer.unref?.()
    this.expiryTimers.set(session.token, timer)
  }

  private remove(token: string): void {
    if (!this.sessions.delete(token)) return
    const timer = this.expiryTimers.get(token)
    if (timer) clearTimeout(timer)
    this.expiryTimers.delete(token)
    this.onRemoved?.(token)
  }

  private evictExpired(): void {
    const now = this.now()
    for (const [token, session] of this.sessions) {
      if (session.expiresAt <= now) this.remove(token)
    }
  }

  private evictExpiredAndOldest(): void {
    this.evictExpired()
    if (this.sessions.size < MAX_REMOTE_SESSIONS) return
    let oldestToken: string | null = null
    let oldest = Number.POSITIVE_INFINITY
    for (const [token, session] of this.sessions) {
      if (session.createdAt < oldest) {
        oldest = session.createdAt
        oldestToken = token
      }
    }
    if (oldestToken) this.remove(oldestToken)
  }
}

const LOGIN_FAILURE_WINDOW_MS = 5 * 60_000
const LOGIN_FAILURE_LIMIT = 8
const LOGIN_BLOCK_MS = 60_000

type LoginFailures = {
  failures: number[]
  blockedUntil: number
}

/** Per-IP sliding-window limiter for the Remote login endpoint. */
export class RemoteLoginRateLimiter {
  private readonly failures = new Map<string, LoginFailures>()
  constructor(private readonly now: () => number = () => Date.now()) {}

  blockedSecondsRemaining(remoteAddress: string): number {
    const record = this.failures.get(remoteAddress)
    if (!record) return 0
    const remaining = record.blockedUntil - this.now()
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0
  }

  recordFailure(remoteAddress: string): void {
    const now = this.now()
    const record = this.failures.get(remoteAddress) ?? { failures: [], blockedUntil: 0 }
    record.failures = record.failures.filter((at) => now - at < LOGIN_FAILURE_WINDOW_MS)
    record.failures.push(now)
    if (record.failures.length >= LOGIN_FAILURE_LIMIT) {
      record.blockedUntil = now + LOGIN_BLOCK_MS
      record.failures = []
    }
    this.failures.set(remoteAddress, record)
  }

  recordSuccess(remoteAddress: string): void {
    this.failures.delete(remoteAddress)
  }
}

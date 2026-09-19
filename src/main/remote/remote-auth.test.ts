import { describe, expect, it } from 'vitest'
import {
  hashRemoteAccessPassword,
  parseCookies,
  RemoteLoginRateLimiter,
  RemoteSessionRegistry,
  verifyRemoteAccessPassword
} from './remote-auth'

describe('remote access password hashing', () => {
  it('round-trips a password hash', () => {
    const hash = hashRemoteAccessPassword('secret-phrase')
    expect(hash.startsWith('scrypt-v1$')).toBe(true)
    expect(verifyRemoteAccessPassword('secret-phrase', hash)).toBe(true)
    expect(verifyRemoteAccessPassword('wrong', hash)).toBe(false)
  })

  it('rejects malformed stored hashes without throwing', () => {
    expect(verifyRemoteAccessPassword('x', '')).toBe(false)
    expect(verifyRemoteAccessPassword('x', 'plaintext')).toBe(false)
    expect(verifyRemoteAccessPassword('x', 'scrypt-v1$abc$salt$hash')).toBe(false)
    expect(verifyRemoteAccessPassword('x', 'scrypt-v1$16384$zz$00')).toBe(false)
    expect(verifyRemoteAccessPassword('x', 'scrypt-v1$-1$00$00')).toBe(false)
  })
})

describe('parseCookies', () => {
  it('parses cookie headers', () => {
    expect(parseCookies('a=1; b= two ;kun_remote_session=tok')).toEqual({
      a: '1',
      b: 'two',
      kun_remote_session: 'tok'
    })
    expect(parseCookies(undefined)).toEqual({})
    expect(parseCookies('')).toEqual({})
  })
})

describe('RemoteSessionRegistry', () => {
  it('creates and verifies sessions', () => {
    const registry = new RemoteSessionRegistry()
    const session = registry.create('192.168.1.2', 24)
    expect(registry.verify(session.token)?.remoteAddress).toBe('192.168.1.2')
    registry.revoke(session.token)
    expect(registry.verify(session.token)).toBeNull()
  })

  it('expires sessions past their ttl', () => {
    let now = 1_000
    const registry = new RemoteSessionRegistry(() => now)
    const session = registry.create('10.0.0.2', 1)
    now += 3_600_000 + 1
    expect(registry.verify(session.token)).toBeNull()
  })

  it('revokes every session at once', () => {
    const registry = new RemoteSessionRegistry()
    const a = registry.create('10.0.0.2', 1)
    const b = registry.create('10.0.0.3', 1)
    registry.revokeAll()
    expect(registry.verify(a.token)).toBeNull()
    expect(registry.verify(b.token)).toBeNull()
  })
})

describe('RemoteLoginRateLimiter', () => {
  it('blocks an address after repeated failures', () => {
    let now = 0
    const limiter = new RemoteLoginRateLimiter(() => now)
    for (let i = 0; i < 8; i += 1) limiter.recordFailure('1.2.3.4')
    expect(limiter.blockedSecondsRemaining('1.2.3.4')).toBeGreaterThan(0)
    expect(limiter.blockedSecondsRemaining('5.6.7.8')).toBe(0)
    now += 61_000
    expect(limiter.blockedSecondsRemaining('1.2.3.4')).toBe(0)
  })

  it('clears the failure window on success', () => {
    const limiter = new RemoteLoginRateLimiter()
    for (let i = 0; i < 7; i += 1) limiter.recordFailure('1.2.3.4')
    limiter.recordSuccess('1.2.3.4')
    for (let i = 0; i < 7; i += 1) limiter.recordFailure('1.2.3.4')
    expect(limiter.blockedSecondsRemaining('1.2.3.4')).toBe(0)
  })
})

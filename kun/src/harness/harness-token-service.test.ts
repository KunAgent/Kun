import { describe, expect, it } from 'vitest'
import {
  HARNESS_TOKEN_PREFIX,
  HarnessTokenService
} from './harness-token-service.js'

const baseInput = {
  threadId: 'thread_1',
  harnessId: 'claude-code',
  credentialIdentity: 'cred:anthropic',
  scopes: ['kun-tools'] as const
}

describe('HarnessTokenService', () => {
  it('issues deterministic tokens for the same identity and scope set', () => {
    const tokens = new HarnessTokenService()
    const first = tokens.issue({ ...baseInput, scopes: ['kun-tools'] })
    const second = tokens.issue({ ...baseInput, scopes: ['kun-tools'] })
    expect(second).toBe(first)
    expect(first.startsWith(HARNESS_TOKEN_PREFIX)).toBe(true)
    // Scope order is normalized: the same set in any order gets one grant.
    const forward = tokens.issue({ ...baseInput, scopes: ['gateway', 'kun-tools'] })
    const reordered = tokens.issue({ ...baseInput, scopes: ['kun-tools', 'gateway'] })
    expect(reordered).toBe(forward)
  })

  it('issues different tokens for different scopes of the same identity', () => {
    const tokens = new HarnessTokenService()
    const tools = tokens.issue({ ...baseInput, scopes: ['kun-tools'] })
    const gateway = tokens.issue({ ...baseInput, scopes: ['gateway'] })
    const both = tokens.issue({ ...baseInput, scopes: ['gateway', 'kun-tools'] })
    expect(new Set([tools, gateway, both]).size).toBe(3)
  })

  it('verifies issued tokens and returns the grant', () => {
    const tokens = new HarnessTokenService()
    const token = tokens.issue({
      ...baseInput,
      scopes: ['kun-tools', 'worker-callback'],
      routes: [{ providerId: 'deepseek', model: 'deepseek-chat', role: 'main' }],
      maxConcurrent: 2,
      maxBodyBytes: 4096
    })
    const grant = tokens.verify(token)
    expect(grant).toMatchObject({
      threadId: 'thread_1',
      harnessId: 'claude-code',
      scopes: ['kun-tools', 'worker-callback'],
      routes: [{ providerId: 'deepseek', model: 'deepseek-chat', role: 'main' }],
      maxConcurrent: 2,
      maxBodyBytes: 4096
    })
  })

  it('applies default concurrency and body limits', () => {
    const tokens = new HarnessTokenService()
    const grant = tokens.verify(tokens.issue({ ...baseInput, scopes: ['gateway'] }))
    expect(grant?.maxConcurrent).toBe(4)
    expect(grant?.maxBodyBytes).toBe(32 * 1024 * 1024)
  })

  it('rejects malformed, tampered, and foreign tokens', () => {
    const tokens = new HarnessTokenService()
    const token = tokens.issue({ ...baseInput, scopes: ['kun-tools'] })
    const [prefix, signature] = token.split('.')
    expect(tokens.verify(null)).toBeNull()
    expect(tokens.verify('')).toBeNull()
    expect(tokens.verify('not-a-token')).toBeNull()
    expect(tokens.verify('kun_local_abc.def')).toBeNull()
    expect(tokens.verify(`${prefix}.deadbeef`)).toBeNull()
    expect(tokens.verify(`kgw_deadbeef.${signature}`)).toBeNull()
    // A valid signature minted by a different secret must not verify.
    const other = new HarnessTokenService()
    expect(other.verify(token)).toBeNull()
  })

  it('enforces scopes on verifyScope', () => {
    const tokens = new HarnessTokenService()
    const token = tokens.issue({ ...baseInput, scopes: ['kun-tools'] })
    expect(tokens.verifyScope(token, 'kun-tools')?.threadId).toBe('thread_1')
    expect(tokens.verifyScope(token, 'gateway')).toBeNull()
    expect(tokens.verifyScope(token, 'worker-callback')).toBeNull()
    expect(tokens.verifyScope(undefined, 'kun-tools')).toBeNull()
  })

  it('rejects expired grants', () => {
    const tokens = new HarnessTokenService()
    const token = tokens.issue({ ...baseInput, scopes: ['kun-tools'], expiresAt: Date.now() - 1 })
    expect(tokens.verify(token)).toBeNull()
  })

  it('revokes every grant bound to a thread', () => {
    const tokens = new HarnessTokenService()
    const a = tokens.issue({ ...baseInput, scopes: ['kun-tools'] })
    const b = tokens.issue({ ...baseInput, scopes: ['gateway'] })
    const other = tokens.issue({ ...baseInput, threadId: 'thread_2', scopes: ['kun-tools'] })
    expect(tokens.revokeThread('thread_1')).toBe(2)
    expect(tokens.verify(a)).toBeNull()
    expect(tokens.verify(b)).toBeNull()
    expect(tokens.verify(other)).not.toBeNull()
    expect(tokens.revokeThread('thread_1')).toBe(0)
  })

  it('describes tokens by grant prefix without exposing the secret bytes', () => {
    const tokens = new HarnessTokenService()
    const token = tokens.issue({ ...baseInput, scopes: ['kun-tools'] })
    const described = tokens.describe(token)
    expect(described).toMatch(/^kgw_[0-9a-f]{8}…$/)
    expect(token.includes(described!)).toBe(false)
    expect(tokens.describe('kun_local_abc')).toBeNull()
    expect(tokens.describe(null)).toBeNull()
  })
})

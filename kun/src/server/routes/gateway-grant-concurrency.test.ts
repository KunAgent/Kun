import { describe, expect, it } from 'vitest'
import { HarnessTokenService } from '../../harness/harness-token-service.js'
import { acquireHarnessGrantLease } from './model-gateway-core.js'

describe('gateway concurrency across grant refresh', () => {
  it('does not reset in-flight budgets and honors a lowered concurrency limit', () => {
    const tokens = new HarnessTokenService()
    const input = { harnessId: 'codex', threadId: 'thread', credentialIdentity: 'provider', scopes: ['gateway'] as const }
    const key = tokens.issue({ ...input, maxConcurrent: 2 })
    const first = acquireHarnessGrantLease(tokens.verify(key)!, new AbortController().signal)!
    const second = acquireHarnessGrantLease(tokens.verify(key)!, new AbortController().signal)!
    tokens.issue({ ...input, maxConcurrent: 1 })
    expect(acquireHarnessGrantLease(tokens.verify(key)!, new AbortController().signal)).toBeNull()
    first.release()
    expect(acquireHarnessGrantLease(tokens.verify(key)!, new AbortController().signal)).toBeNull()
    second.release()
    const next = acquireHarnessGrantLease(tokens.verify(key)!, new AbortController().signal)!
    expect(next).not.toBeNull()
    next.release()
  })
})

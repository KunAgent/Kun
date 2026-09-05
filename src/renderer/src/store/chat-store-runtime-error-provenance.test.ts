import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../agent/types'
import { upsertRuntimeErrorBlock } from './chat-store-runtime-projection-support'

function errorBlock(id: string, providerId = 'codex'): Extract<ChatBlock, { kind: 'system' }> {
  return {
    kind: 'system', id, turnId: 'turn_1', text: 'overloaded', code: 'server_is_overloaded',
    severity: 'error', runtimeError: true,
    modelRequestFailure: {
      requestState: 'provider_responded', providerId, model: 'gpt-5.6-sol',
      providerCode: 'server_is_overloaded', category: 'unavailable'
    }
  }
}

describe('provider error deduplication', () => {
  it('merges the immediate and terminal projections for the same failure', () => {
    const blocks = upsertRuntimeErrorBlock([errorBlock('live_error')], errorBlock('terminal_error'))
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ id: 'terminal_error', modelRequestFailure: { providerId: 'codex' } })
  })

  it('keeps same-message failures from different providers distinct', () => {
    const blocks = upsertRuntimeErrorBlock([errorBlock('codex_error')], errorBlock('other_error', 'other'))
    expect(blocks).toHaveLength(2)
  })
})

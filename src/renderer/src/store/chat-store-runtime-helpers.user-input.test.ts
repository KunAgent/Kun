import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../agent/types'
import { hasLivePendingUserInput } from './chat-store-runtime-helpers'

function userInputBlock(overrides: Partial<Extract<ChatBlock, { kind: 'user_input' }>>): ChatBlock {
  return {
    kind: 'user_input',
    id: 'ui_1',
    requestId: 'input_1',
    status: 'pending',
    live: true,
    questions: [],
    ...overrides
  }
}

describe('hasLivePendingUserInput', () => {
  it('is true for a live pending user_input block', () => {
    expect(hasLivePendingUserInput([userInputBlock({})])).toBe(true)
  })

  it('is false for a stale pending record rehydrated from history', () => {
    expect(hasLivePendingUserInput([userInputBlock({ live: false })])).toBe(false)
    expect(hasLivePendingUserInput([userInputBlock({ live: undefined })])).toBe(false)
  })

  it('is false once the request settles or for unrelated blocks', () => {
    expect(hasLivePendingUserInput([userInputBlock({ status: 'submitted' })])).toBe(false)
    expect(
      hasLivePendingUserInput([
        { kind: 'assistant', id: 'a_1', text: 'hi', status: 'success' } as ChatBlock
      ])
    ).toBe(false)
    expect(hasLivePendingUserInput([])).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { ContextWindowTurnItem } from '../../contracts/items.js'
import {
  makeModelContextItem,
  makeToolCallItem,
  makeToolResultItem,
  makeUserItem
} from '../../domain/item.js'
import type { ModelEndpointFormat } from '../../contracts/model-endpoint-format.js'
import type { ModelRequest } from '../../ports/model-client.js'
import { createCompatRequestCodecs } from './compat-request-builder.js'
import { projectCompatMessages } from './compat-message-projector.js'

const baseFields = {
  turnId: 'turn-cw',
  threadId: 'thread-cw',
  role: 'system' as const,
  status: 'completed' as const,
  createdAt: '2026-09-14T00:00:00.000Z'
}

function boundaryItem(overrides: Record<string, unknown> = {}) {
  return ContextWindowTurnItem.parse({
    ...baseFields,
    id: 'item-boundary',
    kind: 'context_window',
    schemaVersion: 1,
    windowId: 'win-2',
    previousWindowId: 'win-1',
    reason: 'model',
    sourceHistoryRevision: 41,
    splitBefore: { kind: 'item', itemId: 'item-user-9' },
    initializationRef: 'init:win-2',
    operationId: 'op-7',
    replacedTokens: 0,
    ...overrides
  })
}

function request(history: ModelRequest['history']): ModelRequest {
  return {
    threadId: 'thread-cw',
    turnId: 'turn-cw',
    model: 'window-model',
    systemPrompt: 'stable-system-prefix',
    prefix: [],
    history,
    tools: [],
    abortSignal: new AbortController().signal
  }
}

function project(history: ModelRequest['history']) {
  return projectCompatMessages(request(history), {
    thinkingMode: false,
    supportsImages: false
  })
}

function buildFor(format: ModelEndpointFormat, history: ModelRequest['history']) {
  return createCompatRequestCodecs().build({
    request: request(history),
    model: 'window-model',
    messages: project(history),
    tools: [],
    stream: true,
    endpointFormat: format,
    baseUrl: 'https://provider.example/v1',
    isCodex: false,
    isCodexLite: false,
    codexNativeImageGeneration: false
  })
}

describe('context window boundary projection', () => {
  it('maps a context_window boundary item to null while retaining surrounding history', () => {
    const beforeUser = makeUserItem({
      id: 'item-user-9',
      turnId: 'turn-old',
      threadId: 'thread-cw',
      text: 'old window user request'
    })
    const initContext = makeModelContextItem({
      id: 'item-init',
      turnId: 'turn-cw',
      threadId: 'thread-cw',
      stepIndex: 0,
      contentDigest: 'digest-init',
      blocks: [],
      text: 'new window initialization context',
      baseline: true
    })
    const afterUser = makeUserItem({
      id: 'item-user-10',
      turnId: 'turn-cw',
      threadId: 'thread-cw',
      text: 'continue the task'
    })

    const messages = project([
      beforeUser,
      boundaryItem(),
      initContext,
      afterUser
    ])

    expect(messages.map((message) => [message.role, message.content])).toEqual([
      ['system', 'stable-system-prefix'],
      ['user', 'old window user request'],
      ['system', 'new window initialization context'],
      ['user', 'continue the task']
    ])
  })

  it('keeps tool call/result pairs adjacent across a boundary without emitting boundary text', () => {
    const call = makeToolCallItem({
      id: 'item-call-1',
      turnId: 'turn-old',
      threadId: 'thread-cw',
      callId: 'call-1',
      toolName: 'notes_read_file',
      arguments: { path: 'notes/plan.md' },
      status: 'completed'
    })
    const result = makeToolResultItem({
      id: 'item-result-1',
      turnId: 'turn-old',
      threadId: 'thread-cw',
      callId: 'call-1',
      toolName: 'notes_read_file',
      output: { path: 'notes/plan.md', revision: 2 }
    })
    const afterUser = makeUserItem({
      id: 'item-user-11',
      turnId: 'turn-cw',
      threadId: 'thread-cw',
      text: 'next step'
    })

    const messages = project([call, result, boundaryItem(), afterUser])
    const assistant = messages.find((message) => message.role === 'assistant')
    expect(assistant?.tool_calls?.[0]?.function.name).toBe('notes_read_file')
    expect(messages.some((message) => message.role === 'tool')).toBe(true)
    const serialized = JSON.stringify(messages)
    expect(serialized).not.toContain('win-2')
    expect(serialized).not.toContain('op-7')
    expect(serialized).not.toContain('initializationRef')
  })

  it('drops a window-0 boundary with no previous window', () => {
    const firstUser = makeUserItem({
      id: 'item-user-0',
      turnId: 'turn-old',
      threadId: 'thread-cw',
      text: 'retained pre-window history'
    })
    const messages = project([
      firstUser,
      boundaryItem({ previousWindowId: null, windowId: 'win-0', reason: 'manual-summary' })
    ])
    expect(messages).toHaveLength(2)
    expect(messages[1]).toMatchObject({ role: 'user', content: 'retained pre-window history' })
  })

  it('still forwards a summary-bearing compaction while dropping the boundary', () => {
    const compaction = {
      ...baseFields,
      id: 'item-compact',
      kind: 'compaction' as const,
      summary: 'Earlier turns summarized.',
      replacedTokens: 1200,
      pinnedConstraints: [],
      sourceItemIds: ['item-user-9']
    }
    const afterUser = makeUserItem({
      id: 'item-user-12',
      turnId: 'turn-cw',
      threadId: 'thread-cw',
      text: 'after both'
    })

    const messages = project([compaction, boundaryItem(), afterUser])
    const systemTexts = messages
      .filter((message) => message.role === 'system')
      .map((message) => String(message.content))
    expect(systemTexts.some((text) => text.includes('Earlier turns summarized.'))).toBe(true)
    expect(systemTexts.some((text) => text.includes('win-2'))).toBe(false)
    expect(messages.some((message) => message.role === 'user')).toBe(true)
  })

  it('keeps boundary fields out of the serialized request body for every endpoint family', () => {
    const history = [
      makeUserItem({
        id: 'item-user-9',
        turnId: 'turn-old',
        threadId: 'thread-cw',
        text: 'before'
      }),
      boundaryItem(),
      makeUserItem({
        id: 'item-user-10',
        turnId: 'turn-cw',
        threadId: 'thread-cw',
        text: 'after'
      })
    ]
    for (const endpointFormat of ['chat_completions', 'messages', 'responses'] as const) {
      const serialized = JSON.stringify(buildFor(endpointFormat, history))
      expect(serialized).not.toContain('context_window')
      expect(serialized).not.toContain('win-2')
      expect(serialized).not.toContain('op-7')
      expect(serialized).not.toContain('splitBefore')
      expect(serialized).toContain('before')
      expect(serialized).toContain('after')
    }
  })
})

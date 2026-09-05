import { describe, expect, it } from 'vitest'
import {
  AgentListRunEventsRequestSchema,
  AgentListRunEventsResponseSchema,
  AgentRunEventSchema,
  ListOwnThreadsResponseSchema
} from '../src/index.js'

const base = {
  runId: 'run-1',
  threadId: 'thread-1',
  sequence: 1,
  timestamp: '2026-08-31T00:00:00.000Z'
}

describe('Agent history schemas', () => {
  it('defaults to the bounded first page', () => {
    expect(AgentListRunEventsRequestSchema.parse({ runId: 'run-1' })).toEqual({
      runId: 'run-1',
      afterSequence: 0,
      limit: 100
    })
    expect(() => AgentListRunEventsRequestSchema.parse({ runId: 'run-1', limit: 201 })).toThrow()
  })

  it('supports replaceable user and assistant messages', () => {
    expect(AgentRunEventSchema.parse({
      ...base,
      type: 'message',
      role: 'user',
      messageId: 'message:user-1',
      phase: 'complete',
      content: 'Hello'
    })).toMatchObject({ role: 'user', messageId: 'message:user-1', phase: 'complete' })
    expect(() => AgentRunEventSchema.parse({
      ...base,
      type: 'message',
      role: 'assistant',
      content: 'missing identity'
    })).toThrow()
  })

  it('requires an explicit numeric continuation cursor and history completeness', () => {
    expect(AgentListRunEventsResponseSchema.parse({
      items: [],
      cursor: 42,
      hasMore: false,
      historyIncomplete: true
    })).toEqual({ items: [], cursor: 42, hasMore: false, historyIncomplete: true })
  })

  it('keeps the latest owned run in paginated thread projections', () => {
    const latestRun = {
      id: 'run-1',
      threadId: 'thread-1',
      ownerExtensionId: 'com.example.agent',
      ownerExtensionVersion: '1.4.0',
      extensionVisibility: 'private',
      extensionBudget: {},
      toolCatalogEpoch: 'epoch:none',
      state: 'completed',
      model: 'default-model',
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:01:00.000Z',
      terminalAt: '2026-08-31T00:01:00.000Z'
    }
    expect(ListOwnThreadsResponseSchema.parse({
      items: [{
        id: 'thread-1',
        title: 'Completed conversation',
        ownerExtensionId: 'com.example.agent',
        ownerExtensionVersion: '1.4.0',
        extensionVisibility: 'private',
        latestRun,
        createdAt: '2026-08-31T00:00:00.000Z',
        updatedAt: '2026-08-31T00:01:00.000Z'
      }],
      page: { hasMore: false }
    })).toMatchObject({ items: [{ latestRun: { id: 'run-1', state: 'completed' } }] })
  })
})

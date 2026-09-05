import { describe, expect, it } from 'vitest'
import {
  createExtensionAgentHarness as createHarness,
  extensionAgentPrincipal as principal,
  workspace
} from './extension-agent-service.test-support.js'

describe('ExtensionAgentService durable history projection', () => {
  it('pages user, assistant, steering, and path-free tool summaries with stable identities', async () => {
    const h = createHarness()
    const run = await h.service.createRun(principal(), { input: 'History baseline', workspace })
    const afterSequence = (await h.sessions.highestSeq(run.threadId)) + 1
    await h.events.record({
      kind: 'item_completed',
      threadId: run.threadId,
      turnId: run.id,
      item: {
        kind: 'user_message', id: 'user-history-1', threadId: run.threadId, turnId: run.id,
        role: 'user', status: 'completed', createdAt: '2026-07-11T08:00:01.000Z',
        text: 'Show the durable conversation',
        fileReferences: [{ path: '/private/secret.txt', relativePath: 'secret.txt', name: 'secret.txt' }]
      }
    })
    await h.events.record({
      kind: 'assistant_text_delta',
      threadId: run.threadId,
      turnId: run.id,
      itemId: 'assistant-history-1',
      deltaOffset: 0,
      item: {
        kind: 'assistant_text', id: 'assistant-history-1', threadId: run.threadId, turnId: run.id,
        role: 'assistant', status: 'running', createdAt: '2026-07-11T08:00:02.000Z', text: 'Working'
      }
    })
    await h.events.record({
      kind: 'item_completed',
      threadId: run.threadId,
      turnId: run.id,
      item: {
        kind: 'assistant_text', id: 'assistant-history-1', threadId: run.threadId, turnId: run.id,
        role: 'assistant', status: 'completed', createdAt: '2026-07-11T08:00:02.000Z',
        finishedAt: '2026-07-11T08:00:03.000Z', text: 'Working complete'
      }
    })
    await h.events.record({
      kind: 'tool_call_started',
      threadId: run.threadId,
      turnId: run.id,
      item: {
        kind: 'tool_call', id: 'tool-call-item', threadId: run.threadId, turnId: run.id,
        role: 'assistant', status: 'running', createdAt: '2026-07-11T08:00:04.000Z',
        toolName: 'read', callId: 'call-history-1', toolKind: 'tool_call',
        arguments: { path: '/private/secret.txt', token: 'never-project-this' },
        summary: 'Read /private/secret.txt'
      }
    })
    await h.events.record({
      kind: 'tool_call_finished',
      threadId: run.threadId,
      turnId: run.id,
      item: {
        kind: 'tool_result', id: 'tool-result-item', threadId: run.threadId, turnId: run.id,
        role: 'tool', status: 'completed', createdAt: '2026-07-11T08:00:05.000Z',
        toolName: 'read', callId: 'call-history-1', toolKind: 'tool_call',
        output: { content: 'private file contents', path: '/private/secret.txt' }, isError: false
      }
    })
    await h.events.record({
      kind: 'source_tool_page',
      threadId: run.threadId,
      turnId: run.id,
      toolName: 'read',
      callId: 'call-history-page-secret',
      hasMore: true,
      continuation: 'cursor',
      budgetTokens: 4_096
    })
    await h.events.record({
      kind: 'model_request_retry',
      threadId: run.threadId,
      turnId: run.id,
      attempt: 2,
      maxAttempts: 3,
      delayMs: 250,
      reason: 'network',
      status: 503,
      failureSummary: 'provider raw failure at /private/provider.log'
    })
    await h.events.record({
      kind: 'turn_steered', threadId: run.threadId, turnId: run.id, text: 'Focus on the public summary'
    })

    const first = await h.service.listRunEvents(principal(), { runId: run.id, afterSequence, limit: 3 })
    expect(first).toMatchObject({ hasMore: true, historyIncomplete: false })
    expect(first.items.map(({ payload }) => payload)).toEqual([
      expect.objectContaining({ role: 'user', messageId: 'message:user-history-1', phase: 'complete' }),
      expect.objectContaining({ role: 'assistant', messageId: 'message:assistant-history-1', phase: 'delta' }),
      expect.objectContaining({ role: 'assistant', messageId: 'message:assistant-history-1', phase: 'complete' })
    ])
    const second = await h.service.listRunEvents(principal(), {
      runId: run.id,
      afterSequence: first.cursor,
      limit: 10
    })
    expect(second.hasMore).toBe(false)
    expect(second.items.map(({ payload }) => payload)).toEqual([
      expect.objectContaining({
        role: 'tool', messageId: 'tool:call-history-1', phase: 'replace',
        content: { toolName: 'read', status: 'running', summary: 'Tool read running' }
      }),
      expect.objectContaining({
        role: 'tool', messageId: 'tool:call-history-1', phase: 'complete',
        content: { toolName: 'read', status: 'completed', summary: 'Tool read completed' }
      }),
      expect.objectContaining({
        message: 'source_tool_page', data: { toolName: 'read', hasMore: true }
      }),
      expect.objectContaining({
        message: 'model_request_retry',
        data: { attempt: 2, maxAttempts: 3, delayMs: 250, reason: 'network', status: 503 }
      }),
      expect.objectContaining({ role: 'user', phase: 'complete', content: 'Focus on the public summary' })
    ])
    expect(JSON.stringify([...first.items, ...second.items])).not.toMatch(
      /\/private\/secret|\/private\/provider|private file contents|never-project-this|arguments|output|continuation|budgetTokens|call-history-page-secret|failureSummary/
    )
    await expect(h.service.listRunEvents(principal('com.example.foreign'), { runId: run.id }))
      .rejects.toMatchObject({ code: 'not_found' })
    await expect(h.service.listRunEvents({
      ...principal(), permissions: ['agent.threads.readOwn']
    }, { runId: run.id })).rejects.toMatchObject({ code: 'permission_denied' })
    await expect(h.service.listRunEvents({
      ...principal(), permissions: ['agent.run']
    }, { runId: run.id })).rejects.toMatchObject({ code: 'permission_denied' })
  })
})

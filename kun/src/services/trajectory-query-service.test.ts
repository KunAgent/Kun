import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { TurnItem } from '../contracts/items.js'
import type { TrajectoryMessageRecord } from '../contracts/trajectory.js'
import type { SessionStore } from '../ports/session-store.js'
import { LlmDebugRecorder } from './llm-debug-recorder.js'
import {
  projectMessageRawDetail,
  projectMessageSourceDetail
} from './trajectory-query-message-detail.js'
import { TrajectoryQueryService } from './trajectory-query-service.js'

describe('TrajectoryQueryService', () => {
  it('joins model attempts with canonical tool and message items', async () => {
    const recorder = new LlmDebugRecorder()
    const round = recorder.start({
      threadId: 'thread-1', turnId: 'turn-1', provider: 'test', model: 'gpt-test',
      roundId: 'round-1', step: 2, captureContent: false
    })
    const request = recorder.beginHttpAttempt(round, {
      endpointFormat: 'chat_completions', attempt: 1, reason: 'initial',
      url: 'https://provider.example/v1/chat/completions', headers: {}, bodyText: '{"secret":"not-stored"}'
    })
    recorder.captureChunk(round, { kind: 'assistant_text_delta', text: 'done' })
    recorder.captureChunk(round, {
      kind: 'usage',
      usage: {
        promptTokens: 100, completionTokens: 20, totalTokens: 120,
        cacheHitTokens: 80, cacheHitRate: 0.8, turns: 1,
        requestTtftMs: 25, requestGenerationMs: 500
      }
    })
    recorder.captureChunk(round, { kind: 'completed', stopReason: 'tool_calls' })
    await recorder.finish(round)

    const items: TurnItem[] = [
      {
        id: 'user-1', kind: 'user_message', threadId: 'thread-1', turnId: 'turn-1',
        role: 'user', status: 'completed', createdAt: request.startedAt, text: 'fix it'
      },
      {
        id: 'tool-call-1', kind: 'tool_call', threadId: 'thread-1', turnId: 'turn-1',
        role: 'assistant', status: 'completed', createdAt: request.startedAt,
        callId: 'call-1', toolName: 'read', toolKind: 'tool_call', arguments: { path: 'src/a.ts' }
      },
      {
        id: 'tool-result-1', kind: 'tool_result', threadId: 'thread-1', turnId: 'turn-1',
        role: 'tool', status: 'completed', createdAt: new Date(Date.parse(request.startedAt) + 10).toISOString(),
        callId: 'call-1', toolName: 'read', toolKind: 'tool_call', output: 'ok', isError: false
      }
    ]
    const sessions = { loadItems: async () => items } as unknown as SessionStore
    const service = new TrajectoryQueryService(recorder, sessions)
    const page = await service.page('thread-1', { limit: 20, filter: 'all', query: '' })

    expect(page.records.some((record) => record.kind === 'llm_request' && record.step === 2)).toBe(true)
    expect(page.records).toContainEqual(expect.objectContaining({
      kind: 'tool', callId: 'call-1', status: 'completed', resultItemId: 'tool-result-1'
    }))
    expect(page.summary).toMatchObject({ requestCount: 1, toolCount: 1, inputTokens: 100 })
    const input = await service.detail('thread-1', `request:${request.id}`, 'input')
    expect(input).toMatchObject({ state: 'not_captured' })
    const output = await service.detail('thread-1', `request:${request.id}`, 'output')
    expect(JSON.stringify(output)).toContain('tool-result-1')
  })

  it('projects Harness rows, real subtools, prompt updates, and request-scoped details', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-trajectory-query-'))
    const recorder = new LlmDebugRecorder({ dataDir })
    const firstRound = recorder.start({
      threadId: 'thread-2', turnId: 'turn-2', provider: 'test', model: 'model-a',
      roundId: 'round-a', step: 0, captureContent: true
    })
    const first = recorder.beginHttpAttempt(firstRound, {
      endpointFormat: 'chat_completions', attempt: 1, reason: 'initial',
      url: 'https://provider.example/v1/chat/completions', headers: {},
      bodyText: JSON.stringify({
        system: 'system v1',
        tools: [{ function: { name: 'read', parameters: { type: 'object' } } }],
        messages: [{ role: 'user', content: 'first' }],
        temperature: 0
      })
    })
    first.startedAt = '2026-01-01T00:00:00.000Z'
    recorder.captureChunk(firstRound, { kind: 'completed', stopReason: 'stop' })
    await recorder.finish(firstRound)

    const secondRound = recorder.start({
      threadId: 'thread-2', turnId: 'turn-2', provider: 'test', model: 'model-a',
      roundId: 'round-b', step: 1, captureContent: true
    })
    const second = recorder.beginHttpAttempt(secondRound, {
      endpointFormat: 'chat_completions', attempt: 1, reason: 'initial',
      url: 'https://provider.example/v1/chat/completions', headers: {},
      bodyText: JSON.stringify({
        system: 'system v2',
        tools: [{ function: { name: 'read', parameters: { type: 'object' } } }],
        messages: [{ role: 'user', content: 'second' }],
        temperature: 0.2
      })
    })
    second.startedAt = '2026-01-01T00:00:01.000Z'
    recorder.captureChunk(secondRound, { kind: 'completed', stopReason: 'tool_calls' })
    await recorder.finish(secondRound)

    const thirdRound = recorder.start({
      threadId: 'thread-2', turnId: 'turn-2', provider: 'test', model: 'model-a',
      roundId: 'round-c', step: 2, captureContent: true
    })
    const third = recorder.beginHttpAttempt(thirdRound, {
      endpointFormat: 'chat_completions', attempt: 1, reason: 'initial',
      url: 'https://provider.example/v1/chat/completions', headers: {},
      bodyText: JSON.stringify({
        system: 'system v2',
        tools: [{ function: { name: 'read', parameters: { type: 'object' } } }],
        messages: [{ role: 'user', content: 'third message only' }],
        temperature: 0.2
      })
    })
    third.startedAt = '2026-01-01T00:00:02.000Z'
    recorder.captureChunk(thirdRound, { kind: 'completed', stopReason: 'stop' })
    await recorder.finish(thirdRound)

    const base = {
      threadId: 'thread-2', turnId: 'turn-2', role: 'assistant' as const, status: 'completed' as const
    }
    const items: TurnItem[] = [
      {
        ...base, id: 'context-1', kind: 'model_context', role: 'system', formatVersion: 1,
        stepIndex: 0, contentDigest: 'digest', blocks: [], text: 'workspace context',
        createdAt: '2026-01-01T00:00:00.100Z'
      },
      {
        ...base, id: 'compact-1', kind: 'compaction', role: 'system', summary: 'older history',
        replacedTokens: 500, pinnedConstraints: [], createdAt: '2026-01-01T00:00:00.200Z'
      },
      {
        ...base, id: 'reasoning-2', kind: 'assistant_reasoning', text: 'thinking',
        createdAt: '2026-01-01T00:00:01.100Z'
      },
      {
        ...base, id: 'text-2', kind: 'assistant_text', text: 'answer',
        createdAt: '2026-01-01T00:00:01.200Z'
      },
      {
        ...base, id: 'call-2', kind: 'tool_call', callId: 'call-2', toolName: 'read',
        toolKind: 'tool_call', arguments: { path: 'a.ts' },
        createdAt: '2026-01-01T00:00:01.300Z'
      },
      {
        ...base, id: 'result-2', kind: 'tool_result', role: 'tool', callId: 'call-2',
        toolName: 'read', toolKind: 'tool_call', isError: false,
        output: {
          text: 'file',
          childRuns: [{
            childId: 'child-1', toolName: 'shell', status: 'completed',
            startedAt: '2026-01-01T00:00:01.310Z', completedAt: '2026-01-01T00:00:01.330Z',
            summary: 'checked'
          }]
        },
        createdAt: '2026-01-01T00:00:01.340Z'
      }
    ]
    const sessions = { loadItems: async () => items } as unknown as SessionStore
    const service = new TrajectoryQueryService(recorder, sessions)

    try {
      const page = await service.page('thread-2', { limit: 30, filter: 'all', query: '' })
      const systems = page.records.filter((record) => record.kind === 'system')
      expect(systems).toHaveLength(2)
      expect(page.records).toContainEqual(expect.objectContaining({
        kind: 'llm_request', requestId: third.id, previousPromptFingerprint: expect.any(String)
      }))
      expect(systems.some((record) => record.preview === 'System Prompt Updated')).toBe(true)
      expect(page.records).toContainEqual(expect.objectContaining({ kind: 'context', itemId: 'context-1' }))
      expect(page.records).toContainEqual(expect.objectContaining({ kind: 'compacted', itemId: 'compact-1' }))
      expect(page.records).toContainEqual(expect.objectContaining({
        kind: 'assistant', itemIds: ['reasoning-2', 'text-2'], preview: 'answer', thinkingPreview: 'thinking'
      }))
      expect(page.records).toContainEqual(expect.objectContaining({
        kind: 'subtool', callId: 'child-1', parentCallId: 'call-2', toolName: 'shell'
      }))

      const firstOutput = await service.detail('thread-2', `request:${first.id}`, 'output')
      expect(JSON.stringify(firstOutput)).not.toContain('text-2')
      const options = await service.detail('thread-2', `request:${second.id}`, 'options')
      expect(JSON.stringify(options)).toContain('0.2')
      const updatedSystem = systems.find(
        (record) => record.kind === 'system' && record.parentRequestId === second.id
      )
      expect(updatedSystem).toBeDefined()
      const diff = await service.detail('thread-2', updatedSystem!.id, 'diff')
      expect(JSON.stringify(diff)).toContain('system v1')
      expect(JSON.stringify(diff)).toContain('system v2')
      const schema = await service.detail('thread-2', 'tool:call-2', 'schema')
      expect(JSON.stringify(schema)).toContain('parameters')
      const payload = await service.detail('thread-2', 'tool:call-2', 'arguments')
      expect(JSON.stringify(payload)).toContain('call-2')
      expect(JSON.stringify(payload)).not.toContain('result-2')
      const result = await service.detail('thread-2', 'tool:call-2', 'result')
      expect(JSON.stringify(result)).toContain('result-2')
      expect(JSON.stringify(result)).not.toContain('"id":"call-2"')
      const assistantRaw = await service.detail('thread-2', `assistant:${second.id}`, 'raw')
      expect(JSON.stringify(assistantRaw)).toContain('reasoning-2')
      expect(JSON.stringify(assistantRaw)).toContain('text-2')
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('separates raw message blocks from whitelisted message source metadata', async () => {
    const recorder = new LlmDebugRecorder()
    const round = recorder.start({
      threadId: 'thread-detail', turnId: 'turn-detail', provider: 'test', model: 'model-detail',
      roundId: 'round-detail', step: 0, captureContent: false
    })
    const request = recorder.beginHttpAttempt(round, {
      endpointFormat: 'chat_completions', attempt: 1, reason: 'initial',
      url: 'https://provider.example/v1/chat/completions', headers: {}, bodyText: '{}'
    })
    request.startedAt = '2026-02-01T00:00:00.000Z'
    recorder.captureChunk(round, { kind: 'completed', stopReason: 'tool_calls' })
    await recorder.finish(round)

    const base = {
      threadId: 'thread-detail', turnId: 'turn-detail', status: 'completed' as const
    }
    const items: TurnItem[] = [
      {
        ...base, id: 'user-detail', kind: 'user_message', role: 'user',
        text: 'inspect this', attachmentIds: ['attachment-detail'],
        workspace: '/private/workspace', threadAgentSurface: 'code', agentSurface: 'code',
        createdAt: '2026-02-01T00:00:00.010Z'
      },
      {
        ...base, id: 'background-detail', kind: 'user_message', role: 'user',
        text: '<background_subagent_completed>done</background_subagent_completed>',
        messageSource: 'background_subagent',
        createdAt: '2026-02-01T00:00:00.020Z'
      },
      {
        ...base, id: 'reasoning-detail', kind: 'assistant_reasoning', role: 'assistant',
        text: 'reason first', createdAt: '2026-02-01T00:00:00.100Z'
      },
      {
        ...base, id: 'text-detail', kind: 'assistant_text', role: 'assistant',
        text: 'answer second\nCookie: session=cookie-sentinel\nAWS_ACCESS_KEY_ID=AKIA1234567890ABCDEF\nprefix data:image/png;base64,EMBEDDED_BINARY_SENTINEL',
        createdAt: '2026-02-01T00:00:00.100Z'
      },
      {
        ...base, id: 'tool-detail', kind: 'tool_call', role: 'assistant',
        callId: 'call-detail', toolName: 'read', toolKind: 'tool_call',
        arguments: {
          path: 'src/example.ts',
          authorization: 'Bearer sk-test-credential-key',
          cookie: 'session=object-cookie-sentinel',
          auth: 'object-auth-sentinel',
          accessKeyId: 'object-access-key-sentinel',
          credentials: { apiKey: 'sk-test-credential-key' },
          image: 'data:image/png;base64,BASE64_SENTINEL',
          note: 'prefix data:image/png;base64,EMBEDDED_OBJECT_BINARY_SENTINEL'
        },
        providerMetadata: { gemini: { thoughtSignature: 'provider-signature-sentinel' } },
        createdAt: '2026-02-01T00:00:00.100Z'
      }
    ]
    const sessions = { loadItems: async () => items } as unknown as SessionStore
    const service = new TrajectoryQueryService(recorder, sessions)
    const page = await service.page('thread-detail', { limit: 30, filter: 'all', query: '' })

    const user = page.records.find((record) => record.id === 'item:user-detail')
    expect(user).toMatchObject({ kind: 'user', sourceType: 'user', sourceAvailable: true })
    const userRaw = await service.detail('thread-detail', 'item:user-detail', 'raw')
    expect(userRaw).toMatchObject({
      state: 'available',
      content: {
        kind: 'blocks',
        blocks: [
          { type: 'text', content: 'inspect this', itemId: 'user-detail' },
          { type: 'attachment', attachmentId: 'attachment-detail', itemId: 'user-detail' }
        ]
      }
    })
    const userSource = await service.detail('thread-detail', 'item:user-detail', 'source')
    expect(userSource).toMatchObject({
      state: 'available',
      content: { kind: 'message-source', label: 'User', value: { kind: 'user' } }
    })
    expect(JSON.stringify(userSource)).not.toMatch(/threadId|workspace|inspect this/)

    const background = page.records.find((record) => record.id === 'item:background-detail')
    expect(background).toMatchObject({
      kind: 'context', sourceType: 'background_subagent', sourceLabel: 'Background Subagent'
    })
    const backgroundSource = await service.detail(
      'thread-detail', 'item:background-detail', 'source'
    )
    expect(backgroundSource).toMatchObject({
      state: 'available',
      content: {
        kind: 'message-source',
        label: 'Background Subagent',
        value: { kind: 'background_subagent' }
      }
    })

    const assistantRaw = await service.detail(
      'thread-detail', `assistant:${request.id}`, 'raw'
    )
    expect(assistantRaw).toMatchObject({
      state: 'available',
      content: {
        kind: 'blocks',
        blocks: [
          { type: 'thinking', content: 'reason first', itemId: 'reasoning-detail' },
          { type: 'text', content: expect.stringContaining('answer second'), itemId: 'text-detail' },
          {
            type: 'tool-call', itemId: 'tool-detail', callId: 'call-detail', toolName: 'read',
            content: { path: 'src/example.ts' }
          }
        ]
      }
    })
    const serializedRaw = JSON.stringify(assistantRaw)
    expect(serializedRaw).not.toContain('providerMetadata')
    expect(serializedRaw).not.toContain('provider-signature-sentinel')
    expect(serializedRaw).not.toContain('sk-test-credential-key')
    expect(serializedRaw).not.toContain('BASE64_SENTINEL')
    expect(serializedRaw).not.toContain('cookie-sentinel')
    expect(serializedRaw).not.toContain('object-auth-sentinel')
    expect(serializedRaw).not.toContain('object-access-key-sentinel')
    expect(serializedRaw).not.toContain('AKIA1234567890ABCDEF')
    expect(serializedRaw).not.toContain('EMBEDDED_BINARY_SENTINEL')
    expect(serializedRaw).not.toContain('EMBEDDED_OBJECT_BINARY_SENTINEL')

    expect(user).toBeDefined()
    const missingRecord = user as TrajectoryMessageRecord
    expect(projectMessageRawDetail(missingRecord, [], [])).toMatchObject({
      state: 'evicted', warning: 'referenced Session content is unavailable'
    })
    expect(projectMessageSourceDetail(missingRecord, [])).toMatchObject({
      state: 'evicted', warning: 'referenced Session content is unavailable'
    })
  })
})

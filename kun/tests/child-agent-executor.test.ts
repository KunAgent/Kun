import { describe, expect, it } from 'vitest'

import { CapabilityRegistry } from '../src/adapters/tool/capability-registry.js'
import { LocalToolHost, buildDefaultLocalTools } from '../src/adapters/tool/local-tool-host.js'
import { InMemoryEventBus } from '../src/adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../src/adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../src/adapters/in-memory-thread-store.js'
import { createImmutablePrefix } from '../src/cache/immutable-prefix.js'
import { createChildAgentExecutor } from '../src/delegation/child-agent-executor.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../src/ports/model-client.js'
import { RuntimeEventRecorder } from '../src/services/runtime-event-recorder.js'

function model(chunks: ModelStreamChunk[], seen: ModelRequest[] = []): ModelClient {
  return {
    provider: 'child-test',
    model: 'child-test',
    async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
      seen.push(request)
      for (const chunk of chunks) yield chunk
    }
  }
}

describe('child agent executor', () => {
  it('runs a real child AgentLoop and returns assistant summary plus usage', async () => {
    const seen: ModelRequest[] = []
    const executor = createChildAgentExecutor({
      model: model([
        { kind: 'assistant_text_delta', text: 'child ' },
        { kind: 'assistant_text_delta', text: 'answer' },
        {
          kind: 'usage',
          usage: {
            promptTokens: 11,
            completionTokens: 3,
            totalTokens: 14,
            cacheHitTokens: 5,
            cacheMissTokens: 6,
            cacheHitRate: 5 / 11,
            cachedTokens: 5,
            turns: 1,
            costUsd: 0.001,
            cacheSavingsUsd: 0.0002
          }
        },
        { kind: 'completed', stopReason: 'stop' }
      ], seen),
      toolHost: new LocalToolHost({ registry: new CapabilityRegistry([]) }),
      prefix: createImmutablePrefix({ systemPrompt: 'child system' }),
      defaultModel: 'child-test',
      nowIso: () => '2026-06-03T00:00:00.000Z'
    })

    const result = await executor({
      childId: 'child_1',
      parentThreadId: 'thr_parent',
      parentTurnId: 'turn_parent',
      label: 'research',
      prompt: 'Research the issue',
      workspace: '/tmp/project',
      toolPolicy: 'inherit',
      signal: new AbortController().signal
    })

    expect(result.summary).toBe('child answer')
    expect(result).toMatchObject({ prefixReused: true, inheritedHistoryItems: 0 })
    expect(result.usage).toMatchObject({
      promptTokens: 11,
      completionTokens: 3,
      totalTokens: 14,
      cacheHitTokens: 5,
      cacheSavingsUsd: 0.0002,
      turns: 1
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      threadId: 'child_1',
      model: 'child-test',
      systemPrompt: 'child system',
      history: [
        expect.objectContaining({
          kind: 'user_message',
          text: 'Research the issue'
        })
      ]
    })
    expect(seen[0]?.tools).toEqual([])
  })

  it('fails the child run when the child loop cannot produce a completed turn', async () => {
    const executor = createChildAgentExecutor({
      model: model([{ kind: 'error', message: 'model failed', code: 'bad_model' }]),
      toolHost: new LocalToolHost({ registry: new CapabilityRegistry([]) }),
      prefix: createImmutablePrefix({ systemPrompt: 'child system' }),
      defaultModel: 'child-test',
      nowIso: () => '2026-06-03T00:00:00.000Z'
    })

    await expect(executor({
      childId: 'child_fail',
      parentThreadId: 'thr_parent',
      parentTurnId: 'turn_parent',
      prompt: 'Fail',
      toolPolicy: 'readOnly',
      signal: new AbortController().signal
    })).rejects.toThrow(/child agent failed|model failed/i)
  })

  it('restricts a read-only child to investigation tools and a preamble prompt', async () => {
    const seen: ModelRequest[] = []
    const registry = new CapabilityRegistry([{
      id: 'builtin',
      kind: 'built-in',
      enabled: true,
      available: true,
      tools: buildDefaultLocalTools()
    }])
    const executor = createChildAgentExecutor({
      model: model([
        { kind: 'assistant_text_delta', text: 'done' },
        { kind: 'completed', stopReason: 'stop' }
      ], seen),
      toolHost: new LocalToolHost({ registry }),
      prefix: createImmutablePrefix({ systemPrompt: 'child system' }),
      defaultModel: 'child-test',
      nowIso: () => '2026-06-03T00:00:00.000Z'
    })

    const result = await executor({
      childId: 'child_ro',
      parentThreadId: 'thr_parent',
      parentTurnId: 'turn_parent',
      prompt: 'Investigate the bug',
      promptPreamble: 'Read-only review.',
      toolPolicy: 'readOnly',
      signal: new AbortController().signal
    })

    const toolNames = (seen[0]?.tools ?? []).map((tool) => tool.name).sort()
    expect(toolNames).toEqual(['find', 'grep', 'ls', 'read'])
    expect(seen[0]?.history?.[0]).toMatchObject({
      kind: 'user_message',
      text: 'Read-only review.\n\nInvestigate the bug'
    })
    expect(result).toMatchObject({ prefixReused: true, inheritedHistoryItems: 0 })
  })

  it('does NOT fail the child when a tool call is rejected by its read-only policy', async () => {
    // The child (read-only) calls `bash`, which its policy denies. That is a
    // recoverable tool error (warning), not a fatal one: the loop hands the
    // model an error result, the model adapts and the turn completes. The
    // child run must report success, not "failed".
    const registry = new CapabilityRegistry([{
      id: 'builtin',
      kind: 'built-in',
      enabled: true,
      available: true,
      tools: buildDefaultLocalTools()
    }])
    let calls = 0
    const recoveringModel: ModelClient = {
      provider: 'child-test',
      model: 'child-test',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        calls += 1
        if (calls === 1) {
          yield { kind: 'tool_call_complete', callId: 'call_bash', toolName: 'bash', arguments: { command: 'ls' } }
          yield { kind: 'completed', stopReason: 'tool_calls' }
        } else {
          yield { kind: 'assistant_text_delta', text: 'bash was denied, so here is my read-only summary' }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      }
    }
    const executor = createChildAgentExecutor({
      model: recoveringModel,
      toolHost: new LocalToolHost({ registry }),
      prefix: createImmutablePrefix({ systemPrompt: 'child system' }),
      defaultModel: 'child-test',
      nowIso: () => '2026-06-03T00:00:00.000Z'
    })

    const result = await executor({
      childId: 'child_rejected_tool',
      parentThreadId: 'thr_parent',
      parentTurnId: 'turn_parent',
      prompt: 'Investigate the project',
      toolPolicy: 'readOnly',
      signal: new AbortController().signal
    })

    expect(calls).toBe(2)
    expect(result.summary).toContain('read-only summary')
  })

  it('threads the input providerId onto the child ModelRequest for routing', async () => {
    const seen: ModelRequest[] = []
    const executor = createChildAgentExecutor({
      model: model([
        { kind: 'assistant_text_delta', text: 'ok' },
        { kind: 'completed', stopReason: 'stop' }
      ], seen),
      toolHost: new LocalToolHost({ registry: new CapabilityRegistry([]) }),
      prefix: createImmutablePrefix({ systemPrompt: 'child system' }),
      defaultModel: 'child-test',
      nowIso: () => '2026-06-03T00:00:00.000Z'
    })

    await executor({
      childId: 'child_provider',
      parentThreadId: 'thr_parent',
      parentTurnId: 'turn_parent',
      prompt: 'Route me',
      providerId: 'minimax',
      toolPolicy: 'inherit',
      signal: new AbortController().signal
    })

    expect(seen[0]?.providerId).toBe('minimax')
  })

  it('persists the child as a hidden side thread when shared stores are supplied', async () => {
    const eventBus = new InMemoryEventBus()
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso: () => '2026-06-03T00:00:00.000Z'
    })
    const executor = createChildAgentExecutor({
      model: model([
        { kind: 'assistant_text_delta', text: 'child answer' },
        { kind: 'completed', stopReason: 'stop' }
      ]),
      toolHost: new LocalToolHost({ registry: new CapabilityRegistry([]) }),
      prefix: createImmutablePrefix({ systemPrompt: 'child system' }),
      defaultModel: 'child-test',
      nowIso: () => '2026-06-03T00:00:00.000Z',
      sessionStore,
      threadStore,
      events
    })

    await executor({
      childId: 'child_persisted',
      parentThreadId: 'thr_parent',
      parentTurnId: 'turn_parent',
      profile: 'explore',
      prompt: 'Investigate',
      toolPolicy: 'readOnly',
      signal: new AbortController().signal
    })

    // The child thread is queryable from the shared store, flagged `side` and
    // linked to its parent so the GUI can load it but the sidebar hides it.
    const persisted = await threadStore.get('child_persisted')
    expect(persisted).not.toBeNull()
    expect(persisted?.relation).toBe('side')
    expect(persisted?.parentThreadId).toBe('thr_parent')
    expect(persisted?.title).toContain('explore')

    // The child's transcript persists too (loadable for the read-only viewer).
    const items = await sessionStore.loadItems('child_persisted')
    expect(items.some((item) => item.kind === 'assistant_text')).toBe(true)
  })

  it('gives an inherit child the parent agent full tool set (no forced read-only allowlist)', async () => {
    const seen: ModelRequest[] = []
    const registry = new CapabilityRegistry([{
      id: 'builtin',
      kind: 'built-in',
      enabled: true,
      available: true,
      tools: buildDefaultLocalTools()
    }])
    const executor = createChildAgentExecutor({
      model: model([
        { kind: 'assistant_text_delta', text: 'done' },
        { kind: 'completed', stopReason: 'stop' }
      ], seen),
      toolHost: new LocalToolHost({ registry }),
      prefix: createImmutablePrefix({ systemPrompt: 'child system' }),
      defaultModel: 'child-test',
      nowIso: () => '2026-06-03T00:00:00.000Z'
    })

    await executor({
      childId: 'child_inherit',
      parentThreadId: 'thr_parent',
      parentTurnId: 'turn_parent',
      prompt: 'Do the work',
      toolPolicy: 'inherit',
      signal: new AbortController().signal
    })

    const toolNames = (seen[0]?.tools ?? []).map((tool) => tool.name)
    // The child sees write/shell tools (not just the read-only investigation
    // set) because inherit applies no forced allow-list.
    expect(toolNames).toContain('read')
    expect(toolNames.length).toBeGreaterThan(4)
    const restricted = new Set(['read', 'grep', 'find', 'ls'])
    expect(toolNames.some((name) => !restricted.has(name))).toBe(true)
  })

  it('honors an explicit allowedTools list over the tool policy', async () => {
    const seen: ModelRequest[] = []
    const registry = new CapabilityRegistry([{
      id: 'builtin',
      kind: 'built-in',
      enabled: true,
      available: true,
      tools: buildDefaultLocalTools()
    }])
    const executor = createChildAgentExecutor({
      model: model([
        { kind: 'assistant_text_delta', text: 'done' },
        { kind: 'completed', stopReason: 'stop' }
      ], seen),
      toolHost: new LocalToolHost({ registry }),
      prefix: createImmutablePrefix({ systemPrompt: 'child system' }),
      defaultModel: 'child-test',
      nowIso: () => '2026-06-03T00:00:00.000Z'
    })

    await executor({
      childId: 'child_tools',
      parentThreadId: 'thr_parent',
      parentTurnId: 'turn_parent',
      prompt: 'Investigate',
      // readOnly would allow read/grep/find/ls; the explicit list narrows it.
      toolPolicy: 'readOnly',
      allowedTools: ['read', 'grep'],
      signal: new AbortController().signal
    })

    const toolNames = (seen[0]?.tools ?? []).map((tool) => tool.name).sort()
    expect(toolNames).toEqual(['grep', 'read'])
  })

  it('drops blocked built-in tools (blockedTools) from an inherit child', async () => {
    const seen: ModelRequest[] = []
    const registry = new CapabilityRegistry([{
      id: 'builtin',
      kind: 'built-in',
      enabled: true,
      available: true,
      tools: buildDefaultLocalTools()
    }])
    const executor = createChildAgentExecutor({
      model: model([
        { kind: 'assistant_text_delta', text: 'done' },
        { kind: 'completed', stopReason: 'stop' }
      ], seen),
      toolHost: new LocalToolHost({ registry }),
      prefix: createImmutablePrefix({ systemPrompt: 'child system' }),
      defaultModel: 'child-test',
      nowIso: () => '2026-06-03T00:00:00.000Z'
    })

    await executor({
      childId: 'child_blocked_tools',
      parentThreadId: 'thr_parent',
      parentTurnId: 'turn_parent',
      prompt: 'Do the work',
      toolPolicy: 'inherit',
      blockedTools: ['bash', 'write'],
      signal: new AbortController().signal
    })

    const toolNames = (seen[0]?.tools ?? []).map((tool) => tool.name)
    expect(toolNames).toContain('read')
    expect(toolNames).not.toContain('bash')
    expect(toolNames).not.toContain('write')
  })

  it('maps blockedMcpServers to mcp:<serverId> and hides that server tools from the child', async () => {
    const seen: ModelRequest[] = []
    const mcpTool = LocalToolHost.defineTool({
      name: 'mcp_github_create_issue',
      description: 'create issue',
      inputSchema: { type: 'object' },
      policy: 'auto',
      execute: async () => ({ output: { ok: true } })
    })
    const registry = new CapabilityRegistry([
      { id: 'builtin', kind: 'built-in', enabled: true, available: true, tools: buildDefaultLocalTools() },
      { id: 'mcp:github', kind: 'mcp', enabled: true, available: true, tools: [mcpTool] }
    ])
    const executor = createChildAgentExecutor({
      model: model([
        { kind: 'assistant_text_delta', text: 'done' },
        { kind: 'completed', stopReason: 'stop' }
      ], seen),
      toolHost: new LocalToolHost({ registry }),
      prefix: createImmutablePrefix({ systemPrompt: 'child system' }),
      defaultModel: 'child-test',
      nowIso: () => '2026-06-03T00:00:00.000Z'
    })

    await executor({
      childId: 'child_blocked_mcp',
      parentThreadId: 'thr_parent',
      parentTurnId: 'turn_parent',
      prompt: 'Do the work',
      toolPolicy: 'inherit',
      blockedMcpServers: ['github'],
      signal: new AbortController().signal
    })

    const toolNames = (seen[0]?.tools ?? []).map((tool) => tool.name)
    expect(toolNames).toContain('read')
    expect(toolNames).not.toContain('mcp_github_create_issue')
  })

  it('augments the base system prompt with the agent systemPrompt', async () => {
    const seen: ModelRequest[] = []
    const executor = createChildAgentExecutor({
      model: model([
        { kind: 'assistant_text_delta', text: 'ok' },
        { kind: 'completed', stopReason: 'stop' }
      ], seen),
      toolHost: new LocalToolHost({ registry: new CapabilityRegistry([]) }),
      prefix: createImmutablePrefix({ systemPrompt: 'BASE PROMPT' }),
      defaultModel: 'child-test',
      nowIso: () => '2026-06-03T00:00:00.000Z'
    })

    await executor({
      childId: 'child_sys',
      parentThreadId: 'thr_parent',
      parentTurnId: 'turn_parent',
      prompt: 'Task',
      systemPrompt: 'You are a careful reviewer.',
      toolPolicy: 'inherit',
      signal: new AbortController().signal
    })

    expect(seen[0]?.systemPrompt).toBe('BASE PROMPT\n\nYou are a careful reviewer.')
  })

  it('persists the child as a hidden side thread on the shared stores when provided', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso: () => '2026-06-03T00:00:00.000Z'
    })
    const executor = createChildAgentExecutor({
      model: model([
        { kind: 'assistant_text_delta', text: 'persisted answer' },
        { kind: 'completed', stopReason: 'stop' }
      ]),
      toolHost: new LocalToolHost({ registry: new CapabilityRegistry([]) }),
      prefix: createImmutablePrefix({ systemPrompt: 'child system' }),
      defaultModel: 'child-test',
      sessionStore,
      threadStore,
      events,
      nowIso: () => '2026-06-03T00:00:00.000Z'
    })

    await executor({
      childId: 'child_persist',
      parentThreadId: 'thr_parent',
      parentTurnId: 'turn_parent',
      profile: 'explore',
      prompt: 'Investigate',
      toolPolicy: 'readOnly',
      signal: new AbortController().signal
    })

    // The child thread is persisted as a `side` branch of the parent. The
    // `side` relation is what the thread store / ThreadService.list filter on
    // to keep it out of the default (sidebar) list while leaving it loadable.
    const thread = await threadStore.get('child_persist')
    expect(thread).toMatchObject({ relation: 'side', parentThreadId: 'thr_parent' })

    // The full session must live on the thread RECORD's turns/items — that is
    // what `GET /threads/:id` (getThreadDetail → selectThread) reads to render
    // the child's conversation when the user drills into it.
    const recordItems = (thread?.turns ?? []).flatMap((turn) => turn.items)
    const recordAssistantText = recordItems
      .filter((item): item is Extract<typeof item, { kind: 'assistant_text' }> => item.kind === 'assistant_text')
      .map((item) => item.text)
      .join('')
    expect(recordAssistantText).toContain('persisted answer')
  })
})

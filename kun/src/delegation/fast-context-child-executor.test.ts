import { describe, expect, it } from 'vitest'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { LocalToolHost, type LocalTool } from '../adapters/tool/local-tool-host.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import { createThreadRecord } from '../domain/thread.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import { createChildAgentExecutor } from './child-agent-executor.js'

const tasks = [{ title: 'Read implementation', query: 'Find the implementation and explain its behavior.' }]
const groupedTasks = [
  ...tasks,
  { title: 'Read callers', query: 'Find callers and explain their behavior.' }
]

function sourceTool(
  name: 'grep' | 'glob' | 'read',
  onExecute?: (context: ToolHostContext) => void
): LocalTool {
  return LocalToolHost.defineTool({
    name,
    description: name,
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, additionalProperties: true },
    policy: 'auto',
    sideEffect: 'read-only',
    execute: async (_args, context) => {
      onExecute?.(context)
      return {
        output: name === 'read'
          ? { relative_path: 'src/target.ts', start_line: 10, end_line: 12, content: 'export const target = true' }
          : { matches: [] }
      }
    }
  })
}

function fastContextInput(model: string, signal = new AbortController().signal) {
  return {
    childId: 'child_fast_context', parentThreadId: 'parent', parentTurnId: 'turn_parent',
    prompt: 'retrieve source evidence', workspace: '/workspace', model, toolPolicy: 'readOnly' as const,
    fastContext: true, fastContextTasks: tasks, signal
  }
}

class CatalogModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'catalog-model'
  readonly requests: ModelRequest[] = []

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    yield { kind: 'assistant_text_delta', text: 'Task 1: source found.' }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

class ReadForeverModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'read-forever-model'
  requests = 0

  async *stream(): AsyncIterable<ModelStreamChunk> {
    this.requests += 1
    yield { kind: 'tool_call_complete', callId: `read_${this.requests}`, toolName: 'read', arguments: { path: 'src/target.ts', task_indexes: [1] } }
    yield { kind: 'completed', stopReason: 'tool_calls' }
  }
}

class OverflowThenConcludeModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'too-many-tools-model'
  requests = 0

  async *stream(): AsyncIterable<ModelStreamChunk> {
    this.requests += 1
    if (this.requests === 1) {
      for (let index = 0; index < 9; index += 1) {
        yield { kind: 'tool_call_complete', callId: `read_${index}`, toolName: 'read', arguments: { path: 'src/target.ts', task_indexes: [1] } }
      }
      yield { kind: 'completed', stopReason: 'tool_calls' }
      return
    }
    yield { kind: 'assistant_text_delta', text: 'Task 1: source found after bounded reads.' }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

class ReadThenConcludeModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'read-then-conclude-model'
  requests = 0

  async *stream(): AsyncIterable<ModelStreamChunk> {
    this.requests += 1
    if (this.requests === 1) {
      yield { kind: 'tool_call_complete', callId: 'read_once', toolName: 'read', arguments: { path: 'src/target.ts', task_indexes: [1] } }
      yield { kind: 'completed', stopReason: 'tool_calls' }
      return
    }
    yield { kind: 'assistant_text_delta', text: 'Task 1: source found.' }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

class ReadThenSilentFinishModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'read-then-silent-finish-model'
  requests = 0

  async *stream(): AsyncIterable<ModelStreamChunk> {
    this.requests += 1
    if (this.requests <= 3) {
      yield { kind: 'tool_call_complete', callId: `read_${this.requests}`, toolName: 'read', arguments: { path: 'src/target.ts', task_indexes: [1] } }
      yield { kind: 'completed', stopReason: 'tool_calls' }
      return
    }
    // Final round: no synthesis text at all — the turn settles completed with
    // tool_results only (the regression scenario).
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

class ConcludeThenInjectErrorModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'conclude-then-inject-error-model'
  requests = 0

  constructor(
    private readonly inject: () => Promise<void>
  ) {}

  async *stream(): AsyncIterable<ModelStreamChunk> {
    this.requests += 1
    if (this.requests === 1) {
      yield { kind: 'tool_call_complete', callId: 'read_once', toolName: 'read', arguments: { path: 'src/target.ts', task_indexes: [1] } }
      yield { kind: 'completed', stopReason: 'tool_calls' }
      return
    }
    // The turn settles completed normally; the injected error event lands in
    // the shared session store after the loop finished but before the executor
    // settles the child run.
    await this.inject()
    yield { kind: 'assistant_text_delta', text: 'Task 1: source found.' }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

describe('Fast Context child executor', () => {
  it('inherits a locked parent profile when admitting the first Design child turn', async () => {
    const model = new CatalogModel()
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const documentTarget = { documentId: 'doc_design', boardArtifactId: 'board_design' }
    const parentProfile = {
      version: 1 as const,
      documentTarget,
      outputMedium: 'html' as const,
      target: 'web' as const,
      preset: 'geist' as const,
      presetSource: 'explicit' as const,
      context: { tone: ['technical'] },
      lockedAtTurnId: 'turn_parent'
    }
    await threadStore.upsert(createThreadRecord({
      id: 'parent', title: 'Unified workbench', workspace: '/workspace',
      model: model.model, agentSurface: 'code', designProfile: parentProfile
    }))
    const executor = createChildAgentExecutor({
      model,
      toolHost: new LocalToolHost({ tools: [sourceTool('grep'), sourceTool('glob'), sourceTool('read')] }),
      prefix: createImmutablePrefix({ systemPrompt: 'test' }), defaultModel: model.model,
      threadStore, sessionStore
    })

    const result = await executor({ ...fastContextInput(model.model), agentSurface: 'design' })

    expect(result).toMatchObject({ summary: 'Task 1: source found.', evidencePack: { version: 1 } })
    expect(model.requests).toHaveLength(1)
    expect(model.requests[0]?.tools.map((tool) => tool.name).sort()).toEqual(['glob', 'grep', 'read'])
    const child = await threadStore.get('child_fast_context')
    const firstTurn = child?.turns[0]
    const firstUserItem = firstTurn?.items.find((item) => item.kind === 'user_message')
    expect(child).toMatchObject({
      agentSurface: 'design',
      designProfile: { ...parentProfile, lockedAtTurnId: firstTurn?.id }
    })
    expect(firstTurn).toMatchObject({
      agentSurface: 'design',
      designProfile: { ...parentProfile, lockedAtTurnId: firstTurn?.id },
      designDocumentTarget: documentTarget
    })
    expect(firstUserItem).toMatchObject({
      designProfile: { ...parentProfile, lockedAtTurnId: firstTurn?.id },
      designDocumentTarget: documentTarget
    })
    expect(firstTurn?.id).not.toBe(parentProfile.lockedAtTurnId)
  })

  it('bypasses provider-native SDK composition and exposes only grep, glob, and read', async () => {
    const model = new CatalogModel()
    let nativeFactoryCalls = 0
    const executor = createChildAgentExecutor({
      model,
      toolHost: new LocalToolHost({ tools: [sourceTool('grep'), sourceTool('glob'), sourceTool('read'), sourceTool('read')].slice(0, 3) }),
      prefix: createImmutablePrefix({ systemPrompt: 'test' }), defaultModel: model.model,
      createDelegatedRuntime: () => {
        nativeFactoryCalls += 1
        throw new Error('Fast Context must not construct a provider-native runtime')
      }
    })

    const result = await executor({ ...fastContextInput(model.model), fastContextTasks: groupedTasks })
    expect(result).toMatchObject({ summary: 'Task 1: source found.', evidencePack: { version: 1 } })
    expect(result.evidencePack?.tasks[0]).toMatchObject({ index: 0, evidence: [] })
    expect(nativeFactoryCalls).toBe(0)
    expect(model.requests).toHaveLength(1)
    expect(model.requests[0]?.tools.map((tool) => tool.name).sort()).toEqual(['glob', 'grep', 'read'])
    expect(model.requests[0]?.tools.find((tool) => tool.name === 'read')?.inputSchema).toMatchObject({
      properties: { task_indexes: { type: 'array', minItems: 1, maxItems: 2 } },
      required: expect.arrayContaining(['task_indexes'])
    })
  })

  it('caps a Fast Context child at four model steps, reserving the fourth for synthesis', async () => {
    const model = new ReadForeverModel()
    let reads = 0
    const executor = createChildAgentExecutor({
      model, toolHost: new LocalToolHost({ tools: [sourceTool('grep'), sourceTool('glob'), sourceTool('read', () => { reads += 1 })] }),
      prefix: createImmutablePrefix({ systemPrompt: 'test' }), defaultModel: model.model
    })

    await expect(executor(fastContextInput(model.model))).rejects.toMatchObject({
      name: 'ChildResultExecutionError',
      result: { evidencePack: { version: 1, tasks: [{ evidence: [{ path: 'src/target.ts', ranges: [[10, 12]] }] }] } }
    })
    expect(model.requests).toBe(4)
    expect(reads).toBe(3)
  })

  it('replaces the fake tool_result summary with the evidence-pack placeholder', async () => {
    const model = new ReadThenSilentFinishModel()
    const executor = createChildAgentExecutor({
      model, toolHost: new LocalToolHost({ tools: [sourceTool('grep'), sourceTool('glob'), sourceTool('read')] }),
      prefix: createImmutablePrefix({ systemPrompt: 'test' }), defaultModel: model.model
    })

    // The empty final round legitimately fails the loop turn, but the child
    // result must not carry a stringified tool_result as its summary.
    await expect(executor(fastContextInput(model.model))).rejects.toMatchObject({
      name: 'ChildResultExecutionError',
      result: {
        summary: 'Fast Context retrieval incomplete; see evidence pack.',
        evidencePack: {
          version: 1,
          tasks: [{ evidence: [{ path: 'src/target.ts', ranges: [[10, 12]] }] }]
        }
      }
    })
  })

  it.each([
    ['tool_loop_suppressed'],
    ['model_empty_response'],
    ['empty_post_tool_continuation']
  ] as const)('lets a completed Fast Context child outrank whitelisted loop error %s', async (code) => {
    const sessionStore = new InMemorySessionStore()
    const model = new ConcludeThenInjectErrorModel(async () => {
      const started = (await sessionStore.loadEventsSince('child_fast_context', 0))
        .find((event) => event.kind === 'turn_started')
      await sessionStore.appendEvent('child_fast_context', {
        seq: 100,
        kind: 'error',
        threadId: 'child_fast_context',
        ...(started?.turnId ? { turnId: started.turnId } : {}),
        message: 'loop bookkeeping error',
        code,
        severity: 'error',
        timestamp: new Date().toISOString()
      })
    })
    const executor = createChildAgentExecutor({
      model,
      sessionStore,
      toolHost: new LocalToolHost({ tools: [sourceTool('grep'), sourceTool('glob'), sourceTool('read')] }),
      prefix: createImmutablePrefix({ systemPrompt: 'test' }), defaultModel: model.model
    })

    await expect(executor(fastContextInput(model.model))).resolves.toMatchObject({
      summary: 'Task 1: source found.',
      evidencePack: { version: 1 }
    })
  })

  it('still fails a completed Fast Context child for a non-whitelisted fatal error', async () => {
    const sessionStore = new InMemorySessionStore()
    const model = new ConcludeThenInjectErrorModel(async () => {
      const started = (await sessionStore.loadEventsSince('child_fast_context', 0))
        .find((event) => event.kind === 'turn_started')
      await sessionStore.appendEvent('child_fast_context', {
        seq: 100,
        kind: 'error',
        threadId: 'child_fast_context',
        ...(started?.turnId ? { turnId: started.turnId } : {}),
        message: 'provider returned HTTP 520',
        code: 'upstream',
        severity: 'error',
        timestamp: new Date().toISOString()
      })
    })
    const executor = createChildAgentExecutor({
      model,
      sessionStore,
      toolHost: new LocalToolHost({ tools: [sourceTool('grep'), sourceTool('glob'), sourceTool('read')] }),
      prefix: createImmutablePrefix({ systemPrompt: 'test' }), defaultModel: model.model
    })

    await expect(executor(fastContextInput(model.model))).rejects.toMatchObject({
      name: 'ChildResultExecutionError',
      message: 'provider returned HTTP 520'
    })
  })

  it('truncates tool-call overflow and continues with the accepted batch', async () => {
    const model = new OverflowThenConcludeModel()
    let reads = 0
    const executor = createChildAgentExecutor({
      model, toolHost: new LocalToolHost({ tools: [sourceTool('grep'), sourceTool('glob'), sourceTool('read', () => { reads += 1 })] }),
      prefix: createImmutablePrefix({ systemPrompt: 'test' }), defaultModel: model.model
    })

    await expect(executor(fastContextInput(model.model))).resolves.toMatchObject({
      summary: 'Task 1: source found after bounded reads.'
    })
    expect(model.requests).toBe(2)
    expect(reads).toBe(8)
  })

  it('confines full-access Fast Context source calls to the captured workspace', async () => {
    const model = new ReadThenConcludeModel()
    let sourceContext: ToolHostContext | undefined
    const executor = createChildAgentExecutor({
      model,
      toolHost: new LocalToolHost({ tools: [
        sourceTool('grep'), sourceTool('glob'), sourceTool('read', (context) => { sourceContext = context })
      ] }),
      prefix: createImmutablePrefix({ systemPrompt: 'test' }), defaultModel: model.model
    })

    await expect(executor({
      ...fastContextInput(model.model),
      sandboxMode: 'danger-full-access'
    })).resolves.toMatchObject({ evidencePack: { version: 1 } })
    expect(sourceContext).toMatchObject({
      fastContext: true,
      fastContextScopeId: 'parent',
      fastContextTaskCount: 1,
      sandboxMode: 'danger-full-access',
      allowedReadPaths: ['.']
    })
  })
})

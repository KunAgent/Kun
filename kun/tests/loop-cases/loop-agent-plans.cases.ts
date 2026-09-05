import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryEventBus } from '../../src/adapters/in-memory-event-bus.js'
import { LocalToolHost, buildDefaultLocalTools } from '../../src/adapters/tool/local-tool-host.js'
import { CapabilityRegistry } from '../../src/adapters/tool/capability-registry.js'
import { buildBrowserUseToolProviders } from '../../src/adapters/tool/browser-use-tool-provider.js'
import { CREATE_PLAN_TOOL_NAME } from '../../src/adapters/tool/create-plan-tool.js'
import { GET_GOAL_TOOL_NAME, UPDATE_GOAL_TOOL_NAME } from '../../src/adapters/tool/goal-tools.js'
import { FileThreadStore, FileSessionStore } from '../../src/adapters/file/index.js'
import { RuntimeEventRecorder } from '../../src/services/runtime-event-recorder.js'
import { ContextCompactor } from '../../src/loop/context-compactor.js'
import { COMPACTION_SYSTEM_PROMPT } from '../../src/loop/compaction-summary.js'
import { effectiveHistoryAfterLatestCompaction } from '../../src/loop/compaction-history.js'
import { resolveModelContextProfile } from '../../src/loop/model-context-profile.js'
import { isPlanClarifyingQuestion } from '../../src/loop/agent-loop.js'
import { LoopTelemetry } from '../../src/loop/loop-telemetry.js'
import {
  makeApprovalItem,
  makeAssistantReasoningItem,
  makeAssistantTextItem,
  makeGoalContextItem,
  makeToolCallItem,
  makeToolResultItem,
  makeUserInputItem,
  makeUserItem
} from '../../src/domain/item.js'
import { createThreadRecord } from '../../src/domain/thread.js'
import { createImmutablePrefix, setSystemPrompt } from '../../src/cache/immutable-prefix.js'
import { InflightTracker } from '../../src/loop/inflight-tracker.js'
import { SteeringQueue } from '../../src/loop/steering-queue.js'
import { SequentialIdGenerator } from '../../src/ports/id-generator.js'
import type { SessionStore } from '../../src/ports/session-store.js'
import { TurnService } from '../../src/services/turn-service.js'
import type { TurnItem } from '../../src/contracts/items.js'
import type { ModelRequest, ModelStreamChunk } from '../../src/ports/model-client.js'
import type { BrowserController } from '../../src/ports/browser-controller.js'
import {
  bootstrapThread,
  makeFakeModel,
  makeHarness,
  makeSilentModel,
  resolveNextUserInput
} from '../loop-test-harness.js'

describe('AgentLoop', () => {
  it('omits create_plan from normal agent model requests', async () => {
    const observedTools: string[] = []
    const h = makeHarness(
      {
        provider: 'capture',
        model: 'capture',
        async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
          observedTools.push(...request.tools.map((tool) => tool.name))
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: buildDefaultLocalTools() }
    )
    await bootstrapThread(h)
    await h.loop.runTurn(h.threadId, h.turnId)
    expect(observedTools).not.toContain(CREATE_PLAN_TOOL_NAME)
  })

  it('continues after a normal agent turn attempts a non-advertised create_plan call', async () => {
    const observedRequests: ModelRequest[] = []
    let calls = 0
    const h = makeHarness(
      {
        provider: 'overeager-planner',
        model: 'overeager-planner',
        async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
          observedRequests.push(request)
          calls += 1
          if (calls === 1) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_plan',
              toolName: CREATE_PLAN_TOOL_NAME,
              arguments: {
                markdown: '# Plan',
                operation: 'draft'
              }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'assistant_text_delta', text: 'I will continue without the plan tool.' }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: buildDefaultLocalTools() }
    )
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const items = await h.sessionStore.loadItems(h.threadId)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    const planCall = items.find(
      (item) => item.kind === 'tool_call' && item.toolName === CREATE_PLAN_TOOL_NAME
    )
    const planResult = items.find(
      (item) => item.kind === 'tool_result' && item.toolName === CREATE_PLAN_TOOL_NAME
    )

    expect(status).toBe('completed')
    expect(observedRequests[0]?.tools.map((tool) => tool.name)).not.toContain(CREATE_PLAN_TOOL_NAME)
    expect(observedRequests.length).toBe(2)
    expect(planCall).toMatchObject({ kind: 'tool_call', status: 'failed' })
    expect(planResult).toMatchObject({ kind: 'tool_result', isError: true })
    expect(planResult?.kind === 'tool_result' ? JSON.stringify(planResult.output) : '')
      .toContain('not advertised in this turn context')
    expect(events.some((event) =>
      event.kind === 'error' && event.code === 'tool_dispatch_rejected'
    )).toBe(true)
  })

  it('persists active goal guidance in model history and includes goal status tools', async () => {
    const observedRequests: ModelRequest[] = []
    const goalTools = [GET_GOAL_TOOL_NAME, UPDATE_GOAL_TOOL_NAME].map((name) =>
      LocalToolHost.defineTool({
        name,
        description: name,
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false
        },
        policy: 'auto',
        execute: async () => ({ output: { ok: true } })
      })
    )
    const h = makeHarness(
      {
        provider: 'capture-goal',
        model: 'capture-goal',
        async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
          observedRequests.push(request)
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [...buildDefaultLocalTools(), ...goalTools] }
    )
    await bootstrapThread(h, { request: { prompt: 'check current memory usage' } })
    await h.threads.setGoal(h.threadId, {
      objective: 'check current memory usage',
      status: 'active'
    })

    await h.loop.runTurn(h.threadId, h.turnId)

    const [request] = observedRequests
    if (!request) throw new Error('expected model request')
    const goalContext = request.history.find((item) => item.kind === 'goal_context')
    expect(goalContext).toMatchObject({
      kind: 'goal_context',
      text: expect.stringContaining('check current memory usage')
    })
    if (!goalContext || goalContext.kind !== 'goal_context') {
      throw new Error('expected durable goal context in model history')
    }
    expect(goalContext.text).toContain('Continue working toward the active thread goal.')
    expect(request.contextInstructions?.join('\n') ?? '').not.toContain('Continue working toward the active thread goal.')
    expect(request.tools.map((tool) => tool.name)).toContain(GET_GOAL_TOOL_NAME)
    expect(request.tools.map((tool) => tool.name)).toContain(UPDATE_GOAL_TOOL_NAME)
  })

  it('continues an active goal after no-tool model turns until update_goal completes it', async () => {
    let h: ReturnType<typeof makeHarness>
    const goalTools = [
      LocalToolHost.defineTool({
        name: GET_GOAL_TOOL_NAME,
        description: 'Get goal',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false
        },
        policy: 'auto',
        execute: async (_args, context) => ({ output: { goal: await h.threads.getGoal(context.threadId) } })
      }),
      LocalToolHost.defineTool({
        name: UPDATE_GOAL_TOOL_NAME,
        description: 'Update goal',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['complete', 'blocked'] }
          },
          required: ['status'],
          additionalProperties: false
        },
        policy: 'auto',
        execute: async (args, context) => {
          const status = args.status
          if (status !== 'complete' && status !== 'blocked') {
            return { output: { error: 'invalid status' }, isError: true }
          }
          const goal = await h.threads.setGoal(context.threadId, { status })
          return { output: { goal } }
        }
      })
    ]
    let calls = 0
    h = makeHarness(
      {
        provider: 'goal-continuation',
        model: 'goal-continuation',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          calls += 1
          if (calls === 1) {
            yield { kind: 'assistant_text_delta', text: 'Draft ready.' }
            yield { kind: 'completed', stopReason: 'stop' }
            return
          }
          if (calls === 2) {
            yield { kind: 'assistant_text_delta', text: 'Still working.' }
            yield { kind: 'completed', stopReason: 'stop' }
            return
          }
          if (calls === 3) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_complete_goal',
              toolName: UPDATE_GOAL_TOOL_NAME,
              arguments: { status: 'complete' }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'assistant_text_delta', text: 'Goal complete.' }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [...buildDefaultLocalTools(), ...goalTools] }
    )
    await bootstrapThread(h, { request: { prompt: 'write a benchmark note' } })
    await h.threads.setGoal(h.threadId, {
      objective: 'write a benchmark note',
      status: 'active'
    })

    const status = await h.loop.runTurn(h.threadId, h.turnId)

    expect(status).toBe('completed')
    expect(calls).toBe(4)
    expect((await h.threads.getGoal(h.threadId))?.status).toBe('complete')
    const texts = (await h.sessionStore.loadItems(h.threadId))
      .filter((item) => item.kind === 'assistant_text')
      .map((item) => item.kind === 'assistant_text' ? item.text : '')
    expect(texts).toEqual(['Draft ready.', 'Still working.', 'Goal complete.'])
  })

  it('persists the canonical tool catalog fingerprint on each turn', async () => {
    const h = makeHarness(makeSilentModel(), { tools: buildDefaultLocalTools() })
    await bootstrapThread(h)

    await h.loop.runTurn(h.threadId, h.turnId)

    const turn = await h.turns.getTurn(h.threadId, h.turnId)
    expect(turn?.toolCatalogFingerprint).toMatch(/^[0-9a-f]{16}$/)
    expect(turn?.toolCatalogToolCount).toBeGreaterThan(0)
    expect(turn?.toolCatalogDrift).toBe(false)
  })

  it('uses persisted GUI plan context to advertise and execute create_plan', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-loop-plan-'))
    const observedToolLists: string[][] = []
    const observedRequiredToolNames: Array<string | undefined> = []
    try {
      const h = makeHarness(
        {
          provider: 'planner',
          model: 'planner',
          async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
            observedToolLists.push(request.tools.map((tool) => tool.name))
            observedRequiredToolNames.push(request.requiredToolName)
            if (observedToolLists.length === 1) {
              yield {
                kind: 'tool_call_complete',
                callId: 'call_plan',
                toolName: CREATE_PLAN_TOOL_NAME,
                arguments: {
                  markdown: '# Generated plan',
                  operation: 'draft',
                  source_request: 'Add auth'
                }
              }
              yield { kind: 'completed', stopReason: 'tool_calls' }
              return
            }
            yield { kind: 'completed', stopReason: 'stop' }
          }
        },
        { tools: buildDefaultLocalTools() }
      )
      await bootstrapThread(h, {
        workspace,
        request: {
          prompt: 'Plan auth',
          guiPlan: {
            operation: 'draft',
            workspaceRoot: workspace,
            relativePath: '.kunsdd/plan/auth.md',
            planId: `${workspace}:.kunsdd/plan/auth.md`,
            sourceRequest: 'Add auth',
            title: 'Auth'
          }
        }
      })
      const status = await h.loop.runTurn(h.threadId, h.turnId)
      expect(status).toBe('completed')
      expect(observedToolLists[0]).toContain(CREATE_PLAN_TOOL_NAME)
      expect(observedRequiredToolNames).toEqual([undefined, undefined])
      await expect(readFile(join(workspace, '.kunsdd/plan/thr-1.md'), 'utf8')).resolves.toBe('# Generated plan')
      const turn = await h.turns.getTurn(h.threadId, h.turnId)
      expect(turn?.guiPlan?.relativePath).toBe('.kunsdd/plan/auth.md')
      const items = await h.sessionStore.loadItems(h.threadId)
      const result = items.find((item) => item.kind === 'tool_result' && item.callId === 'call_plan')
      expect(result).toBeDefined()
      if (result?.kind === 'tool_result') {
        expect(result.toolName).toBe(CREATE_PLAN_TOOL_NAME)
        expect(result.output).toMatchObject({
          relative_path: '.kunsdd/plan/thr-1.md',
          workspace_root: workspace,
          operation: 'draft'
        })
      }
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('materializes assistant plan text when a GUI plan turn misses create_plan', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-loop-plan-missing-tool-'))
    try {
      const h = makeHarness(
        {
          provider: 'planner',
          model: 'planner',
          async *stream(): AsyncIterable<ModelStreamChunk> {
            yield { kind: 'assistant_text_delta', text: '## Plan\nImplement auth.\n' }
            yield { kind: 'completed', stopReason: 'stop' }
          }
        },
        { tools: buildDefaultLocalTools() }
      )
      await bootstrapThread(h, {
        workspace,
        request: {
          prompt: 'Plan auth',
          guiPlan: {
            operation: 'draft',
            workspaceRoot: workspace,
            relativePath: '.kunsdd/plan/auth.md',
            planId: `${workspace}:.kunsdd/plan/auth.md`,
            sourceRequest: 'Add auth'
          }
        }
      })

      const status = await h.loop.runTurn(h.threadId, h.turnId)
      const items = await h.sessionStore.loadItems(h.threadId)

      expect(status).toBe('completed')
      await expect(readFile(join(workspace, '.kunsdd/plan/thr-1.md'), 'utf8')).resolves.toBe(
        '## Plan\nImplement auth.'
      )
      expect(items.some((item) =>
        item.kind === 'tool_result' &&
        item.toolName === CREATE_PLAN_TOOL_NAME &&
        item.isError !== true
      )).toBe(true)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('materializes assistant plan text for plan-mode turns without a reserved context', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-loop-plan-free-form-text-'))
    try {
      const h = makeHarness(
        {
          provider: 'planner',
          model: 'planner',
          async *stream(): AsyncIterable<ModelStreamChunk> {
            yield { kind: 'assistant_text_delta', text: '## Plan\nPolish the sidebar footer.\n' }
            yield { kind: 'completed', stopReason: 'stop' }
          }
        },
        { tools: buildDefaultLocalTools() }
      )
      await bootstrapThread(h, {
        workspace,
        request: {
          prompt: 'Plan sidebar footer polish',
          mode: 'plan'
        }
      })

      const status = await h.loop.runTurn(h.threadId, h.turnId)
      const items = await h.sessionStore.loadItems(h.threadId)
      const planResult = items.find((item) =>
        item.kind === 'tool_result' && item.toolName === CREATE_PLAN_TOOL_NAME
      )

      expect(status).toBe('completed')
      expect(planResult?.kind === 'tool_result' && planResult.isError).not.toBe(true)
      expect(
        planResult?.kind === 'tool_result' &&
        (planResult.output as { relative_path?: string }).relative_path
      ).toBe('.kunsdd/plan/plan-sidebar-footer-polish.md')
      await expect(readFile(join(workspace, '.kunsdd/plan/plan-sidebar-footer-polish.md'), 'utf8')).resolves.toBe(
        '## Plan\nPolish the sidebar footer.'
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('pauses a GUI plan turn for a clarifying question instead of materializing a plan', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-loop-plan-clarify-'))
    try {
      const h = makeHarness(
        {
          provider: 'planner',
          model: 'planner',
          async *stream(): AsyncIterable<ModelStreamChunk> {
            yield {
              kind: 'assistant_text_delta',
              text: 'Your request is ambiguous. Which direction do you want: an interactive map, a static page, or a 3D globe?'
            }
            yield { kind: 'completed', stopReason: 'stop' }
          }
        },
        { tools: buildDefaultLocalTools() }
      )
      await bootstrapThread(h, {
        workspace,
        request: {
          prompt: 'Write a world page',
          mode: 'plan'
        }
      })

      const status = await h.loop.runTurn(h.threadId, h.turnId)
      const items = await h.sessionStore.loadItems(h.threadId)

      expect(status).toBe('completed')
      // The question was not coerced into a plan...
      expect(
        items.some(
          (item) => item.kind === 'tool_result' && item.toolName === CREATE_PLAN_TOOL_NAME
        )
      ).toBe(false)
      // ...nor failed as a missing required tool...
      expect(items.some((item) => item.kind === 'error' && item.code === 'required_tool_missing')).toBe(
        false
      )
      // ...and the clarifying question stays as assistant text for the user.
      expect(
        items.some(
          (item) =>
            item.kind === 'assistant_text' && /Which direction/.test(item.text ?? '')
        )
      ).toBe(true)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('rejects forged write calls during plan mode without touching workspace files', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-loop-plan-forged-write-'))
    const observedToolLists: string[][] = []
    let calls = 0
    try {
      const h = makeHarness(
        {
          provider: 'planner',
          model: 'planner',
          async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
            observedToolLists.push(request.tools.map((tool) => tool.name))
            calls += 1
            if (calls === 1) {
              yield {
                kind: 'tool_call_complete',
                callId: 'call_write',
                toolName: 'write',
                arguments: {
                  path: 'forbidden.txt',
                  content: 'should not exist'
                }
              }
              yield { kind: 'completed', stopReason: 'tool_calls' }
              return
            }
            yield { kind: 'assistant_text_delta', text: '## Plan\nStay read-only until build mode.\n' }
            yield { kind: 'completed', stopReason: 'stop' }
          }
        },
        { tools: buildDefaultLocalTools() }
      )
      await bootstrapThread(h, {
        workspace,
        request: {
          prompt: 'Plan a safe change',
          mode: 'plan'
        }
      })

      const status = await h.loop.runTurn(h.threadId, h.turnId)
      const items = await h.sessionStore.loadItems(h.threadId)
      const writeCall = items.find((item) => item.kind === 'tool_call' && item.toolName === 'write')
      const writeResult = items.find((item) => item.kind === 'tool_result' && item.toolName === 'write')

      expect(status).toBe('completed')
      expect(observedToolLists[0]).toEqual(expect.arrayContaining(['read', 'git_inspect', CREATE_PLAN_TOOL_NAME]))
      expect(observedToolLists[0]).not.toEqual(expect.arrayContaining(['write', 'edit', 'bash']))
      expect(writeCall).toMatchObject({ kind: 'tool_call', status: 'failed' })
      expect(writeResult).toMatchObject({ kind: 'tool_result', isError: true })
      expect(writeResult?.kind === 'tool_result' ? JSON.stringify(writeResult.output) : '')
        .toContain('not advertised by active tool policy')
      await expect(readFile(join(workspace, 'forbidden.txt'), 'utf8')).rejects.toThrow()
      await expect(readFile(join(workspace, '.kunsdd/plan/plan-a-safe-change.md'), 'utf8')).resolves.toBe(
        '## Plan\nStay read-only until build mode.'
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('rejects forged bash calls during plan mode without running mutating commands', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-loop-plan-forged-bash-'))
    let calls = 0
    try {
      const h = makeHarness(
        {
          provider: 'planner',
          model: 'planner',
          async *stream(): AsyncIterable<ModelStreamChunk> {
            calls += 1
            if (calls === 1) {
              yield {
                kind: 'tool_call_complete',
                callId: 'call_bash',
                toolName: 'bash',
                arguments: {
                  command: 'touch forbidden.txt'
                }
              }
              yield { kind: 'completed', stopReason: 'tool_calls' }
              return
            }
            yield { kind: 'assistant_text_delta', text: '## Plan\nUse read-only inspection only.\n' }
            yield { kind: 'completed', stopReason: 'stop' }
          }
        },
        { tools: buildDefaultLocalTools() }
      )
      await bootstrapThread(h, {
        workspace,
        request: {
          prompt: 'Plan without shell mutations',
          mode: 'plan'
        }
      })

      const status = await h.loop.runTurn(h.threadId, h.turnId)
      const items = await h.sessionStore.loadItems(h.threadId)
      const bashCall = items.find((item) => item.kind === 'tool_call' && item.toolName === 'bash')
      const bashResult = items.find((item) => item.kind === 'tool_result' && item.toolName === 'bash')

      expect(status).toBe('completed')
      expect(bashCall).toMatchObject({ kind: 'tool_call', status: 'failed' })
      expect(bashResult).toMatchObject({ kind: 'tool_result', isError: true })
      expect(bashResult?.kind === 'tool_result' ? JSON.stringify(bashResult.output) : '')
        .toContain('not advertised by active tool policy')
      await expect(readFile(join(workspace, 'forbidden.txt'), 'utf8')).rejects.toThrow()
      await expect(readFile(join(workspace, '.kunsdd/plan/plan-without-shell-mutations.md'), 'utf8')).resolves.toBe(
        '## Plan\nUse read-only inspection only.'
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})

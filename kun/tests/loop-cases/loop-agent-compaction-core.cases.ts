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
import { modelRequestContextText } from '../../src/loop/model-request-context.js'
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
  it('fails GUI plan turns only when neither create_plan nor plan text is returned', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-loop-plan-empty-'))
    try {
      const h = makeHarness(
        {
          provider: 'planner',
          model: 'planner',
          async *stream(): AsyncIterable<ModelStreamChunk> {
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
      const events = await h.sessionStore.loadEventsSince(h.threadId, 0)

      expect(status).toBe('failed')
      expect(items.some((item) =>
        item.kind === 'error' && item.code === 'required_tool_missing'
      )).toBe(true)
      expect(events.some((event) =>
        event.kind === 'error' && event.code === 'required_tool_missing'
      )).toBe(true)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('keeps create_plan as a soft completion condition after unrelated tool calls', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-loop-plan-other-tool-'))
    const observedRequiredToolNames: Array<string | undefined> = []
    let calls = 0
    try {
      const h = makeHarness(
        {
          provider: 'planner',
          model: 'planner',
          async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
            observedRequiredToolNames.push(request.requiredToolName)
            calls += 1
            if (calls === 1) {
              yield {
                kind: 'tool_call_complete',
                callId: 'call_echo',
                toolName: 'echo',
                arguments: { text: 'not a plan' }
              }
              yield { kind: 'completed', stopReason: 'tool_calls' }
              return
            }
            yield { kind: 'assistant_text_delta', text: '## Plan\nImplement auth after checking context.\n' }
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

      expect(status).toBe('completed')
      expect(observedRequiredToolNames).toEqual([undefined, undefined, undefined])
      await expect(readFile(join(workspace, '.kunsdd/plan/thr-1.md'), 'utf8')).resolves.toBe(
        '## Plan\nImplement auth after checking context.'
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('reopens the plan gate when guidance is accepted after a successful plan write', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-loop-plan-guidance-'))
    const requests: ModelRequest[] = []
    let releaseSecondResponse: (() => void) | undefined
    let markSecondResponseStarted: (() => void) | undefined
    const secondResponseStarted = new Promise<void>((resolve) => {
      markSecondResponseStarted = resolve
    })
    const secondResponseRelease = new Promise<void>((resolve) => {
      releaseSecondResponse = resolve
    })
    try {
      const model = {
        provider: 'planner',
        model: 'plan-guidance-model',
        async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
          requests.push(request)
          if (requests.length === 1) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_plan_initial',
              toolName: CREATE_PLAN_TOOL_NAME,
              arguments: {
                markdown: '## Plan\nFollow the repository ignore rules.',
                operation: 'draft',
                source_request: 'Plan the restriction change'
              }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          if (requests.length === 2) {
            markSecondResponseStarted?.()
            await secondResponseRelease
            yield { kind: 'assistant_text_delta', text: 'Initial plan saved.' }
            yield { kind: 'completed', stopReason: 'stop' }
            return
          }
          if (requests.length === 3) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_plan_refined',
              toolName: CREATE_PLAN_TOOL_NAME,
              arguments: {
                markdown: '## Plan\nFollow both repository ignore and hasconfig rules.',
                operation: 'refine',
                plan_relative_path: '.kunsdd/plan/plan-the-restriction-change.md',
                source_request: 'Plan the restriction change'
              }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'assistant_text_delta', text: 'Updated the plan with the added constraint.' }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      }
      const h = makeHarness(model, { tools: buildDefaultLocalTools() })
      await bootstrapThread(h, {
        workspace,
        request: {
          prompt: 'Plan the restriction change',
          mode: 'plan',
          model: model.model
        }
      })

      const run = h.loop.runTurn(h.threadId, h.turnId)
      await secondResponseStarted
      await h.turns.steerTurn({
        threadId: h.threadId,
        turnId: h.turnId,
        text: 'Also follow the hasconfig rules'
      })
      releaseSecondResponse?.()

      await expect(run).resolves.toBe('completed')
      expect(requests).toHaveLength(4)
      expect(requests[2]).toMatchObject({
        model: model.model
      })
      expect(requests[2]?.requiredToolName).toBeUndefined()
      expect(modelRequestContextText(requests[2]!)).toContain('You are in Plan mode.')
      expect(requests[2]?.history).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'user_message',
          text: 'Also follow the hasconfig rules'
        })
      ]))
      await expect(
        readFile(join(workspace, '.kunsdd/plan/plan-the-restriction-change.md'), 'utf8')
      ).resolves.toBe('## Plan\nFollow both repository ignore and hasconfig rules.')
    } finally {
      releaseSecondResponse?.()
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('steers the turn and injects user messages', async () => {
    const h = makeHarness(makeSilentModel())
    await bootstrapThread(h)
    h.steering.enqueue(h.turnId, { text: 'follow up' })
    await h.loop.runTurn(h.threadId, h.turnId)
    const items = await h.sessionStore.loadItems(h.threadId)
    const user = items.find((item) => item.kind === 'user_message' && item.text === 'follow up')
    expect(user).toBeDefined()
  })

  it('cleans up inflight ids after success and error', async () => {
    const h = makeHarness({
      provider: 'flaky',
      model: 'flaky',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        yield { kind: 'error', message: 'boom' }
        yield { kind: 'completed', stopReason: 'error' }
      }
    })
    await bootstrapThread(h)
    await h.loop.runTurn(h.threadId, h.turnId)
    expect(h.inflight.size()).toBe(0)
  })

  it('keeps the prefix stable when the system prompt does not change', () => {
    const a = createImmutablePrefix({ systemPrompt: 'be brief' })
    const b = createImmutablePrefix({ systemPrompt: 'be brief' })
    expect(a.fingerprint).toBe(b.fingerprint)
    const drifted = setSystemPrompt(a, 'be thorough')
    expect(drifted.fingerprint).not.toBe(a.fingerprint)
  })

  it('uses 1M context thresholds for DeepSeek v4 models and compatibility aliases', () => {
    const compactor = new ContextCompactor()
    const items = [
      makeUserItem({
        id: 'long_history',
        turnId: 'turn_1',
        threadId: 'thr_1',
        // ~200k estimated tokens: above the 256k fallback profile's 192k soft
        // threshold, but below the DeepSeek v4 soft threshold
        // (750k = 0.75 * 1M) so the v4 profiles do not.
        text: 'x'.repeat(800_000)
      })
    ]

    expect(resolveModelContextProfile('deepseek-v4-pro')?.contextWindowTokens).toBe(1_000_000)
    expect(resolveModelContextProfile('provider/deepseek-v4-flash')?.contextWindowTokens).toBe(1_000_000)
    expect(resolveModelContextProfile('deepseek-chat')?.canonicalModel).toBe('deepseek-v4-flash')
    expect(resolveModelContextProfile('deepseek-reasoner')?.canonicalModel).toBe('deepseek-v4-flash')
    expect(compactor.shouldCompact(items)).toBe(true)
    expect(compactor.shouldCompact(items, { model: 'deepseek-v4-pro' })).toBe(false)
    expect(compactor.shouldCompact(items, { model: 'deepseek-v4-flash' })).toBe(false)
    expect(compactor.hardCap('deepseek-v4-flash')).toBe(850_000)
  })

  it('uses reported prompt tokens as a compaction pressure signal', () => {
    const compactor = new ContextCompactor({ softThreshold: 100, hardThreshold: 200 })
    const tinyHistory = [
      makeUserItem({
        id: 'tiny_history',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'short'
      })
    ]

    expect(compactor.shouldCompact(tinyHistory)).toBe(false)
    // A reported count within PROMPT_TOKEN_TRUST_FACTOR of the estimate (here
    // the per-request system/tool overhead) is honoured and drives compaction.
    expect(compactor.shouldCompact(tinyHistory, { promptTokens: 120, overheadTokens: 40 })).toBe(true)
  })

  it('ignores prompt tokens inflated far beyond the local estimate', () => {
    // Regression: MiniMax-M3 folds cumulative cache reads into prompt_tokens and
    // reported ~1.2M for a thread whose real content was ~33k, stranding it at
    // "100%" and firing compaction that folded almost nothing. An implausibly
    // large reported count must be ignored in favour of the local estimate.
    const compactor = new ContextCompactor({ softThreshold: 100, hardThreshold: 200 })
    const history = [
      makeUserItem({ id: 'h', turnId: 'turn_1', threadId: 'thr_1', text: 'x'.repeat(360) })
    ]

    // ~90 estimated tokens of real content, below the soft threshold.
    expect(compactor.shouldCompact(history)).toBe(false)
    // A plausible provider count (within the trust factor) still triggers.
    expect(compactor.shouldCompact(history, { promptTokens: 300 })).toBe(true)
    // An order-of-magnitude-inflated count is dropped; the estimate wins, so a
    // genuinely small thread is not pinned at the threshold compacting nothing.
    expect(compactor.shouldCompact(history, { promptTokens: 1_000_000 })).toBe(false)
    expect(compactor.planCompaction(history, { promptTokens: 1_000_000 })).toBeNull()
  })

  it('adds per-request overhead to the estimate-only compaction trigger', () => {
    const compactor = new ContextCompactor({ softThreshold: 100, hardThreshold: 200 })
    const tinyHistory = [
      makeUserItem({
        id: 'tiny_history',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'short'
      })
    ]

    // Item text alone is far below the soft threshold and would skip
    // compaction when no provider usage count is available.
    expect(compactor.shouldCompact(tinyHistory)).toBe(false)
    // The system prompt + tool schemas sent every turn (overheadTokens)
    // are added as a floor, so the estimate-only path still triggers.
    expect(compactor.shouldCompact(tinyHistory, { overheadTokens: 500 })).toBe(true)
    expect(compactor.planCompaction(tinyHistory, { overheadTokens: 500 })?.reason)
      .toContain('estimated prompt tokens')
  })

  it('plans normal, aggressive, and force compaction levels', () => {
    const compactor = new ContextCompactor({ softThreshold: 100, hardThreshold: 200 })
    const tinyHistory = [
      makeUserItem({
        id: 'tiny_history',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'short'
      })
    ]

    // overheadTokens keeps the reported counts within the trust factor of the
    // estimate (mirroring the real per-request system/tool floor).
    expect(compactor.planCompaction(tinyHistory, { promptTokens: 120, overheadTokens: 40 })).toMatchObject({
      mode: 'normal',
      keepRecent: 4
    })
    expect(compactor.planCompaction(tinyHistory, { promptTokens: 160, overheadTokens: 40 })).toMatchObject({
      mode: 'aggressive',
      keepRecent: 2
    })
    expect(compactor.planCompaction(tinyHistory, { promptTokens: 220, overheadTokens: 40 })).toMatchObject({
      mode: 'force',
      keepRecent: 1
    })
  })

  it('trims trailing tool calls and retains tail skill pins verbatim', () => {
    const compactor = new ContextCompactor({ softThreshold: 1, hardThreshold: 2 })
    const prefix = createImmutablePrefix({ systemPrompt: 'system' })
    const result = compactor.compact({
      threadId: 'thr_1',
      turnId: 'turn_1',
      prefix,
      keepRecent: 1,
      history: [
        makeUserItem({ id: 'u1', turnId: 'turn_1', threadId: 'thr_1', text: 'first request' }),
        makeAssistantTextItem({
          id: 'a1',
          turnId: 'turn_1',
          threadId: 'thr_1',
          text: 'Active Skill: documents (documents)',
          status: 'completed'
        }),
        makeToolCallItem({
          id: 'call_trailing',
          turnId: 'turn_1',
          threadId: 'thr_1',
          callId: 'call_trailing',
          toolName: 'read',
          arguments: { path: 'a.txt' }
        })
      ]
    })

    expect(result.next.some((item) => item.kind === 'tool_call')).toBe(false)
    expect(result.summaryItem.kind === 'compaction' ? result.summaryItem.summary : '')
      .not.toContain('Active Skill: documents (documents)')
    expect(result.next.at(-1)).toMatchObject({
      kind: 'assistant_text',
      id: 'a1',
      text: 'Active Skill: documents (documents)'
    })
  })

  it('keeps the latest user turn when force compaction would orphan a tool result', () => {
    const compactor = new ContextCompactor({ softThreshold: 1, hardThreshold: 2 })
    const prefix = createImmutablePrefix({ systemPrompt: 'system' })
    const result = compactor.compact({
      threadId: 'thr_1',
      turnId: 'turn_2',
      prefix,
      keepRecent: 1,
      history: [
        makeUserItem({ id: 'u1', turnId: 'turn_1', threadId: 'thr_1', text: 'fold this old request' }),
        makeAssistantTextItem({
          id: 'a1',
          turnId: 'turn_1',
          threadId: 'thr_1',
          text: 'old answer',
          status: 'completed'
        }),
        makeUserItem({ id: 'u2', turnId: 'turn_2', threadId: 'thr_1', text: 'keep this current request' }),
        makeAssistantReasoningItem({
          id: 'r2',
          turnId: 'turn_2',
          threadId: 'thr_1',
          text: 'need read before answering',
          status: 'completed'
        }),
        makeToolCallItem({
          id: 'call_2',
          turnId: 'turn_2',
          threadId: 'thr_1',
          callId: 'call_2',
          toolName: 'read',
          arguments: { path: 'current.ts' },
          status: 'completed'
        }),
        makeToolResultItem({
          id: 'result_2',
          turnId: 'turn_2',
          threadId: 'thr_1',
          callId: 'call_2',
          toolName: 'read',
          output: 'current file content'
        })
      ]
    })

    expect(result.next.map((item) => item.id)).toEqual([
      result.summaryItem.id,
      'u2',
      'r2',
      'call_2',
      'result_2'
    ])
    expect(result.summaryItem.kind === 'compaction' ? result.summaryItem.sourceItemIds : [])
      .toEqual(['u1', 'a1'])
  })

  it('embeds a digest marker and skips frozen messages when compacting history', () => {
    const compactor = new ContextCompactor({ softThreshold: 1, hardThreshold: 2 })
    const prefix = createImmutablePrefix({ systemPrompt: 'system' })
    const result = compactor.compact({
      threadId: 'thr_1',
      turnId: 'turn_1',
      prefix,
      keepRecent: 1,
      frozenMessageCount: 1,
      history: [
        makeUserItem({ id: 'frozen', turnId: 'turn_1', threadId: 'thr_1', text: 'already processed upstream' }),
        makeUserItem({ id: 'u1', turnId: 'turn_1', threadId: 'thr_1', text: 'fold alpha' }),
        makeAssistantTextItem({
          id: 'a1',
          turnId: 'turn_1',
          threadId: 'thr_1',
          text: 'fold beta',
          status: 'completed'
        }),
        makeUserItem({ id: 'u2', turnId: 'turn_1', threadId: 'thr_1', text: 'keep gamma' })
      ]
    })
    const summary = result.summaryItem.kind === 'compaction' ? result.summaryItem.summary : ''

    expect(result.next.map((item) => item.id)).toEqual(['frozen', result.summaryItem.id, 'u2'])
    expect(summary).toContain('fold alpha')
    expect(summary).not.toContain('already processed upstream')
    expect(result.summaryItem.kind === 'compaction' ? result.summaryItem.sourceDigest : '')
      .toMatch(/^[0-9a-f]{16}$/)
    expect(result.summaryItem.kind === 'compaction' ? result.summaryItem.digestMarker : '')
      .toBe(`<kun:tool_digest sha256="${result.summaryItem.kind === 'compaction' ? result.summaryItem.sourceDigest : ''}">`)
    expect(result.summaryItem.kind === 'compaction' ? result.summaryItem.sourceItemIds : [])
      .toEqual(['u1', 'a1'])
    expect(summary).toContain(result.summaryItem.kind === 'compaction' ? result.summaryItem.digestMarker : '')
  })

  it('accepts configured context compaction thresholds and model profiles', () => {
    const compactor = new ContextCompactor({
      contextCompaction: {
        defaultSoftThreshold: 123,
        defaultHardThreshold: 456,
        modelProfiles: {
          'custom-model': {
            aliases: ['vendor/custom-model'],
            softThreshold: 1_000,
            hardThreshold: 2_000
          }
        }
      }
    })

    expect(compactor.thresholds()).toEqual({ softThreshold: 123, hardThreshold: 456 })
    // No contextWindowTokens is configured, so the window is inferred as
    // max(soft, hard) = 2000 and the safety cap clamps the hard threshold to
    // floor(0.85 * 2000) = 1700.
    expect(compactor.thresholds('vendor/custom-model')).toEqual({
      softThreshold: 1_000,
      hardThreshold: 1_700
    })
  })
})

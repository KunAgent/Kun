import { describe, expect, it, vi } from 'vitest'
import { getThreadTimeline } from './threads.js'
import { createThreadRecord } from '../../domain/thread.js'
import { createTurnRecord } from '../../domain/turn.js'
import type { TurnItem } from '../../contracts/items.js'
import type { ThreadService } from '../../services/thread-service.js'
import type { DelegationRuntime } from '../../delegation/delegation-runtime.js'
import { InMemorySessionStore } from '../../adapters/in-memory-session-store.js'

describe('getThreadTimeline child-backed tool overlay', () => {
  async function timelineSetup(
    threadId: string,
    items: readonly TurnItem[],
    childRuns?: readonly unknown[]
  ) {
    const record = createThreadRecord({
      id: threadId, title: 'Delegated', workspace: '/tmp', model: 'deepseek-chat',
      status: 'running'
    })
    const turn = createTurnRecord({
      id: `${threadId}_turn`, threadId: record.id, prompt: 'delegate', status: 'completed'
    })
    record.turns = [turn]
    const store = new InMemorySessionStore()
    for (const item of items) await store.appendItem(record.id, item)
    const diagnostics = vi.fn(async () => ({
      enabled: true, active: 0, childRuns: childRuns ?? [], aggregates: []
    }))
    const delegationRuntime = { diagnostics } as unknown as DelegationRuntime
    return { record, store, delegationRuntime, diagnostics }
  }

  function delegateResult(
    threadId: string,
    turnId: string,
    options: {
      childId?: string
      status?: string
      detached?: boolean
      resumeCount?: number
    } = {}
  ): TurnItem {
    const childId = options.childId ?? 'child_delegated'
    return {
      id: `item_delegate_result_${childId}`,
      turnId,
      threadId,
      role: 'tool',
      status: 'running',
      createdAt: '2026-08-27T03:26:43.157Z',
      kind: 'tool_result',
      toolName: 'delegate_task',
      callId: `call_delegate_${childId}`,
      toolKind: 'tool_call',
      output: {
        childId,
        status: options.status ?? 'running',
        detached: options.detached ?? true,
        resumeCount: options.resumeCount ?? 0,
        profile: 'ci-cd-and-automation'
      },
      isError: false
    }
  }

  function childRun(
    threadId: string,
    status: string,
    overrides: Record<string, unknown> = {}
  ) {
    return {
      id: 'child_delegated',
      parentThreadId: threadId,
      parentTurnId: `${threadId}_turn`,
      status,
      ...overrides
    }
  }

  function fastContextResult(
    threadId: string,
    turnId: string,
    status = 'queued'
  ): TurnItem {
    return {
      id: 'item_fast_context_result',
      turnId,
      threadId,
      role: 'tool',
      status: 'running',
      createdAt: '2026-08-27T03:26:43.157Z',
      kind: 'tool_result',
      toolName: 'fast_context',
      callId: 'call_fast_context',
      toolKind: 'tool_call',
      output: {
        childId: 'child_fast_context',
        status,
        label: 'Fast Context retrieval',
        launcher: 'fast_context',
        profile: 'explore',
        evidencePack: { version: 1, tasks: [], uncertainties: ['pending'] },
        child: {
          childId: 'child_fast_context',
          status,
          launcher: 'fast_context',
          profile: 'explore'
        }
      },
      isError: false
    }
  }

  async function timelineItem(setup: Awaited<ReturnType<typeof timelineSetup>>) {
    const response = await getThreadTimeline(
      { get: async () => setup.record } as unknown as ThreadService,
      setup.record.id,
      new Request(`http://kun.local/v1/threads/${setup.record.id}/timeline`),
      setup.store,
      undefined,
      undefined,
      setup.delegationRuntime
    )
    const body = JSON.parse(response.body)
    return { response, body, item: body.turns[0].items[0] }
  }

  it('hydrates a foreground child as running instead of its durable queued progress', async () => {
    const setup = await timelineSetup('thr_foreground', [
      delegateResult('thr_foreground', 'thr_foreground_turn', {
        status: 'queued', detached: false
      })
    ], [childRun('thr_foreground', 'running', { detached: false })])

    const { item } = await timelineItem(setup)
    expect(item.output).toMatchObject({
      childId: 'child_delegated', status: 'running', detached: false
    })
    expect(item.isError).toBe(false)
  })

  it('returns authoritative running state at the same frozen event waterline', async () => {
    const setup = await timelineSetup('thr_waterline', [
      delegateResult('thr_waterline', 'thr_waterline_turn', {
        status: 'queued', detached: false
      })
    ], [childRun('thr_waterline', 'running', { detached: false })])
    await setup.store.appendEvent('thr_waterline', {
      kind: 'turn_started',
      seq: 7,
      timestamp: '2026-08-27T03:26:44.157Z',
      threadId: 'thr_waterline',
      turnId: 'thr_waterline_turn',
      status: 'running',
      child: {
        parentThreadId: 'thr_waterline',
        parentTurnId: 'thr_waterline_turn',
        childId: 'child_delegated',
        childStatus: 'running',
        childSeq: 1
      }
    })

    const { body, item } = await timelineItem(setup)
    expect(body.latestSeq).toBe(7)
    expect(item.output.status).toBe('running')
  })

  it('hydrates Fast Context running state into both lifecycle projections', async () => {
    const setup = await timelineSetup('thr_fast_context_running', [
      fastContextResult('thr_fast_context_running', 'thr_fast_context_running_turn')
    ], [childRun('thr_fast_context_running', 'running', {
      id: 'child_fast_context',
      launcher: 'fast_context',
      fastContext: true,
      model: 'retrieval-model',
      startedAt: '2026-08-27T03:26:44.000Z',
      updatedAt: '2026-08-27T03:27:14.000Z'
    })])
    await setup.store.appendEvent('thr_fast_context_running', {
      kind: 'turn_started',
      seq: 7,
      timestamp: '2026-08-27T03:26:44.157Z',
      threadId: 'thr_fast_context_running',
      turnId: 'thr_fast_context_running_turn',
      status: 'running',
      child: {
        parentThreadId: 'thr_fast_context_running',
        parentTurnId: 'thr_fast_context_running_turn',
        childId: 'child_fast_context',
        childStatus: 'running',
        childSeq: 1,
        childLauncher: 'fast_context'
      }
    })

    const { body, item } = await timelineItem(setup)
    expect(body.latestSeq).toBe(7)
    expect(item.output).toMatchObject({
      childId: 'child_fast_context',
      status: 'running',
      launcher: 'fast_context',
      model: 'retrieval-model',
      attemptStartedAt: '2026-08-27T03:26:44.000Z',
      attemptDurationMs: 30_000,
      child: {
        childId: 'child_fast_context',
        status: 'running',
        launcher: 'fast_context',
        model: 'retrieval-model',
        attemptStartedAt: '2026-08-27T03:26:44.000Z',
        attemptDurationMs: 30_000
      }
    })
    expect(item.isError).toBe(false)
  })

  it.each([
    ['completed', false],
    ['failed', true],
    ['aborted', true]
  ] as const)('hydrates authoritative Fast Context terminal state %s', async (status, isError) => {
    const evidencePack = {
      version: 1,
      tasks: [{
        index: 0,
        title: 'Locate state',
        query: 'Find the lifecycle owner',
        evidence: [],
        conclusion: 'Child store is authoritative.',
        uncertainties: []
      }],
      uncertainties: []
    }
    const setup = await timelineSetup(`thr_fast_context_${status}`, [
      fastContextResult(`thr_fast_context_${status}`, `thr_fast_context_${status}_turn`)
    ], [childRun(`thr_fast_context_${status}`, status, {
      id: 'child_fast_context',
      launcher: 'fast_context',
      fastContext: true,
      evidencePack,
      ...(status === 'failed'
        ? { error: 'retrieval failed', failure: { source: 'runtime', code: 'retrieval_failed' } }
        : {}),
      ...(status === 'aborted' ? { error: 'retrieval stopped', terminationReason: 'user_stop' } : {})
    })])

    const { item } = await timelineItem(setup)
    expect(item.output).toMatchObject({
      status,
      evidencePack,
      child: { childId: 'child_fast_context', status }
    })
    expect(item.isError).toBe(isError)
  })

  it('widens replay for anonymous legacy Fast Context progress', async () => {
    const result = fastContextResult('thr_fast_context_legacy', 'thr_fast_context_legacy_turn')
    if (result.kind !== 'tool_result' || typeof result.output !== 'object' || !result.output) {
      throw new Error('invalid Fast Context fixture')
    }
    delete (result.output as Record<string, unknown>).childId
    const child = (result.output as { child?: Record<string, unknown> }).child
    if (child) delete child.childId
    const setup = await timelineSetup('thr_fast_context_legacy', [result], [])
    await setup.store.appendEvent('thr_fast_context_legacy', {
      kind: 'turn_started',
      seq: 11,
      timestamp: '2026-08-27T03:26:44.157Z',
      threadId: 'thr_fast_context_legacy',
      turnId: 'thr_fast_context_legacy_turn',
      status: 'running'
    })

    const { body, item } = await timelineItem(setup)
    expect(body.latestSeq).toBe(0)
    expect(item.output).toMatchObject({ status: 'queued' })
  })

  it.each([
    ['queued', false],
    ['running', false],
    ['completed', false],
    ['failed', true],
    ['aborted', true]
  ] as const)('overlays child lifecycle %s', async (status, isError) => {
    const setup = await timelineSetup('thr_state', [
      delegateResult('thr_state', 'thr_state_turn', { status: 'queued' })
    ], [childRun('thr_state', status, {
      detached: true,
      ...(status === 'completed' ? { summary: 'background child completed' } : {}),
      ...(status === 'failed' ? { error: 'child crashed' } : {})
    })])

    const { item } = await timelineItem(setup)
    expect(item.output).toMatchObject({ status, detached: true })
    expect(item.isError).toBe(isError)
  })

  it('does not rewrite an older attempt that reused the same child id', async () => {
    const setup = await timelineSetup('thr_resume', [
      delegateResult('thr_resume', 'thr_resume_turn', {
        status: 'failed', detached: false, resumeCount: 0
      })
    ], [childRun('thr_resume', 'running', { detached: false, resumeCount: 1 })])
    await setup.store.appendEvent('thr_resume', {
      kind: 'turn_started', seq: 9, timestamp: '2026-08-27T03:26:44.157Z',
      threadId: 'thr_resume', turnId: 'thr_resume_turn', status: 'running',
      child: {
        parentThreadId: 'thr_resume', parentTurnId: 'thr_resume_turn',
        childId: 'child_delegated', childStatus: 'running', childSeq: 1,
        resumeCount: 1
      }
    })

    const { body, item } = await timelineItem(setup)
    expect(item.output).toMatchObject({ status: 'failed', resumeCount: 0 })
    expect(body.latestSeq).toBe(0)
  })

  it('updates only delegate results with a matching child id', async () => {
    const setup = await timelineSetup('thr_multi', [
      delegateResult('thr_multi', 'thr_multi_turn', { status: 'queued' }),
      delegateResult('thr_multi', 'thr_multi_turn', {
        childId: 'child_unrelated', status: 'queued', detached: false
      })
    ], [childRun('thr_multi', 'running', { detached: false })])

    const { body } = await timelineItem(setup)
    const outputs = body.turns[0].items.map((item: { output: unknown }) => item.output)
    expect(outputs).toContainEqual(expect.objectContaining({
      childId: 'child_delegated', status: 'running'
    }))
    expect(outputs).toContainEqual(expect.objectContaining({
      childId: 'child_unrelated', status: 'queued'
    }))
  })

  it('falls back to persisted progress when child diagnostics fail', async () => {
    const setup = await timelineSetup('thr_fallback', [
      delegateResult('thr_fallback', 'thr_fallback_turn', {
        status: 'queued', detached: false
      })
    ])
    setup.diagnostics.mockRejectedValueOnce(new Error('child store unavailable'))

    const { response, body, item } = await timelineItem(setup)
    expect(response.status).toBe(200)
    expect(body.latestSeq).toBe(0)
    expect(item.output).toMatchObject({ status: 'queued', detached: false })
  })

  it('does not load child runs when no delegate result is on the page', async () => {
    const setup = await timelineSetup('thr_plain', [{
      id: 'item_plain_result', turnId: 'thr_plain_turn', threadId: 'thr_plain',
      role: 'tool', status: 'completed', createdAt: '2026-08-27T03:26:43.157Z',
      kind: 'tool_result', toolName: 'bash', callId: 'call_bash',
      toolKind: 'command_execution', output: 'ok', isError: false
    }], [])

    const { response } = await timelineItem(setup)
    expect(response.status).toBe(200)
    expect(setup.diagnostics).not.toHaveBeenCalled()
  })
})

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DispatchRecord } from '../contracts/ade.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { TurnItem } from '../contracts/items.js'
import type { ActivityPatch, ActivityProvenance } from '../contracts/activity.js'
import { FileTeamStore } from '../ade/team-store.js'
import { FileDispatchStore } from '../ade/dispatch-store.js'
import { FileQuestionStore } from '../ade/question-store.js'
import { FileWorkerNoticeStore } from '../ade/worker-notice-store.js'
import { WorkerCallbackService } from './worker-callback-service.js'
import { createWorkerCallbackToolProvider } from '../adapters/tool/worker-callback-tool-provider.js'

const NOW = '2026-10-01T00:00:00.000Z'
const MANAGER = 'thr_mgr'
const WORKER = 'wrk_1'

let dataDir: string
let teams: FileTeamStore
let dispatches: FileDispatchStore
let questions: FileQuestionStore
let notices: FileWorkerNoticeStore
let now: number
let qSeq: number
let applied: { unitId: string; patch: ActivityPatch; provenance: ActivityProvenance }[]

function threadFixture(overrides: Record<string, unknown> = {}): ThreadRecord {
  return {
    id: WORKER,
    executionUnit: {
      kind: 'worker',
      teamId: MANAGER,
      managerThreadId: MANAGER,
      label: 'implementer',
      lifecycle: 'persistent',
      control: 'manager'
    },
    ...overrides
  } as unknown as ThreadRecord
}

function dispatchFixture(overrides: Partial<DispatchRecord> = {}): DispatchRecord {
  return {
    dispatchId: 'dsp_1',
    teamId: MANAGER,
    workerId: WORKER,
    parentTurnId: 'turn_mgr_1',
    title: 'fix login',
    task: 'repair the login redirect',
    mode: 'queue',
    state: 'accepted',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}

function makeService(items: TurnItem[] = [], thread: ThreadRecord | null = threadFixture()) {
  return new WorkerCallbackService({
    threadStore: { get: async () => thread },
    sessionStore: {
      loadItems: async (threadId: string) => {
        if (threadId !== MANAGER) throw new Error(`unexpected read of ${threadId}`)
        return items
      }
    },
    teams,
    dispatches,
    questions,
    notices,
    activity: {
      apply: (unitId, patch, provenance) => {
        applied.push({ unitId, patch, provenance })
      }
    },
    nowIso: () => NOW,
    nowMs: () => now,
    idGenerator: () => `q_${++qSeq}`
  })
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'kun-wcb-'))
  teams = new FileTeamStore(dataDir, () => NOW)
  dispatches = new FileDispatchStore(dataDir, () => NOW)
  questions = new FileQuestionStore(dataDir, () => NOW)
  notices = new FileWorkerNoticeStore(dataDir, () => NOW)
  await teams.ensure(MANAGER)
  await dispatches.create(dispatchFixture())
  now = 0
  qSeq = 0
  applied = []
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

describe('worker identity', () => {
  it('rejects calls from threads without a worker execution unit', async () => {
    const service = makeService([], threadFixture({ executionUnit: undefined }))
    await expect(service.reportProgress(WORKER, { summary: 'hi' })).rejects.toThrow(/not a worker/)
    await expect(service.submitResult(WORKER, { summary: 'x', outcome: 'succeeded' }))
      .rejects.toThrow(/not a worker/)
    const plainThread = makeService([], threadFixture({ executionUnit: undefined }))
    await expect(plainThread.readManagerContext(WORKER, {})).rejects.toThrow(/not a worker/)
  })

  it('rejects a missing thread', async () => {
    const service = makeService([], null)
    await expect(service.reportProgress(WORKER, { summary: 'hi' })).rejects.toThrow(/not a worker/)
  })
})

describe('reportProgress', () => {
  it('writes phase + note to the activity store with callback provenance', async () => {
    const service = makeService()
    const result = await service.reportProgress(WORKER, {
      summary: 'located the redirect loop',
      phase: 'investigating'
    })
    expect(result).toEqual({ status: 'recorded' })
    expect(applied).toEqual([{
      unitId: WORKER,
      patch: { phase: 'investigating', progressNote: 'located the redirect loop' },
      provenance: 'callback'
    }])
  })

  it('rate limits the second report inside 10s without failing', async () => {
    const service = makeService()
    await service.reportProgress(WORKER, { summary: 'first' })
    expect(await service.reportProgress(WORKER, { summary: 'second' }))
      .toEqual({ status: 'rate_limited' })
    now += 10_001
    expect(await service.reportProgress(WORKER, { summary: 'third' }))
      .toEqual({ status: 'recorded' })
    expect(applied.map((entry) => entry.patch.progressNote)).toEqual(['first', 'third'])
  })
})

describe('askManager', () => {
  it('fails without an accepted dispatch', async () => {
    await dispatches.update(MANAGER, 'dsp_1', { state: 'completed' })
    const service = makeService()
    await expect(service.askManager(WORKER, { question: '?' }, new AbortController().signal))
      .rejects.toThrow(/no active dispatch/)
  })

  it('returns the manager answer, marks waiting then working, and queues a notice', async () => {
    const service = makeService()
    const pending = service.askManager(WORKER, { question: 'which env?' }, new AbortController().signal)
    await vi.waitFor(async () => {
      expect(await questions.get(MANAGER, 'q_1')).toMatchObject({ state: 'open' })
    })
    const pendingNotices = await notices.pending(MANAGER)
    expect(pendingNotices).toHaveLength(1)
    expect(pendingNotices[0]).toMatchObject({
      kind: 'question',
      questionId: 'q_1',
      workerId: WORKER,
      dispatchId: 'dsp_1'
    })
    await service.answerQuestion({
      teamId: MANAGER,
      questionId: 'q_1',
      answer: 'staging',
      answeredBy: 'manager'
    })
    await expect(pending).resolves.toEqual({
      status: 'answered',
      answer: 'staging',
      answeredBy: 'manager'
    })
    expect(applied).toEqual([
      { unitId: WORKER, patch: { mainState: 'waiting', waitingReason: 'question' }, provenance: 'callback' },
      { unitId: WORKER, patch: { mainState: 'working', waitingReason: undefined }, provenance: 'callback' }
    ])
  })

  it('times out unanswered questions', async () => {
    const service = makeService()
    const result = await service.askManager(
      WORKER,
      { question: 'anyone?', timeoutSeconds: 1 },
      new AbortController().signal
    )
    expect(result).toEqual({ status: 'timeout' })
    expect((await questions.get(MANAGER, 'q_1'))?.state).toBe('timeout')
  })

  it('returns cancelled when the turn aborts mid-wait', async () => {
    const service = makeService()
    const abort = new AbortController()
    const pending = service.askManager(WORKER, { question: 'hmm' }, abort.signal)
    await vi.waitFor(async () => {
      expect(await questions.get(MANAGER, 'q_1')).toMatchObject({ state: 'open' })
    })
    abort.abort()
    await expect(pending).resolves.toEqual({ status: 'cancelled' })
    expect((await questions.get(MANAGER, 'q_1'))?.state).toBe('cancelled')
  })

  it('startup reconciliation marks unanswered questions timed out', async () => {
    const service = makeService()
    const abort = new AbortController()
    void service.askManager(WORKER, { question: 'before crash' }, abort.signal)
      .catch(() => undefined)
    await vi.waitFor(async () => {
      expect(await questions.get(MANAGER, 'q_1')).toMatchObject({ state: 'open' })
    })
    // Simulate restart: a fresh service has no in-memory waiters.
    const restarted = makeService()
    await restarted.reconcileOnStartup(MANAGER)
    expect((await questions.get(MANAGER, 'q_1'))?.state).toBe('timeout')
    abort.abort()
  })
})

describe('readManagerContext', () => {
  function item(overrides: Record<string, unknown>): TurnItem {
    return {
      id: Math.random().toString(36).slice(2),
      turnId: 'turn_mgr_1',
      threadId: MANAGER,
      role: 'user',
      status: 'completed',
      createdAt: NOW,
      ...overrides
    } as TurnItem
  }

  const items: TurnItem[] = [
    item({ kind: 'user_message', text: 'raw prompt', displayText: 'shown prompt' }),
    item({ kind: 'assistant_text', role: 'assistant', text: 'planning the split' }),
    item({ kind: 'assistant_reasoning', role: 'assistant', text: 'hidden chain' }),
    item({ kind: 'tool_call', role: 'assistant', toolName: 'x', callId: 'c1', toolKind: 'tool_call', arguments: {} }),
    item({ kind: 'tool_result', role: 'tool', toolName: 'x', callId: 'c1', output: 'secret' }),
    item({ kind: 'user_message', text: 'host notice', messageSource: 'worker_update' }),
    item({ kind: 'user_message', text: 'second question' })
  ]

  it('returns only user displayText and assistant text, newest first', async () => {
    const service = makeService(items)
    const result = await service.readManagerContext(WORKER, {})
    expect(result.items).toEqual([
      { role: 'user', text: 'second question', turnId: 'turn_mgr_1', createdAt: NOW },
      { role: 'assistant', text: 'planning the split', turnId: 'turn_mgr_1', createdAt: NOW },
      { role: 'user', text: 'shown prompt', turnId: 'turn_mgr_1', createdAt: NOW }
    ])
    expect(result.nextCursor).toBeUndefined()
  })

  it('applies case-insensitive query filtering', async () => {
    const service = makeService(items)
    const result = await service.readManagerContext(WORKER, { query: 'PROMPT' })
    expect(result.items).toEqual([
      { role: 'user', text: 'shown prompt', turnId: 'turn_mgr_1', createdAt: NOW }
    ])
  })

  it('paginates with a cursor', async () => {
    const service = makeService(items)
    const first = await service.readManagerContext(WORKER, { limit: 2 })
    expect(first.items).toHaveLength(2)
    expect(first.nextCursor).toBeTruthy()
    const second = await service.readManagerContext(WORKER, { limit: 2, cursor: first.nextCursor })
    expect(second.items).toHaveLength(1)
    expect(second.nextCursor).toBeUndefined()
    expect([...first.items, ...second.items].map((entry) => entry.text))
      .toEqual(['second question', 'planning the split', 'shown prompt'])
  })
})

describe('submitResult', () => {
  it('persists the structured report on the active dispatch', async () => {
    const service = makeService()
    await expect(service.submitResult(WORKER, {
      summary: 'redirect fixed',
      outcome: 'succeeded',
      filesChanged: ['src/auth.ts'],
      checks: [{ name: 'typecheck', status: 'passed' }],
      risks: ['legacy IE11 path untested']
    })).resolves.toEqual({ status: 'recorded' })
    const dispatch = await dispatches.get(MANAGER, 'dsp_1')
    expect(dispatch?.workerReport).toEqual({
      summary: 'redirect fixed',
      outcome: 'succeeded',
      filesChanged: ['src/auth.ts'],
      checks: [{ name: 'typecheck', status: 'passed' }],
      risks: ['legacy IE11 path untested'],
      submittedAt: NOW
    })
  })

  it('rejects reports over the contract limits', async () => {
    const service = makeService()
    await expect(service.submitResult(WORKER, {
      summary: 'x'.repeat(4_001),
      outcome: 'succeeded'
    })).rejects.toThrow()
  })
})

describe('tool provider gating', () => {
  it('advertises all four tools only on worker contexts', async () => {
    const provider = createWorkerCallbackToolProvider(makeService())
    expect(provider.tools.map((tool) => tool.name).sort()).toEqual([
      'ask_manager',
      'read_manager_context',
      'report_progress',
      'submit_result'
    ])
    for (const tool of provider.tools) {
      expect(tool.shouldAdvertise?.({ executionUnitKind: 'worker' } as never)).toBe(true)
      expect(tool.shouldAdvertise?.({} as never)).toBe(false)
    }
  })
})

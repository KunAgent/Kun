import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DispatchRecord, WorkerRecord } from '../contracts/ade.js'
import { adeTeamDir, adeTeamFile } from './ade-paths.js'
import { FileDispatchStore, DispatchTransitionError } from './dispatch-store.js'
import { FileQuestionStore } from './question-store.js'
import { FileTeamStore } from './team-store.js'
import { FileWorkerNoticeStore } from './worker-notice-store.js'

let dataDir: string
let teams: FileTeamStore
let dispatches: FileDispatchStore
let questions: FileQuestionStore
let notices: FileWorkerNoticeStore

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'kun-ade-stores-'))
  teams = new FileTeamStore(dataDir)
  dispatches = new FileDispatchStore(dataDir)
  questions = new FileQuestionStore(dataDir)
  notices = new FileWorkerNoticeStore(dataDir)
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

function workerRecord(overrides: Partial<WorkerRecord> = {}): WorkerRecord {
  return {
    workerId: 'wrk_1',
    label: 'implementer',
    route: { harnessId: 'kun', model: 'model-x', credentialMode: 'provider' },
    permissionMode: 'default',
    lifecycle: 'persistent',
    securitySnapshot: { sandboxRoot: '/tmp/ws', memoryEnabled: false },
    control: 'manager',
    state: 'active',
    createdAt: '2026-09-26T00:00:00.000Z',
    ...overrides
  }
}

function dispatchRecord(overrides: Partial<DispatchRecord> = {}): DispatchRecord {
  return {
    dispatchId: 'dsp_1',
    teamId: 'thr_mgr',
    workerId: 'wrk_1',
    parentTurnId: 'turn_1',
    title: 'fix login',
    task: 'repair the login redirect',
    mode: 'queue',
    state: 'pending',
    createdAt: '2026-09-26T00:00:00.000Z',
    updatedAt: '2026-09-26T00:00:00.000Z',
    ...overrides
  }
}

describe('FileTeamStore', () => {
  it('ensure creates a team with defaults and is idempotent', async () => {
    const team = await teams.ensure('thr_mgr')
    expect(team.teamId).toBe('thr_mgr')
    expect(team.limits).toEqual({ softWorkers: 4, hardWorkers: 8 })
    const again = await teams.ensure('thr_mgr', { hardWorkers: 2 })
    expect(again.limits.hardWorkers).toBe(8)
  })

  it('upserts and updates workers', async () => {
    await teams.ensure('thr_mgr')
    await teams.upsertWorker('thr_mgr', workerRecord())
    const found = await teams.worker('thr_mgr', 'wrk_1')
    expect(found?.label).toBe('implementer')
    const updated = await teams.updateWorker('thr_mgr', 'wrk_1', {
      state: 'released',
      releasedAt: '2026-09-26T01:00:00.000Z'
    })
    expect(updated?.state).toBe('released')
    expect((await teams.byManager('thr_mgr'))?.workers).toHaveLength(1)
  })

  it('discards a corrupt team file and reports an empty team', async () => {
    await teams.ensure('thr_mgr')
    await writeFile(adeTeamFile(dataDir, 'thr_mgr'), '{"version":1,"team":', 'utf8')
    expect(await teams.byManager('thr_mgr')).toBeNull()
    // The thread record itself is unaffected; a new team can be recreated.
    const recreated = await teams.ensure('thr_mgr')
    expect(recreated.workers).toHaveLength(0)
  })
})

describe('FileDispatchStore', () => {
  beforeEach(async () => {
    await teams.ensure('thr_mgr')
  })

  it('creates, gets, lists by worker and finds by clientRequestId', async () => {
    await dispatches.create(dispatchRecord())
    expect((await dispatches.get('thr_mgr', 'dsp_1'))?.title).toBe('fix login')
    expect(await dispatches.findByClientRequestId('thr_mgr', 'dsp_1')).not.toBeNull()
    expect(await dispatches.findByClientRequestId('thr_mgr', 'dsp_other')).toBeNull()
    expect(await dispatches.listByWorker('thr_mgr', 'wrk_1')).toHaveLength(1)
    expect(await dispatches.listByWorker('thr_mgr', 'wrk_2')).toHaveLength(0)
  })

  it('enforces the dispatch transition table', async () => {
    await dispatches.create(dispatchRecord())
    await expect(dispatches.update('thr_mgr', 'dsp_1', { state: 'completed' }))
      .rejects.toBeInstanceOf(DispatchTransitionError)
    await dispatches.update('thr_mgr', 'dsp_1', { state: 'delivering' })
    await dispatches.update('thr_mgr', 'dsp_1', { state: 'accepted', turnId: 'turn_w1' })
    await dispatches.update('thr_mgr', 'dsp_1', { state: 'completed' })
    await expect(dispatches.update('thr_mgr', 'dsp_1', { state: 'pending' }))
      .rejects.toThrow('completed -> pending')
  })

  it('accepts retry through uncertain -> delivering -> accepted', async () => {
    await dispatches.create(dispatchRecord({ dispatchId: 'dsp_2' }))
    await dispatches.update('thr_mgr', 'dsp_2', { state: 'delivering' })
    await dispatches.update('thr_mgr', 'dsp_2', { state: 'uncertain' })
    await dispatches.update('thr_mgr', 'dsp_2', { state: 'delivering' })
    const done = await dispatches.update('thr_mgr', 'dsp_2', { state: 'accepted' })
    expect(done?.state).toBe('accepted')
  })

  it('listByState filters pending dispatches', async () => {
    await dispatches.create(dispatchRecord({ dispatchId: 'dsp_a' }))
    await dispatches.create(dispatchRecord({ dispatchId: 'dsp_b', state: 'accepted' }))
    expect((await dispatches.listByState('thr_mgr', ['pending'])).map((d) => d.dispatchId))
      .toEqual(['dsp_a'])
  })

  it('returns empty collections for a corrupt dispatches file', async () => {
    await dispatches.create(dispatchRecord())
    await writeFile(join(adeTeamDir(dataDir, 'thr_mgr'), 'dispatches.json'), 'not json', 'utf8')
    expect(await dispatches.list('thr_mgr')).toEqual([])
  })
})

describe('FileQuestionStore', () => {
  it('creates, answers, and times out open questions on restart', async () => {
    await teams.ensure('thr_mgr')
    await questions.create('thr_mgr', {
      questionId: 'q_1',
      dispatchId: 'dsp_1',
      workerId: 'wrk_1',
      question: 'also fix dark mode?',
      state: 'open',
      deadline: '2026-09-26T00:10:00.000Z',
      createdAt: '2026-09-26T00:00:00.000Z',
      updatedAt: '2026-09-26T00:00:00.000Z'
    })
    expect(await questions.listOpen('thr_mgr')).toHaveLength(1)
    const answered = await questions.update('thr_mgr', 'q_1', {
      state: 'answered',
      answer: 'yes',
      answeredBy: 'manager'
    })
    expect(answered?.answer).toBe('yes')
    await expect(questions.update('thr_mgr', 'q_1', { state: 'open' })).rejects.toThrow()

    await questions.create('thr_mgr', {
      questionId: 'q_2',
      dispatchId: 'dsp_1',
      workerId: 'wrk_1',
      question: 'retry?',
      state: 'open',
      deadline: '2026-09-26T00:10:00.000Z',
      createdAt: '2026-09-26T00:00:00.000Z',
      updatedAt: '2026-09-26T00:00:00.000Z'
    })
    expect(await questions.markOpenTimedOut('thr_mgr')).toBe(1)
    expect((await questions.get('thr_mgr', 'q_2'))?.state).toBe('timeout')
    expect((await questions.get('thr_mgr', 'q_1'))?.state).toBe('answered')
  })
})

describe('FileWorkerNoticeStore', () => {
  it('enqueues, lists pending, and acks delivered notices', async () => {
    await teams.ensure('thr_mgr')
    await notices.enqueue({
      noticeId: 'ntc_1',
      teamId: 'thr_mgr',
      workerId: 'wrk_1',
      kind: 'dispatch_completed',
      dispatchId: 'dsp_1',
      title: 'fix login',
      attempts: 0,
      createdAt: '2026-09-26T00:00:00.000Z'
    })
    // Duplicate enqueue is idempotent.
    await notices.enqueue({
      noticeId: 'ntc_1',
      teamId: 'thr_mgr',
      workerId: 'wrk_1',
      kind: 'dispatch_completed',
      dispatchId: 'dsp_1',
      title: 'fix login',
      attempts: 0,
      createdAt: '2026-09-26T00:00:00.000Z'
    })
    expect(await notices.pending('thr_mgr')).toHaveLength(1)
    expect(await notices.ack('thr_mgr', ['ntc_1', 'ntc_missing'])).toBe(1)
    expect(await notices.pending('thr_mgr')).toHaveLength(0)
    expect(await notices.list('thr_mgr')).toHaveLength(1)
  })

  it('records delivery attempts on pending notices only', async () => {
    await teams.ensure('thr_mgr')
    await notices.enqueue({
      noticeId: 'ntc_1',
      teamId: 'thr_mgr',
      workerId: 'wrk_1',
      kind: 'dispatch_completed',
      title: 'fix login',
      attempts: 0,
      createdAt: '2026-09-26T00:00:00.000Z'
    })
    await notices.enqueue({
      noticeId: 'ntc_2',
      teamId: 'thr_mgr',
      workerId: 'wrk_2',
      kind: 'question',
      title: 'need input',
      attempts: 0,
      createdAt: '2026-09-26T00:00:00.000Z'
    })
    await notices.ack('thr_mgr', ['ntc_2'])
    expect(await notices.markAttempt('thr_mgr', ['ntc_1', 'ntc_2', 'ntc_missing'], 'busy')).toBe(1)
    const stored = (await notices.list('thr_mgr')).find((entry) => entry.noticeId === 'ntc_1')!
    expect(stored.attempts).toBe(1)
    expect(stored.lastError).toBe('busy')
    expect(stored.lastAttemptAt).toBeTruthy()
    // Acked rows are untouched by attempt bookkeeping.
    expect((await notices.list('thr_mgr')).find((entry) => entry.noticeId === 'ntc_2')?.attempts).toBe(0)
    expect(await notices.markAttempt('thr_mgr', [], 'x')).toBe(0)
  })
})

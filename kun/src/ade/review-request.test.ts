import { describe, expect, it } from 'vitest'
import type { HarnessDefinition, HarnessStatus } from '../contracts/harness.js'
import type { HarnessCapabilities } from '../contracts/harness-capabilities.js'
import { allSupportedStatuses } from '../contracts/harness-capabilities.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import type { ChildRunRecord } from '../delegation/delegation-runtime-contracts.js'
import { SUBAGENT_READ_ONLY_TOOL_NAMES } from '../contracts/capabilities-core.js'
import { ADE_WORKER_CALLBACK_TOOL_NAMES, readOnlyToolCeiling } from '../contracts/ade.js'
import { BUILTIN_HARNESSES } from '../harness/builtin-harnesses.js'
import {
  managerCtx,
  NOW,
  seedDispatch,
  seedWorker,
  setupAdeStores,
  teardownAdeStores,
  makeHarness,
  turnRecord,
  workerRecord,
  workerThread,
  type AdeStores
} from './manager-controls-test-support.js'
import type { ManagerRuntimeDeps } from './manager-runtime.js'

/** Cross-review: 10 §5 — ephemeral read-only reviewer, exclusion, merge. */

const READY: HarnessStatus = {
  harnessId: 'kun',
  installed: 'yes',
  login: 'signed-in',
  checkedAt: '2026-01-01T00:00:00.000Z'
}

const ALL_SUPPORTED: HarnessCapabilities = {
  statuses: allSupportedStatuses(),
  facts: { sandbox: 'host', usageReporting: 'exact', compactionOwner: 'kun' }
}

const def = (id: string): HarnessDefinition =>
  BUILTIN_HARNESSES.find((entry) => entry.id === id)!

const SELECTOR: ManagerRuntimeDeps['selector'] = {
  profiles: async () => [],
  quota: async () => null,
  agentOrder: () => [],
  modelCostTier: () => 0
}

const toolContext = (extra: Partial<ToolHostContext> = {}): ToolHostContext =>
  ({ workspace: '/repo', ...extra }) as ToolHostContext

const SNAPSHOT = {
  record: {} as never,
  changedFiles: ['src/a.ts', 'src/b.ts'],
  patch: 'diff --git a/src/a.ts b/src/a.ts\n+const x = 1\n'
}

async function seeded(
  opts: {
    harnesses?: HarnessDefinition[]
    selector?: ManagerRuntimeDeps['selector']
    reviewSnapshot?: unknown
    workerOverrides?: Parameters<typeof workerRecord>[0]
    dispatchOverrides?: Parameters<typeof seedDispatch>[1]
  } = {}
) {
  const stores = await setupAdeStores()
  const harness = makeHarness(stores, {
    harnesses: opts.harnesses ?? [def('kun'), def('claude-code'), def('cursor')],
    capabilities: ALL_SUPPORTED,
    statusFor: (id) => ({ ...READY, harnessId: id }),
    ...('selector' in opts ? { selector: opts.selector } : { selector: SELECTOR }),
    ...('reviewSnapshot' in opts
      ? { reviewSnapshot: opts.reviewSnapshot }
      : { reviewSnapshot: SNAPSHOT })
  })
  await seedWorker(stores, {
    route: { harnessId: 'kun', model: 'model-x', credentialMode: 'provider' },
    ...opts.workerOverrides
  })
  await seedDispatch(stores, {
    dispatchId: 'dsp_done',
    state: 'completed',
    outcome: 'completed',
    task: 'fix the login bug',
    workerReport: { summary: 'fixed it', outcome: 'succeeded', checks: [], risks: [], submittedAt: NOW },
    ...opts.dispatchOverrides
  })
  return { stores, harness }
}

const firstRunChild = (harness: ReturnType<typeof makeHarness>) =>
  (harness.delegation.runChild as unknown as { mock: { calls: unknown[][] } })
    .mock.calls[0]![0] as Record<string, unknown> & Partial<ChildRunRecord>

describe('readOnlyToolCeiling (10 §5)', () => {
  it('unions the worker callback tools for worker children only', () => {
    expect(readOnlyToolCeiling({ kind: 'worker' })).toEqual([
      ...SUBAGENT_READ_ONLY_TOOL_NAMES,
      ...ADE_WORKER_CALLBACK_TOOL_NAMES
    ])
    expect(readOnlyToolCeiling({ kind: 'subagent' })).toBe(SUBAGENT_READ_ONLY_TOOL_NAMES)
    expect(readOnlyToolCeiling(undefined)).toBe(SUBAGENT_READ_ONLY_TOOL_NAMES)
  })
})

describe('ReviewRequests.request', () => {
  it('creates an ephemeral read-only reviewer on a different harness and dispatches it', async () => {
    const { stores, harness } = await seeded()
    try {
      const result = await harness.reviews.request(managerCtx(), { workerId: 'wrk_1' }, toolContext())
      expect(result).toMatchObject({ ok: true, reviewedDispatchId: 'dsp_done' })

      const team = await stores.teams.get('thr_mgr')
      const reviewer = team!.workers.find((entry) => entry.reviewOf === 'dsp_done')!
      expect(reviewer.workerId).toBe(result.reviewerWorkerId)
      expect(reviewer.role).toBe('reviewer')
      expect(reviewer.lifecycle).toBe('ephemeral')
      // The reviewed harness (kun) is excluded by default.
      expect(reviewer.route.harnessId).not.toBe('kun')
      expect(reviewer.taskWorkspaceId).toBeUndefined()
      expect(reviewer.securitySnapshot).toMatchObject({
        sandboxRoot: '/repo/.worktrees/fix-login',
        allowedWritePaths: [],
        allowedReadPaths: ['/repo/.worktrees/fix-login'],
        memoryEnabled: false
      })

      const dispatches = await stores.dispatches.listByWorker('thr_mgr', reviewer.workerId)
      expect(dispatches).toHaveLength(1)
      expect(dispatches[0]!.state).toBe('accepted')
      expect(dispatches[0]!.verdict).toEqual({ status: 'pending', checks: [] })
      // The review brief carries the task, report, and inline patch.
      expect(dispatches[0]!.task).toContain('fix the login bug')
      expect(dispatches[0]!.task).toContain('fixed it')
      expect(dispatches[0]!.task).toContain('```diff')

      const call = firstRunChild(harness)
      expect(call.toolPolicyCeiling).toBe('readOnly')
      expect(call.sandboxMode).toBe('read-only')
      expect(call.workspace).toBe('/repo/.worktrees/fix-login')
      expect((call.executionUnit as { role?: string }).role).toBe('reviewer')
    } finally {
      await teardownAdeStores(stores)
    }
  })

  it('keeps callback tools reachable under a narrowed parent tool ceiling', async () => {
    const { stores, harness } = await seeded()
    try {
      const ctx = toolContext({ allowedToolNames: ['read', 'grep'] })
      const result = await harness.reviews.request(managerCtx(), { workerId: 'wrk_1' }, ctx)
      expect(result.ok).toBe(true)
      const team = await stores.teams.get('thr_mgr')
      const reviewer = team!.workers.find((entry) => entry.reviewOf === 'dsp_done')!
      expect(reviewer.securitySnapshot.allowedToolNames).toEqual(
        expect.arrayContaining(['read', 'grep', 'submit_result', 'report_progress', 'ask_manager'])
      )
    } finally {
      await teardownAdeStores(stores)
    }
  })

  it('refuses an explicit reviewer on the same harness and honors a different one', async () => {
    const { stores, harness } = await seeded()
    try {
      const same = await harness.reviews.request(
        managerCtx(),
        { workerId: 'wrk_1', reviewer: { harnessId: 'kun' } },
        toolContext()
      )
      expect(same).toMatchObject({ ok: false, refusal: 'same_harness' })

      const pinned = await harness.reviews.request(
        managerCtx(),
        { workerId: 'wrk_1', reviewer: { harnessId: 'claude-code', model: 'claude-sonnet-5' } },
        toolContext()
      )
      expect(pinned.ok).toBe(true)
      const team = await stores.teams.get('thr_mgr')
      const reviewer = team!.workers.find((entry) => entry.workerId === pinned.reviewerWorkerId)!
      expect(reviewer.route.harnessId).toBe('claude-code')
    } finally {
      await teardownAdeStores(stores)
    }
  })

  it('refuses no_reviewer when the reviewed harness is the only one available', async () => {
    const { stores, harness } = await seeded({ harnesses: [def('kun')] })
    try {
      const result = await harness.reviews.request(managerCtx(), { workerId: 'wrk_1' }, toolContext())
      expect(result).toMatchObject({ ok: false, refusal: 'no_reviewer' })
      expect(result.userReport).toContain('excluded')
      // Nothing was created.
      expect((await stores.teams.get('thr_mgr'))!.workers).toHaveLength(1)
      expect(await stores.dispatches.listByWorker('thr_mgr', 'wrk_1')).toHaveLength(1)
    } finally {
      await teardownAdeStores(stores)
    }
  })

  it('refuses no_reviewer without the selector unless reviewer.harnessId is explicit', async () => {
    const { stores, harness } = await seeded({ selector: undefined })
    try {
      const result = await harness.reviews.request(managerCtx(), { workerId: 'wrk_1' }, toolContext())
      expect(result).toMatchObject({ ok: false, refusal: 'no_reviewer' })
      expect(result.userReport).toMatch(/reviewer\.harnessId|explicitly/i)
    } finally {
      await teardownAdeStores(stores)
    }
  })

  it('rejects unknown workers, mismatched dispatches, and in-flight work', async () => {
    const { stores, harness } = await seeded()
    try {
      const unknown = await harness.reviews.request(
        managerCtx(), { workerId: 'wrk_ghost' }, toolContext())
      expect(unknown).toMatchObject({ ok: false, refusal: 'worker_not_found' })

      const missing = await harness.reviews.request(
        managerCtx(), { workerId: 'wrk_1', dispatchId: 'dsp_ghost' }, toolContext())
      expect(missing).toMatchObject({ ok: false, refusal: 'dispatch_not_found' })

      await seedDispatch(stores, { dispatchId: 'dsp_other', workerId: 'wrk_other', state: 'completed' })
      const mismatch = await harness.reviews.request(
        managerCtx(), { workerId: 'wrk_1', dispatchId: 'dsp_other' }, toolContext())
      expect(mismatch).toMatchObject({ ok: false, refusal: 'dispatch_worker_mismatch' })

      await seedDispatch(stores, { dispatchId: 'dsp_live', state: 'accepted' })
      const live = await harness.reviews.request(
        managerCtx(), { workerId: 'wrk_1', dispatchId: 'dsp_live' }, toolContext())
      expect(live).toMatchObject({ ok: false, refusal: 'dispatch_in_flight' })
    } finally {
      await teardownAdeStores(stores)
    }
  })

  it('refuses no_completed_dispatch when the worker has only pending work', async () => {
    const stores = await setupAdeStores()
    const harness = makeHarness(stores, {
      harnesses: [def('kun'), def('claude-code')],
      capabilities: ALL_SUPPORTED,
      statusFor: (id) => ({ ...READY, harnessId: id }),
      selector: SELECTOR
    })
    try {
      await seedWorker(stores)
      await seedDispatch(stores, { dispatchId: 'dsp_pending', state: 'pending' })
      const result = await harness.reviews.request(managerCtx(), { workerId: 'wrk_1' }, toolContext())
      expect(result).toMatchObject({ ok: false, refusal: 'no_completed_dispatch' })
    } finally {
      await teardownAdeStores(stores)
    }
  })

  it('falls back to file names plus read tools when the patch exceeds the budget', async () => {
    const { stores, harness } = await seeded({
      reviewSnapshot: {
        record: {} as never,
        changedFiles: ['src/huge.ts'],
        patch: 'x'.repeat(30_000)
      }
    })
    try {
      const result = await harness.reviews.request(managerCtx(), { workerId: 'wrk_1' }, toolContext())
      expect(result.ok).toBe(true)
      const dispatches = await stores.dispatches.listByWorker('thr_mgr', result.reviewerWorkerId!)
      expect(dispatches[0]!.task).toContain('src/huge.ts')
      expect(dispatches[0]!.task).toContain('exceeds the inline budget')
      expect(dispatches[0]!.task).not.toContain('```diff')
      expect(dispatches[0]!.task.length).toBeLessThanOrEqual(32_000)
    } finally {
      await teardownAdeStores(stores)
    }
  })

  it('points the reviewer at the workspace when no snapshot exists', async () => {
    const { stores, harness } = await seeded({ reviewSnapshot: undefined })
    try {
      const result = await harness.reviews.request(managerCtx(), { workerId: 'wrk_1' }, toolContext())
      expect(result.ok).toBe(true)
      const dispatches = await stores.dispatches.listByWorker('thr_mgr', result.reviewerWorkerId!)
      expect(dispatches[0]!.task).toContain('/repo/.worktrees/fix-login')
      expect(dispatches[0]!.task).toContain('read tools')
    } finally {
      await teardownAdeStores(stores)
    }
  })

  it('honors the worker-limit refusal before creating anything', async () => {
    const stores = await setupAdeStores({ hardWorkers: 1 })
    const harness = makeHarness(stores, {
      harnesses: [def('kun'), def('claude-code')],
      capabilities: ALL_SUPPORTED,
      statusFor: (id) => ({ ...READY, harnessId: id }),
      selector: SELECTOR
    })
    try {
      await seedWorker(stores)
      const result = await harness.reviews.request(managerCtx(), { workerId: 'wrk_1' }, toolContext())
      expect(result).toMatchObject({ ok: false, refusal: 'worker_limit' })
    } finally {
      await teardownAdeStores(stores)
    }
  })
})

describe('reviewer terminal merge (10 §5)', () => {
  it('merges the reviewer report into the reviewed dispatch verdict and notifies', async () => {
    const { stores, harness } = await seeded()
    try {
      // Reviewer worker + its own dispatch already accepted on a finished turn.
      await stores.teams.upsertWorker('thr_mgr', workerRecord({
        workerId: 'wrk_rev',
        label: 'review fixer',
        role: 'reviewer',
        lifecycle: 'ephemeral',
        reviewOf: 'dsp_done',
        taskWorkspaceId: undefined,
        securitySnapshot: {
          sandboxRoot: '/repo/.worktrees/fix-login',
          allowedReadPaths: ['/repo/.worktrees/fix-login'],
          allowedWritePaths: [],
          memoryEnabled: false
        }
      }))
      await stores.threads.upsert({
        ...workerThread({ id: 'wrk_rev' }),
        turns: [turnRecord({ id: 'turn_r1', threadId: 'wrk_rev', clientRequestId: 'dsp_rev', status: 'completed' })]
      })
      await seedDispatch(stores, {
        dispatchId: 'dsp_rev',
        workerId: 'wrk_rev',
        state: 'accepted',
        turnId: 'turn_r1',
        workerReport: {
          summary: 'two findings',
          outcome: 'failed',
          checks: [{ name: 'missing test', status: 'failed', detail: 'src/a.ts' }],
          risks: ['touches auth'],
          submittedAt: NOW
        }
      })

      await harness.lifecycle.handleWorkerTurnTerminal('wrk_rev', 'turn_r1', 'completed')

      const reviewed = await stores.dispatches.get('thr_mgr', 'dsp_done')
      expect(reviewed!.verdict).toMatchObject({ status: 'pending', reviewerWorkerId: 'wrk_rev' })
      expect(reviewed!.verdict!.checks).toEqual([
        { name: 'missing test', status: 'failed', detail: 'src/a.ts', source: 'reviewer' },
        { name: 'risk', status: 'failed', source: 'reviewer', detail: 'touches auth' }
      ])
      // The reviewer's own dispatch completed; verdict independence holds.
      expect((await stores.dispatches.get('thr_mgr', 'dsp_rev'))!.state).toBe('completed')

      const notice = (await stores.notices.pending('thr_mgr')).at(-1)!
      expect(notice.kind).toBe('review_completed')
      expect(notice.dispatchId).toBe('dsp_done')
      expect(notice.workerId).toBe('wrk_rev')
    } finally {
      await teardownAdeStores(stores)
    }
  })

  it('merges findings exactly once when the terminal hook replays', async () => {
    const { stores, harness } = await seeded()
    try {
      await stores.teams.upsertWorker('thr_mgr', workerRecord({
        workerId: 'wrk_rev',
        reviewOf: 'dsp_done',
        taskWorkspaceId: undefined,
        securitySnapshot: {
          sandboxRoot: '/repo/.worktrees/fix-login',
          allowedWritePaths: [],
          memoryEnabled: false
        }
      }))
      await stores.threads.upsert({
        ...workerThread({ id: 'wrk_rev' }),
        turns: [turnRecord({ id: 'turn_r1', threadId: 'wrk_rev', clientRequestId: 'dsp_rev', status: 'completed' })]
      })
      await seedDispatch(stores, {
        dispatchId: 'dsp_rev',
        workerId: 'wrk_rev',
        state: 'accepted',
        turnId: 'turn_r1',
        workerReport: {
          summary: 'x',
          outcome: 'succeeded',
          checks: [{ name: 'c1', status: 'passed' }],
          submittedAt: NOW
        }
      })
      await harness.lifecycle.handleWorkerTurnTerminal('wrk_rev', 'turn_r1', 'completed')
      await harness.lifecycle.handleWorkerTurnTerminal('wrk_rev', 'turn_r1', 'completed')
      const reviewed = await stores.dispatches.get('thr_mgr', 'dsp_done')
      // The second replay is a no-op: terminal write required 'accepted'.
      expect(reviewed!.verdict!.checks).toHaveLength(1)
    } finally {
      await teardownAdeStores(stores)
    }
  })
})

import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DispatchRecord,
  WorkerNotice,
  WorkerRecord
} from '../contracts/ade.js'
import type { ManagerRuntime, ManagerToolContext } from './manager-runtime.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import { FileTeamStore } from './team-store.js'
import { FileDispatchStore } from './dispatch-store.js'
import {
  decideRace,
  discardRaceOthers,
  FileRaceStore,
  reconcileRaces,
  recommendRace,
  startRace,
  type RaceServiceDeps
} from './race.js'

const execFileAsync = promisify(execFile)
const NOW = '2026-10-01T00:00:00.000Z'
const TEAM = 'thr_mgr'
const tempDirs: string[] = []

afterEach(async () => {
  while (tempDirs.length) await rm(tempDirs.pop()!, { recursive: true, force: true })
})

async function git(dir: string, args: string[]): Promise<string> {
  return (await execFileAsync('git', ['-C', dir, ...args], { encoding: 'utf8' })).stdout
}

async function initRepo(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  await git(dir, ['init'])
  await git(dir, ['config', 'user.email', 'race-test@example.test'])
  await git(dir, ['config', 'user.name', 'Race Test'])
  await writeFile(join(dir, 'a.txt'), 'base\n')
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-m', 'test: base'])
  return (await git(dir, ['rev-parse', 'HEAD'])).trim()
}

function dispatch(overrides: Partial<DispatchRecord> = {}): DispatchRecord {
  return {
    dispatchId: 'dsp_1',
    teamId: TEAM,
    workerId: 'wrk_1',
    parentTurnId: 'turn_mgr',
    title: 'contender',
    task: 'task',
    mode: 'queue',
    state: 'accepted',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}

function worker(overrides: Partial<WorkerRecord> = {}): WorkerRecord {
  return {
    workerId: 'wrk_1',
    label: 'contender',
    route: { harnessId: 'kun', model: 'm', credentialMode: 'provider' },
    permissionMode: 'default',
    lifecycle: 'ephemeral',
    securitySnapshot: { sandboxRoot: '/repo', memoryEnabled: false },
    control: 'manager',
    state: 'active',
    createdAt: NOW,
    ...overrides
  }
}

async function harness(options: { nowMs?: () => number } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-race-'))
  tempDirs.push(dataDir)
  const races = new FileRaceStore(dataDir, () => NOW)
  const dispatches = new FileDispatchStore(dataDir, () => NOW)
  const teams = new FileTeamStore(dataDir, () => NOW)
  const notices: WorkerNotice[] = []
  const deps: RaceServiceDeps = {
    races,
    dispatches,
    teams,
    notices: { enqueue: async (notice) => { notices.push(notice); return notice } },
    nowIso: () => NOW,
    nowMs: options.nowMs ?? (() => Date.parse(NOW))
  }
  return { dataDir, races, dispatches, teams, notices, deps }
}

const CTX = {
  threadId: TEAM,
  turnId: 'turn_mgr',
  workspace: '/workspace',
  authority: 'standard',
  signal: new AbortController().signal,
  awaitApproval: async () => ({ approved: false as const })
} as unknown as ManagerToolContext

const TOOL_CTX = {} as ToolHostContext

describe('FileRaceStore', () => {
  it('persists and resolves races by id across teams', async () => {
    const { races, deps } = await harness()
    await races.create({
      raceId: 'race_1',
      teamId: TEAM,
      label: 'fix bug',
      task: 'task',
      contenders: [
        { harnessId: 'claude-code', label: 'fix bug · claude-code' },
        { harnessId: 'codex', label: 'fix bug · codex' }
      ],
      state: 'running',
      deadlineAt: NOW,
      createdAt: NOW,
      updatedAt: NOW
    })
    expect((await races.get(TEAM, 'race_1'))?.state).toBe('running')
    expect((await races.findRace('race_1'))?.teamId).toBe(TEAM)
    expect(await races.findRace('race_missing')).toBeNull()
    const updated = await races.update(TEAM, 'race_1', { notes: 'pick b' })
    expect(updated?.notes).toBe('pick b')
    void deps
  })
})

describe('startRace', () => {
  it('resolves the baseline once and dispatches contenders from the same sha', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'kun-race-repo-'))
    tempDirs.push(repo)
    const headSha = await initRepo(repo)
    const { deps } = await harness()
    const created: unknown[] = []
    const manager = {
      createWorker: vi.fn(async (_ctx: unknown, input: unknown) => {
        created.push(input)
        const n = created.length
        return { ok: true, workerId: `wrk_${n}`, dispatchId: `dsp_${n}`, userReport: 'ok' }
      })
    } as unknown as ManagerRuntime
    const result = await startRace(
      manager, { ...deps, ids: { next: () => 'race_x' } },
      { ...CTX, workspace: repo },
      {
        label: 'fix', task: 'do it',
        contenders: [{ harnessId: 'claude-code' }, { harnessId: 'codex', model: 'gpt-5' }]
      },
      TOOL_CTX
    )
    expect(result.ok).toBe(true)
    expect(created).toHaveLength(2)
    for (const input of created as Array<Record<string, unknown>>) {
      expect(input.lifecycle).toBe('ephemeral')
      expect(input.workspace).toEqual({
        isolation: 'worktree',
        startFrom: { kind: 'commit', sha: headSha }
      })
    }
    const record = await deps.races.get(TEAM, 'race_x')
    expect(record?.state).toBe('running')
    expect(record?.startSha).toBe(headSha)
    expect(record?.contenders.map((c) => c.dispatchId)).toEqual(['dsp_1', 'dsp_2'])
  })

  it('returns a refusal when the baseline cannot be resolved', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'kun-race-empty-'))
    tempDirs.push(repo)
    const { deps } = await harness()
    const manager = { createWorker: vi.fn() } as unknown as ManagerRuntime
    const result = await startRace(
      manager, { ...deps, ids: { next: () => 'race_x' } },
      { ...CTX, workspace: repo },
      { label: 'fix', task: 'do it', contenders: [{ harnessId: 'a' }, { harnessId: 'b' }] },
      TOOL_CTX
    )
    expect(result.ok).toBe(false)
    expect(result.refusal).toBe('start_from_unresolved')
    expect(manager.createWorker).not.toHaveBeenCalled()
  })
})

describe('reconcileRaces', () => {
  it('marks the race ready and wakes the manager once all dispatches are terminal', async () => {
    const { deps, dispatches, notices } = await harness()
    await deps.races.create({
      raceId: 'race_1', teamId: TEAM, label: 'fix', task: 't',
      contenders: [
        { dispatchId: 'dsp_1', workerId: 'wrk_1', harnessId: 'a', label: 'a' },
        { dispatchId: 'dsp_2', workerId: 'wrk_2', harnessId: 'b', label: 'b' }
      ],
      state: 'running',
      deadlineAt: '2026-10-01T01:00:00.000Z',
      createdAt: NOW, updatedAt: NOW
    })
    await dispatches.create(dispatch({ dispatchId: 'dsp_1', workerId: 'wrk_1' }))
    await dispatches.create(dispatch({ dispatchId: 'dsp_2', workerId: 'wrk_2' }))

    await reconcileRaces(deps, TEAM)
    expect((await deps.races.get(TEAM, 'race_1'))?.state).toBe('running')
    expect(notices).toHaveLength(0)

    await dispatches.update(TEAM, 'dsp_1', { state: 'completed' }, { expect: ['accepted'] })
    await reconcileRaces(deps, TEAM)
    expect((await deps.races.get(TEAM, 'race_1'))?.state).toBe('running')

    await dispatches.update(TEAM, 'dsp_2', { state: 'failed' }, { expect: ['accepted'] })
    await reconcileRaces(deps, TEAM)
    const ready = await deps.races.get(TEAM, 'race_1')
    expect(ready?.state).toBe('ready')
    expect(ready?.notifiedAt).toBe(NOW)
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ kind: 'race_ready', teamId: TEAM })

    // Idempotent: a second reconcile does not re-notify.
    await reconcileRaces(deps, TEAM)
    expect(notices).toHaveLength(1)
  })

  it('marks the race ready past its deadline even with live dispatches', async () => {
    const nowMs = Date.parse('2026-10-01T02:00:00.000Z')
    const { deps, dispatches } = await harness({ nowMs: () => nowMs })
    await deps.races.create({
      raceId: 'race_1', teamId: TEAM, label: 'fix', task: 't',
      contenders: [{ dispatchId: 'dsp_1', workerId: 'wrk_1', harnessId: 'a', label: 'a' }],
      state: 'running',
      deadlineAt: '2026-10-01T01:00:00.000Z',
      createdAt: NOW, updatedAt: NOW
    })
    await dispatches.create(dispatch({ dispatchId: 'dsp_1', workerId: 'wrk_1' }))
    await reconcileRaces(deps, TEAM)
    expect((await deps.races.get(TEAM, 'race_1'))?.state).toBe('ready')
  })
})

describe('decideRace + discardRaceOthers', () => {
  it('only decides a ready race with a contender dispatch', async () => {
    const { deps, dispatches } = await harness()
    await deps.races.create({
      raceId: 'race_1', teamId: TEAM, label: 'fix', task: 't',
      contenders: [
        { dispatchId: 'dsp_1', workerId: 'wrk_1', harnessId: 'a', label: 'a' },
        { dispatchId: 'dsp_2', workerId: 'wrk_2', harnessId: 'b', label: 'b' }
      ],
      state: 'running',
      deadlineAt: '2026-10-01T01:00:00.000Z',
      createdAt: NOW, updatedAt: NOW
    })
    expect((await decideRace(deps, 'race_1', 'dsp_1')).refusal).toBe('race_not_ready')
    expect((await decideRace(deps, 'missing', 'dsp_1')).refusal).toBe('race_not_found')
    await dispatches.create(dispatch({ dispatchId: 'dsp_1', workerId: 'wrk_1' }))
    await dispatches.create(dispatch({ dispatchId: 'dsp_2', workerId: 'wrk_2' }))
    for (const id of ['dsp_1', 'dsp_2']) {
      await dispatches.update(TEAM, id, { state: 'completed' }, { expect: ['accepted'] })
    }
    await reconcileRaces(deps, TEAM)
    expect((await decideRace(deps, 'race_1', 'dsp_other')).refusal).toBe('winner_not_contender')
    const decided = await decideRace(deps, 'race_1', 'dsp_1')
    expect(decided.ok).toBe(true)
    expect(decided.race?.winnerDispatchId).toBe('dsp_1')
  })

  it('discards non-winner workspaces only after a confirmed decide', async () => {
    const { deps, teams } = await harness()
    await teams.ensure(TEAM)
    await teams.upsertWorker(TEAM, worker({ workerId: 'wrk_1', taskWorkspaceId: 'tws_win' }))
    await teams.upsertWorker(TEAM, worker({ workerId: 'wrk_2', taskWorkspaceId: 'tws_lose' }))
    const discarded: string[] = []
    const full = {
      ...deps,
      taskWorkspaces: {
        discard: async (workspaceId: string, confirm: boolean) => {
          expect(confirm).toBe(true)
          discarded.push(workspaceId)
          return {} as never
        }
      }
    }
    await deps.races.create({
      raceId: 'race_1', teamId: TEAM, label: 'fix', task: 't',
      contenders: [
        { dispatchId: 'dsp_1', workerId: 'wrk_1', harnessId: 'a', label: 'a' },
        { dispatchId: 'dsp_2', workerId: 'wrk_2', harnessId: 'b', label: 'b' }
      ],
      state: 'decided', winnerDispatchId: 'dsp_1',
      deadlineAt: NOW, createdAt: NOW, updatedAt: NOW
    })
    expect((await discardRaceOthers(full, 'race_1', false)).refusal).toBe('confirm_required')
    const result = await discardRaceOthers(full, 'race_1', true)
    expect(result.ok).toBe(true)
    expect(discarded).toEqual(['tws_lose'])
    expect(result.discarded).toEqual([
      { dispatchId: 'dsp_2', workspaceId: 'tws_lose', ok: true }
    ])
  })
})

describe('recommendRace', () => {
  it('writes notes only on the manager\'s own team races', async () => {
    const { deps } = await harness()
    await deps.races.create({
      raceId: 'race_1', teamId: TEAM, label: 'fix', task: 't',
      contenders: [{ harnessId: 'a', label: 'a' }, { harnessId: 'b', label: 'b' }],
      state: 'ready', deadlineAt: NOW, createdAt: NOW, updatedAt: NOW
    })
    expect((await recommendRace(deps, CTX, { raceId: 'race_1', notes: 'b is cleaner' })).ok).toBe(true)
    expect((await deps.races.get(TEAM, 'race_1'))?.notes).toBe('b is cleaner')
    // A different manager thread id cannot touch this team's race.
    const other = await recommendRace(
      deps, { ...CTX, threadId: 'thr_other' }, { raceId: 'race_1', notes: 'x' }
    )
    expect(other.ok).toBe(false)
    expect(other.refusal).toBe('race_not_found')
    expect((await recommendRace(deps, CTX, { raceId: 'race_1' })).refusal).toBe('invalid_input')
  })
})

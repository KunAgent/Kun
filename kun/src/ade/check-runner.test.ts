import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import type { ArtifactStore, StoredArtifactMeta } from '../artifacts/artifact-store.js'
import type { DispatchRecord } from '../contracts/ade.js'
import type { TaskWorkspaceRecord } from '../contracts/task-workspace.js'
import type { TeamRecord } from '../contracts/ade.js'
import { runWorkspaceChecks, type WorkspaceCheckRunnerDeps } from './check-runner.js'

function fakeChild(code = 0, out = ''): ChildProcess {
  const child = new EventEmitter() as ChildProcess
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  Object.assign(child, { stdout, stderr })
  setTimeout(() => {
    if (out) stdout.emit('data', Buffer.from(out))
    child.emit('close', code)
  }, 1)
  return child
}

function team(): TeamRecord {
  return {
    teamId: 'team_1',
    managerThreadId: 'thr_mgr',
    status: 'active',
    workers: [{
      workerId: 'wrk_1',
      label: 'impl',
      control: 'manager',
      state: 'active',
      taskWorkspaceId: 'tws_1'
    }],
    createdAt: 't',
    updatedAt: 't'
  } as TeamRecord
}

function workspace(state: TaskWorkspaceRecord['state'] = 'ready'): TaskWorkspaceRecord {
  return {
    workspaceId: 'tws_1',
    ownerThreadId: 'thr_mgr',
    unitId: 'wrk_1',
    isolation: 'worktree',
    sourceRoot: '/repo/a',
    path: '/repo/a/.worktrees/tws_1',
    startFrom: { kind: 'current-head' },
    state,
    setup: { status: 'succeeded' },
    changedFiles: [],
    createdAt: 't',
    updatedAt: 't'
  } as TaskWorkspaceRecord
}

function dispatch(over: Partial<DispatchRecord> = {}): DispatchRecord {
  return {
    dispatchId: 'dsp_1',
    teamId: 'team_1',
    workerId: 'wrk_1',
    title: 't',
    state: 'completed',
    createdAt: 't',
    updatedAt: 't',
    ...over
  } as DispatchRecord
}

function fakeArtifacts() {
  const contents = new Map<string, string>()
  let n = 0
  const store = {
    put: async (input: { content: string }) => {
      const id = `art_${++n}`
      contents.set(id, input.content)
      return {
        meta: { id, byteSize: input.content.length, lineCount: 0, createdAt: '' } as StoredArtifactMeta,
        summary: {},
        deduped: false
      }
    }
  } as unknown as Pick<ArtifactStore, 'put'>
  return { store, contents }
}

function harness(over: Partial<WorkspaceCheckRunnerDeps> & {
  record?: TeamRecord | null
  workspace?: TaskWorkspaceRecord | null
  dispatchRows?: DispatchRecord[]
} = {}) {
  const { record, workspace: ws, dispatchRows: rows, ...rest } = over
  const dispatchRows = [...(rows ?? [dispatch()])]
  const artifacts = fakeArtifacts()
  const deps: WorkspaceCheckRunnerDeps = {
    teams: { get: async () => record === undefined ? team() : record },
    dispatches: {
      list: async () => dispatchRows,
      mutate: async (_teamId: string, dispatchId: string, fn: (d: DispatchRecord) => Partial<DispatchRecord> | null) => {
        const index = dispatchRows.findIndex((d) => d.dispatchId === dispatchId)
        if (index < 0) return null
        const patch = fn(dispatchRows[index])
        if (patch) dispatchRows[index] = { ...dispatchRows[index], ...patch }
        return dispatchRows[index]
      }
    },
    taskWorkspaces: {
      get: () => ws === undefined ? workspace() : ws
    } as WorkspaceCheckRunnerDeps['taskWorkspaces'],
    approvedChecks: async () => [
      { name: 'typecheck', command: 'bun', args: ['run', 'tsc'], timeoutMs: 5_000 },
      { name: 'lint', command: 'bun', args: ['run', 'lint'], timeoutMs: 5_000 }
    ],
    artifacts: artifacts.store,
    spawn: (async () => fakeChild(0, 'ok\n')) as never,
    nowIso: () => 't',
    ...rest
  }
  return { deps, dispatchRows, artifacts }
}

describe('runWorkspaceChecks', () => {
  it('runs approved checks in the workspace and merges host results into the verdict', async () => {
    const { deps, dispatchRows, artifacts } = harness()
    const result = await runWorkspaceChecks(deps, {
      teamId: 'team_1', workerId: 'wrk_1'
    })
    expect(result.ok).toBe(true)
    expect(result.checks?.map((c) => [c.name, c.status, c.source])).toEqual([
      ['typecheck', 'passed', 'host'],
      ['lint', 'passed', 'host']
    ])
    expect(dispatchRows[0]?.verdict?.checks).toHaveLength(2)
    expect(dispatchRows[0]?.verdict?.status).toBe('pending')
    const log = artifacts.contents.get(result.logArtifactId ?? '')
    expect(log).toContain('$ bun run tsc')
  })

  it('marks a nonzero exit as failed and reports the count', async () => {
    const { deps } = harness({
      spawn: (async (command: string) => fakeChild(command === 'bun' ? 1 : 0)) as never
    })
    const result = await runWorkspaceChecks(deps, { teamId: 'team_1', workerId: 'wrk_1' })
    expect(result.ok).toBe(true)
    expect(result.checks?.every((c) => c.status === 'failed')).toBe(true)
    expect(result.userReport).toContain('2 failed')
  })

  it('reruns replace same-name host rows but keep worker checks', async () => {
    const existing = dispatch({
      verdict: {
        status: 'pending',
        checks: [
          { name: 'typecheck', status: 'failed', source: 'host' },
          { name: 'selftest', status: 'passed', source: 'worker' }
        ]
      } as DispatchRecord['verdict']
    })
    const { deps, dispatchRows } = harness({ dispatchRows: [existing] })
    await runWorkspaceChecks(deps, {
      teamId: 'team_1', workerId: 'wrk_1', names: ['typecheck']
    })
    expect(dispatchRows[0]?.verdict?.checks).toEqual([
      { name: 'selftest', status: 'passed', source: 'worker' },
      expect.objectContaining({ name: 'typecheck', status: 'passed', source: 'host' })
    ])
  })

  it('refuses when the workspace is not ready or checks are unapproved', async () => {
    const notReady = await runWorkspaceChecks(
      harness({ workspace: workspace('creating') }).deps,
      { teamId: 'team_1', workerId: 'wrk_1' }
    )
    expect(notReady).toMatchObject({ ok: false, refusal: 'workspace_not_ready' })
    const none = await runWorkspaceChecks(
      harness({ approvedChecks: async () => [] }).deps,
      { teamId: 'team_1', workerId: 'wrk_1' }
    )
    expect(none).toMatchObject({ ok: false, refusal: 'no_approved_checks' })
  })

  it('refuses unknown workers and workers without a workspace', async () => {
    const missing = await runWorkspaceChecks(
      harness().deps, { teamId: 'team_1', workerId: 'wrk_x' }
    )
    expect(missing).toMatchObject({ ok: false, refusal: 'worker_not_found' })
    const noSpace = await runWorkspaceChecks(
      harness({ workspace: null }).deps,
      { teamId: 'team_1', workerId: 'wrk_1' }
    )
    expect(noSpace).toMatchObject({ ok: false, refusal: 'no_workspace' })
  })
})

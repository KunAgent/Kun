import { describe, expect, it } from 'vitest'
import type { TaskWorkspaceRecord } from '../contracts/task-workspace.js'
import {
  ChangeRequestService,
  detectForgeFromRemote,
  type ChangeRequestExec
} from './change-request-service.js'

const record = (over: Partial<TaskWorkspaceRecord> = {}): TaskWorkspaceRecord => ({
  workspaceId: 'tws_pr000001',
  ownerThreadId: 'thr_manager',
  unitId: 'thr_w1',
  label: 'Add attribution ledger',
  isolation: 'worktree',
  sourceRoot: '/repo',
  path: '/repo/.worktrees/tws_pr000001',
  startFrom: { kind: 'default-branch' },
  branch: 'kun/task-add-attribution-000001',
  targetBranch: 'main',
  state: 'captured',
  setup: { status: 'succeeded' },
  changedFiles: ['src/a.ts'],
  createdAt: 't',
  updatedAt: 't',
  ...over
})

type Step = { bin: string; args: string[]; cwd: string }

/** Exec fake: each entry matches by `bin + args[0..n]` prefix. */
function execFake(map: Record<string, string | Error>) {
  const calls: Step[] = []
  const exec: ChangeRequestExec = async (bin, args, cwd) => {
    calls.push({ bin, args, cwd })
    const key = `${bin} ${args.join(' ')}`
    const hit = Object.keys(map).find((prefix) => key.startsWith(prefix))
    if (!hit) throw Object.assign(new Error(`unexpected: ${key}`), { code: 'ENOENT' })
    const value = map[hit]!
    if (value instanceof Error) throw value
    return { stdout: value, stderr: '' }
  }
  return { exec, calls }
}

function serviceFor(exec: ChangeRequestExec, over: {
  record?: TaskWorkspaceRecord
  setCalls?: Array<TaskWorkspaceRecord['changeRequest']>
  teams?: unknown
  dispatches?: unknown
} = {}) {
  const stored: TaskWorkspaceRecord[] = []
  const svc = new ChangeRequestService({
    taskWorkspaces: {
      get: () => over.record ?? record(),
      setChangeRequest: (_id: string, changeRequest: TaskWorkspaceRecord['changeRequest']) => {
        over.setCalls?.push(changeRequest)
        return over.record ?? record()
      }
    } as never,
    teams: over.teams as never,
    dispatches: over.dispatches as never,
    exec,
    nowIso: () => '2026-02-01T00:00:00Z'
  })
  return { svc, stored }
}

describe('detectForgeFromRemote', () => {
  it('maps ssh/https remote URLs to forge kinds', () => {
    expect(detectForgeFromRemote('git@github.com:org/repo.git')).toBe('github')
    expect(detectForgeFromRemote('https://github.com/org/repo.git')).toBe('github')
    expect(detectForgeFromRemote('git@gitlab.com:org/repo.git')).toBe('gitlab')
    expect(detectForgeFromRemote('https://git.example.com/r.git')).toBe('other')
    expect(detectForgeFromRemote(null)).toBeNull()
  })
})

describe('ChangeRequestService.status', () => {
  it('reports gh-not-authed and keeps the persisted snapshot', async () => {
    const { exec } = execFake({
      'git config --get remote.origin.url': 'git@github.com:org/repo.git\n',
      'gh auth status': new Error('not logged in')
    })
    const { svc, stored } = serviceFor(exec, {
      record: record({
        changeRequest: {
          provider: 'github', number: 12, url: 'https://github.com/org/repo/pull/12',
          title: 'T', state: 'open', checks: [], checkedAt: 't0'
        }
      })
    })
    const status = await svc.status('tws_pr000001')
    expect(status).toMatchObject({
      available: false, forge: 'github', reason: 'gh-not-authed',
      request: { number: 12 }
    })
    void stored
  })

  it('refreshes an open PR and normalizes the check rollup', async () => {
    const { exec } = execFake({
      'git config --get remote.origin.url': 'https://github.com/org/repo.git\n',
      'gh auth status': 'ok\n',
      'gh pr view 12': JSON.stringify({
        number: 12, state: 'OPEN', title: 'Add ledger', url: 'https://github.com/org/repo/pull/12',
        isDraft: false, baseRefName: 'main', headRefName: 'kun/task',
        statusCheckRollup: [
          {
            __typename: 'CheckRun', name: 'unit', status: 'COMPLETED',
            conclusion: 'SUCCESS', startedAt: '2026-02-01T00:00:00Z',
            completedAt: '2026-02-01T00:02:30Z', detailsUrl: 'https://ci/1'
          },
          {
            __typename: 'StatusContext', context: 'cla', state: 'PENDING',
            targetUrl: 'https://cla/1'
          }
        ]
      })
    })
    const persisted: unknown[] = []
    const { svc } = serviceFor(exec, {
      record: record({
        changeRequest: {
          provider: 'github', number: 12, url: 'u', title: 'old',
          state: 'open', checks: [], checkedAt: 't0'
        }
      }),
      setCalls: persisted as never
    })
    const status = await svc.status('tws_pr000001')
    expect(status.request).toMatchObject({
      number: 12, state: 'open', title: 'Add ledger', base: 'main', head: 'kun/task',
      checks: [
        { name: 'unit', status: 'completed', conclusion: 'success', durationMs: 150_000 },
        { name: 'cla', status: 'pending' }
      ],
      checkedAt: '2026-02-01T00:00:00Z'
    })
    expect(persisted).toHaveLength(1)
  })

  it('reports forge-not-supported for gitlab remotes', async () => {
    const { exec } = execFake({
      'git config --get remote.origin.url': 'git@gitlab.com:org/repo.git\n'
    })
    const { svc } = serviceFor(exec)
    expect(await svc.status('tws_pr000001')).toMatchObject({
      available: false, forge: 'gitlab', reason: 'forge-not-supported'
    })
  })
})

describe('ChangeRequestService.create', () => {
  const baseExecMap = {
    'git config --get remote.origin.url': 'https://github.com/org/repo.git\n',
    'gh auth status': 'ok\n',
    'git push -u origin kun/task-add-attribution-000001': 'ok\n',
    'gh pr create': 'https://github.com/org/repo/pull/34\n'
  }

  it('pushes the branch, creates the PR, and persists the snapshot', async () => {
    const { exec, calls } = execFake(baseExecMap)
    const persisted: unknown[] = []
    const { svc } = serviceFor(exec, { setCalls: persisted as never })
    const result = await svc.create('tws_pr000001', { title: 'My PR' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.request).toMatchObject({
        provider: 'github', number: 34,
        url: 'https://github.com/org/repo/pull/34',
        title: 'My PR', state: 'open', base: 'main'
      })
    }
    expect(persisted).toHaveLength(1)
    // Push ran inside the worktree, never the source checkout.
    expect(calls.find((c) => c.args[0] === 'push')?.cwd).toBe('/repo/.worktrees/tws_pr000001')
  })

  it('refuses when gh is not authenticated', async () => {
    const { exec } = execFake({
      'git config --get remote.origin.url': 'https://github.com/org/repo.git\n',
      'gh auth status': new Error('not logged in')
    })
    const { svc } = serviceFor(exec)
    const result = await svc.create('tws_pr000001', {})
    expect(result).toMatchObject({ ok: false, reason: 'gh-not-authed' })
  })

  it('is idempotent when a request already exists', async () => {
    const { exec, calls } = execFake(baseExecMap)
    const { svc } = serviceFor(exec, {
      record: record({
        changeRequest: {
          provider: 'github', number: 9, url: 'u', title: 't',
          state: 'open', checks: [], checkedAt: 't0'
        }
      })
    })
    const result = await svc.create('tws_pr000001', {})
    expect(result).toMatchObject({ ok: true, request: { number: 9 } })
    expect(calls).toHaveLength(0)
  })
})

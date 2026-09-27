import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceIntegrations } from './workspace-integrate.js'
import {
  managerCtx,
  makeHarness,
  setupAdeStores,
  teardownAdeStores,
  type AdeStores
} from './manager-controls-test-support.js'
import type { ApprovalRequest } from '../domain/approval.js'
import type { TaskWorkspaceRecord } from '../contracts/task-workspace.js'

let stores: AdeStores | undefined

function workspace(overrides: Partial<TaskWorkspaceRecord> = {}): TaskWorkspaceRecord {
  return {
    workspaceId: 'tws_1',
    ownerThreadId: 'thr_mgr',
    unitId: 'wrk_1',
    label: 'fix login',
    isolation: 'worktree',
    sourceRoot: '/repo',
    repositoryRoot: '/repo',
    path: '/repo/.worktrees/fix-login',
    startFrom: { kind: 'default-branch' },
    baseRevision: 'a'.repeat(40),
    branch: 'kun/fix-login-tws_1',
    targetBranch: 'main',
    state: 'ready',
    setup: { status: 'skipped' },
    changedFiles: ['src/a.ts'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  } as TaskWorkspaceRecord
}

async function harness(opts: {
  integrate?: (id: string, mode: string) => Promise<unknown>
  list?: () => TaskWorkspaceRecord[]
  noService?: boolean
} = {}) {
  stores = await setupAdeStores()
  const { deps } = makeHarness(stores)
  deps.taskWorkspaces = opts.noService ? undefined : ({
    get: vi.fn((id: string) => (id === 'tws_1' ? workspace() : undefined)),
    list: vi.fn(opts.list ?? (() => [workspace()])),
    integrate: vi.fn(opts.integrate ?? (async () => ({
      outcome: 'applied',
      record: workspace()
    })))
  } as never)
  return new WorkspaceIntegrations(deps)
}

afterEach(async () => {
  if (stores) await teardownAdeStores(stores)
  stores = undefined
})

describe('WorkspaceIntegrations.integrate', () => {
  it('defers to the user when the manager turn is unattended', async () => {
    const integrations = await harness()
    const awaitApproval = vi.fn(async () => 'allow' as const)
    const result = await integrations.integrate(
      managerCtx({ authority: { kunPermissionMode: 'full-access', interactive: false }, awaitApproval }),
      { workspaceId: 'tws_1' }
    )
    expect(result.ok).toBe(false)
    expect(result.refusal).toBe('pending_user')
    expect(result.userReport).toMatch(/pending your confirmation/)
    expect(awaitApproval).not.toHaveBeenCalled()
  })

  it('asks the user with a file envelope targeting the source checkout', async () => {
    const integrations = await harness()
    const requests: ApprovalRequest[] = []
    const awaitApproval = vi.fn(async (request: ApprovalRequest) => {
      requests.push(request)
      return 'allow' as const
    })
    const result = await integrations.integrate(
      managerCtx({ authority: { kunPermissionMode: 'full-access', interactive: true }, awaitApproval }),
      { workspaceId: 'tws_1', mode: 'merge-branch' }
    )
    expect(result.ok).toBe(true)
    expect(result.outcome).toBe('applied')
    expect(requests).toHaveLength(1)
    const action = requests[0]!.action
    expect(action?.kind).toBe('file')
    expect(action?.targets).toEqual([{ kind: 'file', value: '/repo' }])
    expect(action?.workspace).toBe('/repo')
    expect(action?.reviewerRequirement).toBe('user')
    expect(action?.requiresUserDecision).toBe(true)
    expect((action?.arguments as { mode?: string })?.mode).toBe('merge-branch')
  })

  it('does not integrate when the user declines', async () => {
    const integrate = vi.fn(async () => ({ outcome: 'applied', record: workspace() }))
    const integrations = await harness({ integrate })
    const result = await integrations.integrate(
      managerCtx({
        authority: { kunPermissionMode: 'full-access', interactive: true },
        awaitApproval: vi.fn(async () => 'deny' as const)
      }),
      { workspaceId: 'tws_1' }
    )
    expect(result.ok).toBe(false)
    expect(result.refusal).toBe('user_declined')
    expect(integrate).not.toHaveBeenCalled()
  })

  it('propagates needs_human outcomes with recovery steps', async () => {
    const integrations = await harness({
      integrate: async () => ({
        outcome: 'needs_human',
        reason: 'repository HEAD changed since worktree allocation',
        recovery: ['Review the source checkout', 'The worktree is preserved'],
        record: workspace()
      })
    })
    const result = await integrations.integrate(
      managerCtx({
        authority: { kunPermissionMode: 'full-access', interactive: true },
        awaitApproval: vi.fn(async () => 'allow' as const)
      }),
      { workspaceId: 'tws_1' }
    )
    expect(result.ok).toBe(false)
    expect(result.outcome).toBe('needs_human')
    expect(result.reason).toMatch(/HEAD changed/)
    expect(result.recovery).toHaveLength(2)
    expect(result.userReport).toMatch(/needs you/)
  })

  it('resolves the single live workspace when no id is given', async () => {
    const integrate = vi.fn(async () => ({ outcome: 'merged', record: workspace() }))
    const integrations = await harness({ integrate })
    const result = await integrations.integrate(
      managerCtx({
        authority: { kunPermissionMode: 'full-access', interactive: true },
        awaitApproval: vi.fn(async () => 'allow' as const)
      }),
      {}
    )
    expect(result.ok).toBe(true)
    expect(result.workspaceId).toBe('tws_1')
    expect(integrate).toHaveBeenCalledWith('tws_1', 'apply-patch')
  })

  it('refuses ambiguous resolution and foreign workspace ids', async () => {
    const integrations = await harness({
      list: () => [
        workspace(),
        workspace({ workspaceId: 'tws_2' } as Partial<TaskWorkspaceRecord>)
      ]
    })
    const ctx = managerCtx({
      authority: { kunPermissionMode: 'full-access', interactive: true },
      awaitApproval: vi.fn(async () => 'allow' as const)
    })
    const ambiguous = await integrations.integrate(ctx, {})
    expect(ambiguous.refusal).toBe('workspace_ambiguous')
    const foreign = await integrations.integrate(ctx, { workspaceId: 'tws_elsewhere' })
    expect(foreign.refusal).toBe('workspace_not_found')
  })

  it('refuses cleanly when the workspace service is absent', async () => {
    const integrations = await harness({ noService: true })
    const result = await integrations.integrate(
      managerCtx({ authority: { kunPermissionMode: 'full-access', interactive: true } }),
      {}
    )
    expect(result.refusal).toBe('unavailable')
  })
})

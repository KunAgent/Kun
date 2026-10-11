import { describe, expect, it } from 'vitest'
import type { DispatchRecord, WorkerRecord } from '../contracts/ade.js'
import type { TaskWorkspaceRecord } from '../contracts/task-workspace.js'
import { renderAssignment } from './assignment-template.js'
import { reportLanguage, reportWorkerCreated, reportWorkerCreateBatch } from './user-report.js'

const NOW = '2026-09-26T00:00:00.000Z'

function dispatch(overrides: Partial<DispatchRecord> = {}): DispatchRecord {
  return {
    dispatchId: 'dsp_1',
    teamId: 'thr_mgr',
    workerId: 'wrk_1',
    parentTurnId: 'turn_mgr_1',
    title: 'fix login',
    task: 'repair the login redirect',
    mode: 'queue',
    state: 'pending',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}

function worker(overrides: Partial<WorkerRecord> = {}): WorkerRecord {
  return {
    workerId: 'wrk_1',
    label: 'implementer',
    route: { harnessId: 'kun', model: 'model-x', credentialMode: 'provider' },
    permissionMode: 'default',
    lifecycle: 'persistent',
    securitySnapshot: { sandboxRoot: '/tmp/ws', memoryEnabled: false },
    control: 'manager',
    state: 'active',
    createdAt: NOW,
    ...overrides
  }
}

function workspace(): TaskWorkspaceRecord {
  return {
    workspaceId: 'tws_1',
    ownerThreadId: 'thr_mgr',
    unitId: 'wrk_1',
    label: 'fix login',
    isolation: 'worktree',
    sourceRoot: '/repo',
    repositoryRoot: '/repo',
    path: '/repo/.worktrees/fix-login',
    branch: 'ade/fix-login',
    startFrom: { kind: 'default-branch' },
    state: 'ready',
    setup: { status: 'skipped', steps: [] },
    changedFiles: [],
    createdAt: NOW,
    updatedAt: NOW
  } as TaskWorkspaceRecord
}

describe('renderAssignment', () => {
  it('renders the kun_assignment wrapper with task, workspace and collaboration', () => {
    const text = renderAssignment({ dispatch: dispatch(), worker: worker(), workspace: workspace() })
    expect(text).toContain('<kun_assignment dispatch="dsp_1" worker="wrk_1" from="Manager">')
    expect(text).toContain('## Task\nrepair the login redirect')
    expect(text).toContain('## Workspace')
    expect(text).toContain('/repo/.worktrees/fix-login')
    expect(text).toContain('Branch: ade/fix-login')
    expect(text).toContain('Dependency setup')
    expect(text).toContain('## Collaboration')
    for (const tool of ['ask_manager', 'report_progress', 'submit_result', 'read_manager_context']) {
      expect(text).toContain(tool)
    }
    expect(text.trimEnd().endsWith('</kun_assignment>')).toBe(true)
  })

  it('renders context files/links/constraints when present', () => {
    const text = renderAssignment({
      dispatch: dispatch({
        context: {
          files: ['src/login.ts'],
          links: ['https://example.test/spec'],
          constraints: ['keep session cookies'],
          notes: 'see ticket 42'
        }
      }),
      worker: worker(),
      workspace: null
    })
    expect(text).toContain('src/login.ts')
    expect(text).toContain('https://example.test/spec')
    expect(text).toContain('keep session cookies')
    expect(text).toContain('see ticket 42')
    expect(text).not.toContain('## Workspace')
  })

  it('renders the Chinese template for zh language', () => {
    const text = renderAssignment({
      dispatch: dispatch(), worker: worker(), workspace: workspace(), language: 'zh'
    })
    expect(text).toContain('from="总管"')
    expect(text).toContain('## 任务')
    expect(text).toContain('## 工作区')
    expect(text).toContain('## 协作方式')
    expect(text).toContain('ask_manager')
  })

  it('points external-harness workers at the Kun MCP bridge', () => {
    const bridged = renderAssignment({
      dispatch: dispatch(),
      worker: worker({ route: { harnessId: 'claude-code', model: 'claude-sonnet-4-6', credentialMode: 'kun-gateway' } }),
      workspace: null
    })
    expect(bridged).toContain('MCP')
    const native = renderAssignment({ dispatch: dispatch(), worker: worker(), workspace: null })
    expect(native).not.toContain('MCP')
  })
})

describe('user reports', () => {
  it('selects zh for zh locales and falls back to en', () => {
    expect(reportLanguage('zh-CN')).toBe('zh')
    expect(reportLanguage('zh-Hant')).toBe('zh')
    expect(reportLanguage('en-US')).toBe('en')
    expect(reportLanguage('fr')).toBe('en')
    expect(reportLanguage(undefined)).toBe('en')
  })

  it('reports dispatch, workspace-pending and worker-busy states', () => {
    const base = {
      worker: worker(),
      dispatch: dispatch(),
      permission: { downgraded: false },
      harnessLabel: 'Kun'
    }
    expect(reportWorkerCreated(base, 'en')).toContain('dispatched')
    expect(reportWorkerCreated({ ...base, pendingReason: 'workspace' }, 'en'))
      .toContain('workspace is being prepared')
    expect(reportWorkerCreated({ ...base, pendingReason: 'worker-busy' }, 'en'))
      .toContain('worker is busy')
    expect(reportWorkerCreated({ ...base, pendingReason: 'workspace' }, 'zh'))
      .toContain('工作区正在准备')
  })

  it('reports the permission downgrade with requested and effective modes', () => {
    const text = reportWorkerCreated({
      worker: worker({ permissionMode: 'approve-for-me' }),
      dispatch: dispatch(),
      permission: { downgraded: true, requestedMode: { id: 'full-access', label: 'Full', kunPermissionMode: 'full-access' } },
      harnessLabel: 'Kun'
    }, 'en')
    expect(text).toContain('full-access')
    expect(text).toContain('approve-for-me')
  })

  it('aggregates batches and states clearly when nothing was created', () => {
    expect(reportWorkerCreateBatch({ created: 2, failed: 1, skipped: 1, dispatched: 2 }, 'en'))
      .toBe('Created 2 worker(s), 2 dispatched, 1 failed, 1 skipped.')
    expect(reportWorkerCreateBatch({ created: 0, failed: 2, skipped: 0, dispatched: 0 }, 'en'))
      .toContain('No workers were created')
    expect(reportWorkerCreateBatch({ created: 0, failed: 2, skipped: 0, dispatched: 0 }, 'zh'))
      .toContain('没有创建任何 worker')
  })
})

import { describe, expect, it } from 'vitest'
import { normalizeAppSettings, type AppSettingsV1 } from '../../shared/app-settings'
import {
  applyPortableSettingsMigration,
  assertNoImportedTrustOrSecrets,
  importDisabledAutomations,
  importedWorkspaceTrustResets,
  restoreSemanticRendererState
} from './application-state-migration'

function settings(overrides: Partial<AppSettingsV1> = {}): AppSettingsV1 {
  const base = normalizeAppSettings({} as AppSettingsV1)
  return normalizeAppSettings({ ...base, ...overrides })
}

describe('application state migration', () => {
  it('applies only portable preferences while preserving local roots, runtime, credentials, and terminal state', () => {
    const current = settings({
      workspaceRoot: '/Users/bob/current',
      conversationWorkspaceRoot: '/Users/bob/conversations'
    })
    const migrated = applyPortableSettingsMigration(current, {
      locale: 'zh',
      theme: 'dark',
      gitBranchPrefix: 'migrated/',
      notifications: { turnComplete: false },
      workspaceRoot: 'C:\\Users\\Alice\\Project',
      conversationWorkspaceRoot: 'C:\\Users\\Alice\\Chats',
      provider: { providers: [] },
      agents: { kun: { dataDir: 'C:\\unsafe' } },
      terminal: { shell: 'cmd.exe' },
      log: { enabled: false }
    })

    expect(migrated).toMatchObject({ locale: 'zh', theme: 'dark', gitBranchPrefix: 'migrated/' })
    expect(migrated.notifications.turnComplete).toBe(false)
    expect(migrated.workspaceRoot).toBe(current.workspaceRoot)
    expect(migrated.conversationWorkspaceRoot).toBe(current.conversationWorkspaceRoot)
    expect(migrated.provider).toEqual(current.provider)
    expect(migrated.agents).toEqual(current.agents)
    expect(migrated.terminal).toEqual(current.terminal)
    expect(migrated.log).toEqual(current.log)
  })

  it('rebinds schema-declared renderer references without rewriting prose', () => {
    const restored = restoreSemanticRendererState({
      state: {
        design: [{
          workspaceRoot: 'C:\\Users\\Alice\\Project',
          threadId: 'thread-old',
          description: 'Keep C:\\Users\\Alice\\Project and thread-old in prose.'
        }],
        write: [{ workspaceRoot: 'D:\\Missing', threadId: 'not-a-declared-write-thread-field' }],
        unknownCache: { path: 'C:\\Users\\Alice\\Project' }
      },
      workspacePathMap: { 'C:\\Users\\Alice\\Project': '/Users/bob/Project' },
      threadIdMap: { 'thread-old': 'thread-new' },
      sourcePlatform: 'windows'
    })

    expect(restored.design[0]).toEqual({
      workspaceRoot: '/Users/bob/Project',
      threadId: 'thread-new',
      description: 'Keep C:\\Users\\Alice\\Project and thread-old in prose.'
    })
    expect(restored.write[0]).toEqual({ workspaceRoot: 'D:\\Missing', threadId: 'not-a-declared-write-thread-field' })
    expect(restored.unresolvedReferences).toEqual([
      { pointer: '/write/0/workspaceRoot', originalValue: 'D:\\Missing' },
      { pointer: '/write/0/threadId', originalValue: 'not-a-declared-write-thread-field' }
    ])
    expect(restored).not.toHaveProperty('unknownCache')
  })

  it('imports workflow and schedule definitions with collision-free ids and every activation binding disabled', () => {
    const nowIso = '2026-07-15T00:00:00.000Z'
    const base = settings()
    const current = normalizeAppSettings({
      ...base,
      workflow: {
        ...base.workflow,
        workflows: [{ id: 'same-id', name: 'Existing', enabled: true }]
      },
      schedule: {
        ...base.schedule,
        tasks: [{ id: 'same-id', title: 'Existing task', enabled: true }]
      }
    } as AppSettingsV1)
    const migrated = importDisabledAutomations({
      current,
      nowIso,
      workspacePathMap: { 'C:\\Users\\Alice\\Project': '/Users/bob/Project' },
      automations: {
        workflows: [{
          id: 'same-id',
          name: 'Imported workflow',
          enabled: true,
          callableByAgent: true,
          env: [{ key: 'SAFE_VALUE', value: 'source', type: 'string' }],
          runs: [{ id: 'old-run', status: 'success' }]
        }],
        schedules: [{
          id: 'same-id',
          title: 'Imported schedule',
          enabled: true,
          workspaceRoot: 'C:\\Users\\Alice\\Project',
          providerId: 'source-provider',
          clawChannelId: 'source-channel',
          lastThreadId: 'source-thread',
          prompt: 'Review the imported project'
        }]
      }
    })

    const workflow = migrated.workflow.workflows.at(-1)!
    expect(workflow).toMatchObject({
      id: 'same-id-imported-1',
      name: 'Imported workflow',
      enabled: false,
      callableByAgent: false,
      env: [],
      runs: [],
      lastStatus: 'idle'
    })
    const schedule = migrated.schedule.tasks.at(-1)!
    expect(schedule).toMatchObject({
      id: 'same-id-imported-1',
      enabled: false,
      workspaceRoot: '/Users/bob/Project',
      providerId: '',
      clawChannelId: '',
      lastThreadId: '',
      lastStatus: 'idle'
    })
  })

  it('marks imported workspaces untrusted with all automatic execution surfaces disabled', () => {
    expect(importedWorkspaceTrustResets(['/workspace/a', '/workspace/a', ' /workspace/b '])).toEqual([
      {
        workspaceRoot: '/workspace/a',
        trusted: false,
        disabledCapabilities: [
          'hooks', 'commands', 'extensions', 'schedules', 'workflows', 'connect-channels', 'external-actions'
        ]
      },
      {
        workspaceRoot: '/workspace/b',
        trusted: false,
        disabledCapabilities: [
          'hooks', 'commands', 'extensions', 'schedules', 'workflows', 'connect-channels', 'external-actions'
        ]
      }
    ])
  })

  it.each([
    { nested: { apiKey: 'secret' } },
    { oauth: { refreshToken: 'secret' } },
    { pendingApprovals: ['allow'] },
    { trustedWorkspaceRoots: ['/unsafe'] },
    { permissionGrants: [{ tool: 'shell' }] }
  ])('hard-denies imported secrets, approvals, and trust grants: %j', (value) => {
    expect(() => assertNoImportedTrustOrSecrets(value)).toThrow(/forbidden trust or secret fields/)
  })
})

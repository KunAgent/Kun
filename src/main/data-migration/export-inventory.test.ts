import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  defaultClawSettings,
  defaultDesignSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultTerminalSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import {
  assertMigrationOutputOutsideWorkspaces,
  discoverDataMigrationWorkspaces,
  inventoryDataMigrationFiles,
  portableSettingsForMigration,
  sanitizedAutomationsForMigration
} from './export-inventory'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function settings(workspaceRoot: string, nestedRoot = workspaceRoot): AppSettingsV1 {
  const write = defaultWriteSettings()
  const design = defaultDesignSettings()
  const schedule = defaultScheduleSettings()
  const workflow = defaultWorkflowSettings()
  return {
    version: 1,
    locale: 'en',
    theme: 'dark',
    uiFontScale: 1,
    chatContentMaxWidthPx: 896,
    provider: { ...defaultModelProviderSettings(), apiKey: 'must-not-export' },
    agents: { kun: { ...defaultKunRuntimeSettings(), runtimeToken: 'must-not-export' } },
    workspaceRoot,
    conversationWorkspaceRoot: workspaceRoot,
    log: { enabled: true, retentionDays: 7 },
    checkpointCleanup: { enabled: true, intervalDays: 3 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: { ...write, defaultWorkspaceRoot: nestedRoot, activeWorkspaceRoot: nestedRoot, workspaces: [nestedRoot] },
    claw: { ...defaultClawSettings(), im: { ...defaultClawSettings().im, workspaceRoot } },
    schedule: { ...schedule, defaultWorkspaceRoot: workspaceRoot },
    workflow: { ...workflow, defaultWorkspaceRoot: workspaceRoot },
    design: { ...design, defaultWorkspaceRoot: workspaceRoot },
    terminal: defaultTerminalSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: 'portable prompt',
    disabledSkillIds: ['example']
  }
}

describe('data migration export inventory', () => {
  it('deduplicates Code/Design roots and records nested Write ownership', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-migration-inventory-'))
    roots.push(root)
    const project = join(root, 'project')
    const nested = join(project, 'books', 'novel')
    await mkdir(nested, { recursive: true })
    const inventory = await discoverDataMigrationWorkspaces({
      settings: settings(project, nested),
      runtimeThreads: [{ id: 'thr_one', workspace: project }]
    })
    expect(inventory).toHaveLength(2)
    const parent = inventory.find((entry) => entry.capabilities.includes('design'))!
    const child = inventory.find((entry) => entry.capabilities.includes('write'))!
    expect(parent.capabilities).toEqual(['code', 'design'])
    expect(parent.relatedThreadIds).toEqual(['thr_one'])
    expect(child.capabilities).toEqual(['write'])
    expect(child.nestedUnderWorkspaceId).toBe(parent.workspaceId)
  })

  it('scans safely, applies presets, protects portable artifacts, and never follows links', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-migration-files-'))
    roots.push(root)
    const project = join(root, 'project')
    const outside = join(root, 'outside')
    await mkdir(join(project, '.git'), { recursive: true })
    await mkdir(join(project, 'node_modules'), { recursive: true })
    await mkdir(join(project, '.kun-design', 'node_modules'), { recursive: true })
    await mkdir(outside, { recursive: true })
    await writeFile(join(project, 'README.md'), 'hello')
    await writeFile(join(project, '.env'), 'TOKEN=secret')
    await writeFile(join(project, '.git', 'HEAD'), 'main')
    await writeFile(join(project, 'node_modules', 'package.js'), 'generated')
    await writeFile(join(project, '.kun-design', 'node_modules', 'canvas.json'), '{}')
    await writeFile(join(outside, 'secret.txt'), 'outside')
    await symlink(outside, join(project, 'external-link'))
    const [workspace] = await discoverDataMigrationWorkspaces({ settings: settings(project) })
    const result = await inventoryDataMigrationFiles({
      workspaces: [workspace!],
      preset: 'smaller',
      sensitiveContentAcknowledged: false
    })
    expect(result.files.map((file) => file.relativePath)).toEqual([
      '.kun-design/node_modules/canvas.json',
      'README.md'
    ])
    expect(result.estimate.sensitiveFindings[0]?.path).toBe('.env')
    expect(result.exclusionCounts['git-metadata']).toBe(1)
    expect(result.exclusionCounts['node-dependencies']).toBe(1)
  })

  it('exports only allowlisted settings and deactivates automation definitions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-migration-settings-'))
    roots.push(root)
    const value = settings(root)
    value.schedule.tasks = [{
      id: 'task_one',
      title: 'Task',
      enabled: true,
      prompt: 'Run',
      workspaceRoot: root,
      clawChannelId: 'channel_secret',
      providerId: 'provider_local',
      model: 'model',
      reasoningEffort: 'off',
      mode: 'agent',
      schedule: { kind: 'daily', everyMinutes: 60, timeOfDay: '09:00', atTime: '' },
      createdAt: 't0', updatedAt: 't0', lastRunAt: 't0', nextRunAt: 't1',
      lastStatus: 'success', lastMessage: 'done', lastThreadId: 'thr_local'
    }]
    const portable = portableSettingsForMigration(value)
    expect(portable).not.toHaveProperty('provider')
    expect(portable).not.toHaveProperty('agents')
    expect(JSON.stringify(portable)).not.toContain('must-not-export')
    const automations = sanitizedAutomationsForMigration(value) as { schedules: Array<Record<string, unknown>> }
    expect(automations.schedules[0]).toMatchObject({ enabled: false, clawChannelId: '', lastThreadId: '' })
    expect(automations.schedules[0]).not.toHaveProperty('providerId')
  })

  it('rejects export destinations inside selected workspaces or migration internals', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-migration-output-'))
    roots.push(root)
    const [workspace] = await discoverDataMigrationWorkspaces({ settings: settings(root) })
    expect(() => assertMigrationOutputOutsideWorkspaces(join(root, 'backup.kunpack'), [workspace!])).toThrow('inside a selected workspace')
    expect(() => assertMigrationOutputOutsideWorkspaces(join(root, '..', '.kun-migration-backup', 'backup.kunpack'), [])).toThrow('staging or backup')
  })
})

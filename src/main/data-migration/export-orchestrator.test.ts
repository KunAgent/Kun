import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  DataMigrationExportOrchestrator,
  type KunMigrationSnapshotClient
} from './export-orchestrator'
import { verifyKunpackPackage } from './kunpack-container'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function settings(workspaceRoot: string): AppSettingsV1 {
  const write = defaultWriteSettings()
  return {
    version: 1,
    locale: 'zh',
    theme: 'system',
    uiFontScale: 1,
    chatContentMaxWidthPx: 896,
    provider: defaultModelProviderSettings(),
    agents: { kun: defaultKunRuntimeSettings() },
    workspaceRoot,
    conversationWorkspaceRoot: workspaceRoot,
    log: { enabled: false, retentionDays: 7 },
    checkpointCleanup: { enabled: false, intervalDays: 3 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: { ...write, defaultWorkspaceRoot: workspaceRoot, activeWorkspaceRoot: workspaceRoot, workspaces: [workspaceRoot] },
    claw: { ...defaultClawSettings(), im: { ...defaultClawSettings().im, workspaceRoot } },
    schedule: { ...defaultScheduleSettings(), defaultWorkspaceRoot: workspaceRoot },
    workflow: { ...defaultWorkflowSettings(), defaultWorkspaceRoot: workspaceRoot },
    design: { ...defaultDesignSettings(), defaultWorkspaceRoot: workspaceRoot },
    guiUpdate: { channel: 'stable' },
    terminal: defaultTerminalSettings(),
    codePromptPrefix: '',
    disabledSkillIds: []
  }
}

function runtimeClient(contents = '{"schemaVersion":1,"type":"metadata","value":{}}\n') {
  const release = vi.fn(async () => undefined)
  const client: KunMigrationSnapshotClient = {
    create: vi.fn(async (input) => ({
      snapshotId: 'migexp_test',
      exportedThreadIds: input.threadIds,
      omittedThreadIds: [],
      contentCounts: { attachments: 2, artifacts: 1, memories: 3 }
    })),
    download: vi.fn(async (_id, destinationPath) => {
      await writeFile(destinationPath, contents)
      return {
        byteSize: Buffer.byteLength(contents),
        sha256: createHash('sha256').update(contents).digest('hex')
      }
    }),
    release
  }
  return { client, release }
}

describe('DataMigrationExportOrchestrator', () => {
  it('packages workspace files, runtime history, semantic settings, and a reportable verified archive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-export-orchestrator-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    const output = join(root, 'exports', 'portable.kunpack')
    await mkdir(workspace, { recursive: true })
    await writeFile(join(workspace, 'README.md'), '# Project\n')
    const runtime = runtimeClient()
    const orchestrator = new DataMigrationExportOrchestrator(runtime.client)
    const progress: string[] = []
    const result = await orchestrator.export({
      operationId: 'export_test',
      outputPath: output,
      settings: settings(workspace),
      runtimeThreads: [{
        id: 'thread_one', title: 'History', workspace, status: 'idle',
        createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:01.000Z'
      }],
      selectedWorkspaceIds: [],
      selectedThreadIds: ['thread_one'],
      categories: ['workspace-files', 'thread-history', 'portable-settings', 'renderer-state'],
      preset: 'complete',
      sensitiveContentAcknowledged: false,
      unencryptedPackageAcknowledged: true,
      runningThreadPolicy: 'wait',
      rendererState: { design: [], write: [] },
      sourceInstallationId: 'installation_test',
      sourceAppVersion: '0.1.0-test',
      sourceRuntimeVersion: '0.1.0-test',
      onProgress: (value) => progress.push(value.phase)
    })
    expect(result.packagePath).toBe(output)
    expect(result.report.outcome).toBe('success')
    expect(result.report.counts.workspaceFiles).toBe(1)
    expect(result.report.counts).toMatchObject({ attachments: 2, artifacts: 1, memories: 3 })
    expect(runtime.release).toHaveBeenCalledWith('migexp_test')
    expect(progress).toContain('completed')
    const verified = await verifyKunpackPackage({
      packagePath: output,
      materializedZipPath: join(root, 'verify.zip')
    })
    expect(verified.entries.map((entry) => entry.path)).toEqual(expect.arrayContaining([
      'payload/runtime/snapshot.jsonl',
      expect.stringMatching(/^payload\/workspaces\/ws_[a-f0-9]+\/files\/README\.md$/),
      'catalog/portable-settings.json',
      'catalog/renderer-state.json'
    ]))
    expect(verified.manifest.counts).toMatchObject({ attachments: 2, artifacts: 1, memories: 3 })
  })

  it('requires explicit acknowledgement for plaintext and sensitive workspace files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-export-policy-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    await writeFile(join(workspace, '.env'), 'TOKEN=secret')
    const orchestrator = new DataMigrationExportOrchestrator(runtimeClient().client)
    const base = {
      operationId: 'export_policy',
      outputPath: join(root, 'portable.kunpack'),
      settings: settings(workspace),
      runtimeThreads: [],
      selectedWorkspaceIds: [],
      selectedThreadIds: [],
      categories: ['workspace-files'] as const,
      preset: 'complete' as const,
      sensitiveContentAcknowledged: false,
      unencryptedPackageAcknowledged: false,
      runningThreadPolicy: 'wait' as const,
      sourceInstallationId: 'installation_test',
      sourceAppVersion: 'test',
      sourceRuntimeVersion: 'test'
    }
    await expect(orchestrator.export({ ...base, categories: [...base.categories] })).rejects.toThrow('unencrypted')
    await expect(orchestrator.export({
      ...base,
      categories: [...base.categories],
      unencryptedPackageAcknowledged: true
    })).rejects.toThrow('sensitive workspace files')
    await expect(stat(base.outputPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('cleans a partially downloaded runtime snapshot and never publishes on failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-export-cleanup-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    const output = join(root, 'portable.kunpack')
    await mkdir(workspace, { recursive: true })
    const runtime = runtimeClient()
    runtime.client.download = vi.fn(async (_id, destinationPath) => {
      await writeFile(destinationPath, 'partial')
      throw new Error('download failed')
    })
    const orchestrator = new DataMigrationExportOrchestrator(runtime.client)
    await expect(orchestrator.export({
      operationId: 'export_fail', outputPath: output, settings: settings(workspace),
      runtimeThreads: [{ id: 'thread_one', title: 'History', workspace, createdAt: 't0', updatedAt: 't1' }],
      selectedWorkspaceIds: [], selectedThreadIds: ['thread_one'], categories: ['thread-history'], preset: 'complete',
      sensitiveContentAcknowledged: false, unencryptedPackageAcknowledged: true, runningThreadPolicy: 'wait',
      sourceInstallationId: 'installation_test', sourceAppVersion: 'test', sourceRuntimeVersion: 'test'
    })).rejects.toThrow('download failed')
    expect(runtime.release).toHaveBeenCalledWith('migexp_test')
    await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('treats an empty thread selection as all runtime histories when history is included', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-export-all-threads-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    const runtime = runtimeClient()
    const orchestrator = new DataMigrationExportOrchestrator(runtime.client)
    await orchestrator.export({
      operationId: 'export_all_threads', outputPath: join(root, 'all.kunpack'), settings: settings(workspace),
      runtimeThreads: [
        { id: 'thread_one', title: 'One', workspace, createdAt: 't0', updatedAt: 't1' },
        { id: 'thread_two', title: 'Two', workspace, createdAt: 't0', updatedAt: 't1' }
      ],
      selectedWorkspaceIds: [], selectedThreadIds: [], categories: ['thread-history'], preset: 'complete',
      sensitiveContentAcknowledged: false, unencryptedPackageAcknowledged: true, runningThreadPolicy: 'wait',
      sourceInstallationId: 'installation_test', sourceAppVersion: 'test', sourceRuntimeVersion: 'test'
    })
    expect(runtime.client.create).toHaveBeenCalledWith(expect.objectContaining({
      threadIds: ['thread_one', 'thread_two']
    }), undefined)
  })

  it('limits automatic history selection to the explicitly selected workspaces', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-export-related-threads-'))
    roots.push(root)
    const firstWorkspace = join(root, 'first')
    const secondWorkspace = join(root, 'second')
    await Promise.all([mkdir(firstWorkspace), mkdir(secondWorkspace)])
    const runtime = runtimeClient()
    const orchestrator = new DataMigrationExportOrchestrator(runtime.client)
    const runtimeThreads = [
      { id: 'thread_first', title: 'First', workspace: firstWorkspace, createdAt: 't0', updatedAt: 't1' },
      { id: 'thread_second', title: 'Second', workspace: secondWorkspace, createdAt: 't0', updatedAt: 't1' }
    ]
    const inventory = await orchestrator.estimate({
      operationId: 'estimate_related_threads',
      settings: settings(firstWorkspace),
      runtimeThreads,
      selectedWorkspaceIds: [],
      preset: 'complete',
      sensitiveContentAcknowledged: false
    })
    const selectedWorkspaceId = inventory.estimate.workspaces.find((workspace) => workspace.sourcePathDisplay === firstWorkspace)!.workspaceId
    const outputPath = join(root, 'related.kunpack')
    await orchestrator.export({
      operationId: 'export_related_threads', outputPath,
      settings: settings(firstWorkspace), runtimeThreads,
      selectedWorkspaceIds: [selectedWorkspaceId], selectedThreadIds: [], categories: ['thread-history'], preset: 'complete',
      sensitiveContentAcknowledged: false, unencryptedPackageAcknowledged: true, runningThreadPolicy: 'wait',
      sourceInstallationId: 'installation_test', sourceAppVersion: 'test', sourceRuntimeVersion: 'test'
    })
    expect(runtime.client.create).toHaveBeenCalledWith(expect.objectContaining({
      threadIds: ['thread_first']
    }), undefined)
    const verified = await verifyKunpackPackage({ packagePath: outputPath, materializedZipPath: join(root, 'related.zip') })
    expect(verified.manifest.selection.threadIds).toEqual(['thread_first'])
    expect(verified.manifest.counts.threads).toBe(1)
  })
})

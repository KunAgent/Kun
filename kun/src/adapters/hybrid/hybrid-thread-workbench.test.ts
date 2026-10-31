import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ThreadRecord } from '../../contracts/threads.js'
import { createThreadRecord } from '../../domain/thread.js'
import { HybridThreadStore } from './hybrid-thread-store.js'
import { ExecutionTaskStateSchema } from '../../contracts/execution-tasks.js'
import { rowFromIndexRecord, summaryFromRow } from './hybrid-thread-index-mapping.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('HybridThreadStore combined Code workbench', () => {
  it('keeps canonical task progress alongside ADE routing in indexed summaries', () => {
    const now = '2026-09-30T00:00:00.000Z'
    const thread = createThreadRecord({ id: 'task', title: 'Task', workspace: '/repo', model: 'm',
      workspaceMode: 'ade', harnessId: 'codex', providerId: 'native', taskWorkspaceId: 'workspace' })
    thread.todos = { threadId: thread.id, updatedAt: now, items: [{ id: 'old', content: 'Legacy step',
      status: 'completed', createdAt: now, updatedAt: now }] }
    thread.executionTasks = ExecutionTaskStateSchema.parse({ schemaVersion: 1, revision: 3,
      importedAt: now, updatedAt: now, tasks: [{ id: 'canonical', title: 'Canonical step',
        status: 'pending', revision: 1, ownerThreadId: thread.id, createdAt: now, updatedAt: now }] })
    const row = rowFromIndexRecord({ thread, messageCount: 0, eventSeqHighWater: 0, preview: '' },
      { metadataPath: '/metadata', messagesPath: '/messages', eventsPath: '/events' })
    expect(summaryFromRow(row)).toMatchObject({ workspaceMode: 'ade', harnessId: 'codex',
      providerId: 'native', taskWorkspaceId: 'workspace', todos: {
        items: [{ id: 'canonical', content: 'Canonical step', status: 'pending' }]
      } })
    expect(row.search_text).toContain('canonical step')
    expect(row.search_text).not.toContain('legacy step')
    expect(thread.todos.items[0].content).toBe('Legacy step')
  })

  it('uses one indexed cursor across Code and ADE roots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-hybrid-workbench-'))
    roots.push(root)
    const store = new HybridThreadStore({ dataDir: root })
    const seed = async (id: string, index: number, extra: Partial<ThreadRecord> = {}): Promise<void> => {
      const record = createThreadRecord({ id, title: `fix ${id}`, workspace: '/repo', model: 'm' })
      await store.upsert({ ...record, updatedAt: `2026-09-30T00:00:0${index}.000Z`, ...extra })
    }
    try {
      await seed('code_1', 1)
      await seed('ade_2', 2, { workspaceMode: 'ade', providerId: 'source', harnessId: 'claude-code', taskWorkspaceId: 'ws_ade' })
      await seed('code_3', 3, { collaboration: { enabled: true, everEnabled: true } })
      await seed('work_4', 4, { agentSurface: 'write' })
      await seed('side_5', 5, { relation: 'side', parentThreadId: 'ade_2', workspaceMode: 'ade' })
      await seed('archived_6', 6, { status: 'archived', workspaceMode: 'ade' })
      await store.waitForBackfill()

      const options = { workbenchScope: 'code' as const, search: 'fix', limit: 2 }
      const first = await store.listPage(options)
      const second = await store.listPage({ ...options, cursor: first.nextCursor })
      expect(first.total).toBe(3)
      expect(first.hasMore).toBe(true)
      expect([...first.threads, ...second.threads].map((thread) => thread.id))
        .toEqual(['code_3', 'ade_2', 'code_1'])
      expect(first.threads.find((thread) => thread.id === 'ade_2')).toMatchObject({
        providerId: 'source', harnessId: 'claude-code', taskWorkspaceId: 'ws_ade'
      })
      expect(first.threads.find((thread) => thread.id === 'code_3')?.collaboration)
        .toEqual({ enabled: true, everEnabled: true })
      expect((await store.listPage({ workbenchScope: 'code', archivedOnly: true })).threads.map((thread) => thread.id))
        .toEqual(['archived_6'])
      expect((await store.listPage({ workspaceMode: 'code', search: 'fix' })).threads.some((thread) => thread.id === 'ade_2'))
        .toBe(false)
    } finally {
      store.close()
    }
  })
  it('filters Work before pagination and searches older sessions in a mixed indexed space', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-hybrid-work-history-'))
    roots.push(root)
    const store = new HybridThreadStore({ dataDir: root })
    const seed = async (id: string, index: number, extra: Partial<ThreadRecord> = {}): Promise<void> => {
      const record = createThreadRecord({ id, title: id, workspace: '/repo', model: 'm' })
      const updatedAt = new Date(Date.UTC(2026, 9, 1, 0, 0, index)).toISOString()
      await store.upsert({ ...record, updatedAt, ...extra })
    }
    try {
      for (let index = 0; index < 85; index += 1) {
        await seed(`work_${index}`, index, { agentSurface: 'write', ...(index === 0 ? { title: 'unique older title' } : {}) })
      }
      for (let index = 100; index < 190; index += 1) await seed(`code_${index}`, index)
      await seed('legacy', 90, { title: 'Write Assistant', agentSurface: 'write' })
      await seed('not_work', 91, { title: 'Write Assistant', agentSurface: 'code' })
      await seed('archived', 92, { agentSurface: 'write', status: 'archived' })
      await seed('side', 93, { agentSurface: 'write', relation: 'side', parentThreadId: 'work_1' })
      await seed('worker', 94, { agentSurface: 'write', executionUnit: {
        kind: 'worker', teamId: 'team', managerThreadId: 'manager', label: 'Worker', lifecycle: 'persistent', control: 'manager'
      } })
      await seed('elsewhere', 95, { agentSurface: 'write', workspace: '/other' })
      await store.waitForBackfill()
      const { db } = store as unknown as { db: import('better-sqlite3').Database }
      db.prepare("UPDATE threads SET agent_surface = 'code' WHERE id = ?").run('legacy')

      const options = { workbenchScope: 'work' as const, workspace: '/repo', workspaceMode: 'code' as const, limit: 80 }
      const first = await store.listPage(options)
      expect(first.threads).toHaveLength(80)
      expect(first.hasMore).toBe(true)
      expect(first.threads[0]?.id).toBe('legacy')
      const second = await store.listPage({ ...options, cursor: first.nextCursor })
      expect(second.threads).toHaveLength(6)
      expect(second.hasMore).toBe(false)
      const ids = [...first.threads, ...second.threads].map((thread) => thread.id)
      expect(new Set(ids).size).toBe(86)
      expect(ids).toContain('work_0')
      expect(ids).not.toContain('not_work')
      expect(ids).not.toContain('worker')
      expect((await store.listPage({ ...options, search: 'unique older' })).threads.map((thread) => thread.id))
        .toEqual(['work_0'])
    } finally { store.close() }
  })

  it('repairs old indexed routing metadata once, using metadata reads and preserving cursor order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-hybrid-routing-repair-'))
    roots.push(root)
    const store = new HybridThreadStore({ dataDir: root })
    try {
      const thread = createThreadRecord({ id: 'native', title: 'Native task', workspace: '/task/worktree',
        model: 'm', providerId: 'native-source', harnessId: 'codex', taskWorkspaceId: 'task-ws' })
      await store.upsert(thread)
      await store.waitForBackfill()
      const internals = store as unknown as {
        db: import('better-sqlite3').Database
        readThreadMetadataFromDisk(id: string): Promise<ThreadRecord | null>
        readThreadFromDisk(id: string): Promise<ThreadRecord | null>
      }
      internals.db.prepare('UPDATE threads SET extension_metadata_json = NULL WHERE id = ?').run('native')
      const metadata = vi.spyOn(internals, 'readThreadMetadataFromDisk')
      const full = vi.spyOn(internals, 'readThreadFromDisk')
      const first = await store.listPage({ workbenchScope: 'code', limit: 1 })
      expect(first.threads[0]).toMatchObject({ id: 'native', providerId: 'native-source', harnessId: 'codex', taskWorkspaceId: 'task-ws' })
      expect(first.threads[0]).not.toHaveProperty('summaryMetadataVersion')
      expect(metadata).toHaveBeenCalledOnce()
      expect(full).not.toHaveBeenCalled()
      await store.listPage({ workbenchScope: 'code', limit: 1 })
      expect(metadata).toHaveBeenCalledOnce()
    } finally { store.close() }
  })

})

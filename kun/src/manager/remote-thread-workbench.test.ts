import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createThreadRecord } from '../domain/thread.js'
import { startNodeHttpServer } from '../server/node-http-server.js'
import { buildServiceManagerRouter, ServiceManagerState } from './service-manager.js'
import { ManagerSharedDataStore } from './shared-data-store.js'
import { ManagerRemoteThreadStore } from './remote-thread-store.js'
import type { ServiceManagerConnection } from './manager-client.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-remote-workbench-'))
  roots.push(root)
  const shared = await ManagerSharedDataStore.create(join(root, 'data'))
  const router = buildServiceManagerRouter({ managerToken: 'test-manager-token', instanceId: 'test-manager',
    startedAt: '2026-09-30T00:00:00.000Z', state: new ServiceManagerState(), sharedData: shared })
  const server = await startNodeHttpServer({ router, host: '127.0.0.1', port: 0 })
  const connection: ServiceManagerConnection = { discovery: {
    version: 1, protocolVersion: 6, instanceId: 'test-manager', pid: process.pid,
    startedAt: '2026-09-30T00:00:00.000Z', host: '127.0.0.1', port: server.port,
    baseUrl: `http://127.0.0.1:${server.port}`, managerToken: 'test-manager-token', serviceVersion: '0.1.0',
    dataDir: join(root, 'data'), settingsPath: join(root, 'settings.json')
  } }
  return { remote: new ManagerRemoteThreadStore(connection), close: async () => {
    await server.close()
    await shared.close()
  } }
}

describe('Code workbench through the Manager HTTP proxy', () => {
  it('admits the unified scope through strict RPC validation and preserves paginated identities', async () => {
    const { remote, close } = await fixture()
    try {
      const definitions = [
        { id: 'code', workspaceMode: 'code' as const },
        { id: 'ade', workspaceMode: 'ade' as const, harnessId: 'codex', providerId: 'source', taskWorkspaceId: 'task-workspace' },
        { id: 'work', agentSurface: 'write' as const },
        { id: 'worker', workspaceMode: 'ade' as const, relation: 'side' as const, parentThreadId: 'ade' }
      ]
      for (const [index, definition] of definitions.entries()) {
        await remote.upsert(createThreadRecord({ ...definition, workspace: '/repo', title: `Task ${definition.id}`,
          model: 'test-model', createdAt: `2026-09-30T00:00:0${index}.000Z` }))
      }
      const first = await remote.listPage({ workbenchScope: 'code', workspace: '/repo', limit: 1 })
      expect(first).toMatchObject({ total: 2, hasMore: true,
        threads: [{ id: 'ade', providerId: 'source', harnessId: 'codex', taskWorkspaceId: 'task-workspace' }] })
      const second = await remote.listPage({ workbenchScope: 'code', workspace: '/repo', limit: 1, cursor: first.nextCursor })
      expect(second).toMatchObject({ hasMore: false, threads: [{ id: 'code' }] })
      expect((await remote.list({ workbenchScope: 'code', search: 'Task' })).map((thread) => thread.id)).toEqual(['ade', 'code'])
      expect((await remote.listPage({ workspaceMode: 'ade' })).threads.map((thread) => thread.id)).toEqual(['ade'])
      await expect(remote.listPage({ workspaceMode: 'code', workbenchScope: 'code' })).rejects.toThrow('HTTP 400')
      await expect(remote.list({ workbenchScope: 'unknown' as 'code' })).rejects.toThrow('HTTP 400')
    } finally { await close() }
  })
})

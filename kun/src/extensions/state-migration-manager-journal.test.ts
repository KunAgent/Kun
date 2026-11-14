import { afterEach, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { configureManagerAtomicJsonClient } from './atomic-json.js'
import { ExtensionPaths } from './paths.js'
import { ExtensionStateMigrationCoordinator } from './state-migration-coordinator.js'
import type { ExtensionStateStore } from './state-store.js'
import type { ExtensionManager } from './manager.js'
import type { ExtensionRegistry } from './registry.js'

afterEach(() => {
  configureManagerAtomicJsonClient(null)
  vi.unstubAllGlobals()
})

it('removes a recovered journal through the Manager so later activation does not stop a live host again', async () => {
  const dataDir = join(tmpdir(), 'kun-journal-manager-fixture')
  const paths = new ExtensionPaths({ packageRoot: join(dataDir, 'packages'), dataRoot: join(dataDir, 'state') })
  const path = join(paths.stateDirectory('fixture.demo'), 'version-switch.json')
  let value: unknown = {
    schemaVersion: 1, transactionId: '12345678-1234-1234-1234-123456789012',
    extensionId: 'fixture.demo', phase: 'selection-committed', reason: 'install',
    target: { kind: 'installed', version: '1.0.0' },
    registryBefore: { extensionId: 'fixture.demo', entryExisted: false, useDevelopment: false,
      workspacePermissionGrants: {}, targetInstalledVersionExisted: false },
    stateExistedBefore: false, fromStateSchema: 0, toStateSchema: 0,
    backupName: 'fixture.json', backupDigest: 'a'.repeat(64), startedAt: '2026-01-01T00:00:00.000Z'
  }
  let revision = 1
  configureManagerAtomicJsonClient({ baseUrl: 'http://127.0.0.1:19999', token: 'fixture', dataDir })
  const requests: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    const body = JSON.parse(String(options.body))
    expect(body.path).toBe(path)
    requests.push(url)
    if (url.endsWith('/delete')) {
      expect(body.expectedRevision).toBe(revision)
      value = null; revision++
    }
    return Response.json({ snapshot: { revision, value } })
  }))
  const manager = { deactivate: vi.fn(async () => undefined) }
  const transaction = { read: vi.fn(async () => ({ schemaVersion: 0 })) }
  const state = { paths, runVersionSwitchTransaction: vi.fn(async (_id: string,
    run: (context: unknown) => Promise<unknown>) => run(transaction)) }
  const registry = { isVersionSwitchTargetSelected: vi.fn(async () => true) }
  const coordinator = new ExtensionStateMigrationCoordinator(state as unknown as ExtensionStateStore,
    manager as unknown as ExtensionManager, registry as unknown as ExtensionRegistry)
  await coordinator.recover('fixture.demo')
  await coordinator.recover('fixture.demo')
  expect(value).toBeNull()
  expect(requests.filter(url => url.endsWith('/delete'))).toHaveLength(1)
  expect(manager.deactivate).toHaveBeenCalledOnce()
})

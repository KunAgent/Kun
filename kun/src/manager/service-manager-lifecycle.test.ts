import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  runtimeDataDirClaimsPath,
  runtimeDataDirOwnerPath
} from '../server/runtime-data-dir-migration-lock.js'
import { createKunServeRuntime } from '../server/runtime-factory.js'
import { ManagerSharedDataStore } from './shared-data-store.js'
import { startServiceManager } from './service-manager.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-service-manager-lifecycle-'))
  roots.push(root)
  return {
    root,
    controlDir: join(root, 'control'),
    dataDir: join(root, 'data'),
    settingsPath: join(root, 'settings.json')
  }
}

describe('Service Manager data-directory lease lifecycle', () => {
  it('backs up corrupt persisted state and remains restartable', async () => {
    const test = await fixture()
    const statePath = join(test.controlDir, 'manager-state.json')
    await mkdir(test.controlDir, { recursive: true })
    await writeFile(statePath, '\0'.repeat(1_692))
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const first = await startServiceManager({
      controlDir: test.controlDir,
      managerToken: 'manager-token',
      instanceId: 'manager-recovered',
      startedAt: '2026-08-31T00:00:00.000Z',
      dataDir: test.dataDir,
      settingsPath: test.settingsPath
    })
    await expect(fetch(`${first.discovery.baseUrl}/health`)).resolves.toMatchObject({ ok: true })
    await first.close()

    const entries = await readdir(test.controlDir)
    expect(entries.filter((name) => name.startsWith('manager-state.json.corrupt-'))).toHaveLength(1)
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toMatchObject({ version: 5, slots: [] })
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('recovered corrupt manager state'))

    const second = await startServiceManager({
      controlDir: test.controlDir,
      managerToken: 'manager-token',
      instanceId: 'manager-restarted',
      startedAt: '2026-08-31T00:01:00.000Z',
      dataDir: test.dataDir,
      settingsPath: test.settingsPath
    })
    await expect(fetch(`${second.discovery.baseUrl}/health`)).resolves.toMatchObject({ ok: true })
    await second.close()
    expect((await readdir(test.controlDir))
      .filter((name) => name.startsWith('manager-state.json.corrupt-'))).toHaveLength(1)
  })

  it('remains the sole writer-claim owner for managed Runtime compositions', async () => {
    const test = await fixture()
    const manager = await startServiceManager({
      controlDir: test.controlDir,
      managerToken: 'manager-token',
      instanceId: 'manager-instance',
      startedAt: '2026-08-05T00:00:00.000Z',
      buildId: 'c'.repeat(64),
      dataDir: test.dataDir,
      settingsPath: test.settingsPath
    })
    let runtime: Awaited<ReturnType<typeof createKunServeRuntime>> | undefined
    try {
      expect(manager.discovery.buildId).toBe('c'.repeat(64))
      await expect(fetch(`${manager.discovery.baseUrl}/health`).then((response) => response.json()))
        .resolves.toMatchObject({ buildId: 'c'.repeat(64) })
      runtime = await createKunServeRuntime({
        host: '127.0.0.1',
        port: 0,
        dataDir: test.dataDir,
        runtimeToken: 'runtime-token',
        apiKey: '',
        baseUrl: 'http://127.0.0.1:9',
        model: 'test-model',
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        tokenEconomyMode: false,
        insecure: false,
        serviceManager: { discovery: manager.discovery }
      })
      expect((await readdir(runtimeDataDirClaimsPath(test.dataDir)))
        .filter((name) => name.startsWith('claim-'))).toHaveLength(1)

      await runtime.shutdown?.()
      runtime = undefined
      expect((await readdir(runtimeDataDirClaimsPath(test.dataDir)))
        .filter((name) => name.startsWith('claim-'))).toHaveLength(1)
    } finally {
      await runtime?.shutdown?.().catch(() => undefined)
      await manager.close().catch(() => undefined)
    }
  })

  it('releases its owner lease even when a later close step fails', async () => {
    const test = await fixture()
    const sharedData = await ManagerSharedDataStore.create(test.dataDir)
    const closeSharedData = sharedData.close.bind(sharedData)
    vi.spyOn(sharedData, 'close').mockImplementation(async () => {
      await closeSharedData()
      throw new Error('injected shared-data close failure')
    })
    const manager = await startServiceManager({
      controlDir: test.controlDir,
      managerToken: 'manager-token',
      instanceId: 'manager-instance',
      startedAt: '2026-08-05T00:00:00.000Z',
      dataDir: test.dataDir,
      settingsPath: test.settingsPath,
      sharedData
    })

    await expect(readFile(runtimeDataDirOwnerPath(test.dataDir), 'utf8'))
      .resolves.toContain(String(process.pid))
    await expect(manager.close()).rejects.toThrow('injected shared-data close failure')
    await expect(readFile(runtimeDataDirOwnerPath(test.dataDir), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('cleans shared data and the owner lease when setup throws after store creation', async () => {
    const test = await fixture()
    const sharedData = await ManagerSharedDataStore.create(test.dataDir)
    const close = vi.spyOn(sharedData, 'close')
    const input: Parameters<typeof startServiceManager>[0] = {
      controlDir: test.controlDir,
      managerToken: 'manager-token',
      instanceId: 'manager-instance',
      startedAt: '2026-08-05T00:00:00.000Z',
      dataDir: test.dataDir,
      settingsPath: test.settingsPath,
      sharedData
    }
    Object.defineProperty(input, 'documents', {
      get: () => { throw new Error('injected documents construction failure') }
    })

    await expect(startServiceManager(input))
      .rejects.toThrow('injected documents construction failure')
    expect(close).toHaveBeenCalledOnce()
    await expect(readFile(runtimeDataDirOwnerPath(test.dataDir), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })
})

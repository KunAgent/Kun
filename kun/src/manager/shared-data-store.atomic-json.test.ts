import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ManagerSharedDataStore } from './shared-data-store.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
    maxRetries: process.platform === 'win32' ? 5 : 0,
    retryDelay: 50
  })))
})

describe('manager atomic JSON idempotency', () => {
  it('rejects legacy Registry writes and deletes after v2 is published', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-manager-registry-version-')); roots.push(root)
    const store = await ManagerSharedDataStore.create(root)
    try {
      const legacy = join(root, 'model-connections.v1.json')
      await store.writeAtomicJson({ path: legacy, expectedRevision: 0, value: { schemaVersion: 1, revision: 1 } })
      await store.writeAtomicJson({ path: join(root, 'model-connections.v2.json'), expectedRevision: 0,
        value: { schemaVersion: 2, revision: 1 } })
      await expect(store.writeAtomicJson({ path: legacy, expectedRevision: 1,
        value: { schemaVersion: 1, revision: 2 } })).rejects.toThrow('v2')
      await expect(store.deleteAtomicJson({ path: legacy, expectedRevision: 1 })).rejects.toThrow('v2')
      expect((await store.readAtomicJson(legacy)).value).toEqual({ schemaVersion: 1, revision: 1 })
    } finally { await store.close() }
  })
  it('collapses concurrent identical writes without churning the revision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-manager-json-idempotent-'))
    roots.push(root)
    const dataDir = join(root, 'data')
    const path = join(dataDir, 'model-connections.v1.json')
    const store = await ManagerSharedDataStore.create(dataDir)
    const value = { schemaVersion: 1, revision: 7, profiles: { deepseek: { enabled: true } } }
    await expect(store.writeAtomicJson({
      path,
      expectedRevision: 0,
      value
    })).resolves.toEqual({ revision: 1, value })

    const repeated = await Promise.all(Array.from({ length: 16 }, () =>
      store.writeAtomicJson({ path, expectedRevision: 0, value: structuredClone(value) })
    ))
    expect(repeated).toEqual(Array.from({ length: 16 }, () => ({ revision: 1, value })))
    expect(await store.readAtomicJson(path)).toEqual({ revision: 1, value })
    await expect(store.writeAtomicJson({
      path,
      expectedRevision: 0,
      value: { ...value, revision: 8 }
    })).rejects.toMatchObject({ currentRevision: 1 })
    await store.close()
  })
})

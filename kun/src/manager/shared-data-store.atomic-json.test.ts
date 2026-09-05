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

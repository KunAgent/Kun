import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { FileMemoryStore } from './memory-store.js'

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kun-memory-store-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('FileMemoryStore', () => {
  it('re-enables a disabled memory when updated with disabled false', async () => {
    let tick = 0
    const store = new FileMemoryStore({
      rootDir: await makeTempDir(),
      config: { enabled: true, scopes: ['workspace'], maxInjectedRecords: 8 },
      idGenerator: () => 'mem_toggle',
      nowIso: () => `2026-06-21T00:00:0${tick++}.000Z`
    })

    await store.create({
      content: 'Prefer pnpm',
      scope: 'workspace',
      workspace: '/tmp/workspace'
    })

    const disabled = await store.update('mem_toggle', { disabled: true }, { workspace: '/tmp/workspace' })
    expect(disabled.disabledAt).toBe('2026-06-21T00:00:01.000Z')
    await expect(store.retrieve({
      query: 'pnpm',
      workspace: '/tmp/workspace',
      limit: 8
    })).resolves.toEqual([])

    const enabled = await store.update('mem_toggle', { disabled: false }, { workspace: '/tmp/workspace' })
    expect(enabled.disabledAt).toBeUndefined()
    await expect(store.retrieve({
      query: 'pnpm',
      workspace: '/tmp/workspace',
      limit: 8
    })).resolves.toMatchObject([{ id: 'mem_toggle' }])
  })

  async function cappedStore(maxInjectedRecords: number, idPrefix: string) {
    let nextId = 1
    return new FileMemoryStore({
      rootDir: await makeTempDir(),
      config: { enabled: true, scopes: ['workspace'], maxInjectedRecords },
      idGenerator: () => `${idPrefix}_${nextId++}`,
      nowIso: () => '2026-06-21T00:00:00.000Z'
    })
  }

  it('caps injection at the configured maxInjectedRecords', async () => {
    const store = await cappedStore(2, 'mem_cap')
    for (let i = 0; i < 3; i += 1) {
      await store.create({
        content: `Project ${i} uses pnpm for installs`,
        scope: 'workspace',
        workspace: '/tmp/workspace'
      })
    }
    await expect(store.retrieve({
      query: 'pnpm installs',
      workspace: '/tmp/workspace',
      limit: 8
    })).resolves.toHaveLength(2)
  })

  it('lets an explicit limit narrow below the configured cap', async () => {
    const store = await cappedStore(2, 'mem_min')
    await store.create({
      content: 'Use pnpm for frontend installs',
      scope: 'workspace',
      workspace: '/tmp/workspace'
    })
    await store.create({
      content: 'Use pnpm for backend installs',
      scope: 'workspace',
      workspace: '/tmp/workspace'
    })
    await expect(store.retrieve({
      query: 'pnpm installs',
      workspace: '/tmp/workspace',
      limit: 1
    })).resolves.toHaveLength(1)
  })
})

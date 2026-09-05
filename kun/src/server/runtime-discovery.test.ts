import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createRuntimeDiscoveryRecord,
  publishRuntimeDiscovery,
  readRuntimeHandoffDiscovery,
  readRuntimeHandoffDiscoveryStrict,
  readRuntimeDiscovery,
  removeRuntimeDiscovery,
  RuntimeDiscoveryRecordSchema,
  runtimeDiscoveryPath,
  withRuntimeStartLock
} from './runtime-discovery.js'
import { KUN_VERSION } from '../version.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-runtime-discovery-'))
  roots.push(root)
  return root
}

function input(overrides: Partial<Parameters<typeof publishRuntimeDiscovery>[1]> = {}) {
  return {
    pid: process.pid,
    startedAt: '2026-07-22T00:00:00.000Z',
    host: '127.0.0.1',
    port: 18899,
    baseUrl: 'http://127.0.0.1:18899',
    runtimeToken: 'secret-token',
    insecure: false,
    ...overrides
  }
}

describe('runtime discovery', () => {
  it('creates a validated versioned record', () => {
    const buildId = 'a'.repeat(64)
    expect(createRuntimeDiscoveryRecord(input({ instanceId: 'server-a', buildId }))).toEqual({
      version: 2,
      instanceId: 'server-a',
      pid: process.pid,
      startedAt: '2026-07-22T00:00:00.000Z',
      host: '127.0.0.1',
      port: 18899,
      baseUrl: 'http://127.0.0.1:18899',
      runtimeToken: 'secret-token',
      insecure: false,
      serviceVersion: KUN_VERSION,
      buildId,
      launchMode: 'foreground'
    })
  })

  it('continues to parse legacy records without a build identity', async () => {
    const root = await tempRoot()
    const record = await publishRuntimeDiscovery(root, input({ instanceId: 'legacy-server' }))

    expect(record.buildId).toBeUndefined()
    expect((await readRuntimeDiscovery(root))?.instanceId).toBe('legacy-server')
  })

  it.each(['gui', 'tui'] as const)(
    'round-trips optional %s client-owner metadata through normal and handoff discovery',
    async (clientOwnerKind) => {
      const root = await tempRoot()
      const record = await publishRuntimeDiscovery(root, input({
        instanceId: `${clientOwnerKind}-runtime`,
        clientOwnerKind
      }))

      expect(record.clientOwnerKind).toBe(clientOwnerKind)
      expect((await readRuntimeDiscovery(root))?.clientOwnerKind).toBe(clientOwnerKind)
      expect((await readRuntimeHandoffDiscovery(root))?.clientOwnerKind).toBe(clientOwnerKind)
    }
  )

  it('rejects unbounded client-owner kinds while preserving ownerless legacy records', () => {
    const base = createRuntimeDiscoveryRecord(input({ instanceId: 'runtime-owner-schema' }))

    expect(RuntimeDiscoveryRecordSchema.safeParse(base).success).toBe(true)
    expect(RuntimeDiscoveryRecordSchema.safeParse({
      ...base,
      clientOwnerKind: 'cli'
    }).success).toBe(false)
  })

  it('reads an older safe record only through the handoff contract', async () => {
    const root = await tempRoot()
    await writeFile(runtimeDiscoveryPath(root), JSON.stringify({
      version: 1,
      instanceId: 'older-runtime',
      pid: process.pid,
      startedAt: '2026-07-22T00:00:00.000Z',
      host: '127.0.0.1',
      port: 18899,
      baseUrl: 'http://127.0.0.1:18899',
      runtimeToken: 'older-secret',
      futureField: { supportedByNewerBuilds: true }
    }), 'utf8')

    expect(await readRuntimeDiscovery(root)).toBeNull()
    expect(await readRuntimeHandoffDiscovery(root)).toMatchObject({
      version: 1,
      instanceId: 'older-runtime',
      runtimeToken: 'older-secret',
      futureField: { supportedByNewerBuilds: true }
    })
    expect(await removeRuntimeDiscovery(root, 'older-runtime')).toBe(true)
  })

  it('rejects unsafe or wrong-flavor handoff records', async () => {
    const root = await tempRoot()
    const older = {
      version: 1,
      instanceId: 'unsafe-runtime',
      pid: process.pid,
      startedAt: '2026-07-22T00:00:00.000Z',
      host: 'example.com',
      port: 18899,
      baseUrl: 'http://example.com:18899',
      runtimeToken: 'secret'
    }
    await writeFile(runtimeDiscoveryPath(root), JSON.stringify(older), 'utf8')
    expect(await readRuntimeHandoffDiscovery(root)).toBeNull()

    await writeFile(runtimeDiscoveryPath(root, 'development'), JSON.stringify({
      ...older,
      instanceId: 'wrong-flavor',
      host: '127.0.0.1',
      baseUrl: 'http://127.0.0.1:18899',
      flavor: 'production'
    }), 'utf8')
    expect(await readRuntimeHandoffDiscovery(root, 'development')).toBeNull()
  })

  it('fails closed in strict replacement probes when discovery exists but is invalid', async () => {
    const root = await tempRoot()
    await writeFile(runtimeDiscoveryPath(root), '{broken', 'utf8')

    await expect(readRuntimeHandoffDiscoveryStrict(root)).rejects.toThrow(
      /invalid Kun production Runtime discovery/u
    )
    await rm(runtimeDiscoveryPath(root))
    await expect(readRuntimeHandoffDiscoveryStrict(root)).resolves.toBeNull()
  })

  it('keeps development discovery separate from the production compatibility record', async () => {
    const root = await tempRoot()
    const production = await publishRuntimeDiscovery(root, input({ instanceId: 'production-runtime' }))
    const development = await publishRuntimeDiscovery(root, input({
      instanceId: 'development-runtime',
      flavor: 'development',
      port: 18999,
      baseUrl: 'http://127.0.0.1:18999'
    }))

    expect(await readRuntimeDiscovery(root)).toEqual(production)
    expect(await readRuntimeDiscovery(root, 'development')).toEqual(development)
    expect(runtimeDiscoveryPath(root)).toBe(join(root, 'runtime.json'))
    expect(runtimeDiscoveryPath(root, 'development')).toBe(join(root, 'runtime.development.json'))
  })

  it('atomically publishes an owner-only record', async () => {
    const root = await tempRoot()
    const record = await publishRuntimeDiscovery(root, input({ instanceId: 'server-a' }))

    expect(await readRuntimeDiscovery(root)).toEqual(record)
    expect(JSON.parse(await readFile(runtimeDiscoveryPath(root), 'utf8'))).toEqual(record)
    if (process.platform !== 'win32') {
      expect((await stat(runtimeDiscoveryPath(root))).mode & 0o777).toBe(0o600)
    }
  })

  it('treats malformed, oversized, and absent records as unavailable', async () => {
    const root = await tempRoot()
    expect(await readRuntimeDiscovery(root)).toBeNull()
    await writeFile(runtimeDiscoveryPath(root), '{broken', 'utf8')
    expect(await readRuntimeDiscovery(root)).toBeNull()
    expect(await readRuntimeHandoffDiscovery(root)).toBeNull()
    await writeFile(runtimeDiscoveryPath(root), 'x'.repeat(65 * 1024), 'utf8')
    expect(await readRuntimeDiscovery(root)).toBeNull()
    expect(await readRuntimeHandoffDiscovery(root)).toBeNull()
  })

  it('does not let an older server remove a replacement record', async () => {
    const root = await tempRoot()
    await publishRuntimeDiscovery(root, input({ instanceId: 'server-old' }))
    const replacement = await publishRuntimeDiscovery(root, input({
      instanceId: 'server-new',
      port: 18900,
      baseUrl: 'http://127.0.0.1:18900'
    }))

    expect(await removeRuntimeDiscovery(root, 'server-old')).toBe(false)
    expect(await readRuntimeDiscovery(root)).toEqual(replacement)
    expect(await removeRuntimeDiscovery(root, 'server-new')).toBe(true)
    expect(await readRuntimeDiscovery(root)).toBeNull()
  })

  it('serializes concurrent runtime elections for one data directory', async () => {
    const root = await tempRoot()
    let active = 0
    let peak = 0
    await Promise.all(Array.from({ length: 6 }, () => withRuntimeStartLock(root, async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      active -= 1
    })))
    expect(peak).toBe(1)
  })
})

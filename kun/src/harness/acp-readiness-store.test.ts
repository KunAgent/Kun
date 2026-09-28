import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AcpReadinessStore, ACP_READINESS_CACHE_TTL_MS } from './acp-readiness-store.js'
import type { HarnessId } from '../contracts/harness.js'

let dir: string | undefined

async function store(nowMs: () => number): Promise<AcpReadinessStore> {
  dir ??= await mkdtemp(join(tmpdir(), 'kun-readiness-'))
  return new AcpReadinessStore({
    dataDir: dir,
    nowMs,
    nowIso: () => new Date(nowMs()).toISOString()
  })
}

const ID = 'opencode' as HarnessId

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

describe('AcpReadinessStore (P4-03)', () => {
  it('returns a hit only when command and version match', async () => {
    const now = 1_000
    const cache = await store(() => now)
    await cache.set(ID, '/usr/bin/opencode', '1.1.47')
    expect(await cache.get(ID, '/usr/bin/opencode', '1.1.47')).toBe('yes')
    expect(await cache.get(ID, '/usr/bin/opencode', '1.1.48')).toBeUndefined()
    expect(await cache.get(ID, '/opt/opencode', '1.1.47')).toBeUndefined()
    expect(await cache.get('other' as HarnessId, '/usr/bin/opencode', '1.1.47')).toBeUndefined()
  })

  it('survives a reload from disk (restart path)', async () => {
    let now = 1_000
    const first = await store(() => now)
    await first.set(ID, '/usr/bin/opencode', '1.1.47')
    const second = await store(() => now)
    expect(await second.get(ID, '/usr/bin/opencode', '1.1.47')).toBe('yes')
  })

  it('expires entries after 24h', async () => {
    let now = 1_000
    const cache = await store(() => now)
    await cache.set(ID, '/usr/bin/opencode', '1.1.47')
    now += ACP_READINESS_CACHE_TTL_MS + 1
    expect(await cache.get(ID, '/usr/bin/opencode', '1.1.47')).toBeUndefined()
  })

  it('clear() drops the entry', async () => {
    const now = 1_000
    const cache = await store(() => now)
    await cache.set(ID, '/usr/bin/opencode', '1.1.47')
    await cache.clear(ID)
    expect(await cache.get(ID, '/usr/bin/opencode', '1.1.47')).toBeUndefined()
  })

  it('starts empty on a corrupt cache file', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-readiness-'))
    try {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(join(dataDir, 'harness-readiness.json'), '{not json', 'utf8')
      const cache = new AcpReadinessStore({
        dataDir,
        nowMs: () => 1_000,
        nowIso: () => new Date(1_000).toISOString()
      })
      expect(await cache.get(ID, '/usr/bin/opencode', '1.1.47')).toBeUndefined()
      await cache.set(ID, '/usr/bin/opencode', '1.1.47')
      expect(await cache.get(ID, '/usr/bin/opencode', '1.1.47')).toBe('yes')
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})

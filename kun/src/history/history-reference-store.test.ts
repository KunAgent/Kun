import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureManagerAtomicJsonClient } from '../extensions/atomic-json.js'
import type { HistoryReference } from '../contracts/history-reference.js'
import { HistoryReferenceStore } from './history-reference-store.js'

const roots: string[] = []
afterEach(async () => {
  configureManagerAtomicJsonClient(null)
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const reference: HistoryReference = {
  id: 'ref:codex', provider: 'codex', sessionId: 'test-session', title: 'Title', workspace: '/project',
  createdAt: '2026-09-13T00:00:00Z', cutoffTurnId: 'codex:test:turn', parserVersion: 1, warnings: [],
  files: [{ path: '/external/rollout.jsonl', sessionId: 'test-session', byteLength: 12,
    sha256: 'a'.repeat(64), recordCount: 1 }]
}

describe('history reference persistence', () => {
  it('delegates all reference writes to Manager and stores no local copy in a configured Runtime', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-history-manager-'))
    roots.push(root)
    vi.stubEnv('KUN_MANAGER_BASE_URL', '')
    vi.stubEnv('KUN_MANAGER_TOKEN', '')
    vi.stubEnv('KUN_MANAGER_DATA_DIR', '')
    configureManagerAtomicJsonClient({ dataDir: root, baseUrl: 'http://manager.test', token: 'test-token' })
    const snapshots = new Map<string, { revision: number; value: unknown }>()
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { path: string; value?: unknown; expectedRevision?: number }
      const current = snapshots.get(body.path) ?? { revision: 0, value: null }
      if (String(url).endsWith('/read')) return Response.json({ snapshot: current })
      expect(init?.headers).toMatchObject({ authorization: 'Bearer test-token' })
      expect(body.expectedRevision).toBe(current.revision)
      const next = { revision: current.revision + 1, value: body.value ?? null }
      snapshots.set(body.path, next)
      return Response.json({ snapshot: next })
    })
    vi.stubGlobal('fetch', fetch)
    const store = new HistoryReferenceStore(root)
    await store.withMutation(async () => store.put(reference))
    expect(await new HistoryReferenceStore(root).get(reference.id)).toEqual(reference)
    expect(await readdir(root)).toEqual([])
    expect([...snapshots.values()][0]?.value).toEqual(reference)
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/write'))).toBe(true)
  })

  it('does not bypass Manager when a reference directory is outside its configured data root', () => {
    configureManagerAtomicJsonClient({ dataDir: '/canonical-data', baseUrl: 'http://manager.test', token: 'test-token' })
    expect(() => new HistoryReferenceStore('/another-data')).toThrow(/outside the configured Manager data directory/)
  })
})

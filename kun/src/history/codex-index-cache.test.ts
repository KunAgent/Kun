import { mkdtemp, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { HistoryReference } from '../contracts/history-reference.js'
import type { CodexIndex } from './codex-index.js'
import { codexIndexCacheStats, getCachedCodexIndex, invalidateCodexIndexCache } from './codex-index-cache.js'

const roots: string[] = []
afterEach(async () => {
  invalidateCodexIndexCache()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture(id = 'ref') {
  const root = await mkdtemp(join(tmpdir(), 'kun-index-cache-')); roots.push(root)
  const path = join(root, 'rollout.jsonl')
  await writeFile(path, 'source\n')
  const reference: HistoryReference = { id, provider: 'codex', sessionId: 'session', title: 'History', workspace: root,
    createdAt: '2026-09-13', cutoffTurnId: 'codex:session:turn', parserVersion: 1, warnings: [],
    files: [{ path, sessionId: 'session', byteLength: 7, sha256: 'a'.repeat(64), recordCount: 1 }] }
  const index: CodexIndex = { path, sessionId: 'session', title: 'History', workspace: root, createdAt: '2026-09-13',
    updatedAt: '2026-09-13', files: reference.files, warnings: [], turns: [] }
  return { root, path, reference, index }
}

it('reuses verified metadata but protects cached state from mutable subreference callers', async () => {
  const f = await fixture()
  const build = vi.fn(async () => structuredClone(f.index))
  const first = await getCachedCodexIndex(f.reference, build)
  first.files = []
  first.warnings.push('changed by caller')
  const second = await getCachedCodexIndex(f.reference, build)
  expect(build).toHaveBeenCalledTimes(1)
  expect(second.files).toHaveLength(1)
  expect(second.warnings).toEqual([])
})

it('invalidates for same-size edits even when mtime is restored, replacement, and missing files', async () => {
  const f = await fixture()
  const build = vi.fn(async () => structuredClone(f.index))
  await getCachedCodexIndex(f.reference, build)
  const original = await stat(f.path)
  await writeFile(f.path, 'edited\n')
  await utimes(f.path, original.atime, original.mtime)
  await getCachedCodexIndex(f.reference, build)
  expect(build).toHaveBeenCalledTimes(2)
  const replacement = join(f.root, 'replacement')
  await writeFile(replacement, 'edited\n')
  await rename(replacement, f.path)
  await getCachedCodexIndex(f.reference, build)
  expect(build).toHaveBeenCalledTimes(3)
  await rm(f.path)
  await expect(getCachedCodexIndex(f.reference, build)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(codexIndexCacheStats().entries).toBe(0)
})

it('deduplicates simultaneous builders and does not cache a build invalidated while pending', async () => {
  const f = await fixture()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const build = vi.fn(async () => { await gate; return structuredClone(f.index) })
  const first = getCachedCodexIndex(f.reference, build)
  const second = getCachedCodexIndex(f.reference, build)
  await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(1))
  expect(codexIndexCacheStats().building).toBe(1)
  invalidateCodexIndexCache(f.reference.id)
  release()
  const [a, b] = await Promise.all([first, second])
  a.warnings.push('only a')
  expect(b.warnings).toEqual([])
  expect(codexIndexCacheStats()).toEqual({ entries: 0, bytes: 0, building: 0 })
})

it('bounds entry count and does not retain oversized metadata indexes', async () => {
  const f = await fixture()
  for (let i = 0; i < 12; i += 1) {
    await getCachedCodexIndex({ ...f.reference, id: `ref-${i}` }, async () => structuredClone(f.index))
  }
  expect(codexIndexCacheStats().entries).toBe(8)
  const huge: CodexIndex = { ...f.index, turns: Array.from({ length: 10_000 }, (_, i) => ({
    id: `turn-${i}`, createdAt: '2026-09-13', label: 'x'.repeat(160), filePath: f.path,
    items: [], complete: true, boundary: f.reference.files[0]!
  })) }
  const build = vi.fn(async () => huge)
  const big = { ...f.reference, id: 'oversized' }
  await getCachedCodexIndex(big, build)
  await getCachedCodexIndex(big, build)
  expect(build).toHaveBeenCalledTimes(2)
  expect(codexIndexCacheStats().bytes).toBeLessThanOrEqual(8 * 1024 * 1024)
})

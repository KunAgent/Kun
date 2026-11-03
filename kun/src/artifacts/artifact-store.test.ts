import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileArtifactStore, InMemoryArtifactStore, type ArtifactStore } from './artifact-store.js'

function runStoreContract(name: string, make: () => Promise<{ store: ArtifactStore; cleanup?: () => Promise<void> }>) {
  describe(name, () => {
    it('stores content and returns a bounded summary + stable id', async () => {
      const { store, cleanup } = await make()
      try {
        const big = 'x'.repeat(10_000)
        const result = await store.put({ content: big, maxInlineChars: 200, source: 'mcp', origin: 'docs/lookup' })
        expect(result.meta.byteSize).toBe(10_000)
        expect(result.summary.truncated).toBe(true)
        expect(result.summary.inline.length).toBeLessThan(400)
        expect(result.meta.id).toBe(result.summary.artifactId)
        expect(await store.get(result.meta.id)).toBe(big)
      } finally {
        await cleanup?.()
      }
    })

    it('dedupes identical content by hash', async () => {
      const { store, cleanup } = await make()
      try {
        const a = await store.put({ content: 'same' })
        const b = await store.put({ content: 'same' })
        expect(a.meta.id).toBe(b.meta.id)
        expect(b.deduped).toBe(true)
      } finally {
        await cleanup?.()
      }
    })

    it('reads a line range on demand', async () => {
      const { store, cleanup } = await make()
      try {
        const content = ['l1', 'l2', 'l3', 'l4', 'l5'].join('\n')
        const { meta } = await store.put({ content })
        expect(await store.readRange(meta.id, { startLine: 2, endLine: 4 })).toBe('l2\nl3\nl4')
      } finally {
        await cleanup?.()
      }
    })

    it('reads a byte range on demand', async () => {
      const { store, cleanup } = await make()
      try {
        const { meta } = await store.put({ content: 'abcdefghij' })
        expect(await store.readRange(meta.id, { offset: 2, length: 3 })).toBe('cde')
      } finally {
        await cleanup?.()
      }
    })

    it('returns null for an unknown id', async () => {
      const { store, cleanup } = await make()
      try {
        expect(await store.get('art_missing')).toBeNull()
        expect(await store.readRange('art_missing', {})).toBeNull()
        expect(await store.stat('art_missing')).toBeNull()
      } finally {
        await cleanup?.()
      }
    })

    it('records source metadata', async () => {
      const { store, cleanup } = await make()
      try {
        const { meta } = await store.put({ content: 'hi', source: 'web', origin: 'web_fetch' })
        const stat = await store.stat(meta.id)
        expect(stat).toMatchObject({ source: 'web', origin: 'web_fetch' })
      } finally {
        await cleanup?.()
      }
    })

    it('tracks every deduplicated origin so retention cannot delete shared content', async () => {
      const { store, cleanup } = await make()
      try {
        const first = await store.put({ content: 'shared', origin: 'graph:run_1' })
        await store.put({ content: 'shared', origin: 'web_fetch' })
        expect(await store.stat(first.meta.id)).toMatchObject({
          origins: ['graph:run_1', 'web_fetch'],
          originHistoryComplete: true
        })
        expect(await store.list?.()).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: first.meta.id })
        ]))
      } finally {
        await cleanup?.()
      }
    })

    it('merges linked owners and deletes only after the final owner is released', async () => {
      const { store, cleanup } = await make()
      try {
        const first = await store.put({
          content: 'linked child result',
          linkedOwners: ['thread:parent', 'child:one']
        })
        const second = await store.put({
          content: 'linked child result',
          linkedOwners: ['child:two']
        })
        expect(second.deduped).toBe(true)
        expect((await store.stat(first.meta.id))?.linkedOwners).toEqual([
          'thread:parent',
          'child:one',
          'child:two'
        ])

        expect(await store.releaseOwner?.('child:one')).toEqual({ released: 1, deleted: 0 })
        expect(await store.get(first.meta.id)).toBe('linked child result')
        expect(await store.releaseOwner?.('thread:parent')).toEqual({ released: 1, deleted: 0 })
        expect(await store.releaseOwner?.('child:two')).toEqual({ released: 1, deleted: 1 })
        expect(await store.get(first.meta.id)).toBeNull()
      } finally {
        await cleanup?.()
      }
    })

    it('never adopts or reclaims a legacy unlinked artifact', async () => {
      const { store, cleanup } = await make()
      try {
        const legacy = await store.put({ content: 'legacy shared content' })
        await store.put({
          content: 'legacy shared content',
          linkedOwners: ['child:new']
        })
        expect(await store.stat(legacy.meta.id)).not.toHaveProperty('retention')
        expect(await store.releaseOwner?.('child:new')).toEqual({ released: 0, deleted: 0 })
        expect(await store.get(legacy.meta.id)).toBe('legacy shared content')
      } finally {
        await cleanup?.()
      }
    })

    it('promotes a linked artifact to ordinary retention when an unlinked caller dedupes it', async () => {
      const { store, cleanup } = await make()
      try {
        const linked = await store.put({
          content: 'later shared outside the child session',
          linkedOwners: ['child:one']
        })
        await store.put({ content: 'later shared outside the child session' })
        expect(await store.stat(linked.meta.id)).not.toHaveProperty('retention')
        expect(await store.releaseOwner?.('child:one')).toEqual({ released: 0, deleted: 0 })
        expect(await store.get(linked.meta.id)).toBe('later shared outside the child session')
      } finally {
        await cleanup?.()
      }
    })
  })
}

runStoreContract('InMemoryArtifactStore', async () => ({
  store: new InMemoryArtifactStore(() => '2026-06-29T00:00:00.000Z')
}))

runStoreContract('FileArtifactStore', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kun-artifacts-'))
  return {
    store: new FileArtifactStore(dir, () => '2026-06-29T00:00:00.000Z'),
    cleanup: () => rm(dir, { recursive: true, force: true })
  }
})

describe('FileArtifactStore streaming reads', () => {
  it('serializes concurrent writes so the artifact quota cannot race', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-artifact-quota-'))
    try {
      const store = new FileArtifactStore(dir, () => 't0', { maxArtifacts: 1 })
      const [first, second] = await Promise.allSettled([
        store.put({ content: 'first artifact' }),
        store.put({ content: 'second artifact' })
      ])

      expect([first, second].filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect([first, second].filter((result) => result.status === 'rejected')).toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('writes artifact data and metadata with private filesystem permissions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-artifact-private-'))
    try {
      const store = new FileArtifactStore(dir, () => 't0')
      const result = await store.put({ content: 'sensitive artifact' })

      if (process.platform !== 'win32') {
        expect((await stat(dir)).mode & 0o777).toBe(0o700)
        expect((await stat(join(dir, `${result.meta.id}.bin`))).mode & 0o777).toBe(0o600)
        expect((await stat(join(dir, `${result.meta.id}.json`))).mode & 0o777).toBe(0o600)
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('seeks a byte range and a line window from a large artifact without loading it whole', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-artifacts-'))
    try {
      const store = new FileArtifactStore(dir, () => 't0')
      const lines = Array.from({ length: 100_000 }, (_, i) => `line ${i + 1}`)
      const content = lines.join('\n')
      const { meta } = await store.put({ content })
      // Line window stops early — only the selected lines come back.
      expect(await store.readRange(meta.id, { startLine: 5, endLine: 7 })).toBe('line 5\nline 6\nline 7')
      // Byte range seek.
      expect(await store.readRange(meta.id, { offset: 0, length: 6 })).toBe('line 1')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('returns the trailing line when no final newline and the range covers it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-artifacts-'))
    try {
      const store = new FileArtifactStore(dir, () => 't0')
      const { meta } = await store.put({ content: 'a\nb\nc' })
      expect(await store.readRange(meta.id, { startLine: 3, endLine: 3 })).toBe('c')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('stitches a multibyte UTF-8 char split across a 64KiB read boundary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-artifacts-'))
    try {
      const store = new FileArtifactStore(dir, () => 't0')
      // Pad so a 3-byte char (世) straddles the 65536-byte chunk boundary, then
      // read the line that contains it; without incremental decoding the char
      // would surface as replacement characters.
      const head = 'a'.repeat(65_535)
      const content = `${head}世界\nsecond line`
      const { meta } = await store.put({ content })
      const firstLine = await store.readRange(meta.id, { startLine: 1, endLine: 1 })
      expect(firstLine).toBe(`${head}世界`)
      expect(firstLine).not.toContain('\uFFFD')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('readArtifactBounded', () => {
  it('pages UTF-8 text without replacement characters or skipped bytes', async () => {
    const { readArtifactBounded } = await import('./artifact-store.js')
    const store = new InMemoryArtifactStore(() => 't0')
    const { meta } = await store.put({ content: '中文测试' })
    const pages: string[] = []
    let offset = 0
    while (offset < meta.byteSize) {
      const page = await readArtifactBounded(store, meta.id, meta, { offset, length: 2 })
      expect(page).not.toBeNull()
      pages.push(page!.content)
      expect(page!.content).not.toContain('�')
      if (!page!.nextOffset) break
      expect(page!.nextOffset).toBeGreaterThan(offset)
      offset = page!.nextOffset
    }
    expect(pages.join('')).toBe('中文测试')
  })

  it('clamps a no-range read to the byte cap and returns a cursor', async () => {
    const { readArtifactBounded, ARTIFACT_MAX_READ_BYTES } = await import('./artifact-store.js')
    const store = new InMemoryArtifactStore(() => 't0')
    const big = 'x'.repeat(ARTIFACT_MAX_READ_BYTES + 5_000)
    const { meta } = await store.put({ content: big })
    const result = await readArtifactBounded(store, meta.id, meta, {})
    expect(result).not.toBeNull()
    expect(Buffer.byteLength(result!.content, 'utf8')).toBe(ARTIFACT_MAX_READ_BYTES)
    expect(result!.truncated).toBe(true)
    expect(result!.nextOffset).toBe(ARTIFACT_MAX_READ_BYTES)
  })

  it('clamps an oversized line range to the line cap and returns a line cursor', async () => {
    const { readArtifactBounded, ARTIFACT_MAX_READ_LINES } = await import('./artifact-store.js')
    const store = new InMemoryArtifactStore(() => 't0')
    const content = Array.from({ length: ARTIFACT_MAX_READ_LINES + 500 }, (_, i) => `l${i + 1}`).join('\n')
    const { meta } = await store.put({ content })
    const result = await readArtifactBounded(store, meta.id, meta, { startLine: 1, endLine: ARTIFACT_MAX_READ_LINES + 500 })
    expect(result).not.toBeNull()
    expect(result!.range.endLine).toBe(ARTIFACT_MAX_READ_LINES)
    expect(result!.truncated).toBe(true)
    expect(result!.nextStartLine).toBe(ARTIFACT_MAX_READ_LINES + 1)
  })

  it('reports not-truncated and no cursor when the whole artifact fits', async () => {
    const { readArtifactBounded } = await import('./artifact-store.js')
    const store = new InMemoryArtifactStore(() => 't0')
    const { meta } = await store.put({ content: 'small content' })
    const result = await readArtifactBounded(store, meta.id, meta, {})
    expect(result!.content).toBe('small content')
    expect(result!.truncated).toBe(false)
    expect(result!.nextOffset).toBeUndefined()
  })
})

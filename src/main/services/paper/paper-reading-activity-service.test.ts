import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  readPaperReadingActivity,
  resetPaperReadingActivityCache
} from './paper-reading-activity-service'
import type { ScannedPaperUnit } from './paper-library-service'

function unit(dirAbs: string, unitDir: string): ScannedPaperUnit {
  return {
    dirAbs,
    unitDir,
    meta: { version: 2, title: 't', slug: 't', importedAt: '2025-01-01T00:00:00.000Z', authors: [] },
    group: '',
    hasPdf: true,
    hasNotes: false,
    interpretationCount: 0
  }
}

describe('readPaperReadingActivity', () => {
  let root = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'paper-activity-'))
    resetPaperReadingActivityCache()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('counts annotations and card pages per unit', async () => {
    const marks = join(root, 'u1', 'marks')
    await mkdir(marks, { recursive: true })
    await writeFile(join(marks, 'annotations.json'), JSON.stringify({
      version: 1,
      items: [
        { id: 'a', kind: 'highlight', color: 'yellow', page: 1, rects: [[0, 0, 0.1, 0.1]], quote: 'q', createdAt: 'x', updatedAt: 'x' },
        { id: 'b', kind: 'highlight', color: 'blue', page: 1, rects: [[0, 0, 0.1, 0.1]], quote: 'q', createdAt: 'x', updatedAt: 'x' },
        { id: 'c', kind: 'highlight', color: 'pink', page: 4, rects: [[0, 0, 0.1, 0.1]], quote: 'q', createdAt: 'x', updatedAt: 'x' }
      ]
    }))
    await writeFile(join(marks, 't1.json'), JSON.stringify({ id: 't1', kind: 'translate', page: 2, quote: 'q', translation: 'x', targetLanguage: 'zh', model: 'm', createdAt: 'x' }))
    await writeFile(join(marks, 'v1.json'), JSON.stringify({ id: 'v1', kind: 'visual', page: 2, rect: [0, 0, 0.5, 0.5], image: { path: 'assets/v1.png' }, createdAt: 'x', updatedAt: 'x' }))
    // Corrupt file is skipped, not fatal.
    await writeFile(join(marks, 'broken.json'), '{oops')

    const activity = await readPaperReadingActivity(
      [unit(join(root, 'u1'), 'papers/u1')],
      { version: 1, units: { 'papers/u1': { lastPage: 6, pageCount: 10 } } }
    )
    expect(activity['papers/u1']).toEqual({
      pages: [2, 2, 0, 1],
      pageCount: 10,
      lastPage: 6
    })
  })

  it('omits units with no marks and no local state', async () => {
    await mkdir(join(root, 'empty'), { recursive: true })
    const activity = await readPaperReadingActivity(
      [unit(join(root, 'empty'), 'papers/empty')],
      { version: 1, units: {} }
    )
    expect(activity).toEqual({})
  })

  it('serves repeated reads from the mtime cache', async () => {
    const marks = join(root, 'u2', 'marks')
    await mkdir(marks, { recursive: true })
    await writeFile(join(marks, 'annotations.json'), JSON.stringify({
      version: 1,
      items: [{ id: 'a', kind: 'highlight', color: 'yellow', page: 3, rects: [[0, 0, 0.1, 0.1]], quote: 'q', createdAt: 'x', updatedAt: 'x' }]
    }))
    const scanned = [unit(join(root, 'u2'), 'papers/u2')]
    const first = await readPaperReadingActivity(scanned, { version: 1, units: {} })
    expect(first['papers/u2'].pages).toEqual([0, 0, 1])
    // Add a card file — signature change must invalidate the cache.
    await writeFile(join(marks, 'ask1.json'), JSON.stringify({ id: 'ask1', kind: 'ask', page: 3, quote: 'q', question: '?', createdAt: 'x' }))
    const second = await readPaperReadingActivity(scanned, { version: 1, units: {} })
    expect(second['papers/u2'].pages).toEqual([0, 0, 2])
  })
})

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readJsonlTail, readLatestItemsFromJsonl } from './file-session-jsonl.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function jsonlFile(content: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-jsonl-scan-'))
  roots.push(root)
  const path = join(root, 'messages.jsonl')
  await writeFile(path, content)
  return path
}

const item = (id: string, text: string) => ({ id, kind: 'assistant_text', text })

describe('JSONL record scanning across reads', () => {
  it('reads records split across many reads, including split UTF-8 sequences', async () => {
    // Multi-byte characters land on every possible 7-byte read boundary.
    const text = '汉字🙂é'.repeat(40)
    const records = [item('a', text), item('b', 'x'.repeat(300)), item('a', `${text}!`), item('c', '')]
    const path = await jsonlFile(`${records.map((record) => JSON.stringify(record)).join('\n')}\n\n`)

    for (const chunkBytes of [1, 7, 64, 1024 * 1024]) {
      const result = await readLatestItemsFromJsonl(path, { chunkBytes })
      expect(result.items).toEqual([records[2], records[1], records[3]])
      expect(result).toMatchObject({ rawCount: 4, malformedCount: 0, incompleteTrailingRecord: false })
    }
  })

  it('accepts an unterminated final record and flags a partial one', async () => {
    const complete = await jsonlFile(`${JSON.stringify(item('a', 'one'))}\n${JSON.stringify(item('b', 'two'))}`)
    expect((await readLatestItemsFromJsonl(complete, { chunkBytes: 5 })).items.map((entry) => entry.id))
      .toEqual(['a', 'b'])

    const partial = await jsonlFile(`${JSON.stringify(item('a', 'one'))}\nnot json\n{"id":"b","te`)
    expect(await readLatestItemsFromJsonl(partial, { chunkBytes: 5 })).toMatchObject({
      items: [item('a', 'one')], rawCount: 1, malformedCount: 1, incompleteTrailingRecord: true
    })
  })

  it('rejects oversized complete and in-flight records', async () => {
    const big = JSON.stringify(item('a', 'x'.repeat(200)))
    await expect(readLatestItemsFromJsonl(await jsonlFile(`${big}\n`), { maxRecordBytes: 100, chunkBytes: 1024 }))
      .rejects.toThrow('item history record exceeds 100 bytes')
    await expect(readLatestItemsFromJsonl(await jsonlFile(big.slice(0, 150)), { maxRecordBytes: 100, chunkBytes: 16 }))
      .rejects.toThrow('item history record exceeds 100 bytes')
  })

  it('treats a missing log as empty history', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-jsonl-scan-'))
    roots.push(root)
    expect((await readLatestItemsFromJsonl(join(root, 'missing.jsonl'))).items).toEqual([])
    expect(await readJsonlTail(join(root, 'missing.jsonl'), 12)).toEqual({ lines: [], endOffset: 12 })
  })
})

describe('JSONL tail reads', () => {
  it('returns complete lines from an offset and leaves an in-flight record unconsumed', async () => {
    const first = JSON.stringify(item('a', 'é'.repeat(30)))
    const second = JSON.stringify(item('b', '🙂'))
    const path = await jsonlFile(`${first}\n\n${second}\n{"id":"c"`)
    const firstBytes = Buffer.byteLength(first) + 1
    const end = firstBytes + 1 + Buffer.byteLength(second) + 1

    for (const chunkBytes of [3, 1024 * 1024]) {
      expect(await readJsonlTail(path, 0, { chunkBytes })).toEqual({ lines: [first, '', second], endOffset: end })
      expect(await readJsonlTail(path, firstBytes, { chunkBytes })).toEqual({ lines: ['', second], endOffset: end })
      expect(await readJsonlTail(path, end, { chunkBytes })).toEqual({ lines: [], endOffset: end })
    }
  })

  it('rejects an oversized complete line but not a large in-flight tail', async () => {
    const path = await jsonlFile(`${'x'.repeat(50)}\n${'y'.repeat(500)}`)
    await expect(readJsonlTail(path, 0, { maxRecordBytes: 40, chunkBytes: 8 }))
      .rejects.toThrow('jsonl record exceeds 40 bytes')
    expect(await readJsonlTail(path, 51, { maxRecordBytes: 40, chunkBytes: 8 })).toEqual({ lines: [], endOffset: 51 })
  })
})

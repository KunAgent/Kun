import { appendFile, mkdtemp, open, rm, stat, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeAssistantTextItem } from '../domain/item.js'
import { FileSessionItemIndex } from '../adapters/file/file-session-item-index.js'

const PAGE_SIZE = 50
const HOT_PAGES = 100
const BENCHMARK_INDEX_MAX_BYTES = 256 * 1024 * 1024
const WRITE_BATCH_ROWS = 5_000

export type ItemIndexPaginationBenchmarkResult = {
  records: number
  coldMs: number
  hotTotalMs: number
  hotP50Ms: number
  hotP95Ms: number
  appendMs: number
  postAppendPageMs: number
  rebuildMs: number
  postReplacementPageMs: number
  heapDeltaBytes: number
  cache: ReturnType<FileSessionItemIndex['cacheStats']>
}

export async function runItemIndexPaginationBenchmark(
  counts: readonly number[] = [10_000, 100_000, 500_000]
): Promise<ItemIndexPaginationBenchmarkResult[]> {
  const results: ItemIndexPaginationBenchmarkResult[] = []
  for (const count of counts) results.push(await benchmarkCount(count))
  return results
}

async function benchmarkCount(count: number): Promise<ItemIndexPaginationBenchmarkResult> {
  const root = await mkdtemp(join(tmpdir(), `kun-item-index-bench-${count}-`))
  const sourcePath = join(root, 'messages.jsonl')
  const indexPath = join(root, 'messages-index.jsonl')
  const statePath = join(root, 'messages-index.state.json')
  try {
    await seedFiles({ count, sourcePath, indexPath, statePath })
    const index = new FileSessionItemIndex({ indexMaxBytes: BENCHMARK_INDEX_MAX_BYTES })
    const heapBefore = process.memoryUsage().heapUsed
    const coldStarted = performance.now()
    let page = await index.loadPage({
      sourcePath, indexPath, statePath,
      options: { maxItems: PAGE_SIZE, maxBytes: 4 * 1024 * 1024 }
    })
    const coldMs = performance.now() - coldStarted
    const heapDeltaBytes = process.memoryUsage().heapUsed - heapBefore

    const samples: number[] = []
    const hotStarted = performance.now()
    for (let value = 0; value < HOT_PAGES && page?.hasMore; value += 1) {
      const started = performance.now()
      page = await index.loadPage({
        sourcePath, indexPath, statePath,
        options: { before: page.nextCursor, maxItems: PAGE_SIZE, maxBytes: 4 * 1024 * 1024 }
      })
      samples.push(performance.now() - started)
    }
    const hotTotalMs = performance.now() - hotStarted

    const appended = makeAssistantTextItem({
      id: `item_${count}`,
      threadId: 'thread_benchmark',
      turnId: `turn_${count}`,
      text: `message ${count}`,
      status: 'completed'
    })
    const appendStarted = performance.now()
    await index.append({
      sourcePath, indexPath, statePath,
      threadId: 'thread_benchmark', evidencePath: join(root, 'messages-tail.evidence.json'),
      item: appended, record: JSON.stringify(appended)
    })
    const appendMs = performance.now() - appendStarted
    const postAppendStarted = performance.now()
    await index.loadPage({
      sourcePath, indexPath, statePath,
      options: { maxItems: PAGE_SIZE, maxBytes: 4 * 1024 * 1024 }
    })
    const postAppendPageMs = performance.now() - postAppendStarted

    const rebuildStarted = performance.now()
    await index.rebuild({
      sourcePath, indexPath, statePath,
      threadId: 'thread_benchmark', evidencePath: join(root, 'messages-tail.evidence.json')
    })
    const rebuildMs = performance.now() - rebuildStarted
    const postReplacementStarted = performance.now()
    await index.loadPage({
      sourcePath, indexPath, statePath,
      options: { maxItems: PAGE_SIZE, maxBytes: 4 * 1024 * 1024 }
    })
    const postReplacementPageMs = performance.now() - postReplacementStarted

    const sorted = [...samples].sort((left, right) => left - right)
    return {
      records: count,
      coldMs,
      hotTotalMs,
      hotP50Ms: percentile(sorted, 0.5),
      hotP95Ms: percentile(sorted, 0.95),
      appendMs,
      postAppendPageMs,
      rebuildMs,
      postReplacementPageMs,
      heapDeltaBytes,
      cache: index.cacheStats()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function seedFiles(input: {
  count: number
  sourcePath: string
  indexPath: string
  statePath: string
}): Promise<void> {
  const source = await open(input.sourcePath, 'w', 0o600)
  const index = await open(input.indexPath, 'w', 0o600)
  let sourceOffset = 0
  try {
    for (let start = 0; start < input.count; start += WRITE_BATCH_ROWS) {
      const sourceLines: string[] = []
      const indexLines: string[] = []
      const end = Math.min(input.count, start + WRITE_BATCH_ROWS)
      for (let value = start; value < end; value += 1) {
        const item = makeAssistantTextItem({
          id: `item_${value}`,
          threadId: 'thread_benchmark',
          turnId: `turn_${value}`,
          text: `message ${value}`,
          status: 'completed'
        })
        const record = JSON.stringify(item)
        const recordBytes = Buffer.byteLength(record, 'utf8')
        sourceLines.push(record)
        indexLines.push(JSON.stringify({
          itemId: item.id,
          turnId: item.turnId,
          kind: item.kind,
          isPublic: true,
          baseline: false,
          offset: sourceOffset,
          recordBytes
        }))
        sourceOffset += recordBytes + 1
      }
      await source.write(`${sourceLines.join('\n')}\n`)
      await index.write(`${indexLines.join('\n')}\n`)
    }
  } finally {
    await Promise.all([source.close(), index.close()])
  }
  const sourceInfo = await stat(input.sourcePath)
  await writeFile(input.statePath, JSON.stringify({
    version: 3,
    tailReady: true,
    sourceBytes: sourceInfo.size,
    sourceMtimeMs: sourceInfo.mtimeMs,
    sourceDev: sourceInfo.dev,
    sourceIno: sourceInfo.ino,
    rowCount: input.count,
    kindCounts: { assistant_text: input.count },
    baselineCount: 0
  }), { mode: 0o600 })
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0
}

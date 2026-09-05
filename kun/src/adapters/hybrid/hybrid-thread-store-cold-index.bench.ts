import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HybridThreadStore } from './hybrid-thread-store.js'
import { createThreadRecord } from '../../domain/thread.js'
import { stripThreadItemBodies } from './hybrid-thread-projection.js'

const COUNTS = [2_000, 10_000]

async function waitUntilReady(store: HybridThreadStore, timeoutMs = 300_000): Promise<number> {
  const started = Date.now()
  for (;;) {
    const status = store.indexStatus()
    if (status.status === 'ready') return Date.now()
    if (Date.now() - started > timeoutMs) throw new Error('benchmark index never became ready')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

async function seedThreads(root: string, count: number): Promise<void> {
  const threadsDir = join(root, 'threads')
  await mkdir(threadsDir, { recursive: true })
  for (let index = 0; index < count; index += 1) {
    const id = `thread_${String(index).padStart(6, '0')}`
    const thread = createThreadRecord({
      id,
      title: `Benchmark thread ${index}`,
      workspace: '/tmp/workspace',
      model: 'benchmark-model'
    })
    const dir = join(threadsDir, id)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'metadata.jsonl'), `${JSON.stringify({
      kind: 'thread_metadata',
      version: 1,
      timestamp: thread.updatedAt,
      thread: stripThreadItemBodies(thread)
    })}\n`)
    // A minority of threads carry an events.jsonl so usage backfill does real work.
    if (index % 10 === 0) await writeFile(join(dir, 'events.jsonl'), '')
  }
}

describe.skipIf(process.env.KUN_BENCH !== '1')('HybridThreadStore cold-index benchmark', () => {
  for (const count of COUNTS) {
    it(`cold index first page and backfill with ${count} threads`, { timeout: 600_000 }, async () => {
      const root = await mkdtemp(join(tmpdir(), 'kun-cold-bench-'))
      await seedThreads(root, count)
      const store = new HybridThreadStore({ dataDir: root })
      try {
        await store.ready()
        const started = Date.now()
        const page = await store.listPage({ limit: 25 })
        const firstPageMs = Date.now() - started
        expect(page.threads.length).toBeGreaterThan(0)

        const readyAt = await waitUntilReady(store)
        const indexReadyMs = readyAt - started
        await store.waitForBackfill()
        const backfillMs = Date.now() - started
        console.log(
          `[cold-index-bench] N=${count} firstPage=${firstPageMs}ms indexReady=${indexReadyMs}ms backfill=${backfillMs}ms`
        )
      } finally {
        store.close()
        await rm(root, { recursive: true, force: true })
      }
    })
  }
})

import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileSessionStore } from './file-session-store.js'
import type { RuntimeEvent } from '../../contracts/events.js'

const COUNTS = [10_000]

function heartbeat(threadId: string, seq: number): RuntimeEvent {
  return {
    seq,
    timestamp: '2026-09-04T00:00:00.000Z',
    threadId,
    kind: 'heartbeat'
  }
}

describe.skipIf(process.env.KUN_BENCH !== '1')('FileSessionStore event append benchmark', () => {
  for (const count of COUNTS) {
    it(`appends ${count} small events`, { timeout: 600_000 }, async () => {
      const root = await mkdtemp(join(tmpdir(), 'kun-append-bench-'))
      const store = new FileSessionStore({ dataDir: root })
      const threadId = 'thread-bench'
      try {
        const started = Date.now()
        for (let seq = 1; seq <= count; seq += 1) {
          await store.appendEvent(threadId, heartbeat(threadId, seq))
        }
        const elapsedMs = Date.now() - started
        expect(elapsedMs).toBeGreaterThan(0)
        const opsPerSecond = Math.round(count / (elapsedMs / 1000))
        console.log(`[event-append-bench] N=${count} elapsed=${elapsedMs}ms ops=${opsPerSecond}/s`)
      } finally {
        await store.close()
        await rm(root, { recursive: true, force: true })
      }
    })
  }
})

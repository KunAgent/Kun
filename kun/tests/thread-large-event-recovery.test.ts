import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileSessionStore } from '../src/adapters/file/file-session-store.js'
import { InMemoryEventBus } from '../src/adapters/in-memory-event-bus.js'
import type { RuntimeEvent } from '../src/contracts/events.js'
import type { TurnItem } from '../src/contracts/items.js'
import { createThreadRecord } from '../src/domain/thread.js'
import { createTurnRecord } from '../src/domain/turn.js'
import { buildEventStreamResponse } from '../src/server/routes/events.js'
import { getThreadTimeline } from '../src/server/routes/threads.js'
import type { ThreadService } from '../src/services/thread-service.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function persistedThread() {
  const root = await mkdtemp(join(tmpdir(), 'kun-large-event-recovery-'))
  roots.push(root)
  const thread = createThreadRecord({ id: 'thr_large_event', title: 'Large result', workspace: root, model: 'm' })
  const turn = createTurnRecord({ id: 'turn_large_event', threadId: thread.id, prompt: 'Read output', status: 'completed' })
  thread.turns = [turn]
  const timestamp = '2026-10-26T00:00:00.000Z'
  const item: TurnItem = {
    id: 'item_large_result', threadId: thread.id, turnId: turn.id,
    role: 'tool', kind: 'tool_result', status: 'completed', createdAt: timestamp,
    toolName: 'acp:fs.write', callId: 'call_large', toolKind: 'tool_call',
    output: { content: 'x'.repeat(2 * 1024 * 1024) }, isError: false
  }
  const events: RuntimeEvent[] = [
    { kind: 'heartbeat', threadId: thread.id, seq: 1, timestamp },
    { kind: 'item_created', threadId: thread.id, turnId: turn.id, itemId: item.id, seq: 2, timestamp, item },
    { kind: 'heartbeat', threadId: thread.id, seq: 3, timestamp }
  ]
  const directory = join(root, 'threads', thread.id)
  await mkdir(directory, { recursive: true })
  const eventPath = join(directory, 'events.jsonl')
  const contents = events.map((event) => JSON.stringify(event)).join('\n') + '\n'
  await writeFile(eventPath, contents)
  await writeFile(join(directory, 'messages.jsonl'), `${JSON.stringify(item)}\n`)
  return { thread, eventPath, contents, coldStore: () => new FileSessionStore({ dataDir: root }) }
}

describe('cold thread recovery with large persisted tool results', () => {
  it('hydrates the timeline with the durable SSE cursor and preserves the event log', async () => {
    const f = await persistedThread()
    const response = await getThreadTimeline(
      { get: async () => f.thread } as unknown as ThreadService,
      f.thread.id, new Request(`http://kun.local/v1/threads/${f.thread.id}/timeline`), f.coldStore()
    )
    expect(response.status).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.latestSeq).toBe(3)
    expect(body.turns[0].items[0].id).toBe('item_large_result')
    expect(await readFile(f.eventPath, 'utf8')).toBe(f.contents)
  })

  it('replays a large record and resumes from its cursor without a reset or error', async () => {
    const f = await persistedThread()
    const eventBus = new InMemoryEventBus()
    const first = buildEventStreamResponse({
      request: new Request('http://kun.local/events?since_seq=1'),
      threadId: f.thread.id, eventBus, sessionStore: f.coldStore()
    })
    const page = await first.text()
    expect(page).toContain('id: 2\n')
    expect(page).toContain('item_large_result')
    expect(page).not.toContain('event: error')
    const abort = new AbortController()
    const next = buildEventStreamResponse({
      request: new Request('http://kun.local/events?since_seq=2', { signal: abort.signal }),
      threadId: f.thread.id, eventBus, sessionStore: f.coldStore()
    })
    const reader = next.body!.getReader()
    let replay = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        replay += new TextDecoder().decode(value)
        if (replay.includes('event: replay_synchronized')) break
      }
      expect(replay).toContain('id: 3\n')
      expect(replay).toContain('event: replay_synchronized')
      expect(replay).not.toContain('event: error')
      expect(replay).not.toContain('item_large_result')
    } finally {
      abort.abort()
      await reader.cancel()
    }
  })
})

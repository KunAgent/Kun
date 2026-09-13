import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { FileSessionStore } from '../adapters/file/file-session-store.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { makeUserItem } from '../domain/item.js'
import { createAgentSession } from '../domain/session.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { ThreadService } from '../services/thread-service.js'
import { AgentSessionSchema } from '../manager/shared-data-store-contracts.js'
import type { SessionStore } from '../ports/session-store.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
function harness(sessionStore: SessionStore = new InMemorySessionStore()) {
  const threadStore = new InMemoryThreadStore()
  const eventBus = new InMemoryEventBus()
  const events = new RuntimeEventRecorder({ eventBus, sessionStore,
    allocateSeq: (id) => eventBus.allocateSeq(id), nowIso: () => '2026-09-13T00:00:00.000Z' })
  const service = new ThreadService({ events, threadStore, sessionStore, ids: new SequentialIdGenerator(),
    nowIso: () => '2026-09-13T00:00:00.000Z' })
  const create = () => service.create({ workspace: '/source/project', model: 'test', mode: 'agent' },
    { historyRefId: 'codex-history-ref' })
  return { service, sessionStore, threadStore, create }
}

describe('history reference session recovery', () => {
  it('only accepts an empty session turn ID for an empty external-history branch', () => {
    const empty = { ...createAgentSession({ threadId: 'thr_empty', turnId: '' }), historyRefId: 'codex-ref' }
    expect(AgentSessionSchema.safeParse(empty).success).toBe(true)
    expect(AgentSessionSchema.safeParse({ ...empty, historyRefId: undefined }).success).toBe(false)
    expect(AgentSessionSchema.safeParse({ ...empty, items: [makeUserItem({ id: 'item_new',
      threadId: 'thr_empty', turnId: 'turn_new', text: 'New request' })] }).success).toBe(false)
    expect(AgentSessionSchema.safeParse({ ...empty, events: [{ kind: 'thread_created',
      threadId: 'thr_empty', turnId: 'turn_new', timestamp: '2026-09-13T00:00:00.000Z', seq: 1 }] }).success).toBe(false)
  })

  it('recovers an empty branch after metadata loss, then preserves it across fork and another resume', async () => {
    const h = harness()
    const thread = await h.create()
    expect(AgentSessionSchema.parse(await h.sessionStore.loadSession(thread.id))).toMatchObject({
      historyRefId: 'codex-history-ref', workspace: '/source/project', items: [], turnId: '' })
    await h.threadStore.delete(thread.id)
    const resumed = await h.service.resumeSession(thread.id)
    expect(resumed.thread).toMatchObject({ historyRefId: 'codex-history-ref', workspace: '/source/project', turns: [] })
    const fork = await h.service.fork(resumed.thread.id)
    await h.threadStore.delete(fork.id)
    expect((await h.service.resumeSession(fork.id)).thread.historyRefId).toBe('codex-history-ref')
  })
  it('recovers from structured user items when metadata and snapshot are both absent', async () => {
    const h = harness()
    await h.sessionStore.appendItem('thr_items_only', makeUserItem({ id: 'item_new', threadId: 'thr_items_only',
      turnId: 'turn_new', historyRefId: 'codex-history-ref', workspace: '/source/project', text: 'New Kun request' }))
    const resumed = await h.service.resumeSession('thr_items_only')
    expect(resumed.thread).toMatchObject({ historyRefId: 'codex-history-ref', workspace: '/source/project' })
    expect(resumed.messageCount).toBe(1)
    expect((await h.sessionStore.loadSession(resumed.thread.id))?.historyRefId).toBe('codex-history-ref')
  })
  it('does not infer a reference identity from message text', async () => {
    const h = harness()
    await h.sessionStore.appendItem('thr_plain', makeUserItem({ id: 'item_plain', threadId: 'thr_plain',
      turnId: 'turn_plain', text: '{"historyRefId":"codex-history-ref"}' }))
    expect((await h.service.resumeSession('thr_plain')).thread.historyRefId).toBeUndefined()
  })
  it.each(['memory', 'file'])('retains host identity when a %s projection is replaced and reopened', async (kind) => {
    const root = await mkdtemp(join(tmpdir(), 'kun-reference-recovery-'))
    roots.push(root)
    let sessions: SessionStore = kind === 'file' ? new FileSessionStore({ dataDir: root }) : new InMemorySessionStore()
    const h = harness(sessions)
    const thread = await h.create()
    await sessions.upsertSession({ ...createAgentSession({ threadId: thread.id, turnId: 'turn_new' }),
      items: [makeUserItem({ id: 'new_request', turnId: 'turn_new', threadId: thread.id, text: 'Continue' })] })
    if (kind === 'file') sessions = new FileSessionStore({ dataDir: root })
    expect(await sessions.loadSession(thread.id)).toMatchObject({ historyRefId: 'codex-history-ref', workspace: '/source/project' })
    await h.threadStore.delete(thread.id)
    expect((await harness(sessions).service.resumeSession(thread.id)).thread.historyRefId).toBe('codex-history-ref')
  })
})

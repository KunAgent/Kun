import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { FileSessionStore } from '../adapters/file/file-session-store.js'
import { HybridThreadStore } from '../adapters/hybrid/hybrid-thread-store.js'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { makeUserItem } from '../domain/item.js'
import { createThreadRecord } from '../domain/thread.js'
import { appendTurnItem, createTurnRecord } from '../domain/turn.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { ApprovalConsentVerifier } from '../server/approval-consent.js'
import { Router } from '../server/router.js'
import { registerThreadRoutes } from '../server/routes/register-thread-routes.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { TurnService } from './turn-service.js'
import { ThreadService } from './thread-service.js'
import { deriveWorkSessionTitle, recoverWorkSessionTitle } from './work-session-title.js'

function fixture() {
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const bus = new InMemoryEventBus()
  const nowIso = () => '2026-10-01T00:00:00.000Z'
  const events = new RuntimeEventRecorder({ sessionStore, eventBus: bus, nowIso,
    allocateSeq: (id) => bus.allocateSeq(id) })
  const turns = new TurnService({ threadStore, sessionStore, events, nowIso,
    ids: new SequentialIdGenerator(), inflight: new InflightTracker(),
    steering: new SteeringQueue(), compactor: new ContextCompactor() })
  return { threadStore, sessionStore, bus, events, turns }
}

async function seedHistory(f: ReturnType<typeof fixture>, options: {
  title?: string; titleAuto?: boolean; surface?: 'write' | 'code'; displayText?: string; text?: string
} = {}) {
  const item = makeUserItem({ id: 'item_turn_1_user', threadId: 'thread', turnId: 'turn_1',
    text: options.text ?? '[写作上下文]\n交互约定: test\n\nExplain the paper', displayText: options.displayText })
  if (item.kind !== 'user_message') throw new Error('expected user item')
  const turn = appendTurnItem(createTurnRecord({ id: 'turn_1', threadId: 'thread',
    prompt: item.text, status: 'completed', agentSurface: options.surface ?? 'write' }), item)
  const thread = createThreadRecord({ id: 'thread', workspace: '/workspace', model: 'test',
    title: options.title ?? 'Write Assistant', ...(options.titleAuto !== undefined ? { titleAuto: options.titleAuto } : {}),
    agentSurface: options.surface ?? 'write' })
  await f.threadStore.upsert({ ...thread, updatedAt: '2026-09-01T00:00:00.000Z', turns: [turn] })
  await f.sessionStore.appendItem('thread', item)
}

describe('Work session titles', () => {
  it('names the first accepted Work turn using the visible message and emits a title event', async () => {
    const f = fixture()
    await f.threadStore.upsert(createThreadRecord({ id: 'thread', title: 'Write Assistant', titleAuto: true,
      workspace: '/workspace', model: 'test', agentSurface: 'write' }))
    const started = await f.turns.startTurn({ threadId: 'thread', request: {
      prompt: 'internal context and long document', displayText: '帮我读一下这篇论文', agentSurface: 'write'
    } })
    expect((await f.threadStore.get('thread'))?.title).toBe('帮我读一下这篇论文')
    expect((await f.threadStore.get('thread'))?.titleAuto).toBe(true)
    expect(f.bus.snapshotSince('thread', 0)).toContainEqual(expect.objectContaining({
      kind: 'thread_updated', title: '帮我读一下这篇论文', titleAuto: true
    }))
    expect(started.threadId).toBe('thread')
  })

  it.each(['code', 'write'] as const)('never changes a manually locked %s title', async (surface) => {
    const f = fixture()
    await f.threadStore.upsert(createThreadRecord({ id: 'thread', title: 'Write Assistant', titleAuto: false,
      workspace: '/workspace', model: 'test', agentSurface: surface }))
    await f.turns.startTurn({ threadId: 'thread', request: { prompt: 'New topic', agentSurface: surface } })
    expect((await f.threadStore.get('thread'))?.title).toBe('Write Assistant')
  })

  it('recovers an old title from the first visible message without changing the activity time', async () => {
    const f = fixture()
    await seedHistory(f, { displayText: '读一下历史论文' })
    const page = vi.spyOn(f.sessionStore, 'loadItemPage')
    const updated = await recoverWorkSessionTitle(f, 'thread')
    expect(updated).toMatchObject({ title: '读一下历史论文', titleAuto: true,
      updatedAt: '2026-09-01T00:00:00.000Z' })
    expect(page).toHaveBeenCalledWith('thread', expect.objectContaining({
      turnId: 'turn_1', anchorTurnId: 'turn_1', maxItems: 2
    }))
    expect(await recoverWorkSessionTitle(f, 'thread')).toBeNull()
  })

  it('requires authorization and restores a title through the runtime route', async () => {
    const f = fixture()
    await seedHistory(f, { displayText: '历史会话标题' })
    const threads = new ThreadService({ threadStore: f.threadStore, sessionStore: f.sessionStore,
      events: f.events, ids: new SequentialIdGenerator(), nowIso: () => '2026-10-01T00:00:00.000Z' })
    const router = new Router()
    registerThreadRoutes(router, { threadService: threads, runtimeToken: 'secret', insecure: false } as ServerRuntime,
      new ApprovalConsentVerifier('secret'))
    const path = '/v1/threads/thread/work-title/recover'
    const route = router.match('POST', path)
    if (!route) throw new Error('Work title recovery route missing')
    const denied = await route.handler(new Request(`http://localhost${path}`, { method: 'POST' }), { params: route.params })
    expect(denied.status).toBe(401)
    expect((await f.threadStore.get('thread'))?.title).toBe('Write Assistant')
    const response = await route.handler(new Request(`http://localhost${path}`, {
      method: 'POST', headers: { authorization: 'Bearer secret' }
    }), { params: route.params })
    expect(response.status).toBe(200)
    const body: unknown = response instanceof Response ? await response.json() : JSON.parse(response.body)
    expect(body).toMatchObject({ title: '历史会话标题', titleAuto: true, agentSurface: 'write' })
    expect((await f.threadStore.get('thread'))?.title).toBe('历史会话标题')
  })

  it('strips a legacy Work envelope when no display text was stored', async () => {
    const f = fixture()
    await seedHistory(f)
    expect((await recoverWorkSessionTitle(f, 'thread'))?.title).toBe('Explain the paper')
  })

  it('recovers a legacy title when document context exceeds the timeline preview', async () => {
    const f = fixture()
    await seedHistory(f, { text: '[写作上下文]\n旧上下文\n\n[Office 文档上下文]\n' +
      '文'.repeat(50_000) + '\n[/Office 文档上下文]\n\nSummarize the paper' })
    const page = vi.spyOn(f.sessionStore, 'loadItemPage')
    expect((await recoverWorkSessionTitle(f, 'thread'))?.title).toBe('Summarize the paper')
    expect(page).toHaveBeenCalledTimes(2)
    expect(page).toHaveBeenLastCalledWith('thread', expect.objectContaining({
      turnId: 'turn_1', anchorTurnId: 'turn_1', maxItems: 1, maxBytes: 16 * 1024 * 1024
    }))
  })

  it('recovers a long legacy request from disk and persists its title across reopening', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-work-title-'))
    let threadStore = new HybridThreadStore({ dataDir: root })
    const sessionStore = new FileSessionStore({ dataDir: root })
    const bus = new InMemoryEventBus()
    const nowIso = () => '2026-10-01T00:00:00.000Z'
    const events = new RuntimeEventRecorder({ sessionStore, eventBus: bus, nowIso,
      allocateSeq: (id) => bus.allocateSeq(id) })
    try {
      const item = makeUserItem({ id: 'item_turn_1_user', threadId: 'thread', turnId: 'turn_1',
        text: '[写作上下文]\n旧上下文\n\n[Office 文档上下文]\n' +
          '文'.repeat(50_000) + '\n[/Office 文档上下文]\n\nSummarize the paper' })
      if (item.kind !== 'user_message') throw new Error('expected user item')
      const turn = appendTurnItem(createTurnRecord({ id: 'turn_1', threadId: 'thread',
        prompt: item.text, status: 'completed', agentSurface: 'write' }), item)
      const thread = createThreadRecord({ id: 'thread', workspace: '/workspace', model: 'test',
        title: 'Write Assistant', titleAuto: true, agentSurface: 'write' })
      await threadStore.upsert({ ...thread, updatedAt: '2026-09-01T00:00:00.000Z', turns: [turn] })
      await sessionStore.appendItem('thread', item)
      expect((await recoverWorkSessionTitle({ threadStore, sessionStore, events }, 'thread'))?.title)
        .toBe('Summarize the paper')
      await threadStore.shutdown()
      threadStore = new HybridThreadStore({ dataDir: root })
      expect(await threadStore.getMetadata('thread')).toMatchObject({
        title: 'Summarize the paper', titleAuto: true, updatedAt: '2026-09-01T00:00:00.000Z'
      })
    } finally {
      await threadStore.shutdown()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('publishes the automatic title before a competing manual rename', async () => {
    const f = fixture()
    await seedHistory(f)
    const threads = new ThreadService({ threadStore: f.threadStore, sessionStore: f.sessionStore,
      events: f.events, ids: new SequentialIdGenerator(), nowIso: () => '2026-10-01T00:00:00.000Z' })
    let release!: () => void
    let entered!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const started = new Promise<void>((resolve) => { entered = resolve })
    const appendEvent = f.sessionStore.appendEvent.bind(f.sessionStore)
    vi.spyOn(f.sessionStore, 'appendEvent').mockImplementation(async (threadId, event) => {
      if (event.kind === 'thread_updated' && event.titleAuto === true) {
        entered()
        await blocked
      }
      return appendEvent(threadId, event)
    })
    const recovery = recoverWorkSessionTitle(f, 'thread')
    await started
    const rename = threads.update('thread', { title: 'Manual title', titleAuto: false })
    await new Promise((resolve) => setTimeout(resolve, 10))
    const titleWhileBlocked = (await f.threadStore.get('thread'))?.title
    release()
    await Promise.all([recovery, rename])
    expect(titleWhileBlocked).toBe('Manual title')
    const titles = f.bus.snapshotSince('thread', 0)
      .filter((event) => event.kind === 'thread_updated')
      .map((event) => event.kind === 'thread_updated' && event.title)
    expect(titles).toEqual(['Explain the paper', 'Manual title'])
    expect(await f.threadStore.get('thread')).toMatchObject({ title: 'Manual title', titleAuto: false })
  })

  it('does not rename Code, locked, archived, or empty sessions', async () => {
    for (const options of [{ surface: 'code' as const }, { titleAuto: false }, { title: 'My title' }]) {
      const f = fixture()
      await seedHistory(f, options)
      expect(await recoverWorkSessionTitle(f, 'thread')).toBeNull()
    }
    const f = fixture()
    await seedHistory(f)
    await f.threadStore.upsert({ ...(await f.threadStore.get('thread'))!, status: 'archived' })
    expect(await recoverWorkSessionTitle(f, 'thread')).toBeNull()
    await f.threadStore.upsert(createThreadRecord({ id: 'empty', title: 'Write Assistant', titleAuto: true,
      workspace: '/workspace', model: 'test', agentSurface: 'write' }))
    expect(await recoverWorkSessionTitle(f, 'empty')).toBeNull()
  })

  it('does not overwrite a manual rename made while history is being read', async () => {
    const f = fixture()
    await seedHistory(f)
    let release!: () => void
    let entered!: () => void
    const waiting = new Promise<void>((resolve) => { release = resolve })
    const started = new Promise<void>((resolve) => { entered = resolve })
    const original = f.sessionStore.loadItemPage.bind(f.sessionStore)
    vi.spyOn(f.sessionStore, 'loadItemPage').mockImplementation(async (...args) => {
      entered()
      await waiting
      return original(...args)
    })
    const pending = recoverWorkSessionTitle(f, 'thread')
    await started
    await f.threadStore.upsert({ ...(await f.threadStore.get('thread'))!, title: 'Manual title', titleAuto: false })
    release()
    expect(await pending).toBeNull()
    expect((await f.threadStore.get('thread'))?.title).toBe('Manual title')
  })

  it('uses a visible file name when no message text exists', () => {
    const item = makeUserItem({ id: 'item', threadId: 'thread', turnId: 'turn', text: '',
      fileReferences: [{ path: '/workspace/report.pdf', relativePath: 'report.pdf', name: 'report.pdf' }] })
    if (item.kind !== 'user_message') throw new Error('expected user item')
    expect(deriveWorkSessionTitle(item)).toBe('report.pdf')
  })
})

import { describe, expect, it, vi } from 'vitest'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ThreadActivityRegistry } from '../../services/thread-activity-registry.js'
import { ThreadService } from '../../services/thread-service.js'
import { remoteFixture } from '../testing/runtime.test-support.js'
import { RemoteDirectoryFeed, DIRECTORY_SPACING_MS } from './feed.js'
import { registerRemoteDirectoryRoutes } from './routes.js'
import { roomDirectoryChanges } from './changes.js'

async function fixture() {
  const f = await remoteFixture(), registry = new ThreadActivityRegistry()
  f.runtime.threadActivity = registry
  f.h.events.addObserver(registry)
  // Production composition clears the recorder after a durable thread deletion.
  f.runtime.threadService = f.h.threads = new ThreadService({ threadStore: f.h.threadStore, sessionStore: f.h.sessionStore,
    events: f.h.events, ids: f.h.ids, nowIso: f.h.nowIso, onDeleted: (id) => f.h.events.clearThread(id) })
  const feed = new RemoteDirectoryFeed(f.runtime)
  const watch = (scopes = ['personal']) => {
    const abort = new AbortController(), request = new Request('http://runtime/directory', { signal: abort.signal })
    const reader = feed.stream(request, scopes).body!.getReader()
    return { abort, reader, next: async () => {
      const { value, done } = await reader.read()
      return done ? undefined : JSON.parse(new TextDecoder().decode(value).slice(6)) as { kind: string; resources: string[] }
    } }
  }
  return { ...f, registry, feed, watch }
}
const advance = () => vi.advanceTimersByTimeAsync(DIRECTORY_SPACING_MS + 1)

describe('runtime directory push', () => {
  it('pushes actual Code create, metadata edit, turn state and deletion without loading histories', async () => {
    const f = await fixture()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    try {
      const stream = f.watch(), histories = vi.spyOn(f.h.sessionStore, 'loadItems')
      const next = async () => {
        const reads = histories.mock.calls.length
        await advance()
        const event = await stream.next()
        expect(histories).toHaveBeenCalledTimes(reads)
        return event?.resources
      }
      expect((await stream.next())?.kind).toBe('synchronized')
      const task = await f.code('Before')
      expect(await next()).toEqual(['code', 'project'])
      await f.h.threads.update(task.id, { title: 'After' })
      expect(await next()).toEqual(['code', 'project'])
      const turn = await f.h.turns.startTurn({ threadId: task.id, request: { prompt: 'Hello' } })
      expect(await next()).toContain('code')
      await f.h.turns.interruptTurn({ threadId: task.id, turnId: turn.turnId })
      expect(await next()).toContain('code')
      await f.h.threads.delete(task.id)
      expect(await next()).toEqual(['code', 'project'])
      stream.abort.abort(); expect(await stream.next()).toBeUndefined()
    } finally { vi.useRealTimers(); await f.close() }
  })

  it('coalesces durable Agent and room changes, and excludes bookkeeping writes', async () => {
    const f = await fixture()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    try {
      const stream = f.watch(['personal', 'groups.read'])
      await stream.next()
      const agent = (await f.rooms.agents.create({ clientRequestId: 'create', name: 'Visible agent' })).agent
      await f.rooms.agents.update(agent.id, { clientRequestId: 'rename', expectedRevision: agent.revision, name: 'Updated agent' })
      await advance(); expect(await stream.next()).toEqual({ kind: 'directory_changed', resources: ['agent'] })
      await f.rooms.agents.update(agent.id, { clientRequestId: 'archive', expectedRevision: 1, archived: true })
      await advance(); expect((await stream.next())?.resources).toEqual(['agent'])
      const room = (await f.rooms.service.create({ clientRequestId: 'room-create', name: 'Visible room' })).room
      await advance(); expect((await stream.next())?.resources).toEqual(['agent', 'group'])
      await f.rooms.service.update(room.id, { clientRequestId: 'room-update', expectedRevision: room.revision, name: 'Renamed room' })
      await advance(); expect((await stream.next())?.resources).toEqual(['agent', 'group'])
      await f.rooms.service.update(room.id, { clientRequestId: 'room-delete', expectedRevision: room.revision + 1, deleted: true })
      await advance(); expect((await stream.next())?.resources).toEqual(['agent', 'group'])
      expect(roomDirectoryChanges({ documents: ['remote_receipt', 'remote_history'], events: [] })).toEqual([])
      const waiting = vi.fn(); void stream.reader.read().then(waiting)
      await f.store.commit({ requestId: 'receipt', checks: [{ kind: 'remote_receipt', id: 'receipt', expectedRevision: null }],
        puts: [{ kind: 'remote_receipt', id: 'receipt', value: {} }] })
      await advance(); expect(waiting).not.toHaveBeenCalled()
      stream.abort.abort(); await Promise.resolve()
    } finally { vi.useRealTimers(); await f.close() }
  })

  it('invalidates the catalog scan when desktop project roots change, before the cache TTL', async () => {
    const f = await fixture()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    try {
      const stream = f.watch(); await stream.next()
      expect((await f.call('catalog.get', {})).projects).toEqual([])
      const project = join(f.root, 'new-project'); await mkdir(project)
      await f.rooms.workbench.directory.set({ codeProjects: [project], workRoots: [] })
      await advance(); expect((await stream.next())?.resources).toEqual(['project'])
      expect((await f.call('catalog.get', {})).projects).toEqual([expect.objectContaining({ name: 'new-project' })])
      await f.rooms.workbench.directory.set({ codeProjects: [], workRoots: [] })
      await advance(); expect((await stream.next())?.resources).toEqual(['project'])
      expect((await f.call('catalog.get', {})).projects).toEqual([])
      stream.abort.abort()
    } finally { vi.useRealTimers(); await f.close() }
  })

  it('shares source listeners, isolates cancellation, filters permissions and cleans the final listener', async () => {
    const f = await fixture(), original = f.registry.subscribe.bind(f.registry)
    const subscribe = vi.spyOn(f.registry, 'subscribe'), detach = vi.fn()
    subscribe.mockImplementation((listener) => { const stop = original(listener); return () => { detach(); stop() } })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    try {
      const first = f.watch(), second = f.watch(['personal', 'groups.read'])
      expect((await first.next())?.resources).not.toContain('group')
      expect((await second.next())?.resources).toContain('group')
      expect(subscribe).toHaveBeenCalledOnce()
      await f.rooms.service.create({ clientRequestId: 'shared-watch-room', name: 'Private contents stay local' })
      await advance()
      expect(await first.next()).toEqual({ kind: 'directory_changed', resources: ['agent'] })
      expect(await second.next()).toEqual({ kind: 'directory_changed', resources: ['agent', 'group'] })
      first.abort.abort(); expect(detach).not.toHaveBeenCalled()
      await f.code(); await advance()
      expect((await second.next())?.resources).toEqual(['code', 'project'])
      second.abort.abort(); expect(detach).toHaveBeenCalledOnce()
      const third = f.watch(); await third.next(); expect(subscribe).toHaveBeenCalledTimes(2)
      await f.feed.close(); expect(await third.next()).toBeUndefined(); expect(detach).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers(); await f.close() }
  })

  it('requires host authentication and trusted peer authority on the runtime route', async () => {
    const f = await fixture()
    try {
      registerRemoteDirectoryRoutes(f.router, f.runtime)
      const route = f.router.match('GET', '/v1/remote/directory-events')!
      const call = (headers: Record<string, string>) => route.handler(new Request('http://runtime/v1/remote/directory-events', { headers }), { params: {} })
      expect((await call({})).status).toBe(401)
      expect((await call({ Authorization: 'Bearer token' })).status).toBe(403)
      expect((await call({ Authorization: 'Bearer token', 'X-Kun-Remote-Account': 'owner', 'X-Kun-Remote-Device': 'phone',
        'X-Kun-Remote-Authorization': 'grant', 'X-Kun-Remote-Scopes': 'personal,invalid' })).status).toBe(403)
    } finally { await f.close() }
  })

  it('bounds slow consumers to a queued batch plus a coalesced set, then sends every dirty resource', async () => {
    const f = await fixture()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    try {
      const stream = f.watch()
      // Leave the synchronized barrier unread, blocking the stream's high-water mark.
      for (let index = 0; index < 5000; index++) f.registry.clearThread('removed-' + index)
      await advance()
      expect(await stream.next()).toEqual({ kind: 'synchronized', resources: ['agent', 'code', 'project'] })
      await advance()
      expect(await stream.next()).toEqual({ kind: 'directory_changed', resources: ['code', 'project'] })
      const waiting = vi.fn(); void stream.reader.read().then(waiting)
      await advance(); expect(waiting).not.toHaveBeenCalled()
      stream.abort.abort()
    } finally { vi.useRealTimers(); await f.close() }
  })
})

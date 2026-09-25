import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Router } from '../router.js'
import type { JsonResponse } from '../response.js'
import type { ServerRuntime } from './server-runtime.js'
import { ActivityStore } from '../../services/activity-store.js'
import { ActivityFactsStore } from '../../services/activity-facts-store.js'
import { registerActivityRoutes } from './register-activity-routes.js'

const NOW = '2026-09-01T12:00:00.000Z'
const tempDirs: string[] = []

async function tempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kun-activity-facts-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  while (tempDirs.length) await rm(tempDirs.pop()!, { recursive: true, force: true })
})

async function harness() {
  const dataDir = await tempDataDir()
  const facts = new ActivityFactsStore({ dataDir, flushDelayMs: 5 })
  await facts.load()
  const store = new ActivityStore({ nowIso: () => NOW, facts })
  const router = new Router()
  registerActivityRoutes(router, {
    runtimeToken: 'test-token',
    insecure: false,
    activityStore: store,
    activityFacts: facts,
    nowIso: () => NOW
  } as unknown as ServerRuntime)
  const request = async (method: string, path: string, body?: unknown, authorized = true) => {
    const route = router.match(method, new URL(path, 'http://local.test').pathname)!
    expect(route, `${method} ${path} should route`).toBeTruthy()
    return route.handler(
      new Request(`http://local.test${path}`, {
        method,
        headers: {
          ...(authorized ? { authorization: 'Bearer test-token' } : {}),
          'content-type': 'application/json'
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
      }),
      { params: route.params }
    ) as Promise<JsonResponse>
  }
  return { store, facts, request, dataDir }
}

function registerRow(store: ActivityStore, unitId = 't1', workspace = '/ws/a') {
  return store.register({
    unitId,
    kind: 'thread',
    threadId: unitId,
    harnessId: 'kun',
    title: unitId,
    workspace: { path: workspace, kind: 'local' }
  })
}

describe('activity routes', () => {
  it('serves a snapshot of all rows with a cursor', async () => {
    const { store, request } = await harness()
    registerRow(store, 't1')
    registerRow(store, 't2')
    const res = await request('GET', '/v1/activity')
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.rows).toHaveLength(2)
    expect(typeof body.cursor).toBe('string')
  })

  it('filters the snapshot by normalized workspace scope', async () => {
    const { store, request } = await harness()
    registerRow(store, 't1', '/ws/a')
    registerRow(store, 't2', '/ws/b')
    const res = await request('GET', `/v1/activity?scope=workspace&workspace=${encodeURIComponent('/ws/a/../a')}`)
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.rows.map((row: { unitId: string }) => row.unitId)).toEqual(['t1'])
    expect((await request('GET', '/v1/activity?scope=workspace')).status).toBe(400)
    expect((await request('GET', '/v1/activity?scope=nope')).status).toBe(400)
  })

  it('rejects out-of-range wait_ms', async () => {
    const { request } = await harness()
    for (const wait of ['-1', '30001', '1.5', 'abc']) {
      expect((await request('GET', `/v1/activity/events?wait_ms=${wait}`)).status).toBe(400)
    }
  })

  it('long poll waits for a change and returns it immediately', async () => {
    const { store, request } = await harness()
    registerRow(store, 't1')
    const cursor = store.cursor()
    const pending = request('GET', `/v1/activity/events?cursor=${encodeURIComponent(cursor)}&wait_ms=5000`)
    await new Promise((resolve) => setTimeout(resolve, 25))
    store.apply('t1', { mainState: 'working' }, 'runtime')
    const res = await pending
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.type).toBe('activity')
    expect(body.changes).toHaveLength(1)
    expect(body.changes[0].row).toMatchObject({ unitId: 't1', mainState: 'working' })
  })

  it('ack writes the fact and every client sees the new row revision', async () => {
    const { store, facts, request } = await harness()
    registerRow(store, 't1')
    const cursor = store.cursor()
    const res = await request('POST', '/v1/activity/t1/ack')
    expect(res.status).toBe(200)
    expect(facts.get('t1')?.acknowledgedAt).toBe(NOW)
    expect(store.get('t1')?.acknowledgedAt).toBe(NOW)
    // The row's provenance stays unchanged for user-fact writes.
    expect(store.get('t1')?.provenance).toBe('runtime')
    // A second client polling from the old cursor observes the update.
    const poll = await request('GET', `/v1/activity/events?cursor=${encodeURIComponent(cursor)}&wait_ms=0`)
    const body = JSON.parse(poll.body)
    expect(body.changes[0].row.acknowledgedAt).toBe(NOW)
  })

  it('dismiss and pin persist their facts', async () => {
    const { store, facts, request } = await harness()
    registerRow(store, 't1')
    expect((await request('POST', '/v1/activity/t1/dismiss')).status).toBe(200)
    expect((await request('POST', '/v1/activity/t1/pin', { pinned: true })).status).toBe(200)
    expect(facts.get('t1')).toMatchObject({ dismissedAt: NOW, pinned: true })
    expect(store.get('t1')).toMatchObject({ dismissedAt: NOW, pinned: true })
    expect((await request('POST', '/v1/activity/t1/pin', { pinned: false })).status).toBe(200)
    expect(store.get('t1')?.pinned).toBe(false)
  })

  it('clears persisted facts when the thread is deleted', async () => {
    const { store, facts, request } = await harness()
    registerRow(store, 't1')
    await request('POST', '/v1/activity/t1/ack')
    expect(facts.get('t1')?.acknowledgedAt).toBe(NOW)
    store.clearThread('t1')
    expect(facts.get('t1')).toBeUndefined()
  })

  it('persists facts across a facts-store reload', async () => {
    const { facts, request, dataDir } = await harness()
    await request('POST', '/v1/activity/t1/ack')
    await request('POST', '/v1/activity/t2/dismiss')
    await facts.flush()
    const reloaded = new ActivityFactsStore({ dataDir })
    await reloaded.load()
    expect(reloaded.get('t1')?.acknowledgedAt).toBe(NOW)
    expect(reloaded.get('t2')?.dismissedAt).toBe(NOW)
  })

  it('requires authorization', async () => {
    const { request } = await harness()
    expect((await request('GET', '/v1/activity', undefined, false)).status).toBe(401)
    expect((await request('GET', '/v1/activity/events', undefined, false)).status).toBe(401)
    expect((await request('POST', '/v1/activity/t1/ack', undefined, false)).status).toBe(401)
  })

  it('serves an SSE stream with backlog then live activity frames', async () => {
    const { store } = await harness()
    registerRow(store, 't1')
    const controller = new AbortController()
    const response = (await import('./activity.js')).activityEventStream(
      store,
      new Request('http://local.test/v1/activity/events', {
        headers: { accept: 'text/event-stream' },
        signal: controller.signal
      })
    )
    const reader = (response as Response).body!.getReader()
    const decoder = new TextDecoder()
    const read = async () => decoder.decode((await reader.read()).value)
    // Subscribing without a cursor replays the pending backlog first.
    const first = await read()
    expect(first).toContain('event: activity')
    expect(first).toContain('"unitId":"t1"')
    store.apply('t1', { mainState: 'working' }, 'runtime')
    const second = await read()
    expect(second).toContain('event: activity')
    expect(second).toContain('"mainState":"working"')
    controller.abort()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { WorkbenchLink } from '../../contracts/workbench-links.js'
import { reconcileWorkbench } from '../../workbench-bridge/reconcile.js'
import { workbenchFixture, type WorkbenchFixture } from '../../workbench-bridge/workbench-test-support.js'
import type { RouteContext } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import { registerWorkbenchDirectoryRoutes, registerWorkbenchLinkRoutes } from './register-workbench-link-routes.js'

vi.mock('../../rooms/room-continuation-service.js', () => ({ enqueuePrivateContinuation: vi.fn(async () => 'queued') }))

const open: WorkbenchFixture[] = []
afterEach(async () => { for (const fixture of open.splice(0)) await fixture.cleanup() })

type Handler = (rooms: RoomRuntime, request: Request, context: RouteContext) => Promise<unknown> | unknown
async function fixture() {
  const f = await workbenchFixture({ policy: { code: 'confirm' } })
  open.push(f)
  const handlers = new Map<string, Handler>()
  registerWorkbenchLinkRoutes((method, path, handler) => handlers.set(method + ' ' + path, handler))
  const rooms = { deps: f.deps, workbench: f.bridge } as unknown as RoomRuntime
  const call = (method: string, path: string, params: Record<string, string>, body?: unknown, search = '') =>
    handlers.get(`${method} ${path}`)!(rooms, new Request('http://localhost/x' + search, { method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { params: { roomId: f.room.id, ...params } } as RouteContext) as Promise<{ link?: WorkbenchLink & { revision: number }; links?: WorkbenchLink[] }>
  const createTask = async () => {
    const project = await f.makeDirectory('project')
    f.addCodeThread('existing', project)
    const created = (await f.run('create_code_task', { title: 'Fix SSE', goal: 'g', projectRoot: project }, 'call-' + Math.random())).output as { linkId: string }
    return created.linkId
  }
  return { f, call, createTask, handlers }
}
const BASE = '/v1/rooms/:roomId/workbench-links'

describe('workbench link routes', () => {
  it('reads and lists links, filtered by status', async () => {
    const { call, createTask } = await fixture()
    const id = await createTask()
    expect((await call('GET', `${BASE}/:linkId`, { linkId: id })).link).toMatchObject({ id, status: 'awaiting_confirmation', revision: 0 })
    expect((await call('GET', BASE, {}, undefined, '?status=awaiting_confirmation')).links).toHaveLength(1)
    expect((await call('GET', BASE, {}, undefined, '?status=running,completed')).links).toHaveLength(0)
    await expect(call('GET', BASE, {}, undefined, '?status=bogus')).rejects.toThrow()
    await expect(call('GET', `${BASE}/:linkId`, { linkId: 'nope' })).rejects.toThrow('not found')
  })

  it('confirms with the card revision, rejects a stale one, and only then lets the reconciler start it', async () => {
    const { f, call, createTask } = await fixture()
    const id = await createTask()
    await expect(call('POST', `${BASE}/:linkId/confirm`, { linkId: id }, { clientRequestId: 'c1', expectedRevision: 7 })).rejects.toThrow('changed since')
    await reconcileWorkbench(f.bridge)
    expect(f.stub.calls.created).toHaveLength(0) // nothing runs before the user accepts
    const confirmed = await call('POST', `${BASE}/:linkId/confirm`, { linkId: id }, { clientRequestId: 'c2', expectedRevision: 0, edits: { title: 'Better' } })
    expect(confirmed.link).toMatchObject({ status: 'queued', request: { title: 'Better' } })
    await reconcileWorkbench(f.bridge)
    expect(f.stub.calls.created).toHaveLength(1)
  })

  it('validates bodies and rejects unknown fields', async () => {
    const { call, createTask } = await fixture()
    const id = await createTask()
    await expect(call('POST', `${BASE}/:linkId/confirm`, { linkId: id }, { clientRequestId: 'c1', expectedRevision: 0, edits: { isolation: 'nope' } })).rejects.toThrow()
    await expect(call('POST', `${BASE}/:linkId/confirm`, { linkId: id }, { clientRequestId: 'c1', expectedRevision: 0, extra: true })).rejects.toThrow()
    await expect(call('POST', `${BASE}/:linkId/dismiss`, { linkId: id }, { clientRequestId: 'c1' })).rejects.toThrow()
  })

  it('dismisses and cancels', async () => {
    const { call, createTask } = await fixture()
    const first = await createTask()
    expect((await call('POST', `${BASE}/:linkId/dismiss`, { linkId: first }, { clientRequestId: 'd1', expectedRevision: 0 })).link).toMatchObject({ status: 'dismissed' })
    const second = await createTask()
    expect((await call('POST', `${BASE}/:linkId/cancel`, { linkId: second }, { clientRequestId: 'x1', expectedRevision: 0 })).link).toMatchObject({ status: 'dismissed' })
  })

  it('rejects watching a session that is not running', async () => {
    const { f, call } = await fixture()
    f.addCodeThread('idle', await f.makeDirectory('p'))
    await expect(call('POST', `${BASE}/watch`, {}, { clientRequestId: 'w1', threadId: 'idle' })).rejects.toThrow('not running')
  })
})

describe('workbench directory routes', () => {
  it('replaces and reads the directory, authorized like every runtime route', async () => {
    const f = await workbenchFixture()
    open.push(f)
    const routes = new Map<string, (request: Request, context: RouteContext) => Promise<{ status: number; body: string }>>()
    registerWorkbenchDirectoryRoutes({ add: (method: string, path: string, handler: never) => routes.set(method + ' ' + path, handler) } as never,
      { rooms: { workbench: f.bridge }, runtimeToken: 'secret' } as unknown as ServerRuntime)
    const work = await f.makeDirectory('work')
    const authed = { 'content-type': 'application/json', authorization: 'Bearer secret' }
    const put = await routes.get('PUT /v1/workbench/directory')!(new Request('http://localhost/v1/workbench/directory', { method: 'PUT',
      body: JSON.stringify({ workRoots: [work, '/does/not/exist'], defaultWorkRoot: work, codeProjects: [] }), headers: authed }), {} as RouteContext)
    expect(put.status).toBe(200)
    expect(JSON.parse(put.body)).toEqual({ workRoots: [work], defaultWorkRoot: work, codeProjects: [] })
    const got = await routes.get('GET /v1/workbench/directory')!(new Request('http://localhost/v1/workbench/directory', { headers: authed }), {} as RouteContext)
    expect(JSON.parse(got.body)).toMatchObject({ workRoots: [work] })
    const bad = await routes.get('PUT /v1/workbench/directory')!(new Request('http://localhost/v1/workbench/directory', { method: 'PUT',
      body: JSON.stringify({ workRoots: 'nope' }), headers: authed }), {} as RouteContext)
    expect(bad.status).toBe(400)
    const anonymous = await routes.get('GET /v1/workbench/directory')!(new Request('http://localhost/v1/workbench/directory'), {} as RouteContext)
    expect(anonymous.status).toBe(401)
  })
})

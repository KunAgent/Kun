import { afterEach, describe, expect, it } from 'vitest'
import { Router } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import type { JsonResponse } from '../response.js'
import { registerTeamsRoutes } from './register-teams-routes.js'
import { makeHarness, seedDispatch, setupAdeStores, teardownAdeStores, type AdeStores } from '../../ade/manager-controls-test-support.js'

const cleanup: AdeStores[] = []
afterEach(async () => { for (const stores of cleanup.splice(0)) await teardownAdeStores(stores) })
async function setup(available = true) {
  const stores = await setupAdeStores()
  cleanup.push(stores)
  const { teamControls } = makeHarness(stores)
  const router = new Router()
  registerTeamsRoutes(router, { runtimeToken: 'token', insecure: false,
    ade: { ...(available ? { manager: { teamControls } } : {}) } } as unknown as ServerRuntime)
  const request = async (query = '', authorized = true, manager = 'thr_mgr') => {
    const path = `/v1/teams/by-manager/${manager}`
    const route = router.match('GET', path)!
    return route.handler(new Request(`http://local.test${path}${query}`, {
      headers: authorized ? { authorization: 'Bearer token' } : {}
    }), { params: route.params }) as Promise<JsonResponse>
  }
  return { stores, request }
}
const idsQuery = (value: unknown) => `?${new URLSearchParams({ dispatchIds: JSON.stringify(value) })}`

describe('team dispatch history query', () => {
  it('finds an old dispatch beyond the recent window without exposing other teams', async () => {
    const { stores, request } = await setup()
    await seedDispatch(stores, { dispatchId: 'old', state: 'accepted', createdAt: '2026-01-01T00:00:00.000Z' })
    for (let index = 0; index < 51; index += 1) await seedDispatch(stores, {
      dispatchId: `recent_${index}`, state: 'completed', createdAt: new Date(Date.UTC(2026, 1, 1, 0, index)).toISOString()
    })
    await stores.teams.ensure('thr_other')
    await seedDispatch(stores, { teamId: 'thr_other', dispatchId: 'foreign' })
    const recent = JSON.parse((await request()).body)
    expect(recent.dispatches).toHaveLength(50)
    expect(recent.dispatches.some((entry: { dispatchId: string }) => entry.dispatchId === 'old')).toBe(false)
    const targeted = JSON.parse((await request(idsQuery(['old', 'foreign', 'missing', 'old']))).body)
    expect(targeted.dispatches).toHaveLength(1)
    expect(targeted.dispatches[0]).toMatchObject({ dispatchId: 'old', state: 'accepted', teamId: 'thr_mgr' })
    expect(targeted.questions).toEqual(recent.questions)
    expect(targeted.races).toEqual(recent.races)
    expect(JSON.parse((await request(idsQuery([]))).body).dispatches).toEqual([])
  })

  it.each([null, {}, [1], [''], [' '], ['x'.repeat(257)], Array(65).fill('same')])('rejects an invalid bounded selection: %j', async (value) => {
    const { request } = await setup()
    expect((await request(idsQuery(value))).status).toBe(400)
  })

  it('validates JSON and duplicate query keys; accepts the exact input boundary', async () => {
    const { request } = await setup()
    expect((await request('?dispatchIds=not-json')).status).toBe(400)
    expect((await request('?dispatchIds=[]&dispatchIds=[]')).status).toBe(400)
    const boundary = await request(idsQuery(Array(64).fill('x'.repeat(256))))
    expect(boundary.status).toBe(200)
  })

  it('preserves authentication, unavailable and not-found responses', async () => {
    const { request } = await setup()
    expect((await request(idsQuery(['old']), false)).status).toBe(401)
    expect((await request(idsQuery(['old']), true, 'missing')).status).toBe(404)
    const unavailable = await setup(false)
    expect((await unavailable.request(idsQuery(['old']))).status).toBe(503)
  })
})

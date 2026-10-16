import { expect, it } from 'vitest'
import { remoteFixture } from '../../remote/testing/runtime.test-support.js'

it('keeps native lifecycle/import behind runtime authentication and their own local preview authority', async () => {
  const f = await remoteFixture()
  const call = async (method: string, path: string, body?: unknown, authorized = true) => {
    const route = f.router.match(method, path)!
    const response = await route.handler(new Request('http://runtime' + path, { method,
      headers: { ...(authorized ? { Authorization: 'Bearer token' } : {}), 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) }), { params: route.params })
    return { status: response.status, value: response instanceof Response ? await response.json() : JSON.parse(response.body) }
  }
  try {
    const input = { clientRequestId: 'local-preview', document: { format: 'kun-agent-profile', version: 1,
      profile: { name: 'Local import', instructions: 'Help' } } }
    expect((await call('POST', '/v1/agents/import/preview', input, false)).status).toBe(401)
    expect(await f.store.list('agent_import')).toEqual([])
    expect((await call('POST', '/v1/agents/import/preview', { ...input, ownerAccountId: 'forged' })).status).toBe(400)
    const preview = (await call('POST', '/v1/agents/import/preview', input)).value
    expect((await f.call('agent.import.commit', { token: preview.token, name: 'Cannot steal local preview' }, 'remote')).receipt.error?.code).toBe('INVALID_REQUEST')
    const result = await call('POST', '/v1/agents/import/commit', { token: preview.token, name: 'Local import', clientRequestId: 'local-commit' })
    expect(result.status).toBe(200); expect(result.value.agent.name).toBe('Local import')
    const path = '/v1/agents/' + result.value.agent.id
    expect((await call('GET', path + '/lifecycle', undefined, false)).status).toBe(401)
    const state = (await call('GET', path + '/lifecycle')).value
    const restart = { clientRequestId: 'local-restart', expectedRevision: state.agentRevision, expectedLifecycleRevision: state.lifecycleRevision }
    expect((await call('POST', path + '/restart', restart)).value.restarted).toBe(true)
    expect((await call('POST', path + '/restart', { ...restart, clientRequestId: 'local-stale' })).status).toBe(409)
    expect((await f.store.list('request', { roomId: result.value.conversationId })).length).toBe(0)
  } finally { await f.close() }
})

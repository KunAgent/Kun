import { describe, expect, it } from 'vitest'
import { runtimeRequestPayloadSchema } from './app-ipc-schemas/runtime'

describe('Agent model selection runtime bridge', () => {
  const endpoints = [
    ['/v1/agents/creation-models', 'GET'],
    ['/v1/agents/creation-requests/confirmed-request-1', 'GET'],
    ['/v1/rooms/private-room-1/direct/model', 'PUT']
  ] as const
  it.each(endpoints)('admits %s only through its intended %s method', (path, method) => {
    expect(runtimeRequestPayloadSchema.parse({ path, method }).path).toBe(path)
    for (const denied of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].filter((value) => value !== method)) {
      expect(() => runtimeRequestPayloadSchema.parse({ path, method: denied })).toThrow('runtime request path is not allowed')
    }
    expect(() => runtimeRequestPayloadSchema.parse({ path: path + '/other', method })).toThrow('runtime request path is not allowed')
  })
  it('preserves the protected permission boundary while allowing a scoped model change', () => {
    expect(runtimeRequestPayloadSchema.parse({ path: '/v1/rooms/private-room-1/direct/model', method: 'PUT',
      body: JSON.stringify({ clientRequestId: 'select-1', expectedRevision: 2,
        modelRef: { providerId: 'provider', accountId: 'account', model: 'selected-model' } }) }).method).toBe('PUT')
    expect(() => runtimeRequestPayloadSchema.parse({ path: '/v1/rooms/private-room-1/direct/permissions', method: 'PUT' }))
      .toThrow('runtime request path is not allowed')
    expect(() => runtimeRequestPayloadSchema.parse({ path: '/v1/agents/creation-requests/confirmed-request-1/commit', method: 'POST' }))
      .toThrow('runtime request path is not allowed')
  })
  it('admits the coding Agent catalog and contact upsert only', () => {
    for (const method of ['GET', 'POST'] as const) {
      expect(runtimeRequestPayloadSchema.parse({ path: '/v1/agents/coding-agents', method }).path).toBe('/v1/agents/coding-agents')
    }
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      expect(() => runtimeRequestPayloadSchema.parse({ path: '/v1/agents/coding-agents', method })).toThrow('runtime request path is not allowed')
    }
    expect(() => runtimeRequestPayloadSchema.parse({ path: '/v1/agents/coding-agents/probe', method: 'POST' }))
      .toThrow('runtime request path is not allowed')
  })
})

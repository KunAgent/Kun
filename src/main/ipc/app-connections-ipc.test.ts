import { describe, expect, it } from 'vitest'
import { runtimeRequestPayloadSchema } from './app-ipc-schemas/runtime'

const allow = (path: string, method: string): void => {
  expect(runtimeRequestPayloadSchema.parse({ path, method }).path).toBe(path)
}
const deny = (path: string, method: string): void => {
  expect(() => runtimeRequestPayloadSchema.parse({ path, method })).toThrow()
}

describe('app connection IPC boundary', () => {
  it('keeps the catalog read-only', () => {
    allow('/v1/apps/catalog', 'GET')
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) deny('/v1/apps/catalog', method)
  })

  it('allows only the narrow account-level connection operations', () => {
    allow('/v1/apps/connections', 'GET')
    allow('/v1/apps/connections/github', 'GET')
    allow('/v1/apps/connections/github', 'DELETE')
    allow('/v1/apps/connections/github/connect', 'POST')
    allow('/v1/apps/connections/github/check', 'POST')
    allow('/v1/apps/connections/figma-api/credential', 'PUT')
    allow('/v1/apps/connections/github/attempts/auth_1', 'GET')
    allow('/v1/apps/connections/github/attempts/auth_1', 'DELETE')
    deny('/v1/apps/connections/github', 'POST')
    deny('/v1/apps/connections/github/connect', 'GET')
    deny('/v1/apps/connections/github/credential', 'POST')
    deny('/v1/apps/connections', 'POST')
  })

  it('rejects unregistered app surfaces instead of widening the whitelist', () => {
    deny('/v1/apps/unknown', 'GET')
    deny('/v1/apps/connections/github/oauth', 'POST')
    deny('/v1/apps/connections/github/attempts', 'POST')
  })
})

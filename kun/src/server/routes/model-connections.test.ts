import { describe, expect, it, vi } from 'vitest'
import type { ModelConnectionRegistry } from '../../services/model-connection-registry.js'
import {
  commitModelCredential,
  fenceModelCredential,
  replaceModelCredential
} from './model-connections.js'

const snapshot = {
  schemaVersion: 1 as const,
  revision: 4,
  providers: [],
  proxy: { enabled: false, url: '' },
  routePools: [],
  failover: [],
  localModelGateway: { enabled: false }
}

function request(method: string, body: unknown): Request {
  return new Request('http://127.0.0.1/v1/model-connections/deepseek/credential', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

describe('model connection credential routes', () => {
  it('keeps legacy PUT replacement compatible when no operation token is supplied', async () => {
    const replaceCredential = vi.fn(async () => snapshot)
    const prepareCredential = vi.fn()
    const registry = { replaceCredential, prepareCredential } as unknown as ModelConnectionRegistry
    const body = { expectedRevision: 3, credential: 'legacy-secret' }

    const response = await replaceModelCredential(registry, 'deepseek', request('PUT', body))

    expect(response.status).toBe(200)
    expect(replaceCredential).toHaveBeenCalledWith('deepseek', body)
    expect(prepareCredential).not.toHaveBeenCalled()
  })

  it('routes tokenized PUT through prepare and requires an explicit commit', async () => {
    const prepareCredential = vi.fn(async () => snapshot)
    const fenceCredential = vi.fn(async () => snapshot)
    const commitPreparedCredential = vi.fn(async () => ({ ...snapshot, revision: 5 }))
    const replaceCredential = vi.fn()
    const registry = {
      prepareCredential,
      fenceCredential,
      commitPreparedCredential,
      replaceCredential
    } as unknown as ModelConnectionRegistry
    const operationToken = 'credential:22222222-2222-4222-8222-222222222222:2'
    const prepared = {
      expectedRevision: 4,
      credential: 'final-secret',
      operationToken
    }

    const fenceResponse = await fenceModelCredential(
      registry,
      'deepseek',
      request('POST', { expectedRevision: 4, operationToken })
    )

    const prepareResponse = await replaceModelCredential(
      registry,
      'deepseek',
      request('PUT', prepared)
    )
    const commit = { expectedRevision: 4, operationToken }
    const commitResponse = await commitModelCredential(
      registry,
      'deepseek',
      request('POST', commit)
    )

    expect(fenceResponse.status).toBe(200)
    expect(prepareResponse.status).toBe(200)
    expect(commitResponse.status).toBe(200)
    expect(fenceCredential).toHaveBeenCalledWith('deepseek', { expectedRevision: 4, operationToken })
    expect(prepareCredential).toHaveBeenCalledWith('deepseek', prepared)
    expect(commitPreparedCredential).toHaveBeenCalledWith('deepseek', commit)
    expect(replaceCredential).not.toHaveBeenCalled()
  })
})

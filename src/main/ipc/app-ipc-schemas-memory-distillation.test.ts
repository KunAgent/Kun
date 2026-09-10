import { describe, expect, it } from 'vitest'
import {
  KUN_MEMORY_DISTILLATION_PATH,
  kunMemoryDistillationDecisionPath
} from '../../shared/kun-endpoints'
import { runtimeRequestPayloadSchema } from './app-ipc-schemas'

describe('Memory distillation desktop IPC routes', () => {
  const query = `?workspace=${encodeURIComponent('D:\\anonymous workspace')}`
  const listPath = `${KUN_MEMORY_DISTILLATION_PATH}${query}`
  const decisionPath = `${kunMemoryDistillationDecisionPath('candidate-one')}${query}`

  it.each([undefined, 'GET'] as const)('admits candidate listing with method %s', (method) => {
    const payload = { path: listPath, ...(method ? { method } : {}) }
    expect(runtimeRequestPayloadSchema.parse(payload)).toEqual(payload)
  })

  it.each(['allow', 'deny', 'withdraw'])('admits an independent %s decision', (decision) => {
    const payload = { path: decisionPath, method: 'POST', body: JSON.stringify({ decision }) }
    expect(runtimeRequestPayloadSchema.parse(payload)).toEqual(payload)
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('rejects %s on the candidate collection', (method) => {
    // The static collection must take precedence over /v1/memory/{id}.
    expect(runtimeRequestPayloadSchema.safeParse({ path: listPath, method }).success).toBe(false)
  })

  it.each(['GET', 'PUT', 'PATCH', 'DELETE'])('rejects %s on candidate decisions', (method) => {
    expect(runtimeRequestPayloadSchema.safeParse({ path: decisionPath, method }).success).toBe(false)
  })

  it.each([
    '/v1/memory/distillation/candidate-one',
    '/v1/memory/distillation/candidate-one/decision/extra',
    '/v1/memory/distillation/bulk/approve'
  ])('does not admit an unmodeled nested route: %s', (path) => {
    expect(runtimeRequestPayloadSchema.safeParse({ path, method: 'POST' }).success).toBe(false)
  })

  it('preserves existing Memory record mutations and diagnostics', () => {
    for (const payload of [
      { path: '/v1/memory/mem-one', method: 'PATCH', body: '{"importance":0.8}' },
      { path: '/v1/memory/mem-one', method: 'DELETE' },
      { path: '/v1/memory/diagnostics', method: 'GET' }
    ]) {
      expect(runtimeRequestPayloadSchema.parse(payload)).toEqual(payload)
    }
  })
})

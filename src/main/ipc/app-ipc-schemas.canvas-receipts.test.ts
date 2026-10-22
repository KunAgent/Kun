import { describe, expect, it } from 'vitest'
import { kunThreadCanvasReceiptsPath } from '../../shared/kun-endpoints'
import { runtimeRequestPayloadSchema } from './app-ipc-schemas'

describe('canvas receipt runtime request', () => {
  const path = kunThreadCanvasReceiptsPath('thr_1')

  it('allows the renderer to POST a canvas receipt', () => {
    expect(runtimeRequestPayloadSchema.safeParse({ path, method: 'POST' }).success).toBe(true)
  })

  it('rejects other methods and nested paths', () => {
    for (const method of ['GET', 'PUT', 'DELETE'] as const) {
      expect(runtimeRequestPayloadSchema.safeParse({ path, method }).success).toBe(false)
    }
    expect(
      runtimeRequestPayloadSchema.safeParse({ path: `${path}/extra`, method: 'POST' }).success
    ).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { KUN_MEMORY_RELATIONS_ANALYZE_PATH, KUN_MEMORY_RELATIONS_PATH, KUN_MEMORY_CONTEXT_PREVIEW_PATH } from '../../shared/kun-endpoints'
import { runtimeRequestPayloadSchema } from './app-ipc-schemas'

describe('Memory relation IPC allowlist', () => {
  it.each([KUN_MEMORY_RELATIONS_PATH, KUN_MEMORY_RELATIONS_ANALYZE_PATH, KUN_MEMORY_CONTEXT_PREVIEW_PATH])('admits only POST on %s', (path) => {
    expect(runtimeRequestPayloadSchema.safeParse({ path, method: 'POST', body: '{}' }).success).toBe(true)
    for (const method of ['GET', 'PATCH', 'DELETE', 'PUT']) {
      expect(runtimeRequestPayloadSchema.safeParse({ path, method }).success).toBe(false)
    }
    expect(runtimeRequestPayloadSchema.safeParse({ path: path + '/all', method: 'POST' }).success).toBe(false)
  })
})

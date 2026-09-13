import { describe, expect, it } from 'vitest'
import { runtimeRequestPayloadSchema } from './app-ipc-schemas/runtime'

describe('history reference runtime IPC routes', () => {
  it.each([
    ['/v1/history-sources/codex/sessions?includeArchived=false&limit=200', 'GET'],
    ['/v1/history-sources/codex/preview', 'POST'],
    ['/v1/history-sources/history-1', 'GET'],
    ['/v1/history-sources/history-1/timeline?cursor=abc', 'GET'],
    ['/v1/history-sources/history-1/relink', 'POST'],
    ['/v1/history-sources/history-1/attachments/codex%3Ai/0', 'GET'],
    ['/v1/threads/reference-branches', 'POST']
  ])('allows %s only with its intended method', (path, method) => {
    expect(runtimeRequestPayloadSchema.safeParse({ path, method }).success).toBe(true)
    expect(runtimeRequestPayloadSchema.safeParse({ path, method: 'DELETE' }).success).toBe(false)
  })
  it('rejects extra route segments and empty source identity', () => {
    for (const path of ['/v1/history-sources//relink', '/v1/history-sources/a/timeline/extra']) {
      expect(runtimeRequestPayloadSchema.safeParse({ path, method: 'GET' }).success).toBe(false)
    }
  })
})

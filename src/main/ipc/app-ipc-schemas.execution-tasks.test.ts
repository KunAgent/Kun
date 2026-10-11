import { describe, expect, it } from 'vitest'
import { runtimeRequestPayloadSchema } from './app-ipc-schemas'

describe('execution-task desktop transport', () => {
  it('permits only the declared atomic task endpoints and methods', () => {
    for (const [path, method] of [['/v1/threads/thread/tasks', 'GET'], ['/v1/threads/thread/tasks', 'POST'],
      ['/v1/threads/thread/tasks/task', 'GET'], ['/v1/threads/thread/tasks/task', 'PATCH']] as const) {
      expect(runtimeRequestPayloadSchema.parse({ path, method }).path).toBe(path)
    }
    for (const [path, method] of [['/v1/threads/thread/tasks/task', 'DELETE'], ['/v1/threads/thread/tasks/task/execute', 'POST']] as const) {
      expect(() => runtimeRequestPayloadSchema.parse({ path, method })).toThrow()
    }
  })
})

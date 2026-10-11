import { describe, expect, it } from 'vitest'
import { kunThreadExecutionConfigPath } from '../../shared/kun-endpoints'
import { runtimeRequestPayloadSchema } from './app-ipc-schemas'

describe('task execution config runtime allowlist', () => {
  it('admits only read and mutation methods on the exact thread path', () => {
    const path = kunThreadExecutionConfigPath('thread/one')
    expect(runtimeRequestPayloadSchema.parse({ path, method: 'GET' }).path).toBe(path)
    expect(runtimeRequestPayloadSchema.parse({
      path, method: 'PATCH', body: JSON.stringify({ expectedRevision: 'task-config-v1:x' })
    }).path).toBe(path)
    expect(() => runtimeRequestPayloadSchema.parse({ path, method: 'POST' }))
      .toThrow(/runtime request path is not allowed/)
  })
  it('admits workspace preparation retry without opening unrelated actions or methods', () => {
    const path = '/v1/task-workspaces/tws_12345678/retry'
    expect(runtimeRequestPayloadSchema.parse({ path, method: 'POST' }).path).toBe(path)
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      expect(() => runtimeRequestPayloadSchema.parse({ path, method })).toThrow(/runtime request path is not allowed/)
    }
    expect(() => runtimeRequestPayloadSchema.parse({ path: path + '/other', method: 'POST' }))
      .toThrow(/runtime request path is not allowed/)
  })

})

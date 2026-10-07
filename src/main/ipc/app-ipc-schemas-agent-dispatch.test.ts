import { describe, expect, it } from 'vitest'
import { runtimeRequestPayloadSchema } from './app-ipc-schemas/runtime'
import { agentDispatchPath } from '../../shared/agent-dispatch'

describe('Agent dispatch runtime IPC boundary', () => {
  it.each([
    ['/v1/agent-dispatch-intents?threadId=parent', 'GET'],
    [agentDispatchPath('dispatch1'), 'GET'],
    [`${agentDispatchPath('dispatch1')}/actions`, 'POST']
  ])('allows %s with exactly the declared method', (path, method) => {
    expect(runtimeRequestPayloadSchema.safeParse({ path, method }).success).toBe(true)
    for (const wrong of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].filter((value) => value !== method)) {
      expect(runtimeRequestPayloadSchema.safeParse({ path, method: wrong }).success).toBe(false)
    }
    expect(runtimeRequestPayloadSchema.safeParse({ path: path.split('?')[0] + '/extra/unlisted', method }).success).toBe(false)
  })

  it('rejects direct alternative control paths', () => {
    for (const path of ['/v1/agent-dispatch-intents/dispatch1/start_now', '/v1/agent-dispatch-intents/dispatch1/payload',
      '/v1/agent-dispatch-intents/dispatch1/actions/extra']) {
      expect(runtimeRequestPayloadSchema.safeParse({ path, method: 'POST' }).success).toBe(false)
    }
  })
})

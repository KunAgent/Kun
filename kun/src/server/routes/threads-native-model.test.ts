import { describe, expect, it, vi } from 'vitest'
import { createThread } from './threads.js'
import { createThreadRecord } from '../../domain/thread.js'
import type { ThreadService } from '../../services/thread-service.js'

function fakeService() {
  const create = vi.fn(async (input: { model: string; workspace: string }) =>
    createThreadRecord({ id: 'thread-native', title: 'Native', workspace: input.workspace,
      model: input.model, mode: 'agent' }))
  return { create, service: { create } as unknown as ThreadService }
}

function request(body: Record<string, unknown>): Request {
  return new Request('http://127.0.0.1/v1/threads', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  })
}

describe('createThread native model default', () => {
  it('uses the native sentinel only when an explicit native harness omitted its model', async () => {
    const { service, create } = fakeService()
    const response = await createThread(service, request({ workspace: '/tmp', harnessId: 'codex', credentialMode: 'native-login' }))
    expect(response.status).toBe(201)
    expect(create.mock.calls[0]?.[0].model).toBe('default')
  })

  it('preserves an explicit native model and rejects a Kun request without a model', async () => {
    const { service, create } = fakeService()
    const native = await createThread(service, request({ workspace: '/tmp', harnessId: 'codex', credentialMode: 'native-login', model: 'gpt-5.6-sol' }))
    expect(native.status).toBe(201)
    expect(create.mock.calls[0]?.[0].model).toBe('gpt-5.6-sol')
    const kun = await createThread(service, request({ workspace: '/tmp', harnessId: 'kun', credentialMode: 'provider' }))
    expect(kun.status).toBe(400)
    expect(create).toHaveBeenCalledTimes(1)
  })
})

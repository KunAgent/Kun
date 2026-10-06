import { describe, expect, it, vi } from 'vitest'
import { configureRuntimeModelExecutor } from './runtime-model-requests'
import { oneShotModelRequest } from './one-shot-model-request'

describe('Main text requests through Runtime', () => {
  it('forwards a selected route identity without sending projected credentials or falling back to HTTP', async () => {
    const execute = vi.fn(async () => ({ ok: true as const, text: 'runtime output' }))
    const restore = configureRuntimeModelExecutor(execute)
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Direct HTTP is forbidden'))
    try {
      expect(await oneShotModelRequest({ providerId: 'route-gateway:local', model: 'route/coding',
        baseUrl: 'https://must-not-send.test', apiKey: 'must-not-send-key', endpointFormat: 'responses',
        systemPrompt: 'system', userText: 'question', timeoutMs: 1000 })).toEqual({ ok: true, text: 'runtime output' })
      expect(execute).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'route-gateway:local', model: 'route/coding' }))
      expect(JSON.stringify(execute.mock.calls)).not.toContain('must-not-send')
      expect(network).not.toHaveBeenCalled()
    } finally { restore(); network.mockRestore() }
  })
})

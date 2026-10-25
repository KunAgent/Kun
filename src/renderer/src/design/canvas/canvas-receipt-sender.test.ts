import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendCanvasTurnReceipt } from './canvas-receipt-sender'

const mocks = vi.hoisted(() => ({
  runtimeRequest: vi.fn(async (..._args: unknown[]) => ({}))
}))

vi.mock('../../agent/runtime-client', () => ({
  rendererRuntimeClient: { runtimeRequest: (...args: unknown[]) => mocks.runtimeRequest(...args) }
}))

describe('sendCanvasTurnReceipt', () => {
  beforeEach(() => {
    mocks.runtimeRequest.mockClear()
    vi.stubGlobal('window', { kunGui: {} })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('acknowledges a keyed no-op without waiting for turn completion', () => {
    sendCanvasTurnReceipt({
      threadId: 'thread-1',
      turnId: 'turn-1',
      receiptKey: 'design-receipt-noop',
      affectedIds: [],
      errors: []
    })

    expect(mocks.runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thread-1/canvas-receipts',
      'POST',
      JSON.stringify({
        turnId: 'turn-1',
        receiptKey: 'design-receipt-noop',
        status: 'applied'
      })
    )
  })

  it('keeps suppressing empty legacy turn-level receipts', () => {
    sendCanvasTurnReceipt({
      threadId: 'thread-1', turnId: 'turn-1', affectedIds: [], errors: []
    })
    expect(mocks.runtimeRequest).not.toHaveBeenCalled()
  })

  it('includes renderer-confirmed generated files in a keyed receipt', () => {
    sendCanvasTurnReceipt({
      threadId: 'thread-1',
      turnId: 'turn-1',
      receiptKey: 'design-receipt-export',
      affectedIds: [],
      errors: [],
      generatedFiles: [{
        name: 'architecture.png',
        relativePath: '.deepseekgui-images/architecture.png',
        absolutePath: '/workspace/.deepseekgui-images/architecture.png',
        mimeType: 'image/png',
        byteSize: 128
      }]
    })

    expect(JSON.parse(String(mocks.runtimeRequest.mock.calls[0]?.[2]))).toMatchObject({
      turnId: 'turn-1',
      receiptKey: 'design-receipt-export',
      status: 'applied',
      generatedFiles: [{
        relativePath: '.deepseekgui-images/architecture.png',
        byteSize: 128
      }]
    })
  })

  it('logs instead of swallowing a rejected receipt request', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.runtimeRequest.mockRejectedValueOnce(new Error('runtime request path is not allowed'))
    sendCanvasTurnReceipt({
      threadId: 'thread-1',
      turnId: 'turn-1',
      receiptKey: 'design-receipt-1',
      affectedIds: ['shape-1'],
      errors: []
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(warn).toHaveBeenCalledWith(
      '[design] canvas receipt was not delivered',
      expect.objectContaining({ receiptKey: 'design-receipt-1' })
    )
    warn.mockRestore()
  })
})

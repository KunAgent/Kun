import { afterEach, describe, expect, it, vi } from 'vitest'
import { createKunHarnessesClient } from './kun-harnesses-client'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

afterEach(() => vi.unstubAllGlobals())

describe('harness request cancellation', () => {
  it('cancels a real-trial IPC request when the caller aborts', async () => {
    const pending = deferred<{ ok: boolean; status: number; body: string }>()
    const runtimeRequest = vi.fn(() => pending.promise)
    const cancelRuntimeRequest = vi.fn(async () => true)
    vi.stubGlobal('window', { kunGui: { runtimeRequest, cancelRuntimeRequest } })
    const controller = new AbortController()
    const request = createKunHarnessesClient().testHarness('codex', {
      level: 'trial', credentialMode: 'native-login'
    }, { signal: controller.signal })
    const options = (runtimeRequest.mock.calls as unknown[][])[0]?.[3] as { requestId: string }
    expect(options.requestId).toMatch(/^renderer-/)
    controller.abort()
    await vi.waitFor(() => expect(cancelRuntimeRequest).toHaveBeenCalledWith(options.requestId))
    pending.resolve({ ok: true, status: 200, body: '{}' })
    await expect(request).rejects.toThrow()
  })

  it('cancels an unsaved ACP definition probe with its own request ID', async () => {
    const pending = deferred<{ ok: boolean; status: number; body: string }>()
    const runtimeRequest = vi.fn(() => pending.promise)
    const cancelRuntimeRequest = vi.fn(async () => true)
    vi.stubGlobal('window', { kunGui: { runtimeRequest, cancelRuntimeRequest } })
    const controller = new AbortController()
    const request = createKunHarnessesClient().probeHarnessDefinition({
      displayName: 'Demo', command: '/bin/demo'
    }, { signal: controller.signal })
    const options = (runtimeRequest.mock.calls as unknown[][])[0]?.[3] as { requestId: string }
    controller.abort()
    await vi.waitFor(() => expect(cancelRuntimeRequest).toHaveBeenCalledWith(options.requestId))
    pending.resolve({ ok: true, status: 200, body: '{}' })
    await expect(request).rejects.toThrow()
  })
})

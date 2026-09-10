import { EventEmitter } from 'node:events'
import type { Worker } from 'node:worker_threads'
import { afterEach, expect, it, vi } from 'vitest'
import { KokoroWorkerHost, KOKORO_WORKER_START_TIMEOUT_MS, KOKORO_WORKER_RUN_TIMEOUT_MS } from './local-kokoro-worker-host'

class FakeWorker extends EventEmitter {
  postMessage = vi.fn()
  terminate = vi.fn(async () => 0)
}
const payload = (id: string) => ({ type: 'synthesize' as const, id, text: 'hello',
  modelPath: 'model', voicePath: 'voice', voiceId: 'af_heart', language: 'en-us' as const, speed: 1 })
function setup() {
  const workers: FakeWorker[] = []
  const host = new KokoroWorkerHost(() => {
    const worker = new FakeWorker()
    workers.push(worker)
    return worker as unknown as Worker
  })
  return { host, workers }
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const reply = (worker: FakeWorker, id: string) => worker.emit('message', { type: 'result', id, ok: true,
  pcm: new Int16Array(1), sampleCount: 1, sampleRate: 24_000, durationSeconds: 1 / 24_000 })
afterEach(() => vi.useRealTimers())

it('does not let an old worker exit fail a new generation', async () => {
  const { host, workers } = setup()
  const first = host.run(payload('a'), () => false)
  await flush()
  workers[0].emit('message', { type: 'ready' })
  await flush()
  await host.reset()
  expect((await first).ok).toBe(false)
  const second = host.run(payload('b'), () => false)
  await flush()
  workers[1].emit('message', { type: 'ready' })
  await flush()
  workers[0].emit('exit', 0)
  expect(host.pendingRuns).toBe(1)
  reply(workers[1], 'b')
  expect((await second).ok).toBe(true)
  await host.reset()
})

it('rejects startup on reset and ignores the late ready event', async () => {
  const { host, workers } = setup()
  const result = host.run(payload('a'), () => false).catch(error => error)
  await flush()
  await host.reset()
  expect(await result).toBeInstanceOf(Error)
  workers[0].emit('message', { type: 'ready' })
  expect(host.resident).toBe(false)
  expect(workers[0].postMessage).not.toHaveBeenCalled()
})

it('cancels queued requests from the old epoch instead of posting to a retired worker', async () => {
  const { host, workers } = setup()
  const first = host.run(payload('a'), () => false)
  const queued = host.run(payload('b'), () => false)
  await flush()
  workers[0].emit('message', { type: 'ready' })
  await flush()
  await host.reset()
  await first
  expect(await queued).toMatchObject({ ok: false, canceled: true })
  expect(workers[0].postMessage).toHaveBeenCalledTimes(1)
})

it('bounds startup time and allows a later retry', async () => {
  vi.useFakeTimers()
  const { host, workers } = setup()
  const first = host.run(payload('a'), () => false).catch(error => error)
  await flush()
  await vi.advanceTimersByTimeAsync(KOKORO_WORKER_START_TIMEOUT_MS)
  expect(await first).toBeInstanceOf(Error)
  const next = host.run(payload('b'), () => false)
  await flush()
  workers[1].emit('message', { type: 'ready' })
  await flush()
  reply(workers[1], 'b')
  expect((await next).ok).toBe(true)
  await host.reset()
})

it('bounds native execution time and resolves the pending run', async () => {
  vi.useFakeTimers()
  const { host, workers } = setup()
  const result = host.run(payload('a'), () => false)
  await flush()
  workers[0].emit('message', { type: 'ready' })
  await flush()
  await vi.advanceTimersByTimeAsync(KOKORO_WORKER_RUN_TIMEOUT_MS)
  expect(await result).toMatchObject({ ok: false, message: 'Kokoro synthesis timed out' })
  expect(host.pendingRuns).toBe(0)
})

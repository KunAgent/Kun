import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ run: vi.fn(), reset: vi.fn(), cancel: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/kun-speech-unit' } }))
vi.mock('./local-kokoro-worker-host', () => ({ KokoroWorkerHost: class {
  resident = true
  pendingRuns = 0
  run = fake.run
  reset = fake.reset
  cancel = fake.cancel
} }))
vi.mock('./local-kokoro-download-service', () => ({
  getLocalKokoroModelStatus: vi.fn(async () => ({ state: 'ready', path: 'model' })),
  getLocalKokoroVoiceStatus: vi.fn(async () => ({ state: 'ready', path: 'voice' })),
  releaseLocalKokoroDownloads: vi.fn()
}))
import { synthesizeLocalKokoroSpeech, resetLocalKokoroSession, cancelLocalKokoroSpeech } from './local-kokoro-synthesis-service'
import { localKokoroCaptureUsage, discardAllLocalKokoroCaptures } from './local-kokoro-track-store'
const request = { requestId: 'capture-test', text: 'hello', keepTrack: true }
const success = { ok: true, pcm: new Int16Array([1, 2]), sampleRate: 24_000, sampleCount: 2, durationSeconds: 2 / 24_000 }
beforeEach(async () => { vi.clearAllMocks(); await resetLocalKokoroSession() })
afterEach(() => resetLocalKokoroSession())

it('cleans Main capture state if a later chunk fails without any renderer discard', async () => {
  fake.run.mockResolvedValueOnce(success).mockResolvedValueOnce({ ok: false, message: 'model failure' })
  expect((await synthesizeLocalKokoroSpeech(request)).ok).toBe(true)
  expect(localKokoroCaptureUsage().bytes).toBe(4)
  expect((await synthesizeLocalKokoroSpeech(request)).ok).toBe(false)
  expect(localKokoroCaptureUsage()).toEqual({ count: 0, bytes: 0 })
})

it('cleans capture state when the worker throws', async () => {
  fake.run.mockRejectedValueOnce(new Error('worker died'))
  expect(await synthesizeLocalKokoroSpeech(request)).toMatchObject({ ok: false })
  expect(localKokoroCaptureUsage().bytes).toBe(0)
})

it('does not restart a recording capture after the user clears in-flight audio', async () => {
  fake.run.mockResolvedValue(success)
  await synthesizeLocalKokoroSpeech(request)
  discardAllLocalKokoroCaptures()
  await synthesizeLocalKokoroSpeech(request)
  expect(localKokoroCaptureUsage()).toEqual({ count: 0, bytes: 0 })
})

it('honors cancellation that arrives before synthesis admission', async () => {
  cancelLocalKokoroSpeech('pre-canceled')
  expect(await synthesizeLocalKokoroSpeech({ ...request, requestId: 'pre-canceled' })).toMatchObject({ ok: false, canceled: true })
  expect(fake.run).not.toHaveBeenCalled()
  expect(localKokoroCaptureUsage().count).toBe(0)
})

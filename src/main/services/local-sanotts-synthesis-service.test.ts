import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ run: vi.fn(), reset: vi.fn(), cancel: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/kun-speech-unit' } }))
vi.mock('./local-sanotts-worker-host', () => ({ SanottsWorkerHost: class {
  resident = true
  pendingRuns = 0
  run = fake.run
  reset = fake.reset
  cancel = fake.cancel
} }))
vi.mock('./local-sanotts-download-service', () => ({
  getLocalSanottsRuntimeStatus: vi.fn(async () => ({ state: 'ready', path: 'runtime' })),
  getLocalSanottsVoiceStatus: vi.fn(async () => ({ state: 'ready', path: 'voice' })),
  releaseLocalSanottsDownloads: vi.fn()
}))
import { synthesizeLocalSanottsSpeech, resetLocalSanottsSession, cancelLocalSanottsSpeech } from './local-sanotts-synthesis-service'
import { localSanottsCaptureUsage, discardAllLocalSanottsCaptures } from './local-sanotts-track-store'
const request = { requestId: 'capture-test', text: 'hello', keepTrack: true }
const success = { ok: true, pcm: new Int16Array([1, 2]), sampleRate: 22_050, sampleCount: 2, durationSeconds: 2 / 22_050 }
beforeEach(async () => { vi.clearAllMocks(); await resetLocalSanottsSession() })
afterEach(() => resetLocalSanottsSession())

it('cleans Main capture state if a later chunk fails without any renderer discard', async () => {
  fake.run.mockResolvedValueOnce(success).mockResolvedValueOnce({ ok: false, message: 'model failure' })
  expect((await synthesizeLocalSanottsSpeech(request)).ok).toBe(true)
  expect(localSanottsCaptureUsage().bytes).toBe(4)
  expect((await synthesizeLocalSanottsSpeech(request)).ok).toBe(false)
  expect(localSanottsCaptureUsage()).toEqual({ count: 0, bytes: 0 })
})

it('cleans capture state when the worker throws', async () => {
  fake.run.mockRejectedValueOnce(new Error('worker died'))
  expect(await synthesizeLocalSanottsSpeech(request)).toMatchObject({ ok: false })
  expect(localSanottsCaptureUsage().bytes).toBe(0)
})

it('does not restart a recording capture after the user clears in-flight audio', async () => {
  fake.run.mockResolvedValue(success)
  await synthesizeLocalSanottsSpeech(request)
  discardAllLocalSanottsCaptures()
  await synthesizeLocalSanottsSpeech(request)
  expect(localSanottsCaptureUsage()).toEqual({ count: 0, bytes: 0 })
})

it('honors cancellation that arrives before synthesis admission', async () => {
  cancelLocalSanottsSpeech('pre-canceled')
  expect(await synthesizeLocalSanottsSpeech({ ...request, requestId: 'pre-canceled' })).toMatchObject({ ok: false, canceled: true })
  expect(fake.run).not.toHaveBeenCalled()
  expect(localSanottsCaptureUsage().count).toBe(0)
})

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useSpeakStore } from '../../stores/speak-store'
import { useSpeakTrackStore } from '../../stores/speak-track-store'
import { speakAnswer, speakTrackKeyFor, speakingBlockId, stopSpeaking } from './speak-controller'
import { ensureKokoroAssets, loadSpeakSettings } from './speak-assets'

vi.mock('./speak-assets', () => ({ loadSpeakSettings: vi.fn(), ensureKokoroAssets: vi.fn() }))
vi.mock('./kokoro-playback', () => ({ KokoroPlayer: class {
  bufferedSeconds = 0
  enqueue() {}
  stop() {}
  async waitForDrain() {}
} }))

const settings = {
  enabled: true, keepTracks: false, model: 'kokoro-82m-int8' as const,
  voice: 'af_heart' as const, speed: 1, downloadSource: 'huggingface' as const,
  autoDownload: false
}
const bridge = {
  synthesizeLocalKokoroSpeech: vi.fn(), cancelLocalKokoroSpeech: vi.fn(),
  discardLocalKokoroTrack: vi.fn(), finalizeLocalKokoroTrack: vi.fn(),
  readLocalKokoroTrack: vi.fn()
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('window', { kunGui: bridge, setTimeout })
  useSpeakStore.getState().reset()
  useSpeakStore.getState().clearError()
  useSpeakTrackStore.getState().clearKeys()
  vi.mocked(loadSpeakSettings).mockResolvedValue(settings)
  vi.mocked(ensureKokoroAssets).mockResolvedValue({ ok: true })
  bridge.synthesizeLocalKokoroSpeech.mockResolvedValue({ ok: false, message: 'test failure' })
  bridge.readLocalKokoroTrack.mockResolvedValue(null)
  bridge.cancelLocalKokoroSpeech.mockResolvedValue(true)
  bridge.discardLocalKokoroTrack.mockResolvedValue(true)
})
afterEach(() => { stopSpeaking(); vi.unstubAllGlobals() })

it('keeps only the latest simultaneous start', async () => {
  const pending = deferred<typeof settings>()
  vi.mocked(loadSpeakSettings).mockReturnValue(pending.promise)
  const first = speakAnswer('a', 'First answer.')
  const second = speakAnswer('b', 'Second answer.')
  pending.resolve(settings)
  await Promise.all([first, second])
  expect(bridge.synthesizeLocalKokoroSpeech).toHaveBeenCalledTimes(1)
  expect(bridge.cancelLocalKokoroSpeech).toHaveBeenCalled()
})

it('prevents stop during settings read failing to cancel the pending start', async () => {
  const pending = deferred<typeof settings>()
  vi.mocked(loadSpeakSettings).mockReturnValue(pending.promise)
  const run = speakAnswer('a', 'First answer.')
  stopSpeaking()
  pending.resolve(settings)
  await run
  expect(bridge.synthesizeLocalKokoroSpeech).not.toHaveBeenCalled()
})

it('prevents old request rejection clearing a newer active playback UI', async () => {
  const firstResult = deferred<any>()
  const secondResult = deferred<any>()
  bridge.synthesizeLocalKokoroSpeech
    .mockReturnValueOnce(firstResult.promise).mockReturnValueOnce(secondResult.promise)
  const first = speakAnswer('a', 'First answer.')
  await vi.waitFor(() => expect(bridge.synthesizeLocalKokoroSpeech).toHaveBeenCalledTimes(1))
  const second = speakAnswer('b', 'Second answer.')
  await vi.waitFor(() => expect(bridge.synthesizeLocalKokoroSpeech).toHaveBeenCalledTimes(2))
  firstResult.reject(new Error('old IPC failed'))
  await first
  expect(speakingBlockId()).toBe('b')
  expect(useSpeakStore.getState().activeBlockId).toBe('b')
  expect(useSpeakStore.getState().error).toBe(null)
  secondResult.resolve({ ok: false, message: 'cleanup' })
  await second
})

it('prevents an existing recording blocked by missing model assets', async () => {
  const kept = { ...settings, keepTracks: true }
  vi.mocked(loadSpeakSettings).mockResolvedValue(kept)
  vi.mocked(ensureKokoroAssets).mockResolvedValue({ ok: false, message: 'speakModelMissing' })
  useSpeakTrackStore.getState().addKey(speakTrackKeyFor('First answer.', kept))
  bridge.readLocalKokoroTrack.mockResolvedValue('AAA=')
  await speakAnswer('a', 'First answer.')
  expect(bridge.readLocalKokoroTrack).toHaveBeenCalled()
  expect(ensureKokoroAssets).not.toHaveBeenCalled()
  expect(useSpeakStore.getState().error).toBe(null)
})

it('prevents a failed recording session never discarding its Main capture', async () => {
  vi.mocked(loadSpeakSettings).mockResolvedValue({ ...settings, keepTracks: true })
  bridge.synthesizeLocalKokoroSpeech.mockResolvedValueOnce({
    ok: true, sampleRate: 24_000, sampleCount: 1, durationSeconds: 1 / 24_000, pcm16Base64: 'AAA='
  }).mockResolvedValueOnce({ ok: false, message: 'second chunk failed' })
  await speakAnswer('a', 'The first sentence was synthesized and captured successfully. The second sentence then fails while generating its audio.')
  expect(bridge.synthesizeLocalKokoroSpeech).toHaveBeenCalledTimes(2)
  expect(bridge.synthesizeLocalKokoroSpeech).toHaveBeenCalledWith(expect.objectContaining({ keepTrack: true }))
  expect(bridge.discardLocalKokoroTrack).toHaveBeenCalled()
  expect(bridge.finalizeLocalKokoroTrack).not.toHaveBeenCalled()
})

it('prevents the gap metric reporting zero for a two-second playback underrun', async () => {
  const sources: any[] = []
  const context = {
    currentTime: 0, destination: {},
    createGain: () => ({ gain: { value: 1 }, connect() {} }),
    createBuffer: (_channels: number, count: number, rate: number) => ({
      duration: count / rate, getChannelData: () => new Float32Array(count)
    }),
    createBufferSource: () => {
      const source = { connect() {}, disconnect() {}, start() {}, onended: null as any }
      sources.push(source)
      return source
    },
    async resume() {}, async close() {}
  }
  ;(window as any).AudioContext = class { constructor() { return context } }
  const { KokoroPlayer } = await vi.importActual<typeof import('./kokoro-playback')>('./kokoro-playback')
  const player = new KokoroPlayer(24_000)
  expect(player.enqueue(new Float32Array(24_000))).toBe(1.08)
  context.currentTime = 3
  sources[0].onended()
  expect(player.enqueue(new Float32Array(24_000))).toBe(4.08)
  expect(player.droppedSeconds).toBeCloseTo(2)
})


it('toggles off a second click on the same answer while settings are loading', async () => {
  const pending = deferred<typeof settings>()
  vi.mocked(loadSpeakSettings).mockReturnValue(pending.promise)
  const first = speakAnswer('a', 'Hello.')
  await speakAnswer('a', 'Hello.')
  pending.resolve(settings)
  await first
  expect(speakingBlockId()).toBeNull()
  expect(bridge.synthesizeLocalKokoroSpeech).not.toHaveBeenCalled()
})

it('rejects unsupported scripts before fetching any assets', async () => {
  await speakAnswer('a', '你好，这是测试。')
  expect(useSpeakStore.getState().error).toBe('speakUnsupportedLanguage')
  expect(ensureKokoroAssets).not.toHaveBeenCalled()
})


it('replays an existing recording even when saving new recordings is disabled', async () => {
  bridge.readLocalKokoroTrack.mockResolvedValue('AAA=')
  await speakAnswer('a', 'Hello.')
  expect(bridge.readLocalKokoroTrack).toHaveBeenCalled()
  expect(ensureKokoroAssets).not.toHaveBeenCalled()
  expect(bridge.finalizeLocalKokoroTrack).not.toHaveBeenCalled()
})

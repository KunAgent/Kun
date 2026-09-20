import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useSpeakStore } from '../../stores/speak-store'
import { useSpeakTrackStore } from '../../stores/speak-track-store'
import { speakAnswer, speakTrackKeyFor, speakingBlockId, stopSpeaking } from './speak-controller'
import { ensureSanottsAssets, loadSpeakSettings } from './speak-assets'

vi.mock('./speak-assets', () => ({ loadSpeakSettings: vi.fn(), ensureSanottsAssets: vi.fn() }))
vi.mock('./speak-playback', () => ({ SpeakPlayer: class {
  bufferedSeconds = 0
  enqueue() {}
  stop() {}
  async waitForDrain() {}
} }))

const settings = {
  enabled: true, keepTracks: false,
  voice: 'amy' as const, speed: 1, downloadSource: 'huggingface' as const,
  autoDownload: false
}
const bridge = {
  synthesizeLocalSanottsSpeech: vi.fn(), cancelLocalSanottsSpeech: vi.fn(),
  discardLocalSanottsTrack: vi.fn(), finalizeLocalSanottsTrack: vi.fn(),
  readLocalSanottsTrack: vi.fn()
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
  vi.mocked(ensureSanottsAssets).mockResolvedValue({ ok: true })
  bridge.synthesizeLocalSanottsSpeech.mockResolvedValue({ ok: false, message: 'test failure' })
  bridge.readLocalSanottsTrack.mockResolvedValue(null)
  bridge.cancelLocalSanottsSpeech.mockResolvedValue(true)
  bridge.discardLocalSanottsTrack.mockResolvedValue(true)
})
afterEach(() => { stopSpeaking(); vi.unstubAllGlobals() })

it('keeps only the latest simultaneous start', async () => {
  const pending = deferred<typeof settings>()
  vi.mocked(loadSpeakSettings).mockReturnValue(pending.promise)
  const first = speakAnswer('a', 'First answer.')
  const second = speakAnswer('b', 'Second answer.')
  pending.resolve(settings)
  await Promise.all([first, second])
  expect(bridge.synthesizeLocalSanottsSpeech).toHaveBeenCalledTimes(1)
  expect(bridge.cancelLocalSanottsSpeech).toHaveBeenCalled()
})

it('prevents stop during settings read failing to cancel the pending start', async () => {
  const pending = deferred<typeof settings>()
  vi.mocked(loadSpeakSettings).mockReturnValue(pending.promise)
  const run = speakAnswer('a', 'First answer.')
  stopSpeaking()
  pending.resolve(settings)
  await run
  expect(bridge.synthesizeLocalSanottsSpeech).not.toHaveBeenCalled()
})

it('prevents old request rejection clearing a newer active playback UI', async () => {
  const firstResult = deferred<any>()
  const secondResult = deferred<any>()
  bridge.synthesizeLocalSanottsSpeech
    .mockReturnValueOnce(firstResult.promise).mockReturnValueOnce(secondResult.promise)
  const first = speakAnswer('a', 'First answer.')
  await vi.waitFor(() => expect(bridge.synthesizeLocalSanottsSpeech).toHaveBeenCalledTimes(1))
  const second = speakAnswer('b', 'Second answer.')
  await vi.waitFor(() => expect(bridge.synthesizeLocalSanottsSpeech).toHaveBeenCalledTimes(2))
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
  vi.mocked(ensureSanottsAssets).mockResolvedValue({ ok: false, message: 'speakModelMissing' })
  useSpeakTrackStore.getState().addKey(speakTrackKeyFor('First answer.', kept))
  bridge.readLocalSanottsTrack.mockResolvedValue('AAA=')
  await speakAnswer('a', 'First answer.')
  expect(bridge.readLocalSanottsTrack).toHaveBeenCalled()
  expect(ensureSanottsAssets).not.toHaveBeenCalled()
  expect(useSpeakStore.getState().error).toBe(null)
})

it('prevents a failed recording session never discarding its Main capture', async () => {
  vi.mocked(loadSpeakSettings).mockResolvedValue({ ...settings, keepTracks: true })
  bridge.synthesizeLocalSanottsSpeech.mockResolvedValueOnce({
    ok: true, sampleRate: 22_050, sampleCount: 1, durationSeconds: 1 / 22_050, pcm16Base64: 'AAA='
  }).mockResolvedValueOnce({ ok: false, message: 'second chunk failed' })
  await speakAnswer('a', 'The first sentence was synthesized and captured successfully. The second sentence then fails while generating its audio.')
  expect(bridge.synthesizeLocalSanottsSpeech).toHaveBeenCalledTimes(2)
  expect(bridge.synthesizeLocalSanottsSpeech).toHaveBeenCalledWith(expect.objectContaining({ keepTrack: true }))
  expect(bridge.discardLocalSanottsTrack).toHaveBeenCalled()
  expect(bridge.finalizeLocalSanottsTrack).not.toHaveBeenCalled()
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
  const { SpeakPlayer } = await vi.importActual<typeof import('./speak-playback')>('./speak-playback')
  const player = new SpeakPlayer(22_050)
  expect(player.enqueue(new Float32Array(22_050))).toBe(1.08)
  context.currentTime = 3
  sources[0].onended()
  expect(player.enqueue(new Float32Array(22_050))).toBe(4.08)
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
  expect(bridge.synthesizeLocalSanottsSpeech).not.toHaveBeenCalled()
})

it('rejects unsupported scripts before fetching any assets', async () => {
  await speakAnswer('a', '你好，这是测试。')
  expect(useSpeakStore.getState().error).toBe('speakUnsupportedLanguage')
  expect(ensureSanottsAssets).not.toHaveBeenCalled()
})

it('allows Han when the selected voice is Chinese', async () => {
  vi.mocked(loadSpeakSettings).mockResolvedValue({ ...settings, voice: 'chinese' })
  await speakAnswer('a', '你好，这是测试。')
  expect(useSpeakStore.getState().error).not.toBe('speakUnsupportedLanguage')
  expect(ensureSanottsAssets).toHaveBeenCalled()
})

it('replays an existing recording even when saving new recordings is disabled', async () => {
  bridge.readLocalSanottsTrack.mockResolvedValue('AAA=')
  await speakAnswer('a', 'Hello.')
  expect(bridge.readLocalSanottsTrack).toHaveBeenCalled()
  expect(ensureSanottsAssets).not.toHaveBeenCalled()
  expect(bridge.finalizeLocalSanottsTrack).not.toHaveBeenCalled()
})

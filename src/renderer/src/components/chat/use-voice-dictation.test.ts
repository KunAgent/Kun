import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { useVoiceDictation, type VoiceDictationIntent } from './use-voice-dictation'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
class Recorder {
  static isTypeSupported = () => true
  static instances: Recorder[] = []
  state = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable?: (event: { data: Blob }) => void
  onstop?: () => void
  constructor() { Recorder.instances.push(this) }
  start() { this.state = 'recording' }
  stop() {
    if (this.state !== 'recording') throw new Error('Invalid recorder state')
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['fixture audio']) })
    this.onstop?.()
  }
}
class Audio {
  close = vi.fn().mockResolvedValue(undefined)
  createAnalyser = () => ({ fftSize: 512, getByteTimeDomainData: vi.fn() })
  createMediaStreamSource = () => ({ connect: vi.fn() })
  async decodeAudioData() { return { duration: 1 } }
}
class OfflineAudio {
  destination = {}
  createBufferSource = () => ({ connect: vi.fn(), start: vi.fn(), buffer: null })
  startRendering = async () => ({ getChannelData: () => new Float32Array(4) })
}

describe('shared voice dictation lifecycle', () => {
  let renderer: ReactTestRenderer
  let voice: ReturnType<typeof useVoiceDictation>
  let getUserMedia: ReturnType<typeof vi.fn>
  let transcribe: ReturnType<typeof vi.fn>
  let trackStop: ReturnType<typeof vi.fn>
  let onText: Mock<(text: string, intent: VoiceDictationIntent) => void>
  const stream = () => ({ getTracks: () => [{ stop: trackStop }] })
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    trackStop = vi.fn()
    getUserMedia = vi.fn().mockImplementation(async () => stream())
    transcribe = vi.fn().mockResolvedValue({ ok: true, text: 'Fixture transcript' })
    Object.assign(window, { kunGui: { transcribeSpeech: transcribe } })
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    vi.stubGlobal('MediaRecorder', Recorder)
    vi.stubGlobal('AudioContext', Audio)
    vi.stubGlobal('OfflineAudioContext', OfflineAudio)
    Recorder.instances = []
    onText = vi.fn()
  })
  afterEach(() => {
    if (renderer) act(() => renderer.unmount())
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  async function mount() {
    function Probe() { voice = useVoiceDictation({ onText: (text, intent) => onText(text, intent) }); return null }
    await act(async () => { renderer = create(createElement(Probe)) })
  }
  async function start() { await act(async () => voice.start()) }
  async function stop() {
    await act(async () => { vi.advanceTimersByTime(600); voice.stop('insert') })
  }
  it('locks repeated starts while permission is pending and releases a cancelled late stream', async () => {
    const permission = deferred<ReturnType<typeof stream>>()
    getUserMedia.mockReturnValue(permission.promise)
    await mount()
    await act(async () => { voice.start(); voice.start() })
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(voice.status).toBe('starting')
    act(() => voice.cancel())
    await act(async () => permission.resolve(stream()))
    expect(trackStop).toHaveBeenCalledTimes(1)
    expect(Recorder.instances).toHaveLength(0)
    expect(voice.status).toBe('idle')
  })
  it('stops every track and never transcribes cancelled recordings', async () => {
    await mount(); await start()
    expect(voice.status).toBe('recording')
    act(() => voice.cancel())
    expect(trackStop).toHaveBeenCalledTimes(1)
    expect(transcribe).not.toHaveBeenCalled()
    expect(onText).not.toHaveBeenCalled()
  })
  it('stops and inserts once without auto-send, using the existing WAV transport', async () => {
    await mount(); await start(); await stop()
    expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'audio/wav', durationMs: 600 }))
    expect(onText).toHaveBeenCalledExactlyOnceWith('Fixture transcript', 'insert')
    expect(trackStop).toHaveBeenCalledTimes(1)
    expect(voice.status).toBe('idle')
  })
  it('ignores cancelled transcription results even after another recording starts', async () => {
    const result = deferred<{ ok: true; text: string }>()
    transcribe.mockReturnValue(result.promise)
    await mount(); await start(); await stop()
    expect(voice.status).toBe('transcribing')
    act(() => voice.cancel())
    await start()
    await act(async () => result.resolve({ ok: true, text: 'Stale transcript' }))
    expect(onText).not.toHaveBeenCalled()
    expect(voice.status).toBe('recording')
  })
  it('does not send audio after unmount during encoding', async () => {
    const decoded = deferred<{ duration: number }>()
    vi.spyOn(Audio.prototype, 'decodeAudioData').mockReturnValue(decoded.promise)
    await mount(); await start(); await stop()
    act(() => renderer.unmount())
    await act(async () => decoded.resolve({ duration: 1 }))
    expect(transcribe).not.toHaveBeenCalled()
    expect(onText).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })
  it('ignores late transcription on unmount and avoids stopping an inactive recorder', async () => {
    const result = deferred<{ ok: true; text: string }>()
    transcribe.mockReturnValue(result.promise)
    await mount(); await start(); await stop()
    expect(() => act(() => renderer.unmount())).not.toThrow()
    await act(async () => result.resolve({ ok: true, text: 'Stale transcript' }))
    expect(onText).not.toHaveBeenCalled()
  })
  it('shows a dismissible permission error and allows retry', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('Denied fixture', 'NotAllowedError'))
    await mount(); await start()
    expect(voice.error).toBe('composerVoiceMicDenied')
    expect(voice.status).toBe('idle')
    act(() => voice.clearError())
    expect(voice.error).toBeNull()
    await start()
    expect(voice.status).toBe('recording')
  })
  it('releases the stream and recovers if MediaRecorder construction fails', async () => {
    vi.stubGlobal('MediaRecorder', class extends Recorder { constructor() { super(); throw new Error('Recorder unavailable') } })
    await mount(); await start()
    expect(trackStop).toHaveBeenCalledTimes(1)
    expect(voice.status).toBe('idle')
    expect(voice.error).toBe('composerVoiceFailed')
  })
})

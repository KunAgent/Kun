import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LocalSpeechProviderSettings } from './settings-section-speak'
import { previewSpeakVoice, stopSpeaking } from './chat/speak-controller'
import { useSpeakStore } from '../stores/speak-store'
import type { LocalSanottsAssetProgress, LocalSanottsRuntimeDownloadResult, LocalSanottsVoiceStatus } from '@shared/local-sanotts'
import type { LocalSanottsVoiceId, LocalSanottsVoiceSetting } from '@shared/local-sanotts-voices'
import { initialSpeakRuntimeStatus, initialSpeakVoiceStatus } from './settings-section-speak-assets'

vi.mock('./chat/speak-controller', () => ({
  previewSpeakVoice: vi.fn(async () => ({ ok: true })), stopSpeaking: vi.fn(), speakAnswer: vi.fn()
}))
let dom: JSDOM
let root: Root
let emitProgress: (progress: LocalSanottsAssetProgress) => void
beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>')
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Object.assign(window, { kunGui: {
    getLocalSanottsRuntimeStatus: vi.fn(async () => initialSpeakRuntimeStatus()),
    getLocalSanottsVoiceStatus: vi.fn(async (id: LocalSanottsVoiceId) => initialSpeakVoiceStatus(id)),
    onLocalSanottsAssetProgress: (listener: (progress: LocalSanottsAssetProgress) => void) => { emitProgress = listener; return vi.fn() },
    listDownloadedLocalSanottsVoices: async () => [],
    checkLocalSanottsDownloadSources: async () => ({ sources: [] }),
    getLocalSanottsTrackUsage: async () => ({ count: 3, totalBytes: 1000 })
  } })
  useSpeakStore.getState().reset()
  useSpeakStore.getState().clearError()
  vi.clearAllMocks()
  root = createRoot(document.getElementById('root')!)
})
afterEach(async () => { await act(() => root.unmount()); dom.window.close(); vi.unstubAllGlobals(); vi.useRealTimers() })
async function render(voice: LocalSanottsVoiceSetting = 'auto') {
  await act(async () => root.render(createElement(LocalSpeechProviderSettings, { ctx: {
    t: (key: string) => key, tCommon: (key: string) => key, selectControlClass: '', updateKun: vi.fn(),
    locale: 'en',
    kun: { speak: { voice, autoDownload: false, keepTracks: false } }
  } })))
}
it('keeps existing recording management visible when new recording capture is off', async () => {
  await render()
  expect(document.body.textContent).toContain('speakStoredTracksClear')
  const clear = [...document.querySelectorAll('button')].find(button => button.textContent === 'speakStoredTracksClear')!
  expect(clear.disabled).toBe(false)
})
it('keeps the selected voice represented when filtering to a different language', async () => {
  await render()
  const language = document.querySelector<HTMLSelectElement>('[aria-label="speakLanguage"]')!
  await act(() => { language.value = 'zh'; const event = document.createEvent('Event'); event.initEvent('change', true, false); language.dispatchEvent(event) })
  const voice = document.querySelector<HTMLSelectElement>('[aria-label="speakVoice"]')!
  expect(voice.value).toBe('auto')
  expect([...voice.options].some(option => option.value === 'chinese')).toBe(true)
})
it('respects the automatic download setting when previewing a voice', async () => {
  await render()
  const preview = document.querySelector<HTMLButtonElement>('[aria-label="speakPreviewPlay"]')!
  await act(async () => preview.click())
  expect(previewSpeakVoice).toHaveBeenCalledWith(expect.objectContaining({ autoDownload: false }), expect.any(String))
})

it('stops playback when disabled directly from settings before a chat watcher mounted', async () => {
  await render()
  const toggle = document.querySelector<HTMLElement>('[aria-label="speakEnabled"]')!
  await act(async () => toggle.click())
  expect(stopSpeaking).toHaveBeenCalled()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
function asset(kind: 'runtime' | 'voice'): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-speak-asset="speak-${kind}"]`)!
}
function download(kind: 'runtime' | 'voice'): HTMLButtonElement {
  return asset(kind).querySelector<HTMLButtonElement>('button')!
}

it('shows voice transfer progress immediately without rereading every asset for every chunk', async () => {
  vi.useFakeTimers()
  await render()
  const reads = vi.mocked(window.kunGui.getLocalSanottsVoiceStatus)
  const runtimeReads = vi.mocked(window.kunGui.getLocalSanottsRuntimeStatus)
  reads.mockClear()
  runtimeReads.mockClear()
  await act(async () => {
    for (let chunk = 1; chunk <= 100; chunk++) emitProgress({
      asset: 'voice', voiceId: 'amy', downloadedBytes: chunk * 1000,
      totalBytes: 1000000, speedBytesPerSecond: 2048
    })
  })
  expect(asset('voice').dataset.state).toBe('downloading')
  expect(asset('voice').textContent).toContain('2.0 KB/s')
  expect(asset('voice').querySelector('progress')?.value).toBe(100000)
  expect(download('voice').disabled).toBe(true)
  expect(reads).not.toHaveBeenCalled()
  expect(runtimeReads).not.toHaveBeenCalled()

  reads.mockResolvedValue({ ...initialSpeakVoiceStatus('amy'), state: 'ready' })
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(reads).toHaveBeenCalledExactlyOnceWith('amy')
  expect(asset('voice').dataset.state).toBe('ready')
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(reads).toHaveBeenCalledTimes(1)
})

it('ignores an old status read after newer progress arrives', async () => {
  const oldRead = deferred<LocalSanottsVoiceStatus>()
  vi.mocked(window.kunGui.getLocalSanottsVoiceStatus).mockImplementation(async (id) =>
    id === 'amy' ? oldRead.promise : initialSpeakVoiceStatus(id!)
  )
  await render()
  await act(async () => emitProgress({ asset: 'voice', voiceId: 'amy', downloadedBytes: 12345 }))
  await act(async () => oldRead.resolve(initialSpeakVoiceStatus('amy')))
  expect(asset('voice').dataset.state).toBe('downloading')
  expect(asset('voice').querySelector('progress')?.value).toBe(12345)
})

it('keeps progress and completion attached to the voice that was downloaded after selection changes', async () => {
  const request = deferred<LocalSanottsVoiceStatus>()
  window.kunGui.downloadLocalSanottsVoice = vi.fn(() => request.promise)
  await render()
  await act(async () => download('voice').click())
  expect(asset('voice').dataset.state).toBe('downloading')
  await render('chinese')
  expect(asset('voice').dataset.state).toBe('not_downloaded')
  expect(download('voice').disabled).toBe(false)
  await act(async () => emitProgress({ asset: 'voice', voiceId: 'amy', downloadedBytes: 250000 }))
  expect(asset('voice').dataset.state).toBe('not_downloaded')
  vi.mocked(window.kunGui.getLocalSanottsVoiceStatus).mockResolvedValue({ ...initialSpeakVoiceStatus('amy'), state: 'ready' })
  await act(async () => request.resolve({ ...initialSpeakVoiceStatus('amy'), state: 'ready' }))
  expect(asset('voice').dataset.state).toBe('not_downloaded')
  await render('amy')
  expect(asset('voice').dataset.state).toBe('ready')
  expect(asset('voice').textContent).toContain('Amy')
})

it('retains a voice download error and permits retry without waiting for a new settings page', async () => {
  window.kunGui.downloadLocalSanottsVoice = vi.fn()
    .mockResolvedValueOnce({ ...initialSpeakVoiceStatus('amy'), state: 'error', message: 'Connection interrupted' })
    .mockResolvedValueOnce({ ...initialSpeakVoiceStatus('amy'), state: 'ready' })
  await render()
  await act(async () => download('voice').click())
  expect(asset('voice').dataset.state).toBe('error')
  expect(asset('voice').textContent).toContain('Connection interrupted')
  expect(download('voice').disabled).toBe(false)
  await act(async () => download('voice').click())
  expect(asset('voice').dataset.state).toBe('ready')
  expect(asset('voice').textContent).not.toContain('Connection interrupted')
})

it('keeps simultaneous runtime and voice downloads independently busy', async () => {
  const runtimeRequest = deferred<LocalSanottsRuntimeDownloadResult>()
  const voiceRequest = deferred<LocalSanottsVoiceStatus>()
  window.kunGui.downloadLocalSanottsRuntime = vi.fn(() => runtimeRequest.promise)
  window.kunGui.downloadLocalSanottsVoice = vi.fn(() => voiceRequest.promise)
  await render()
  await act(async () => { download('runtime').click(); download('voice').click() })
  expect(asset('runtime').dataset.state).toBe('downloading')
  expect(asset('voice').dataset.state).toBe('downloading')
  await act(async () => runtimeRequest.resolve({ ok: true, status: { ...initialSpeakRuntimeStatus(), state: 'ready' } }))
  expect(asset('runtime').dataset.state).toBe('ready')
  expect(download('voice').getAttribute('aria-busy')).toBe('true')
  await act(async () => voiceRequest.resolve({ ...initialSpeakVoiceStatus('amy'), state: 'ready' }))
  expect(asset('voice').dataset.state).toBe('ready')
})

it('keeps runtime cancellation available and ignores the canceled request if it settles late', async () => {
  const request = deferred<LocalSanottsRuntimeDownloadResult>()
  window.kunGui.downloadLocalSanottsRuntime = vi.fn(() => request.promise)
  window.kunGui.cancelLocalSanottsRuntime = vi.fn(async () => ({ ok: true, status: initialSpeakRuntimeStatus() }))
  await render()
  await act(async () => download('runtime').click())
  expect(download('runtime').textContent).toContain('speakModelCancel')
  await act(async () => download('runtime').click())
  expect(window.kunGui.cancelLocalSanottsRuntime).toHaveBeenCalledOnce()
  expect(asset('runtime').dataset.state).toBe('not_downloaded')
  await act(async () => request.resolve({ ok: false, message: 'Aborted' }))
  expect(asset('runtime').dataset.state).toBe('not_downloaded')
  expect(asset('runtime').textContent).not.toContain('Aborted')
})

it('coalesces slow status reads across polling ticks', async () => {
  vi.useFakeTimers()
  await render()
  const pending = deferred<LocalSanottsVoiceStatus>()
  const reads = vi.mocked(window.kunGui.getLocalSanottsVoiceStatus)
  reads.mockClear().mockReturnValue(pending.promise)
  await act(async () => emitProgress({ asset: 'voice', voiceId: 'amy', downloadedBytes: 1 }))
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(reads).toHaveBeenCalledExactlyOnceWith('amy')
  await act(async () => pending.resolve({ ...initialSpeakVoiceStatus('amy'), state: 'error', message: 'Transfer failed' }))
  expect(asset('voice').dataset.state).toBe('error')
  expect(asset('voice').textContent).toContain('Transfer failed')
})

it('keeps a ready runtime usable when deletion fails', async () => {
  const ready = { ...initialSpeakRuntimeStatus(), state: 'ready' as const }
  vi.mocked(window.kunGui.getLocalSanottsRuntimeStatus).mockResolvedValue(ready)
  window.kunGui.deleteLocalSanottsRuntime = vi.fn(async () => ({ ok: false, status: ready, message: 'Cannot remove runtime' }))
  await render()
  const remove = [...asset('runtime').querySelectorAll('button')].find(button => button.textContent === 'speakModelDelete')!
  await act(async () => remove.click())
  expect(asset('runtime').dataset.state).toBe('ready')
  expect(document.body.textContent).toContain('Cannot remove runtime')
})

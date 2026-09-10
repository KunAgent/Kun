import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LocalSpeechProviderSettings } from './settings-section-speak'
import { previewKokoroVoice, stopSpeaking } from './chat/speak-controller'
import { useSpeakStore } from '../stores/speak-store'

vi.mock('./chat/speak-controller', () => ({
  previewKokoroVoice: vi.fn(async () => ({ ok: true })), stopSpeaking: vi.fn(), speakAnswer: vi.fn()
}))
let dom: JSDOM
let root: Root
beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>')
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Object.assign(window, { kunGui: {
    listLocalKokoroModelStatuses: async () => [], listDownloadedLocalKokoroVoices: async () => [],
    checkLocalKokoroDownloadSources: async () => ({ sources: [] }),
    getLocalKokoroTrackUsage: async () => ({ count: 3, totalBytes: 1000 })
  } })
  useSpeakStore.getState().reset()
  useSpeakStore.getState().clearError()
  vi.clearAllMocks()
  root = createRoot(document.getElementById('root')!)
})
afterEach(async () => { await act(() => root.unmount()); dom.window.close(); vi.unstubAllGlobals() })
async function render() {
  await act(async () => root.render(createElement(LocalSpeechProviderSettings, { ctx: {
    t: (key: string) => key, tCommon: (key: string) => key, selectControlClass: '', updateKun: vi.fn(),
    kun: { speak: { voice: 'af_heart', autoDownload: false, keepTracks: false } }
  } })))
}
it('keeps existing recording management visible when new recording capture is off', async () => {
  await render()
  expect(document.body.textContent).toContain('speakStoredTracksClear')
  const clear = [...document.querySelectorAll('button')].find(button => button.textContent === 'speakStoredTracksClear')!
  expect(clear.disabled).toBe(false)
})
it('keeps the actual selected voice represented when filtering to a different accent', async () => {
  await render()
  const accent = document.querySelector<HTMLSelectElement>('[aria-label="speakAccent"]')!
  await act(() => { accent.value = 'en-gb'; const event = document.createEvent('Event'); event.initEvent('change', true, false); accent.dispatchEvent(event) })
  const voice = document.querySelector<HTMLSelectElement>('[aria-label="speakVoice"]')!
  expect(voice.value).toBe('af_heart')
  expect([...voice.options].some(option => option.value.startsWith('bf_'))).toBe(true)
})
it('respects the automatic download setting when previewing a voice', async () => {
  await render()
  const preview = document.querySelector<HTMLButtonElement>('[aria-label="speakPreviewPlay"]')!
  await act(async () => preview.click())
  expect(previewKokoroVoice).toHaveBeenCalledWith(expect.objectContaining({ autoDownload: false }), expect.any(String))
})


it('stops playback when disabled directly from settings before a chat watcher mounted', async () => {
  await render()
  const toggle = document.querySelector<HTMLElement>('[aria-label="speakEnabled"]')!
  await act(async () => toggle.click())
  expect(stopSpeaking).toHaveBeenCalled()
})

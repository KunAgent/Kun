import { ipcRenderer } from 'electron'
import type { KunGuiLocalSpeechApi } from '../shared/kun-gui-api-speech'

/**
 * Preload surface for the local Kokoro speech engine: model and voice asset
 * management plus per-chunk synthesis for the Speak action.
 */
export const kokoroSpeechBridge: Pick<
  KunGuiLocalSpeechApi,
  | 'getLocalKokoroModelStatus'
  | 'listLocalKokoroModelStatuses'
  | 'downloadLocalKokoroModel'
  | 'cancelLocalKokoroModel'
  | 'deleteLocalKokoroModel'
  | 'checkLocalKokoroDownloadSources'
  | 'getLocalKokoroVoiceStatus'
  | 'listDownloadedLocalKokoroVoices'
  | 'downloadLocalKokoroVoice'
  | 'getLocalKokoroReadiness'
  | 'synthesizeLocalKokoroSpeech'
  | 'cancelLocalKokoroSpeech'
  | 'pingLocalKokoroMain'
  | 'listLocalKokoroTrackKeys'
  | 'getLocalKokoroTrackUsage'
  | 'finalizeLocalKokoroTrack'
  | 'discardLocalKokoroTrack'
  | 'readLocalKokoroTrack'
  | 'exportLocalKokoroTrack'
  | 'clearLocalKokoroTracks'
  | 'onLocalKokoroModelProgress'
> = {
  getLocalKokoroModelStatus: (modelId) =>
    ipcRenderer.invoke('speak:kokoro:status', modelId),
  listLocalKokoroModelStatuses: () => ipcRenderer.invoke('speak:kokoro:statuses'),
  downloadLocalKokoroModel: (payload) =>
    ipcRenderer.invoke('speak:kokoro:download', payload),
  cancelLocalKokoroModel: (modelId) =>
    ipcRenderer.invoke('speak:kokoro:cancel', modelId),
  deleteLocalKokoroModel: (modelId) =>
    ipcRenderer.invoke('speak:kokoro:delete', modelId),
  checkLocalKokoroDownloadSources: (payload) =>
    ipcRenderer.invoke('speak:kokoro:sources', payload),
  getLocalKokoroVoiceStatus: (voiceId) =>
    ipcRenderer.invoke('speak:kokoro:voice-status', voiceId),
  listDownloadedLocalKokoroVoices: () => ipcRenderer.invoke('speak:kokoro:voices'),
  downloadLocalKokoroVoice: (payload) =>
    ipcRenderer.invoke('speak:kokoro:voice-download', payload),
  getLocalKokoroReadiness: (payload) =>
    ipcRenderer.invoke('speak:kokoro:readiness', payload),
  synthesizeLocalKokoroSpeech: (payload) =>
    ipcRenderer.invoke('speak:kokoro:synthesize', payload),
  cancelLocalKokoroSpeech: (requestId) =>
    ipcRenderer.invoke('speak:kokoro:synthesize-cancel', requestId),
  pingLocalKokoroMain: () => ipcRenderer.invoke('speak:kokoro:ping'),
  listLocalKokoroTrackKeys: () => ipcRenderer.invoke('speak:kokoro:track:keys'),
  getLocalKokoroTrackUsage: () => ipcRenderer.invoke('speak:kokoro:track:usage'),
  finalizeLocalKokoroTrack: (payload) => ipcRenderer.invoke('speak:kokoro:track:finalize', payload),
  discardLocalKokoroTrack: (requestId) => ipcRenderer.invoke('speak:kokoro:track:discard', requestId),
  readLocalKokoroTrack: (key) => ipcRenderer.invoke('speak:kokoro:track:read', key),
  exportLocalKokoroTrack: (payload) => ipcRenderer.invoke('speak:kokoro:track:export', payload),
  clearLocalKokoroTracks: () => ipcRenderer.invoke('speak:kokoro:track:clear'),
  onLocalKokoroModelProgress: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('speak:kokoro:progress', wrapped)
    return () => ipcRenderer.removeListener('speak:kokoro:progress', wrapped)
  },
}

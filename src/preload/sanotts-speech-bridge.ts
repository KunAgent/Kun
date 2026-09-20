import { ipcRenderer } from 'electron'
import type { KunGuiLocalSpeechApi } from '../shared/kun-gui-api-speech'

/**
 * Preload surface for the local sanoTTS speech engine: runtime and voice asset
 * management plus per-chunk synthesis for the Speak action.
 */
export const sanottsSpeechBridge: Pick<
  KunGuiLocalSpeechApi,
  | 'getLocalSanottsRuntimeStatus'
  | 'downloadLocalSanottsRuntime'
  | 'cancelLocalSanottsRuntime'
  | 'deleteLocalSanottsRuntime'
  | 'checkLocalSanottsDownloadSources'
  | 'getLocalSanottsVoiceStatus'
  | 'listDownloadedLocalSanottsVoices'
  | 'downloadLocalSanottsVoice'
  | 'getLocalSanottsReadiness'
  | 'synthesizeLocalSanottsSpeech'
  | 'cancelLocalSanottsSpeech'
  | 'pingLocalSanottsMain'
  | 'listLocalSanottsTrackKeys'
  | 'getLocalSanottsTrackUsage'
  | 'finalizeLocalSanottsTrack'
  | 'discardLocalSanottsTrack'
  | 'readLocalSanottsTrack'
  | 'exportLocalSanottsTrack'
  | 'clearLocalSanottsTracks'
  | 'onLocalSanottsAssetProgress'
> = {
  getLocalSanottsRuntimeStatus: () =>
    ipcRenderer.invoke('speak:sanotts:runtime-status'),
  downloadLocalSanottsRuntime: (payload) =>
    ipcRenderer.invoke('speak:sanotts:runtime-download', payload),
  cancelLocalSanottsRuntime: () =>
    ipcRenderer.invoke('speak:sanotts:runtime-cancel'),
  deleteLocalSanottsRuntime: () =>
    ipcRenderer.invoke('speak:sanotts:runtime-delete'),
  checkLocalSanottsDownloadSources: () => ipcRenderer.invoke('speak:sanotts:sources'),
  getLocalSanottsVoiceStatus: (voiceId) =>
    ipcRenderer.invoke('speak:sanotts:voice-status', voiceId),
  listDownloadedLocalSanottsVoices: () => ipcRenderer.invoke('speak:sanotts:voices'),
  downloadLocalSanottsVoice: (payload) =>
    ipcRenderer.invoke('speak:sanotts:voice-download', payload),
  getLocalSanottsReadiness: (payload) =>
    ipcRenderer.invoke('speak:sanotts:readiness', payload),
  synthesizeLocalSanottsSpeech: (payload) =>
    ipcRenderer.invoke('speak:sanotts:synthesize', payload),
  cancelLocalSanottsSpeech: (requestId) =>
    ipcRenderer.invoke('speak:sanotts:synthesize-cancel', requestId),
  pingLocalSanottsMain: () => ipcRenderer.invoke('speak:sanotts:ping'),
  listLocalSanottsTrackKeys: () => ipcRenderer.invoke('speak:sanotts:track:keys'),
  getLocalSanottsTrackUsage: () => ipcRenderer.invoke('speak:sanotts:track:usage'),
  finalizeLocalSanottsTrack: (payload) => ipcRenderer.invoke('speak:sanotts:track:finalize', payload),
  discardLocalSanottsTrack: (requestId) => ipcRenderer.invoke('speak:sanotts:track:discard', requestId),
  readLocalSanottsTrack: (key) => ipcRenderer.invoke('speak:sanotts:track:read', key),
  exportLocalSanottsTrack: (payload) => ipcRenderer.invoke('speak:sanotts:track:export', payload),
  clearLocalSanottsTracks: () => ipcRenderer.invoke('speak:sanotts:track:clear'),
  onLocalSanottsAssetProgress: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('speak:sanotts:progress', wrapped)
    return () => ipcRenderer.removeListener('speak:sanotts:progress', wrapped)
  }
}

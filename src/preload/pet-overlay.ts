import { contextBridge, ipcRenderer } from 'electron'
import type { PetOverlayBridge } from '../shared/pets'
import { PET_OVERLAY_IPC } from './pet-overlay-channels'

function listen<T>(channel: string, handler: (value: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, value: T): void => handler(value)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api: PetOverlayBridge = {
  onVisitRequested: (handler) => listen(PET_OVERLAY_IPC.overlayVisitRequested, handler),
  acknowledgeVisitRequest: (id) => ipcRenderer.send(PET_OVERLAY_IPC.acknowledgeVisitRequest, id),
  setPetVisitPreferences: (input) => ipcRenderer.invoke(PET_OVERLAY_IPC.setPetVisitPreferences, input),
  requestPetVisit: (scene) => ipcRenderer.invoke(PET_OVERLAY_IPC.requestPetVisit, scene),
  dismissPetVisit: () => ipcRenderer.invoke(PET_OVERLAY_IPC.dismissPetVisit),
  updatePetPresence: (signal) => ipcRenderer.send(PET_OVERLAY_IPC.updatePetPresence, signal),
  onPresenceChanged: (handler) => listen(PET_OVERLAY_IPC.overlayPresence, handler),
  setPetEnsemble: (settings) => ipcRenderer.invoke(PET_OVERLAY_IPC.setPetEnsemble, settings),
  getBootstrap: () => ipcRenderer.invoke(PET_OVERLAY_IPC.overlayBootstrap),
  onBootstrapChanged: (handler) => listen(PET_OVERLAY_IPC.overlayBootstrapChanged, handler),
  onActivityChanged: (handler) => listen(PET_OVERLAY_IPC.overlayActivity, handler),
  onMainWindowFocused: (handler) => listen(PET_OVERLAY_IPC.overlayFocused, () => handler()),
  onLayoutChanged: (handler) => listen(PET_OVERLAY_IPC.overlayLayoutChanged, handler),
  beginDrag: (point) => ipcRenderer.send(PET_OVERLAY_IPC.overlayDragStart, point),
  moveDrag: (point) => ipcRenderer.send(PET_OVERLAY_IPC.overlayDragMove, point),
  endDrag: (point) => ipcRenderer.send(PET_OVERLAY_IPC.overlayDragEnd, point),
  cancelDrag: () => ipcRenderer.send(PET_OVERLAY_IPC.overlayDragCancel),
  setPointerInteractive: (interactive) => ipcRenderer.send(PET_OVERLAY_IPC.overlayPointer, interactive),
  resizeMascot: (width) => ipcRenderer.send(PET_OVERLAY_IPC.overlayResize, width),
  finishResize: (width) => { void ipcRenderer.invoke(PET_OVERLAY_IPC.overlayResizeEnd, width) },
  reportBounds: (bounds) => ipcRenderer.send(PET_OVERLAY_IPC.overlayBounds, bounds),
  performAction: (input) => ipcRenderer.invoke(PET_OVERLAY_IPC.overlayAction, input),
  dismissNotification: (input) => ipcRenderer.invoke(PET_OVERLAY_IPC.overlayDismiss, input),
  recordPetWelcomed: (petId) => ipcRenderer.invoke(PET_OVERLAY_IPC.overlayWelcomed, petId),
  openMainWindow: () => ipcRenderer.send(PET_OVERLAY_IPC.overlayOpenMain),
  openPetSettings: () => ipcRenderer.send(PET_OVERLAY_IPC.overlayOpenSettings),
  closeOverlay: () => ipcRenderer.invoke(PET_OVERLAY_IPC.overlayClose),
  startChat: (prompt) => ipcRenderer.invoke(PET_OVERLAY_IPC.overlayChat, prompt),
  getVoiceInputAvailable: () => ipcRenderer.invoke(PET_OVERLAY_IPC.overlayVoiceAvailable),
  transcribeSpeech: ({ audioBase64, mimeType, durationMs }) =>
    ipcRenderer.invoke('speech:transcribe', { audioBase64, mimeType, durationMs }),
  setBubblesCollapsed: (collapsed) => ipcRenderer.invoke(PET_OVERLAY_IPC.overlayBubblesCollapsed, collapsed)
}

contextBridge.exposeInMainWorld('kunPetOverlay', api)

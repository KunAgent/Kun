import { contextBridge, ipcRenderer } from 'electron'
import type { PetOverlayBridge } from '../shared/pets'
import { PET_OVERLAY_IPC } from './pet-overlay-channels'

function listen<T>(channel: string, handler: (value: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, value: T): void => handler(value)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api: PetOverlayBridge = {
  getBootstrap: () => ipcRenderer.invoke(PET_OVERLAY_IPC.overlayBootstrap),
  onBootstrapChanged: (handler) => listen(PET_OVERLAY_IPC.overlayBootstrapChanged, handler),
  onActivityChanged: (handler) => listen(PET_OVERLAY_IPC.overlayActivity, handler),
  onMainWindowFocused: (handler) => listen(PET_OVERLAY_IPC.overlayFocused, () => handler()),
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
  closeOverlay: () => ipcRenderer.invoke(PET_OVERLAY_IPC.overlayClose)
}

contextBridge.exposeInMainWorld('kunPetOverlay', api)

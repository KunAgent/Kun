import { ipcRenderer } from 'electron'
import { PET_IPC, type PetDesktopBridge } from '../shared/pets'

function listen(channel: string, handler: () => void): () => void {
  const wrapped = (): void => handler()
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

export const petsPreloadApi: PetDesktopBridge = {
  setPetEnsemble: (settings) => ipcRenderer.invoke(PET_IPC.setPetEnsemble, settings),
  listPets: () => ipcRenderer.invoke(PET_IPC.listPets),
  getPetSettings: () => ipcRenderer.invoke(PET_IPC.getSettings),
  selectPet: (petId) => ipcRenderer.invoke(PET_IPC.selectPet, petId),
  setOverlayOpen: (open) => ipcRenderer.invoke(PET_IPC.setOverlayOpen, open),
  setImportPreferences: (input) => ipcRenderer.invoke(PET_IPC.setImportPreferences, input),
  refreshPets: () => ipcRenderer.invoke(PET_IPC.refreshPets),
  openKunPetsDirectory: () => ipcRenderer.invoke(PET_IPC.openKunDirectory),
  openCodexPetsDirectory: () => ipcRenderer.invoke(PET_IPC.openCodexDirectory),
  updatePetActivity: (snapshot) => ipcRenderer.send(PET_IPC.updateActivity, snapshot),
  onPetCatalogChanged: (handler) => listen(PET_IPC.catalogChanged, handler),
  onPetNavigationRequested: (handler) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: Parameters<typeof handler>[0]): void => handler(value)
    ipcRenderer.on(PET_IPC.navigationRequested, wrapped)
    return () => ipcRenderer.removeListener(PET_IPC.navigationRequested, wrapped)
  },
  takePendingNavigation: () => ipcRenderer.invoke(PET_IPC.navigationPending),
  onPetSettingsRequested: (handler) => listen(PET_IPC.settingsRequested, handler),
  takePendingSettings: () => ipcRenderer.invoke(PET_IPC.settingsPending),
  getPetInteraction: () => ipcRenderer.invoke(PET_IPC.interaction),
  onFollowUpRequested: (handler) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: Parameters<typeof handler>[0]): void => handler(value)
    ipcRenderer.on(PET_IPC.followUpRequested, wrapped)
    return () => ipcRenderer.removeListener(PET_IPC.followUpRequested, wrapped)
  },
  completeFollowUp: (requestId, result) => ipcRenderer.send(PET_IPC.followUpResult, { requestId, result }),
  onChatRequested: (handler) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: Parameters<typeof handler>[0]): void => handler(value)
    ipcRenderer.on(PET_IPC.chatRequested, wrapped)
    return () => ipcRenderer.removeListener(PET_IPC.chatRequested, wrapped)
  },
  completeChat: (requestId, result) => ipcRenderer.send(PET_IPC.chatResult, { requestId, result })
}

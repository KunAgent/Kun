import { ipcRenderer } from 'electron'
import type { KunGuiPaperApi } from '../shared/paper/kun-gui-api-paper'
import type { PaperProgressEvent } from '../shared/paper/paper-types'

/**
 * Paper-reading bridge methods (paper units, Cool notes, preprocessing).
 * Spread into the main `kunGui` api object in `index.ts` to keep that file
 * under the line limit.
 */
export const paperApi: KunGuiPaperApi = {
  paperImport: (payload) => ipcRenderer.invoke('paper:import', payload),
  paperReadUnit: (payload) => ipcRenderer.invoke('paper:read-unit', payload),
  paperListUnits: (payload) => ipcRenderer.invoke('paper:list-units', payload),
  paperFetchCoolNotes: (payload) => ipcRenderer.invoke('paper:fetch-cool-notes', payload),
  paperPreprocess: (payload) => ipcRenderer.invoke('paper:preprocess', payload),
  paperRecordInterpretation: (payload) =>
    ipcRenderer.invoke('paper:record-interpretation', payload),
  paperCancel: (payload) => ipcRenderer.invoke('paper:cancel', payload),
  onPaperProgress: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: PaperProgressEvent
    ) => handler(payload)
    ipcRenderer.on('paper:progress', wrapped)
    return () => ipcRenderer.removeListener('paper:progress', wrapped)
  }
}

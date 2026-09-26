import { ipcRenderer } from 'electron'
import type { KunGuiPaperApi } from '../shared/paper/kun-gui-api-paper'
import type { PaperProgressEvent } from '../shared/paper/paper-types'

/**
 * Paper-reading bridge methods (paper units, library index, marks,
 * translation, discovery). Spread into the main `kunGui` api object in
 * `index.ts` to keep that file under the line limit.
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
  },

  // ---- library (paper mode) -------------------------------------------------
  paperLibraryList: (payload) => ipcRenderer.invoke('paper-library:list', payload),
  paperDetectLibraries: (payload) => ipcRenderer.invoke('paper-library:detect', payload),
  paperUpdateMeta: (payload) => ipcRenderer.invoke('paper-library:update-meta', payload),
  paperMoveToGroup: (payload) => ipcRenderer.invoke('paper-library:move-to-group', payload),
  paperTrashUnit: (payload) => ipcRenderer.invoke('paper-library:trash', payload),
  paperDownloadPdf: (payload) => ipcRenderer.invoke('paper-library:download-pdf', payload),
  paperReadingActivity: (payload) =>
    ipcRenderer.invoke('paper-library:reading-activity', payload),
  paperLocalStateRead: (payload) => ipcRenderer.invoke('paper-library:local-state-read', payload),
  paperLocalStateWrite: (payload) => ipcRenderer.invoke('paper-library:local-state-write', payload),
  paperExportBibtex: (payload) => ipcRenderer.invoke('paper-library:export-bibtex', payload),
  paperImportBibtex: (payload) => ipcRenderer.invoke('paper-library:import-bibtex', payload),

  // ---- reader ----------------------------------------------------------------
  paperMarksRead: (payload) => ipcRenderer.invoke('paper-reader:marks-read', payload),
  paperMarksWrite: (payload) => ipcRenderer.invoke('paper-reader:marks-write', payload),
  paperTranslateSelection: (payload) =>
    ipcRenderer.invoke('paper-reader:translate-selection', payload),
  paperTranslateDocument: (payload) =>
    ipcRenderer.invoke('paper-reader:translate-document', payload),
  paperTranslateBlocks: (payload) =>
    ipcRenderer.invoke('paper-reader:translate-blocks', payload),
  paperSaveVisualMark: (payload) =>
    ipcRenderer.invoke('paper-reader:save-visual-mark', payload),
  paperFetchReferences: (payload) => ipcRenderer.invoke('paper-reader:references', payload),

  // ---- discover / import enrichment ------------------------------------------
  paperSearchByTitle: (payload) => ipcRenderer.invoke('paper-discover:search-title', payload),
  paperResolveDoi: (payload) => ipcRenderer.invoke('paper-discover:resolve-doi', payload),
  paperFetchUrlMeta: (payload) => ipcRenderer.invoke('paper-discover:url-meta', payload),
  paperIdentifyLocalPdf: (payload) => ipcRenderer.invoke('paper-discover:identify-pdf', payload),
  paperFetchFeed: (payload) => ipcRenderer.invoke('paper-discover:feed', payload),
  paperArxivToday: (payload) => ipcRenderer.invoke('paper-discover:arxiv-today', payload),
  paperListVenue: (payload) => ipcRenderer.invoke('paper-discover:venue', payload),
  paperVenueCatalog: (payload) => ipcRenderer.invoke('paper-discover:venue-catalog', payload)
}

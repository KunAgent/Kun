import { ipcRenderer } from 'electron'
import type { KunGuiApi } from '../shared/kun-gui-api-surface'

/**
 * Write workbench bridge: document export, rich-text clipboard, inline
 * completion, context retrieval, infographics, prototypes, AI properties.
 * Split from index.ts so the main bridge file stays under the line gate.
 */
export const writeBridge: Pick<
  KunGuiApi,
  | 'exportWriteDocument'
  | 'copyWriteDocumentAsRichText'
  | 'requestWriteInlineCompletion'
  | 'requestWriteAiProperties'
  | 'retrieveWriteContext'
  | 'readWriteDocumentSha256'
  | 'generateWriteInfographic'
  | 'authorizeWritePrototype'
  | 'openWritePrototype'
  | 'listWriteInlineCompletionDebugEntries'
  | 'clearWriteInlineCompletionDebugEntries'
> = {
  exportWriteDocument: (payload) => ipcRenderer.invoke('write:export', payload),
  copyWriteDocumentAsRichText: (payload) =>
    ipcRenderer.invoke('write:copy-rich-text', payload),
  requestWriteInlineCompletion: (payload) =>
    ipcRenderer.invoke('write:inline-completion', payload),
  requestWriteAiProperties: (payload) => ipcRenderer.invoke('write:ai-properties', payload),
  retrieveWriteContext: (payload) => ipcRenderer.invoke('write:retrieve-context', payload),
  readWriteDocumentSha256: (payload) => ipcRenderer.invoke('write:read-document-sha256', payload),
  generateWriteInfographic: (payload) => ipcRenderer.invoke('write:generate-infographic', payload),
  authorizeWritePrototype: (payload) => ipcRenderer.invoke('write:authorize-prototype', payload),
  openWritePrototype: (payload) => ipcRenderer.invoke('write:open-prototype', payload),
  listWriteInlineCompletionDebugEntries: () =>
    ipcRenderer.invoke('write:inline-completion-debug:list'),
  clearWriteInlineCompletionDebugEntries: () =>
    ipcRenderer.invoke('write:inline-completion-debug:clear')
}

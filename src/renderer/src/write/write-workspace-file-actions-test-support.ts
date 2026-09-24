import { defaultWriteSettings } from '@shared/app-settings'
import { initialState } from './write-workspace-store-helpers'
import type { WriteWorkspaceState } from './write-workspace-store-types'

export class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

export function makeWriteFileActionBaseState(): WriteWorkspaceState {
  return {
    defaultWorkspaceRoot: '', workspaceRoots: [], autoSaveEnabled: true,
    autoSaveDelayMs: defaultWriteSettings().autoSaveDelayMs,
    documentEditorV2: defaultWriteSettings().documentEditorV2,
    inlineCompletion: defaultWriteSettings().inlineCompletion,
    inlineCompletionApiReady: false,
    selectionAssist: defaultWriteSettings().selectionAssist,
    agentPresets: defaultWriteSettings().agentPresets,
    paperReading: defaultWriteSettings().paperReading,
    paperMode: defaultWriteSettings().paperMode,
    workSurface: 'docs',
    imageGenReady: false, prototypeReady: false, settingsLoading: false, settingsError: null,
    ...initialState(),
    previewMode: 'rich', assistantOpen: true, assistantModel: 'auto', assistantProviderId: '',
    assistantAgentPresetId: '',
    loadWriteSettings: async () => undefined,
    selectWriteWorkspace: async () => undefined,
    addWriteWorkspace: async () => undefined,
    removeWriteWorkspace: async () => undefined,
    setInlineCompletionEnabled: async () => undefined,
    initializeWorkspace: async () => undefined,
    loadDirectory: async () => null,
    toggleDirectory: async () => undefined,
    refreshWorkspace: async () => undefined,
    openFile: async () => undefined,
    loadWhiteboards: async () => undefined,
    createWhiteboard: async () => null,
    openWhiteboard: () => undefined,
    findOrCreatePptWhiteboard: async () => null,
    findOrCreateExcalidrawWhiteboard: async () => ({ ok: false, code: 'create_failed' as const }),
    renameWhiteboard: async () => false,
    deleteWhiteboard: async () => false,
    bindWhiteboardThread: async () => false,
    forgetWhiteboardThread: async () => false,
    updateWhiteboardPptState: async () => false,
    setWhiteboardEngine: async () => false,
    activateTab: () => undefined,
    closeTab: async () => true,
    moveTab: () => undefined,
    focusEditorGroup: () => undefined,
    splitEditorGroup: () => undefined,
    closeEditorGroup: () => undefined,
    setTabViewMode: () => undefined,
    setSplitOrientation: () => undefined,
    setSplitRatio: () => undefined,
    setPresentationViewForGroup: () => undefined,
    clearPresentationViewForGroup: () => undefined,
    setDocumentContent: () => undefined,
    setSpreadsheetMutations: () => undefined,
    convertSpreadsheet: async () => null,
    reloadSpreadsheetConflict: () => undefined,
    resolveSpreadsheetConflict: () => undefined,
    saveDocument: async () => true,
    saveAllDocuments: async () => true,
    setFileContent: () => undefined,
    syncActiveFileFromDisk: async () => false,
    syncActiveImageFromDisk: async () => false,
    flushSave: async () => true,
    createFile: async () => null,
    createDirectory: async () => null,
    renameEntry: async () => null,
    deleteEntry: async () => false,
    setFileError: () => undefined,
    setPreviewMode: () => undefined,
    setAssistantOpen: () => undefined,
    setAssistantModel: () => undefined,
    setAssistantAgentPresetId: () => undefined,
    setReviewActive: () => undefined,
    clearPendingAgentReview: () => undefined,
    setSelection: () => undefined,
    recordRecentEdits: () => undefined,
    quoteCurrentSelection: () => undefined,
    removeQuotedSelection: () => undefined,
    clearQuotedSelections: () => undefined,
    setWorkSurface: () => undefined,
    resetWorkspace: () => undefined
  }
}

import type { WriteAgentPresetV1, WriteInlineCompletionSettingsV1, WriteSelectionAssistSettingsV1 } from '@shared/app-settings'
import type { WorkspaceEntry } from '@shared/workspace-file'
import type {
  WorkspaceOfficePreviewSuccess,
  WorkspacePresentationViewReference
} from '@shared/office-document'
import type { WriteEditorSelectionState } from '../components/write/WriteMarkdownEditor'
import type { WriteQuotedSelection } from './quoted-selection'
import type { WriteRecentEdit } from './recent-edits'
import type { WorkspaceSpreadsheetMutation } from '@shared/workspace-spreadsheet'

export type WritePreviewMode = 'rich' | 'source' | 'live' | 'preview'
export type WriteSaveStatus = 'saved' | 'dirty' | 'saving' | 'error'
export type WriteActiveFileKind = 'text' | 'code' | 'image' | 'pdf' | 'office'
export type WriteEditorGroupId = 'primary' | 'secondary'
export type WriteEditorLayoutOrientation = 'single' | 'horizontal' | 'vertical'

export type WriteEditorTab = {
  kind?: 'file'
  path: string
  viewMode: WritePreviewMode
  cursorOffset?: number
  scrollTop?: number
}

export type WriteWhiteboardTab = {
  kind: 'whiteboard'
  boardId: string
  viewMode: 'rich'
}

export type WriteEditorItem = WriteEditorTab | WriteWhiteboardTab

export type WriteEditorGroup = {
  id: WriteEditorGroupId
  tabs: WriteEditorItem[]
  activePath: string | null
}

export type WorkWhiteboardPhase = 'blank' | 'directions' | 'review' | 'complete'

export type WorkWhiteboard = {
  id: string
  /** The whiteboard's own canonical display title. */
  title: string
  workspaceRoot: string
  threadId: string | null
  /** Ordered Work conversation history; absent on legacy whiteboards. */
  threadIds?: string[]
  sourcePath?: string
  workflowId?: string
  childId?: string
  outputPath?: string
  phase: WorkWhiteboardPhase
  revision: number
  createdAt: string
  updatedAt: string
}

export type WriteEditorLayoutV1 = {
  version: 1
  orientation: WriteEditorLayoutOrientation
  ratio: number
  focusedGroupId: WriteEditorGroupId
  groups: WriteEditorGroup[]
}

export type WriteDocumentSession = {
  path: string
  kind: WriteActiveFileKind
  fileContent: string
  imageDataUrl: string
  imageMimeType: string
  pdfDataBase64: string
  pdfMimeType: string
  pdfMtimeMs: number
  officePreview: WorkspaceOfficePreviewSuccess | null
  officeLoading: boolean
  officeRefreshError: string | null
  officeAgentEditing: boolean
  officeSemanticText: string
  officeSemanticSha256: string
  officeSemanticTruncated: boolean
  spreadsheetMutations: WorkspaceSpreadsheetMutation[]
  spreadsheetMutationBaseFingerprints: Record<string, string>
  spreadsheetUnsupportedReason: string | null
  spreadsheetConflictPreview: WorkspaceOfficePreviewSuccess | null
  spreadsheetConflictTargets: string[]
  spreadsheetConflictBaseFingerprints: Record<string, string>
  spreadsheetCommitRevision: number
  spreadsheetSourceSha256: string
  fileSize: number
  fileTruncated: boolean
  fileError: string | null
  fileLoading: boolean
  saveStatus: WriteSaveStatus
  documentEpoch: number
  contentRevision: number
  persistedContent: string
  pendingAgentReview: {
    workspaceRoot: string
    filePath: string
    documentEpoch: number
    nextContent: string
  } | null
  reviewActive: boolean
  selection: WriteEditorSelectionState
  quotedSelections: WriteQuotedSelection[]
  recentEdits: WriteRecentEdit[]
}

export type WriteWorkspaceState = {
  defaultWorkspaceRoot: string
  workspaceRoots: string[]
  autoSaveEnabled: boolean
  autoSaveDelayMs: number
  inlineCompletion: WriteInlineCompletionSettingsV1
  inlineCompletionApiReady: boolean
  /** Selection toolbar AI assists: quick action prompts + infographic prompt. */
  selectionAssist: WriteSelectionAssistSettingsV1
  /** Named writing-assistant personas for quick switching. */
  agentPresets: WriteAgentPresetV1[]
  /** True when the image generation provider is fully configured (enables 生成信息图). */
  imageGenReady: boolean
  /** True when the primary chat provider is configured (enables 生成交互原型). */
  prototypeReady: boolean
  settingsLoading: boolean
  settingsError: string | null
  workspaceRoot: string
  rootDirectory: string
  entriesByDir: Record<string, WorkspaceEntry[]>
  expandedDirs: Set<string>
  loadingDirs: Record<string, boolean>
  treeError: string | null
  documentsByPath: Record<string, WriteDocumentSession>
  whiteboards: Record<string, WorkWhiteboard>
  whiteboardsLoading: boolean
  editorLayout: WriteEditorLayoutV1
  presentationViewByGroup: Partial<Record<WriteEditorGroupId, WorkspacePresentationViewReference>>
  activeFilePath: string | null
  activeFileKind: WriteActiveFileKind | null
  activeWhiteboardId: string | null
  fileContent: string
  imageDataUrl: string
  imageMimeType: string
  pdfDataBase64: string
  pdfMimeType: string
  pdfMtimeMs: number
  fileSize: number
  fileTruncated: boolean
  fileError: string | null
  fileLoading: boolean
  saveStatus: WriteSaveStatus
  /** Advances whenever the active document lifecycle changes, including reopening the same path. */
  documentEpoch: number
  /** Advances for each local content mutation within the active document epoch. */
  contentRevision: number
  /** Last content confirmed on disk for the active document epoch. */
  persistedContent: string
  /** Set when an agent edited the active file and the change awaits red/green review. */
  pendingAgentReview: {
    workspaceRoot: string
    filePath: string
    documentEpoch: number
    nextContent: string
  } | null
  /** True while an inline diff review (agent edit or AI rewrite) is in progress. */
  reviewActive: boolean
  previewMode: WritePreviewMode
  assistantOpen: boolean
  assistantModel: string
  assistantProviderId: string
  /** Active writing-agent persona preset id ('' = none); applied to assistant sends. */
  assistantAgentPresetId: string
  selection: WriteEditorSelectionState
  quotedSelections: WriteQuotedSelection[]
  recentEdits: WriteRecentEdit[]
  loadWriteSettings: () => Promise<void>
  selectWriteWorkspace: (workspaceRoot: string) => Promise<void>
  addWriteWorkspace: (workspaceRoot: string) => Promise<void>
  removeWriteWorkspace: (workspaceRoot: string) => Promise<void>
  setInlineCompletionEnabled: (enabled: boolean) => Promise<void>
  initializeWorkspace: (workspaceRoot: string) => Promise<void>
  loadDirectory: (workspaceRoot: string, path?: string) => Promise<string | null>
  toggleDirectory: (workspaceRoot: string, path: string) => Promise<void>
  refreshWorkspace: (workspaceRoot: string) => Promise<void>
  openFile: (
    workspaceRoot: string,
    path: string,
    options?: { groupId?: WriteEditorGroupId; viewMode?: WritePreviewMode }
  ) => Promise<void>
  loadWhiteboards: (workspaceRoot: string) => Promise<void>
  createWhiteboard: (workspaceRoot: string, options: {
    title: string
    groupId?: WriteEditorGroupId
    sourcePath?: string
    threadId?: string
    workflowId?: string
    childId?: string
  }) => Promise<WorkWhiteboard | null>
  openWhiteboard: (boardId: string, groupId?: WriteEditorGroupId) => void
  findOrCreatePptWhiteboard: (input: {
    workspaceRoot: string
    threadId: string
    workflowId: string
    title: string
    childId?: string
    sourcePath?: string
  }) => Promise<WorkWhiteboard | null>
  renameWhiteboard: (boardId: string, title: string) => Promise<boolean>
  deleteWhiteboard: (boardId: string) => Promise<boolean>
  bindWhiteboardThread: (boardId: string, threadId: string) => Promise<boolean>
  forgetWhiteboardThread: (threadId: string) => Promise<boolean>
  updateWhiteboardPptState: (boardId: string, patch: {
    phase?: WorkWhiteboardPhase
    outputPath?: string
    childId?: string
    revision?: number
  }) => Promise<boolean>
  activateTab: (groupId: WriteEditorGroupId, path: string) => void
  closeTab: (groupId: WriteEditorGroupId, path: string, force?: boolean) => Promise<boolean>
  moveTab: (path: string, fromGroupId: WriteEditorGroupId, toGroupId: WriteEditorGroupId, index?: number) => void
  focusEditorGroup: (groupId: WriteEditorGroupId) => void
  splitEditorGroup: (orientation: Exclude<WriteEditorLayoutOrientation, 'single'>, path?: string) => void
  closeEditorGroup: (groupId: WriteEditorGroupId) => void
  setTabViewMode: (groupId: WriteEditorGroupId, path: string, mode: WritePreviewMode) => void
  setSplitOrientation: (orientation: Exclude<WriteEditorLayoutOrientation, 'single'>) => void
  setSplitRatio: (ratio: number) => void
  setPresentationViewForGroup: (
    groupId: WriteEditorGroupId,
    view: WorkspacePresentationViewReference
  ) => void
  clearPresentationViewForGroup: (
    groupId: WriteEditorGroupId,
    source: Pick<WorkspacePresentationViewReference, 'path' | 'sourceSha256'>
  ) => void
  setDocumentContent: (path: string, content: string) => void
  setSpreadsheetMutations: (
    path: string,
    mutations: WorkspaceSpreadsheetMutation[],
    unsupportedReason?: string | null,
    baseFingerprints?: Record<string, string>
  ) => void
  convertSpreadsheet: (workspaceRoot: string, path: string) => Promise<string | null>
  reloadSpreadsheetConflict: (path: string) => void
  resolveSpreadsheetConflict: (
    path: string,
    decision: 'keep-local' | 'use-external'
  ) => void
  saveDocument: (
    workspaceRoot: string,
    path: string,
    options?: { resolveExternalConflict?: 'keep-local' }
  ) => Promise<boolean>
  saveAllDocuments: (workspaceRoot: string) => Promise<boolean>
  setFileContent: (content: string) => void
  syncActiveFileFromDisk: (
    workspaceRoot: string,
    options?: {
      path?: string
      content?: string
      size?: number
      truncated?: boolean
      message?: string
      animate?: boolean
      force?: boolean
      /** When true, surface the change as a red/green diff review instead of applying it. */
      reviewAsDiff?: boolean
    }
  ) => Promise<boolean>
  syncActiveImageFromDisk: (workspaceRoot: string, path?: string) => Promise<boolean>
  flushSave: (
    workspaceRoot: string,
    options?: { resolveExternalConflict?: 'keep-local' }
  ) => Promise<boolean>
  createFile: (workspaceRoot: string, path: string, content?: string) => Promise<string | null>
  createDirectory: (workspaceRoot: string, path: string) => Promise<string | null>
  renameEntry: (workspaceRoot: string, path: string, newName: string) => Promise<string | null>
  deleteEntry: (workspaceRoot: string, path: string) => Promise<boolean>
  setFileError: (message: string | null) => void
  setPreviewMode: (mode: WritePreviewMode) => void
  setAssistantOpen: (open: boolean) => void
  setAssistantModel: (model: string, providerId?: string) => void
  setAssistantAgentPresetId: (id: string) => void
  setSelection: (selection: WriteEditorSelectionState) => void
  setReviewActive: (active: boolean) => void
  clearPendingAgentReview: () => void
  recordRecentEdits: (edits: WriteRecentEdit[]) => void
  quoteCurrentSelection: (workspaceRoot: string) => void
  removeQuotedSelection: (id: string) => void
  clearQuotedSelections: () => void
  resetWorkspace: () => void
}

export type WriteWorkspaceSet = (
  partial: Partial<WriteWorkspaceState> | ((state: WriteWorkspaceState) => Partial<WriteWorkspaceState>)
) => void

export type WriteWorkspaceGet = () => WriteWorkspaceState

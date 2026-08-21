import { create } from 'zustand'
import {
  DEFAULT_WRITE_INLINE_COMPLETION_DEBOUNCE_MS,
  DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS,
  DEFAULT_WRITE_INLINE_COMPLETION_MIN_ACCEPT_SCORE,
  DEFAULT_WRITE_INLINE_COMPLETION_MODEL,
  DEFAULT_WRITE_AUTOSAVE_DELAY_MS,
  DEFAULT_WRITE_INLINE_LONG_COMPLETION_DEBOUNCE_MS,
  DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS,
  DEFAULT_WRITE_INLINE_LONG_COMPLETION_MIN_ACCEPT_SCORE,
  defaultWriteSelectionAssistSettings
} from '@shared/app-settings'
import { normalizeWriteQuotedSelections, quotedSelectionFromEditor } from './quoted-selection'
import { writeSelectionStatesEqual } from './write-selection'
import { trimWriteRecentEdits } from './recent-edits'
import type { WriteWorkspaceState } from './write-workspace-store-types'
import { createWriteSettingsActions } from './write-workspace-settings-actions'
import { createWriteFileActions } from './write-workspace-file-actions'
import { createWriteEditorGroupActions } from './write-editor-group-actions'
import { createWritePresentationViewActions } from './write-presentation-view-state'
import { createWorkWhiteboardActions } from './work-whiteboard'
import { writeDocumentKey } from './write-editor-layout'
import { createWriteSpreadsheetActions } from './write-workspace-spreadsheet-actions'
import { writeBrowserStorageItem } from '../lib/browser-storage'
import {
  captureWriteDocumentContext,
  nextWriteDocumentEpoch,
  writeDocumentContextMatches
} from './write-document-context'
import {
  enqueueWriteWorkspaceSave,
  flushWriteWorkspaceSaveQueue,
  isWriteWorkspaceSaveContentPending
} from './write-save-coordinator'
import {
  WRITE_ASSISTANT_MODEL_KEY,
  WRITE_ASSISTANT_PROVIDER_KEY,
  WRITE_ASSISTANT_OPEN_KEY,
  WRITE_PREVIEW_MODE_KEY,
  commonPrefixLength,
  emptySelection,
  formatWriteImageLoadError,
  initialState,
  isMissingImageIpc,
  normalizeWriteAssistantModel,
  pathsEqual,
  readStoredAssistantModel,
  readStoredAssistantOpen,
  readStoredAssistantProviderId,
  readStoredPreviewMode,
  writeBasenameFromPath,
  writeJoinPath,
  writeRelativeToWorkspace
} from './write-workspace-store-helpers'
export type {
  WorkWhiteboard,
  WorkWhiteboardPhase,
  WriteActiveFileKind,
  WriteDocumentSession,
  WriteEditorGroup,
  WriteEditorGroupId,
  WriteEditorItem,
  WriteEditorLayoutOrientation,
  WriteEditorLayoutV1,
  WriteEditorTab,
  WriteWhiteboardTab,
  WritePreviewMode,
  WriteSaveStatus,
  WriteWorkspaceState
} from './write-workspace-store-types'
export { writeBasenameFromPath, writeDirnameFromPath, writeJoinPath, writeRelativeToWorkspace } from './write-workspace-store-helpers'

const MAX_ANIMATED_EXTERNAL_SYNC_CHARS = 120_000

let externalSyncTimer: number | null = null
let externalSyncAnimationToken = 0

function cancelExternalSyncAnimation(): void {
  externalSyncAnimationToken += 1
  if (externalSyncTimer !== null) {
    window.clearTimeout(externalSyncTimer)
    externalSyncTimer = null
  }
}


export const useWriteWorkspaceStore = create<WriteWorkspaceState>((set, get) => {
  const editorGroupActions = createWriteEditorGroupActions(set, get)
  const presentationViewActions = createWritePresentationViewActions(set, get)
  const whiteboardActions = createWorkWhiteboardActions(set, get)
  return ({
  defaultWorkspaceRoot: '',
  workspaceRoots: [],
  autoSaveEnabled: true,
  autoSaveDelayMs: DEFAULT_WRITE_AUTOSAVE_DELAY_MS,
  inlineCompletion: {
    enabled: true,
    retrievalEnabled: true,
    longCompletionEnabled: true,
    inheritProvider: true,
    providerId: '',
    apiKey: '',
    baseUrl: '',
    inheritModel: true,
    model: DEFAULT_WRITE_INLINE_COMPLETION_MODEL,
    debounceMs: DEFAULT_WRITE_INLINE_COMPLETION_DEBOUNCE_MS,
    longDebounceMs: DEFAULT_WRITE_INLINE_LONG_COMPLETION_DEBOUNCE_MS,
    minAcceptScore: DEFAULT_WRITE_INLINE_COMPLETION_MIN_ACCEPT_SCORE,
    longMinAcceptScore: DEFAULT_WRITE_INLINE_LONG_COMPLETION_MIN_ACCEPT_SCORE,
    maxTokens: DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS,
    longMaxTokens: DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS
  },
  inlineCompletionApiReady: false,
  selectionAssist: defaultWriteSelectionAssistSettings(),
  agentPresets: [],
  imageGenReady: false,
  prototypeReady: false,
  settingsLoading: false,
  settingsError: null,
  ...initialState(),
  previewMode: readStoredPreviewMode(),
  assistantOpen: readStoredAssistantOpen(),
  assistantModel: readStoredAssistantModel(),
  assistantProviderId: readStoredAssistantProviderId(),
  assistantAgentPresetId: '',

  ...createWriteSettingsActions({ set, get }),
  ...createWriteFileActions({
    set,
    get,
    cancelExternalSyncAnimation
  }),
  ...editorGroupActions,
  ...presentationViewActions,
  ...whiteboardActions,
  ...createWriteSpreadsheetActions(set, get),

  setFileContent: (content) => {
    cancelExternalSyncAnimation()
    const activePath = get().activeFilePath
    if (activePath && get().documentsByPath[writeDocumentKey(activePath)]) {
      get().setDocumentContent(activePath, content)
      return
    }
    set((state) => ({
      fileContent: content,
      contentRevision: state.contentRevision + 1,
      saveStatus:
        state.activeFileKind === 'text' && state.activeFilePath && content !== state.persistedContent
          ? 'dirty'
          : 'saved'
    }))
  },

  setReviewActive: (active) => set((state) => {
    const reviewActive = active === true
    if (!state.activeFilePath) return { reviewActive }
    const key = writeDocumentKey(state.activeFilePath)
    const document = state.documentsByPath[key]
    return {
      reviewActive,
      documentsByPath: document
        ? { ...state.documentsByPath, [key]: { ...document, reviewActive } }
        : state.documentsByPath
    }
  }),

  clearPendingAgentReview: () => set((state) => {
    if (!state.activeFilePath) return { pendingAgentReview: null }
    const key = writeDocumentKey(state.activeFilePath)
    const document = state.documentsByPath[key]
    return {
      pendingAgentReview: null,
      documentsByPath: document
        ? { ...state.documentsByPath, [key]: { ...document, pendingAgentReview: null } }
        : state.documentsByPath
    }
  }),

  syncActiveFileFromDisk: async (workspaceRoot, options = {}) => {
    const snapshot = get()
    const context = captureWriteDocumentContext(snapshot)
    const force = options.force === true
    if (!context || !snapshot.activeFilePath) return false
    if (!pathsEqual(context.workspaceRoot, workspaceRoot)) return false
    if (snapshot.activeFileKind !== 'text') return false
    if (
      !force &&
      snapshot.fileContent !== snapshot.persistedContent &&
      typeof options.content !== 'string'
    ) return false
    if (options.path && !pathsEqual(options.path, snapshot.activeFilePath)) return false

    if (options.message) {
      if (writeDocumentContextMatches(get(), context)) {
        set({ fileError: options.message, saveStatus: 'error' })
      }
      return false
    }

    let content = options.content
    let resolvedPath = options.path ?? snapshot.activeFilePath
    let size = options.size
    let truncated = options.truncated
    if (typeof content !== 'string') {
      let result: Awaited<ReturnType<typeof window.kunGui.readWorkspaceFile>>
      try {
        result = await window.kunGui.readWorkspaceFile({
          path: snapshot.activeFilePath,
          workspaceRoot
        })
      } catch (error) {
        if (writeDocumentContextMatches(get(), context)) {
          set({
            fileError: error instanceof Error ? error.message : String(error),
            saveStatus: 'error'
          })
        }
        return false
      }
      if (!result.ok) {
        if (writeDocumentContextMatches(get(), context)) {
          set({ fileError: result.message, saveStatus: 'error' })
        }
        return false
      }
      content = result.content
      resolvedPath = result.path
      size = result.size
      truncated = result.truncated
    }

    const nextSize = typeof size === 'number' && Number.isFinite(size)
      ? Math.max(0, Math.floor(size))
      : content.length
    const nextTruncated = truncated === true

    const latest = get()
    if (
      !writeDocumentContextMatches(latest, context) ||
      !latest.activeFilePath ||
      !pathsEqual(latest.activeFilePath, resolvedPath)
    ) return false
    if (
      !force &&
      isWriteWorkspaceSaveContentPending(context.workspaceRoot, context.filePath, content)
    ) {
      // Filesystem watchers can fire before the corresponding IPC write has
      // settled. Keep the save loop authoritative and do not misclassify its
      // payload as an external assistant edit.
      set({
        fileLoading: false,
        fileSize: nextSize,
        fileTruncated: nextTruncated
      })
      return true
    }

    const hasLocalDraft = latest.fileContent !== latest.persistedContent
    if (!force && hasLocalDraft) {
      if (content === latest.persistedContent) {
        // Delayed echo of the last confirmed baseline. It carries no new disk
        // revision and must not disturb the newer local draft.
        set({
          fileLoading: false,
          fileSize: nextSize,
          fileTruncated: nextTruncated
        })
        return true
      }
      if (content === latest.fileContent) {
        // The watcher confirms that the disk caught up with the local draft.
        // This can happen just after the write promise settles.
        cancelExternalSyncAnimation()
        set({
          persistedContent: content,
          saveStatus: 'saved',
          fileError: null,
          fileLoading: false,
          fileSize: nextSize,
          fileTruncated: nextTruncated
        })
        return true
      }
      if (
        options.reviewAsDiff !== true ||
        nextTruncated ||
        content.length > MAX_ANIMATED_EXTERNAL_SYNC_CHARS
      ) {
        return false
      }
      // Fall through to the diff-review branch. It updates the disk baseline
      // but deliberately leaves fileContent/saveStatus untouched, preserving
      // the local draft until the user resolves the review.
    }
    if (
      latest.fileContent === content &&
      latest.persistedContent === content &&
      latest.fileSize === nextSize &&
      latest.fileTruncated === nextTruncated
    ) {
      set({
        saveStatus: 'saved',
        fileError: null,
        fileLoading: false,
        fileSize: nextSize,
        fileTruncated: nextTruncated
      })
      return true
    }

    cancelExternalSyncAnimation()

    // Agent edits surface as a red/green diff review instead of silently
    // overwriting the editor. The disk already holds `content`, so we record it
    // as the saved baseline and stash it for review; the review's commit later
    // reconciles disk to whatever the user accepts or rejects.
    if (
      options.reviewAsDiff === true &&
      !nextTruncated &&
      content.length <= MAX_ANIMATED_EXTERNAL_SYNC_CHARS &&
      latest.fileContent !== content
    ) {
      set({
        persistedContent: content,
        pendingAgentReview: { ...context, nextContent: content },
        reviewActive: true,
        fileSize: nextSize,
        fileTruncated: nextTruncated,
        fileError: null,
        fileLoading: false
      })
      return true
    }

    if (
      options.animate !== false &&
      !nextTruncated &&
      content.length <= MAX_ANIMATED_EXTERNAL_SYNC_CHARS &&
      content.length > latest.fileContent.length
    ) {
      const token = externalSyncAnimationToken
      const prefix = commonPrefixLength(latest.fileContent, content)
      let cursor = prefix
      set({
        fileContent: content.slice(0, prefix),
        persistedContent: content,
        fileSize: nextSize,
        fileTruncated: nextTruncated,
        saveStatus: 'saved',
        fileError: null,
        fileLoading: false
      })
      const step = (): void => {
        if (token !== externalSyncAnimationToken) return
        if (!writeDocumentContextMatches(get(), context)) return
        const remaining = content.length - cursor
        const chunk = Math.max(24, Math.ceil(remaining * 0.1))
        cursor = Math.min(content.length, cursor + chunk)
        set({
          fileContent: content.slice(0, cursor),
          fileSize: nextSize,
          fileTruncated: nextTruncated,
          saveStatus: 'saved',
          fileError: null,
          fileLoading: false
        })
        if (cursor < content.length) {
          externalSyncTimer = window.setTimeout(step, 16)
        } else {
          externalSyncTimer = null
        }
      }
      externalSyncTimer = window.setTimeout(step, 16)
      return true
    }

    set({
      fileContent: content,
      persistedContent: content,
      fileSize: nextSize,
      fileTruncated: nextTruncated,
      saveStatus: 'saved',
      fileError: null,
      fileLoading: false
    })
    return true
  },

  syncActiveImageFromDisk: async (workspaceRoot, path) => {
    const snapshot = get()
    const context = captureWriteDocumentContext(snapshot)
    if (!context || !snapshot.activeFilePath || snapshot.activeFileKind !== 'image') return false
    if (!pathsEqual(context.workspaceRoot, workspaceRoot)) return false
    if (path && !pathsEqual(path, snapshot.activeFilePath)) return false

    try {
      const result = await window.kunGui.readWorkspaceImage({
        path: snapshot.activeFilePath,
        workspaceRoot
      })
      if (!result.ok) {
        if (writeDocumentContextMatches(get(), context)) {
          set({ fileError: result.message })
        }
        return false
      }

      const latest = get()
      if (
        !writeDocumentContextMatches(latest, context) ||
        !latest.activeFilePath ||
        latest.activeFileKind !== 'image' ||
        !pathsEqual(latest.activeFilePath, result.path)
      ) {
        return false
      }

      set({
        imageDataUrl: result.dataUrl,
        imageMimeType: result.mimeType,
        fileSize: result.size,
        fileError: null,
        fileLoading: false,
        saveStatus: 'saved'
      })
      return true
    } catch (error) {
      if (isMissingImageIpc(error)) return false
      if (writeDocumentContextMatches(get(), context)) {
        set({ fileError: formatWriteImageLoadError(error) })
      }
      return false
    }
  },

  flushSave: async (workspaceRoot, options = {}) => {
    const activePath = get().activeFilePath
    if (activePath && get().documentsByPath[writeDocumentKey(activePath)]) {
      return get().saveDocument(workspaceRoot, activePath, options)
    }
    for (;;) {
      const state = get()
      if (!state.activeFilePath || state.activeFileKind !== 'text') return true
      if (state.fileTruncated) return false
      const context = captureWriteDocumentContext(state)
      if (!context || !pathsEqual(context.workspaceRoot, workspaceRoot)) return false
      const resolveExternalConflict = options.resolveExternalConflict === 'keep-local'
      if (state.reviewActive && !state.pendingAgentReview) {
        // A live source-editor diff must be resolved through its accept/reject
        // controls; Save cannot safely infer the user's chosen result.
        return false
      }
      if (state.pendingAgentReview && !resolveExternalConflict) {
        // An unresolved external review must survive background
        // autosave/navigation. Only an explicit Save may choose the local
        // draft over the external disk revision.
        return false
      }
      await flushWriteWorkspaceSaveQueue(context.workspaceRoot, context.filePath)
      const afterQueuedSave = get()
      if (!writeDocumentContextMatches(afterQueuedSave, context)) return true
      if (afterQueuedSave !== state) {
        // Another flush may have settled (or the user may have edited) while
        // this caller waited. Re-evaluate from the newest persisted baseline.
        continue
      }
      if (externalSyncTimer !== null) {
        cancelExternalSyncAnimation()
        set((current) => writeDocumentContextMatches(current, context)
          ? {
              fileContent: current.persistedContent,
              contentRevision: current.contentRevision + 1,
              saveStatus: 'saved',
              fileError: null
            }
          : {})
        return true
      }
      cancelExternalSyncAnimation()
      if (state.fileContent === state.persistedContent) {
        if (writeDocumentContextMatches(get(), context)) {
          set({
            saveStatus: 'saved',
            ...(resolveExternalConflict
              ? { pendingAgentReview: null, reviewActive: false, fileError: null }
              : {})
          })
        }
        return true
      }

      const content = state.fileContent
      const revision = state.contentRevision
      set((current) => writeDocumentContextMatches(current, context) && current.contentRevision === revision
        ? { saveStatus: 'saving' }
        : {})
      let result: Awaited<ReturnType<typeof window.kunGui.writeWorkspaceFile>>
      try {
        result = await enqueueWriteWorkspaceSave({
          path: context.filePath,
          workspaceRoot: context.workspaceRoot,
          content
        })
      } catch (error) {
        if (writeDocumentContextMatches(get(), context)) {
          set({
            saveStatus: 'error',
            fileError: error instanceof Error ? error.message : String(error)
          })
        }
        return false
      }
      if (!result.ok) {
        if (writeDocumentContextMatches(get(), context)) {
          set({ saveStatus: 'error', fileError: result.message })
        }
        return false
      }
      if (!writeDocumentContextMatches(get(), context)) return true

      set((current) => {
        if (!writeDocumentContextMatches(current, context)) return {}
        const latestIsPersisted = current.fileContent === content
        return {
          persistedContent: content,
          saveStatus: latestIsPersisted ? 'saved' : 'dirty',
          fileError: null,
          ...(resolveExternalConflict
            ? { pendingAgentReview: null, reviewActive: false }
            : {})
        }
      })
      const latest = get()
      if (!writeDocumentContextMatches(latest, context)) return true
      if (latest.fileContent === latest.persistedContent) return true
      // Content changed while the queued write was in flight. Loop once more
      // with the newest revision so navigation cannot treat it as persisted.
    }
  },

  setFileError: (message) => {
    set((state) => {
      if (!state.activeFilePath) return { fileError: message }
      const key = writeDocumentKey(state.activeFilePath)
      const document = state.documentsByPath[key]
      return {
        fileError: message,
        documentsByPath: document
          ? { ...state.documentsByPath, [key]: { ...document, fileError: message } }
          : state.documentsByPath
      }
    })
  },

  setPreviewMode: (mode) => {
    writeBrowserStorageItem(WRITE_PREVIEW_MODE_KEY, mode)
    const state = get()
    const group = state.editorLayout.groups.find((candidate) => candidate.id === state.editorLayout.focusedGroupId)
    if (group?.activePath) {
      state.setTabViewMode(group.id, group.activePath, mode)
      return
    }
    set({ previewMode: mode })
  },

  setAssistantOpen: (open) => {
    writeBrowserStorageItem(WRITE_ASSISTANT_OPEN_KEY, open ? '1' : '0')
    set({ assistantOpen: open })
  },

  setAssistantModel: (model, providerId) => {
    const normalized = normalizeWriteAssistantModel(model)
    writeBrowserStorageItem(WRITE_ASSISTANT_MODEL_KEY, normalized)
    const normalizedProviderId = providerId?.trim() ?? ''
    writeBrowserStorageItem(WRITE_ASSISTANT_PROVIDER_KEY, normalizedProviderId)
    set({ assistantModel: normalized, assistantProviderId: normalizedProviderId })
  },

  setAssistantAgentPresetId: (id) => {
    set({ assistantAgentPresetId: typeof id === 'string' ? id : '' })
  },

  setSelection: (selection) => {
    if (writeSelectionStatesEqual(get().selection, selection)) return
    set((state) => {
      if (!state.activeFilePath) return { selection }
      const key = writeDocumentKey(state.activeFilePath)
      const document = state.documentsByPath[key]
      return {
        selection,
        documentsByPath: document
          ? { ...state.documentsByPath, [key]: { ...document, selection } }
          : state.documentsByPath
      }
    })
  },

  recordRecentEdits: (edits) => {
    if (edits.length === 0) return
    set((state) => {
      const recentEdits = trimWriteRecentEdits([...state.recentEdits, ...edits])
      if (!state.activeFilePath) return { recentEdits }
      const key = writeDocumentKey(state.activeFilePath)
      const document = state.documentsByPath[key]
      return {
        recentEdits,
        documentsByPath: document
          ? { ...state.documentsByPath, [key]: { ...document, recentEdits } }
          : state.documentsByPath
      }
    })
  },

  quoteCurrentSelection: (workspaceRoot) => {
    const state = get()
    if (!state.activeFilePath) return
    const quote = quotedSelectionFromEditor(state.selection, state.activeFilePath, workspaceRoot)
    if (!quote) return
    set((current) => {
      const quotedSelections = normalizeWriteQuotedSelections([...current.quotedSelections, quote])
      const selection = emptySelection()
      const key = current.activeFilePath ? writeDocumentKey(current.activeFilePath) : ''
      const document = key ? current.documentsByPath[key] : undefined
      return {
        assistantOpen: true,
        quotedSelections,
        selection,
        documentsByPath: document
          ? {
              ...current.documentsByPath,
              [key]: { ...document, quotedSelections, selection }
            }
          : current.documentsByPath
      }
    })
  },

  removeQuotedSelection: (id) =>
    set((state) => {
      const quotedSelections = state.quotedSelections.filter((selection) => selection.id !== id)
      const key = state.activeFilePath ? writeDocumentKey(state.activeFilePath) : ''
      const document = key ? state.documentsByPath[key] : undefined
      return {
        quotedSelections,
        documentsByPath: document
          ? { ...state.documentsByPath, [key]: { ...document, quotedSelections } }
          : state.documentsByPath
      }
    }),

  clearQuotedSelections: () => set((state) => {
    const key = state.activeFilePath ? writeDocumentKey(state.activeFilePath) : ''
    const document = key ? state.documentsByPath[key] : undefined
    return {
      quotedSelections: [],
      documentsByPath: document
        ? { ...state.documentsByPath, [key]: { ...document, quotedSelections: [] } }
        : state.documentsByPath
    }
  }),

  resetWorkspace: () => {
    cancelExternalSyncAnimation()
    set((state) => ({
      ...initialState(),
      documentEpoch: nextWriteDocumentEpoch(state.documentEpoch)
    }))
  }
  })
})

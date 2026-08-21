import i18n from '../i18n'
import type {
  WriteDocumentSession,
  WriteEditorGroupId,
  WriteEditorItem,
  WriteEditorLayoutOrientation,
  WritePreviewMode,
  WriteWorkspaceGet,
  WriteWorkspaceSet,
  WriteWorkspaceState
} from './write-workspace-store-types'
import {
  addEditorItemToGroup,
  captureFocusedDocument,
  clearWriteOfficeSelections,
  focusedWriteGroup,
  persistWriteEditorLayout,
  projectFocusedDocument,
  isWriteFileTab,
  tabViewMode,
  writeDocumentKey,
  writeEditorItemForKey,
  writeEditorItemKey,
  writeWhiteboardIdFromTabKey
} from './write-editor-layout'
import { enqueueWriteWorkspaceSave, flushWriteWorkspaceSaveQueue } from './write-save-coordinator'
import {
  commitWriteSpreadsheetEditorSave,
  finishWriteSpreadsheetEditorSave,
  prepareWriteSpreadsheetEditorSave,
  type CoordinatedSpreadsheetSave
} from './write-spreadsheet-editor-coordinator'
import { normalizePath, pathsEqual } from './write-workspace-store-helpers'

type WriteEditorActions = Pick<
  WriteWorkspaceState,
  | 'activateTab'
  | 'closeTab'
  | 'moveTab'
  | 'focusEditorGroup'
  | 'splitEditorGroup'
  | 'closeEditorGroup'
  | 'setTabViewMode'
  | 'setSplitOrientation'
  | 'setSplitRatio'
  | 'setDocumentContent'
  | 'setSpreadsheetMutations'
  | 'saveDocument'
  | 'saveAllDocuments'
>

function persist(workspaceRoot: string, layout: WriteWorkspaceState['editorLayout']): void {
  persistWriteEditorLayout(workspaceRoot, layout)
}

function withProjection(
  documentsByPath: WriteWorkspaceState['documentsByPath'],
  editorLayout: WriteWorkspaceState['editorLayout']
): Partial<WriteWorkspaceState> {
  return { documentsByPath, editorLayout, ...projectFocusedDocument(editorLayout, documentsByPath) }
}

function updateDocument(
  documents: Record<string, WriteDocumentSession>,
  path: string,
  update: (document: WriteDocumentSession) => WriteDocumentSession
): Record<string, WriteDocumentSession> {
  const key = writeDocumentKey(path)
  const document = documents[key]
  if (!document) return documents
  return { ...documents, [key]: update(document) }
}

function documentReferenceCount(state: WriteWorkspaceState, path: string): number {
  if (writeWhiteboardIdFromTabKey(path)) return 0
  const key = writeDocumentKey(path)
  return state.editorLayout.groups.reduce(
    (count, group) => count + group.tabs.filter((tab) => (
      isWriteFileTab(tab) && writeDocumentKey(tab.path) === key
    )).length,
    0
  )
}

function requestedItemKey(value: string): string {
  return writeWhiteboardIdFromTabKey(value) ? value : writeDocumentKey(value)
}

function removeTabFromGroup(
  state: WriteWorkspaceState,
  groupId: WriteEditorGroupId,
  requestedKey: string
): Pick<WriteWorkspaceState, 'editorLayout' | 'documentsByPath'> {
  const key = requestedItemKey(requestedKey)
  const targetGroup = state.editorLayout.groups.find((group) => group.id === groupId)
  const removedItem: WriteEditorItem | null = targetGroup
    ? writeEditorItemForKey(targetGroup, key)
    : null
  const groups = state.editorLayout.groups.map((group) => {
    if (group.id !== groupId) return group
    const index = group.tabs.findIndex((tab) => writeEditorItemKey(tab) === key)
    if (index < 0) return group
    const tabs = group.tabs.filter((_, tabIndex) => tabIndex !== index)
    const nextActive = group.activePath && requestedItemKey(group.activePath) !== key
      ? group.activePath
      : tabs[Math.min(index, Math.max(0, tabs.length - 1))]
        ? writeEditorItemKey(tabs[Math.min(index, Math.max(0, tabs.length - 1))])
        : null
    return { ...group, tabs, activePath: nextActive }
  })
  let editorLayout = { ...state.editorLayout, groups }
  if (editorLayout.focusedGroupId === groupId && !groups.some((group) => group.id === groupId)) {
    editorLayout = { ...editorLayout, focusedGroupId: groups[0]?.id ?? 'primary' }
  }
  const stillReferenced = groups.some((group) => group.tabs.some((tab) => writeEditorItemKey(tab) === key))
  if (stillReferenced) return { editorLayout, documentsByPath: state.documentsByPath }
  if (!removedItem || !isWriteFileTab(removedItem)) {
    return { editorLayout, documentsByPath: state.documentsByPath }
  }
  const documentsByPath = { ...state.documentsByPath }
  delete documentsByPath[writeDocumentKey(removedItem.path)]
  return { editorLayout, documentsByPath }
}

export function createWriteEditorGroupActions(
  set: WriteWorkspaceSet,
  get: WriteWorkspaceGet
): WriteEditorActions {
  const saveDocument = async (
    workspaceRoot: string,
    path: string,
    options: { resolveExternalConflict?: 'keep-local' } = {}
  ): Promise<boolean> => {
    const key = writeDocumentKey(path)
    for (;;) {
      const rawSnapshot = get()
      const capturedDocuments = captureFocusedDocument(rawSnapshot)
      if (capturedDocuments !== rawSnapshot.documentsByPath) set({ documentsByPath: capturedDocuments })
      const snapshot = { ...rawSnapshot, documentsByPath: capturedDocuments }
      const document = snapshot.documentsByPath[key]
      if (!document) return true
      if (document.kind === 'office' && document.officePreview?.sourceFormat === 'xlsx') {
        if (document.spreadsheetConflictPreview) return false
        let coordinated: CoordinatedSpreadsheetSave | null = null
        try {
          coordinated = await prepareWriteSpreadsheetEditorSave(path)
        } catch (error) {
          set((state) => {
            const documentsByPath = updateDocument(state.documentsByPath, path, (current) => ({
              ...current,
              saveStatus: 'error',
              fileError: error instanceof Error ? error.message : String(error)
            }))
            return withProjection(documentsByPath, state.editorLayout)
          })
          return false
        }
        const latestDocument = get().documentsByPath[key]
        if (!latestDocument || latestDocument.kind !== 'office') {
          if (coordinated) finishWriteSpreadsheetEditorSave(path, coordinated.registrationId)
          return true
        }
        if (latestDocument.spreadsheetConflictPreview) {
          if (coordinated) finishWriteSpreadsheetEditorSave(path, coordinated.registrationId)
          return false
        }
        const mutations = coordinated?.prepared.mutations ?? latestDocument.spreadsheetMutations
        const unsupportedReason = coordinated?.prepared.unsupportedReason ?? latestDocument.spreadsheetUnsupportedReason
        if (unsupportedReason) {
          if (coordinated) finishWriteSpreadsheetEditorSave(path, coordinated.registrationId)
          set((state) => {
            const documentsByPath = updateDocument(state.documentsByPath, path, (current) => ({
              ...current, saveStatus: 'error', fileError: unsupportedReason
            }))
            return withProjection(documentsByPath, state.editorLayout)
          })
          return false
        }
        if (mutations.length === 0) {
          if (coordinated) finishWriteSpreadsheetEditorSave(path, coordinated.registrationId)
          set((state) => {
            const documentsByPath = updateDocument(state.documentsByPath, path, (current) => ({
              ...current,
              spreadsheetMutations: [],
              spreadsheetMutationBaseFingerprints: {},
              saveStatus: 'saved',
              fileError: null
            }))
            return withProjection(documentsByPath, state.editorLayout)
          })
          return true
        }
        const revision = latestDocument.contentRevision
        const expectedSha256 = latestDocument.spreadsheetSourceSha256 || latestDocument.officePreview?.sourceSha256 || ''
        set((state) => {
          const documentsByPath = updateDocument(state.documentsByPath, path, (current) => (
            current.contentRevision === revision
              ? { ...current, spreadsheetMutations: mutations, saveStatus: 'saving', fileError: null }
              : current
          ))
          return withProjection(documentsByPath, state.editorLayout)
        })
        let result: Awaited<ReturnType<typeof window.kunGui.saveWorkspaceSpreadsheet>>
        try {
          result = await window.kunGui.saveWorkspaceSpreadsheet({
            path: document.path,
            workspaceRoot,
            expectedSha256,
            mutations
          })
        } catch (error) {
          result = {
            ok: false,
            code: 'mutation_failed',
            message: error instanceof Error ? error.message : String(error)
          }
        }
        if (!result.ok) {
          if (coordinated) finishWriteSpreadsheetEditorSave(path, coordinated.registrationId)
          set((state) => {
            const documentsByPath = updateDocument(state.documentsByPath, path, (current) => ({
              ...current,
              saveStatus: 'error',
              fileError: result.message,
              ...(result.code === 'source_changed' && current.officePreview?.sourceSha256 !== expectedSha256
                ? { spreadsheetConflictPreview: current.officePreview }
                : {})
            }))
            return withProjection(documentsByPath, state.editorLayout)
          })
          return false
        }
        const remaining = coordinated
          ? commitWriteSpreadsheetEditorSave(
              path,
              coordinated.registrationId,
              coordinated.prepared.token,
              result.sourceSha256
            )
          : null
        if (coordinated) finishWriteSpreadsheetEditorSave(path, coordinated.registrationId)
        set((state) => {
          const documentsByPath = updateDocument(state.documentsByPath, path, (current) => ({
            ...current,
            spreadsheetSourceSha256: result.sourceSha256,
            spreadsheetMutations: remaining?.mutations ?? (
              current.contentRevision === revision ? [] : current.spreadsheetMutations
            ),
            spreadsheetMutationBaseFingerprints: remaining?.baseFingerprints ?? (
              current.contentRevision === revision ? {} : current.spreadsheetMutationBaseFingerprints
            ),
            spreadsheetUnsupportedReason: remaining?.unsupportedReason ?? null,
            spreadsheetCommitRevision: coordinated
              ? current.spreadsheetCommitRevision
              : current.spreadsheetCommitRevision + 1,
            saveStatus: (remaining?.mutations.length ?? 0) > 0 || current.contentRevision !== revision
              ? 'dirty'
              : 'saved',
            fileSize: result.size,
            fileError: null
          }))
          return withProjection(documentsByPath, state.editorLayout)
        })
        return true
      }
      if (document.kind !== 'text') return true
      if (document.fileTruncated) return false
      const resolveConflict = options.resolveExternalConflict === 'keep-local'
      if (document.reviewActive && !document.pendingAgentReview) return false
      if (document.pendingAgentReview && !resolveConflict) return false
      await flushWriteWorkspaceSaveQueue(workspaceRoot, document.path)
      const latest = get().documentsByPath[key]
      if (!latest) return true
      if (latest.fileContent === latest.persistedContent) {
        set((state) => {
          const documentsByPath = updateDocument(state.documentsByPath, path, (current) => ({
            ...current,
            saveStatus: 'saved',
            ...(resolveConflict ? { pendingAgentReview: null, reviewActive: false, fileError: null } : {})
          }))
          return withProjection(documentsByPath, state.editorLayout)
        })
        return true
      }
      const content = latest.fileContent
      const revision = latest.contentRevision
      set((state) => {
        const documentsByPath = updateDocument(state.documentsByPath, path, (current) =>
          current.contentRevision === revision ? { ...current, saveStatus: 'saving' } : current
        )
        return withProjection(documentsByPath, state.editorLayout)
      })
      let result: Awaited<ReturnType<typeof window.kunGui.writeWorkspaceFile>>
      try {
        result = await enqueueWriteWorkspaceSave({ path: latest.path, workspaceRoot, content })
      } catch (error) {
        set((state) => {
          const documentsByPath = updateDocument(state.documentsByPath, path, (current) => ({
            ...current,
            saveStatus: 'error',
            fileError: error instanceof Error ? error.message : String(error)
          }))
          return withProjection(documentsByPath, state.editorLayout)
        })
        return false
      }
      if (!result.ok) {
        set((state) => {
          const documentsByPath = updateDocument(state.documentsByPath, path, (current) => ({
            ...current,
            saveStatus: 'error',
            fileError: result.message
          }))
          return withProjection(documentsByPath, state.editorLayout)
        })
        return false
      }
      set((state) => {
        const documentsByPath = updateDocument(state.documentsByPath, path, (current) => ({
          ...current,
          persistedContent: content,
          saveStatus: current.fileContent === content ? 'saved' : 'dirty',
          fileError: null,
          ...(resolveConflict ? { pendingAgentReview: null, reviewActive: false } : {})
        }))
        return withProjection(documentsByPath, state.editorLayout)
      })
      const afterSave = get().documentsByPath[key]
      if (!afterSave || afterSave.fileContent === afterSave.persistedContent) return true
    }
  }

  return {
    activateTab: (groupId, path) => {
      const rawState = get()
      const state = { ...rawState, documentsByPath: captureFocusedDocument(rawState) }
      const key = requestedItemKey(path)
      const group = state.editorLayout.groups.find((candidate) => candidate.id === groupId)
      if (!group?.tabs.some((tab) => writeEditorItemKey(tab) === key)) return
      const editorLayout = {
        ...state.editorLayout,
        focusedGroupId: groupId,
        groups: state.editorLayout.groups.map((candidate) =>
          candidate.id === groupId ? { ...candidate, activePath: key } : candidate
        )
      }
      persist(state.workspaceRoot, editorLayout)
      set(withProjection(clearWriteOfficeSelections(state.documentsByPath), editorLayout))
    },

    closeTab: async (groupId, path, force = false) => {
      const rawSnapshot = get()
      const snapshot = { ...rawSnapshot, documentsByPath: captureFocusedDocument(rawSnapshot) }
      const filePath = writeWhiteboardIdFromTabKey(path) ? null : path
      const document = filePath ? snapshot.documentsByPath[writeDocumentKey(filePath)] : undefined
      const lastReference = documentReferenceCount(snapshot, path) <= 1
      const needsDecision = lastReference && document && (
        document.saveStatus === 'dirty' || document.saveStatus === 'error' || document.reviewActive
      )
      if (needsDecision && !force) {
        const savable = document.kind === 'text' || (
          document.kind === 'office' && document.officePreview?.sourceFormat === 'xlsx'
        )
        if (snapshot.autoSaveEnabled && savable) {
          const saved = await saveDocument(snapshot.workspaceRoot, filePath ?? path, { resolveExternalConflict: 'keep-local' })
          if (!saved) return false
        } else {
          const saveBeforeClosing = savable && window.confirm(
            i18n.t('common:writeSaveUnsavedTabConfirm')
          )
          if (saveBeforeClosing) {
            const saved = await saveDocument(snapshot.workspaceRoot, filePath ?? path, { resolveExternalConflict: 'keep-local' })
            if (!saved) return false
          } else if (!window.confirm(i18n.t('common:writeCloseUnsavedTabConfirm'))) {
            return false
          }
        }
      }
      const rawState = get()
      const state = { ...rawState, documentsByPath: captureFocusedDocument(rawState) }
      const next = removeTabFromGroup(state, groupId, path)
      persist(state.workspaceRoot, next.editorLayout)
      set(withProjection(clearWriteOfficeSelections(next.documentsByPath), next.editorLayout))
      return true
    },

    moveTab: (path, fromGroupId, toGroupId, index) => {
      const rawState = get()
      const state = { ...rawState, documentsByPath: captureFocusedDocument(rawState) }
      if (fromGroupId === toGroupId) {
        const key = requestedItemKey(path)
        const groups = state.editorLayout.groups.map((group) => {
          if (group.id !== fromGroupId) return group
          const tab = group.tabs.find((candidate) => writeEditorItemKey(candidate) === key)
          if (!tab) return group
          const tabs = group.tabs.filter((candidate) => writeEditorItemKey(candidate) !== key)
          tabs.splice(Math.min(Math.max(index ?? tabs.length, 0), tabs.length), 0, tab)
          return { ...group, tabs }
        })
        const editorLayout = { ...state.editorLayout, groups }
        persist(state.workspaceRoot, editorLayout)
        set({ editorLayout })
        return
      }
      const from = state.editorLayout.groups.find((group) => group.id === fromGroupId)
      const key = requestedItemKey(path)
      const tab = from?.tabs.find((candidate) => writeEditorItemKey(candidate) === key)
      if (!tab) return
      let editorLayout = addEditorItemToGroup(state.editorLayout, toGroupId, tab, index)
      editorLayout = {
        ...editorLayout,
        groups: editorLayout.groups.map((group) => group.id === fromGroupId
          ? {
              ...group,
              tabs: group.tabs.filter((candidate) => writeEditorItemKey(candidate) !== key),
              activePath: requestedItemKey(group.activePath ?? '') === key
                ? (() => {
                    const fallback = group.tabs.find((candidate) => writeEditorItemKey(candidate) !== key)
                    return fallback ? writeEditorItemKey(fallback) : null
                  })()
                : group.activePath
            }
          : group)
      }
      persist(state.workspaceRoot, editorLayout)
      set(withProjection(clearWriteOfficeSelections(state.documentsByPath), editorLayout))
    },

    focusEditorGroup: (groupId) => {
      const rawState = get()
      const state = { ...rawState, documentsByPath: captureFocusedDocument(rawState) }
      if (!state.editorLayout.groups.some((group) => group.id === groupId)) return
      const editorLayout = { ...state.editorLayout, focusedGroupId: groupId }
      persist(state.workspaceRoot, editorLayout)
      set(withProjection(clearWriteOfficeSelections(state.documentsByPath), editorLayout))
    },

    splitEditorGroup: (orientation, requestedPath) => {
      const rawState = get()
      const state = { ...rawState, documentsByPath: captureFocusedDocument(rawState) }
      if (state.editorLayout.groups.length === 2) {
        const editorLayout = { ...state.editorLayout, orientation }
        persist(state.workspaceRoot, editorLayout)
        set({ editorLayout })
        return
      }
      const source = focusedWriteGroup(state.editorLayout)
      const key = requestedPath ? requestedItemKey(requestedPath) : source.activePath
      const sourceItem = writeEditorItemForKey(source, key)
      const secondaryItem: WriteEditorItem | null = sourceItem
        ? isWriteFileTab(sourceItem) ? { ...sourceItem, viewMode: 'preview' } : sourceItem
        : key && !writeWhiteboardIdFromTabKey(key) ? { path: key, viewMode: 'preview' } : null
      const secondaryTabs = secondaryItem ? [secondaryItem] : []
      const editorLayout = {
        ...state.editorLayout,
        orientation,
        focusedGroupId: 'secondary' as const,
        groups: [source, {
          id: 'secondary' as const,
          tabs: secondaryTabs,
          activePath: secondaryItem ? writeEditorItemKey(secondaryItem) : null
        }]
      }
      persist(state.workspaceRoot, editorLayout)
      set(withProjection(clearWriteOfficeSelections(state.documentsByPath), editorLayout))
    },

    closeEditorGroup: (groupId) => {
      const rawState = get()
      const state = { ...rawState, documentsByPath: captureFocusedDocument(rawState) }
      if (state.editorLayout.groups.length < 2) return
      const closing = state.editorLayout.groups.find((group) => group.id === groupId)
      const survivor = state.editorLayout.groups.find((group) => group.id !== groupId)
      if (!closing || !survivor) return
      const tabs = [...survivor.tabs]
      for (const tab of closing.tabs) {
        if (!tabs.some((candidate) => writeEditorItemKey(candidate) === writeEditorItemKey(tab))) tabs.push(tab)
      }
      const primary = {
        ...survivor,
        id: 'primary' as const,
        tabs,
        activePath: survivor.activePath ?? (tabs[0] ? writeEditorItemKey(tabs[0]) : null)
      }
      const editorLayout = {
        ...state.editorLayout,
        orientation: 'single' as const,
        focusedGroupId: 'primary' as const,
        groups: [primary]
      }
      persist(state.workspaceRoot, editorLayout)
      set(withProjection(clearWriteOfficeSelections(state.documentsByPath), editorLayout))
    },

    setTabViewMode: (groupId, path, mode) => {
      const rawState = get()
      const state = { ...rawState, documentsByPath: captureFocusedDocument(rawState) }
      const editorLayout = {
        ...state.editorLayout,
        groups: state.editorLayout.groups.map((group) => group.id === groupId
          ? {
              ...group,
              tabs: group.tabs.map((tab) => isWriteFileTab(tab) && pathsEqual(tab.path, path)
                ? { ...tab, viewMode: mode }
                : tab)
            }
          : group)
      }
      persist(state.workspaceRoot, editorLayout)
      set(withProjection(state.documentsByPath, editorLayout))
    },

    setSplitOrientation: (orientation) => {
      const state = get()
      if (state.editorLayout.groups.length < 2) return
      const editorLayout = { ...state.editorLayout, orientation }
      persist(state.workspaceRoot, editorLayout)
      set({ editorLayout })
    },

    setSplitRatio: (ratio) => {
      const state = get()
      if (state.editorLayout.groups.length < 2) return
      const editorLayout = { ...state.editorLayout, ratio: Math.min(0.75, Math.max(0.25, ratio)) }
      persist(state.workspaceRoot, editorLayout)
      set({ editorLayout })
    },

    setDocumentContent: (path, content) => {
      set((state) => {
        const documentsByPath = updateDocument(state.documentsByPath, path, (document) => {
          if (document.kind !== 'text' || document.fileContent === content) return document
          return {
            ...document,
            fileContent: content,
            contentRevision: document.contentRevision + 1,
            saveStatus: content === document.persistedContent ? 'saved' : 'dirty'
          }
        })
        return withProjection(documentsByPath, state.editorLayout)
      })
    },

    setSpreadsheetMutations: (path, mutations, unsupportedReason = null, baseFingerprints = {}) => {
      set((state) => {
        const documentsByPath = updateDocument(state.documentsByPath, path, (document) => {
          if (document.kind !== 'office' || document.officePreview?.sourceFormat !== 'xlsx') return document
          const sameMutations = JSON.stringify(document.spreadsheetMutations) === JSON.stringify(mutations)
          const sameReason = document.spreadsheetUnsupportedReason === unsupportedReason
          const sameFingerprints = JSON.stringify(document.spreadsheetMutationBaseFingerprints) === JSON.stringify(baseFingerprints)
          if (sameMutations && sameReason && sameFingerprints) return document
          return {
            ...document,
            spreadsheetMutations: mutations,
            spreadsheetMutationBaseFingerprints: baseFingerprints,
            spreadsheetUnsupportedReason: unsupportedReason,
            contentRevision: document.contentRevision + 1,
            saveStatus: unsupportedReason ? 'error' : mutations.length ? 'dirty' : 'saved',
            fileError: unsupportedReason
          }
        })
        return withProjection(documentsByPath, state.editorLayout)
      })
    },

    saveDocument,

    saveAllDocuments: async (workspaceRoot) => {
      const paths = Object.values(get().documentsByPath)
        .filter((document) => (
          document.kind === 'text' ||
          (document.kind === 'office' && document.officePreview?.sourceFormat === 'xlsx')
        ) && document.saveStatus !== 'saved')
        .map((document) => document.path)
      const results = await Promise.all(paths.map((path) => saveDocument(workspaceRoot, path)))
      return results.every(Boolean)
    }
  }
}

export function focusedPreviewMode(state: WriteWorkspaceState): WritePreviewMode {
  const group = focusedWriteGroup(state.editorLayout)
  return group.activePath
    ? tabViewMode(state.editorLayout, group.id, group.activePath)
    : state.previewMode
}

export function pathsUnderRenamedEntry(path: string, previousPath: string, nextPath: string): string {
  const normalizedPath = normalizePath(path)
  const previous = normalizePath(previousPath)
  if (normalizedPath === previous) return normalizePath(nextPath)
  return normalizedPath.startsWith(`${previous}/`)
    ? `${normalizePath(nextPath)}/${normalizedPath.slice(previous.length + 1)}`
    : normalizedPath
}

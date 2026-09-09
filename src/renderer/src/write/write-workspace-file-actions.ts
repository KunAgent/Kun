import i18n from '../i18n'
import {
  isWriteCodeFilePath,
  isWriteImageFilePath,
  isWriteOfficeFilePath,
  isWritePdfFilePath,
  isWriteWorkspaceFilePath
} from '@shared/write-text-file'
import { writePathToFileUrl } from '@shared/write-markdown-resource'
import type { WriteWorkspaceGet, WriteWorkspaceSet, WriteWorkspaceState } from './write-workspace-store-types'
import type { WriteEditorGroupId } from './write-workspace-store-types'
import { nextWriteDocumentEpoch } from './write-document-context'
import {
  emptySelection,
  filterWriteEntries,
  formatWriteImageLoadError,
  imageMimeTypeFromPath,
  initialState,
  isMissingImageIpc,
  normalizePath,
  pathsEqual,
  readRememberedActiveFile,
  rememberActiveFile,
  writeDirnameFromPath
} from './write-workspace-store-helpers'
import {
  forgetWriteFileThreads,
  moveWriteFileThreads,
  saveWriteThreadRegistry
} from './write-thread-registry'
import { invalidateWikilinkTargets } from './wikilink/wikilink-target-service'
import {
  createWriteDocumentSession,
  isWriteFileTab,
  isWriteWhiteboardTab,
  persistWriteEditorLayout,
  projectFocusedDocument,
  readWriteEditorLayout,
  writeDocumentKey,
  writeEditorItemKey,
  writeWhiteboardIdFromTabKey
} from './write-editor-layout'
import { pathsUnderRenamedEntry } from './write-editor-group-actions'
import {
  finishRestoredWriteLayout,
  formatWriteFileActionError,
  openWriteDocumentState,
  prepareActiveWriteFileForNavigation,
  removeFailedRestoredWriteTab
} from './write-workspace-file-action-helpers'
import {
  ensureMarkdownRenameExtension,
  projectRenamedDocumentKind,
  renamedWritingDocumentKind,
  withoutLoadingDirs
} from './write-workspace-path-kinds'

type WriteFileActions = Pick<
  WriteWorkspaceState,
  | 'initializeWorkspace'
  | 'loadDirectory'
  | 'toggleDirectory'
  | 'refreshWorkspace'
  | 'openFile'
  | 'createFile'
  | 'createDirectory'
  | 'renameEntry'
  | 'deleteEntry'
>

type WriteFileActionContext = {
  set: WriteWorkspaceSet
  get: WriteWorkspaceGet
  cancelExternalSyncAnimation: () => void
}

export function createWriteFileActions({
  set,
  get,
  cancelExternalSyncAnimation
}: WriteFileActionContext): WriteFileActions {
  let navigationGeneration = 0
  const directoryRequestGenerations = new Map<string, number>()
  const fileRequestGenerations = new Map<WriteEditorGroupId, number>()
  const nextNavigationGeneration = (): number => {
    navigationGeneration += 1
    return navigationGeneration
  }
  const navigationIsCurrent = (generation: number, workspaceRoot?: string): boolean => {
    if (generation !== navigationGeneration) return false
    if (!workspaceRoot) return true
    const activeRoot = normalizePath(get().workspaceRoot)
    return !activeRoot || activeRoot === normalizePath(workspaceRoot)
  }
  const workspaceIsCurrent = (workspaceRoot: string): boolean => {
    const activeRoot = normalizePath(get().workspaceRoot)
    return !activeRoot || activeRoot === normalizePath(workspaceRoot)
  }
  const nextFileRequestGeneration = (groupId: WriteEditorGroupId): number => {
    const generation = (fileRequestGenerations.get(groupId) ?? 0) + 1
    fileRequestGenerations.set(groupId, generation)
    return generation
  }
  const fileRequestIsCurrent = (
    groupId: WriteEditorGroupId,
    generation: number,
    workspaceRoot: string
  ): boolean => fileRequestGenerations.get(groupId) === generation && workspaceIsCurrent(workspaceRoot)

  return {
    initializeWorkspace: async (workspaceRoot) => {
      const generation = nextNavigationGeneration()
      const normalized = normalizePath(workspaceRoot.trim())
      if (!normalized) {
        cancelExternalSyncAnimation()
        set((state) => ({
          ...initialState(),
          documentEpoch: nextWriteDocumentEpoch(state.documentEpoch)
        }))
        return
      }
      const current = get()
      if (current.workspaceRoot === normalized && current.rootDirectory) {
        await get().refreshWorkspace(normalized)
        return
      }
      if (current.workspaceRoot && current.workspaceRoot !== normalized) {
        const canLeaveCurrentFile = await prepareActiveWriteFileForNavigation(get, current.workspaceRoot)
        if (!canLeaveCurrentFile || generation !== navigationGeneration) return
      }

      cancelExternalSyncAnimation()
      set((state) => ({
        ...initialState(),
        workspaceRoot: normalized,
        documentEpoch: nextWriteDocumentEpoch(state.documentEpoch)
      }))
      const root = await get().loadDirectory(normalized)
      if (!root || !navigationIsCurrent(generation, normalized)) return
      set((state) => ({ rootDirectory: root, expandedDirs: new Set([...state.expandedDirs, root]) }))
      await get().loadWhiteboards(normalized)
      if (!navigationIsCurrent(generation, normalized)) return
      const restoredLayout = readWriteEditorLayout(normalized)
      if (restoredLayout) {
        set({ editorLayout: restoredLayout })
        let validatedLayout = restoredLayout
        const unavailableGroups = new Set<WriteEditorGroupId>()
        for (const group of restoredLayout.groups) {
          const candidates = [
            ...group.tabs.filter((tab) => writeEditorItemKey(tab) === group.activePath),
            ...group.tabs.filter((tab) => writeEditorItemKey(tab) !== group.activePath)
          ]
          if (candidates.length === 0) continue
          let openedKey: string | null = null
          for (const tab of candidates) {
            const itemKey = writeEditorItemKey(tab)
            if (isWriteWhiteboardTab(tab)) {
              if (get().whiteboards[tab.boardId]) {
                openedKey = itemKey
                break
              }
              validatedLayout = removeFailedRestoredWriteTab(validatedLayout, group.id, itemKey)
              continue
            }
            await get().openFile(normalized, tab.path, { groupId: group.id, viewMode: tab.viewMode })
            if (!navigationIsCurrent(generation, normalized)) return
            if (get().documentsByPath[writeDocumentKey(tab.path)]) {
              openedKey = itemKey
              break
            }
            validatedLayout = removeFailedRestoredWriteTab(validatedLayout, group.id, itemKey)
          }
          if (openedKey) {
            validatedLayout = {
              ...validatedLayout,
              groups: validatedLayout.groups.map((candidate) => candidate.id === group.id
                ? { ...candidate, activePath: openedKey }
                : candidate)
            }
          } else {
            unavailableGroups.add(group.id)
          }
        }
        validatedLayout = finishRestoredWriteLayout(validatedLayout, unavailableGroups)
        const documentsByPath = get().documentsByPath
        persistWriteEditorLayout(normalized, validatedLayout)
        set({ editorLayout: validatedLayout, ...projectFocusedDocument(validatedLayout, documentsByPath) })
        return
      }
      const remembered = readRememberedActiveFile(normalized)
      if (remembered.trim() && isWriteWorkspaceFilePath(remembered)) {
        await get().openFile(normalized, remembered, { groupId: 'primary' })
      } else if (remembered.trim()) {
        rememberActiveFile(normalized, null)
      }
    },

    loadDirectory: async (workspaceRoot, path) => {
      const requestedWorkspace = normalizePath(workspaceRoot)
      const requestedRoot = normalizePath(path || workspaceRoot)
      const targetKey = path ? requestedRoot : '__root__'
      const requestKey = `${requestedWorkspace}\0${requestedRoot}`
      const requestGeneration = (directoryRequestGenerations.get(requestKey) ?? 0) + 1
      directoryRequestGenerations.set(requestKey, requestGeneration)
      const requestIsCurrent = (): boolean =>
        directoryRequestGenerations.get(requestKey) === requestGeneration && workspaceIsCurrent(workspaceRoot)
      set((state) => ({ loadingDirs: { ...state.loadingDirs, [targetKey]: true } }))
      let result: Awaited<ReturnType<typeof window.kunGui.listWorkspaceDirectory>>
      try {
        result = await window.kunGui.listWorkspaceDirectory({ workspaceRoot, path })
      } catch (error) {
        if (!requestIsCurrent()) return null
        set((state) => ({
          loadingDirs: withoutLoadingDirs(state.loadingDirs, [targetKey, requestedRoot]),
          treeError: formatWriteFileActionError(error)
        }))
        return null
      }
      if (!requestIsCurrent()) return null
      set((state) => {
        const loadingDirs = withoutLoadingDirs(state.loadingDirs, [
          targetKey,
          requestedRoot,
          result.ok ? result.root : undefined
        ])
        return { loadingDirs }
      })
      if (!result.ok) {
        set({ treeError: result.message })
        return null
      }
      const visibleEntries = filterWriteEntries(result.entries)
      set((state) => {
        const entriesByDir = { ...state.entriesByDir, [result.root]: visibleEntries }
        if (requestedRoot && requestedRoot !== result.root) {
          entriesByDir[requestedRoot] = visibleEntries
        }
        const expandedDirs = new Set(state.expandedDirs)
        if (!path) expandedDirs.add(result.root)
        return {
          treeError: null,
          rootDirectory: !path && !state.rootDirectory ? result.root : state.rootDirectory,
          expandedDirs,
          entriesByDir
        }
      })
      return result.root
    },

    toggleDirectory: async (workspaceRoot, path) => {
      const expanded = get().expandedDirs.has(path)
      if (!expanded && !get().entriesByDir[path]) {
        await get().loadDirectory(workspaceRoot, path)
      }
      set((state) => {
        const expandedDirs = new Set(state.expandedDirs)
        if (expandedDirs.has(path)) {
          expandedDirs.delete(path)
        } else {
          expandedDirs.add(path)
        }
        return { expandedDirs }
      })
    },

    refreshWorkspace: async (workspaceRoot) => {
      const state = get()
      const root = state.rootDirectory || await get().loadDirectory(workspaceRoot)
      if (!root) return
      if (!state.rootDirectory) {
        set((latest) => ({ rootDirectory: root, expandedDirs: new Set([...latest.expandedDirs, root]) }))
      }
      const latest = get()
      const targets = new Set([root, ...latest.expandedDirs])
      await Promise.all([...targets].map((dirPath) => get().loadDirectory(workspaceRoot, dirPath)))
    },

    openFile: async (workspaceRoot, path, options = {}) => {
      const groupId = options.groupId ?? get().editorLayout.focusedGroupId
      const generation = nextFileRequestGeneration(groupId)
      cancelExternalSyncAnimation()
      if (!isWriteWorkspaceFilePath(path)) {
        set({
          fileLoading: false,
          fileError: i18n.t('common:writeUnsupportedFileType')
        })
        return
      }
      if (!fileRequestIsCurrent(groupId, generation, workspaceRoot)) return
      const viewMode = options.viewMode ?? 'rich'
      const current = get()
      if (
        current.autoSaveEnabled &&
        current.activeFilePath &&
        current.activeFileKind === 'text' &&
        !pathsEqual(current.activeFilePath, path) &&
        current.saveStatus !== 'saved'
      ) {
        void current.saveDocument(workspaceRoot, current.activeFilePath)
      }
      const existing = get().documentsByPath[writeDocumentKey(path)]
      if (existing) {
        rememberActiveFile(workspaceRoot, existing.path)
        set((state) => openWriteDocumentState(state, existing, groupId, viewMode))
        return
      }
      set({ fileLoading: true, fileError: null })
      try {
        if (isWriteImageFilePath(path)) {
          const result = await window.kunGui.readWorkspaceImage({ path, workspaceRoot })
          if (!fileRequestIsCurrent(groupId, generation, workspaceRoot)) return
          if (!result.ok) {
            set({ fileLoading: false, fileError: result.message })
            return
          }
          rememberActiveFile(workspaceRoot, result.path)
          set((state) => openWriteDocumentState(state, createWriteDocumentSession({
            path: result.path,
            kind: 'image',
            imageDataUrl: result.dataUrl,
            imageMimeType: result.mimeType,
            fileSize: result.size,
            documentEpoch: nextWriteDocumentEpoch(state.documentEpoch)
          }), groupId, viewMode))
          return
        }

        if (isWritePdfFilePath(path)) {
          const result = await window.kunGui.readWorkspacePdf({ path, workspaceRoot })
          if (!fileRequestIsCurrent(groupId, generation, workspaceRoot)) return
          if (!result.ok) {
            set({ fileLoading: false, fileError: result.message })
            return
          }
          rememberActiveFile(workspaceRoot, result.path)
          set((state) => openWriteDocumentState(state, createWriteDocumentSession({
            path: result.path,
            kind: 'pdf',
            pdfDataBase64: result.dataBase64,
            pdfMimeType: result.mimeType,
            pdfMtimeMs: result.mtimeMs,
            fileSize: result.size,
            documentEpoch: nextWriteDocumentEpoch(state.documentEpoch)
          }), groupId, viewMode))
          return
        }

        if (isWriteOfficeFilePath(path)) {
          const result = await window.kunGui.readWorkspaceOfficePreview({ path, workspaceRoot })
          if (!fileRequestIsCurrent(groupId, generation, workspaceRoot)) return
          if (!result.ok) {
            rememberActiveFile(workspaceRoot, path)
            set((state) => openWriteDocumentState(state, createWriteDocumentSession({
              path,
              kind: 'office',
              officeRefreshError: result.message,
              fileError: result.message,
              documentEpoch: nextWriteDocumentEpoch(state.documentEpoch)
            }), groupId, viewMode))
            return
          }
          rememberActiveFile(workspaceRoot, result.path)
          set((state) => openWriteDocumentState(state, createWriteDocumentSession({
            path: result.path,
            kind: 'office',
            officePreview: result,
            fileSize: result.size,
            documentEpoch: nextWriteDocumentEpoch(state.documentEpoch)
          }), groupId, viewMode))
          return
        }

        if (isWriteCodeFilePath(path)) {
          const result = await window.kunGui.readWorkspaceFile({ path, workspaceRoot })
          if (!fileRequestIsCurrent(groupId, generation, workspaceRoot)) return
          if (!result.ok) {
            set({ fileLoading: false, fileError: result.message })
            return
          }
          rememberActiveFile(workspaceRoot, result.path)
        set((state) => openWriteDocumentState(state, createWriteDocumentSession({
            path: result.path,
            kind: 'code',
            fileContent: result.content,
            persistedContent: result.content,
            fileSize: result.size,
            fileTruncated: result.truncated,
            documentEpoch: nextWriteDocumentEpoch(state.documentEpoch)
          }), groupId, 'source'))
          return
        }

        const result = await window.kunGui.readWorkspaceFile({ path, workspaceRoot })
        if (!fileRequestIsCurrent(groupId, generation, workspaceRoot)) return
        if (!result.ok) {
          set({ fileLoading: false, fileError: result.message })
          return
        }
        rememberActiveFile(workspaceRoot, result.path)
        set((state) => openWriteDocumentState(state, createWriteDocumentSession({
          path: result.path,
          kind: 'text',
          fileContent: result.content,
          persistedContent: result.content,
          fileSize: result.size,
          fileTruncated: result.truncated,
          documentEpoch: nextWriteDocumentEpoch(state.documentEpoch)
        }), groupId, viewMode))
      } catch (error) {
        if (!fileRequestIsCurrent(groupId, generation, workspaceRoot)) return
        if (isWriteImageFilePath(path) && isMissingImageIpc(error)) {
          rememberActiveFile(workspaceRoot, path)
          set((state) => openWriteDocumentState(state, createWriteDocumentSession({
            path,
            kind: 'image',
            imageDataUrl: writePathToFileUrl(path),
            imageMimeType: imageMimeTypeFromPath(path),
            documentEpoch: nextWriteDocumentEpoch(state.documentEpoch)
          }), groupId, viewMode))
          return
        }
        set({
          fileLoading: false,
          fileError: isWriteImageFilePath(path)
            ? formatWriteImageLoadError(error)
            : error instanceof Error ? error.message : String(error)
        })
      }
    },

    createFile: async (workspaceRoot, path, content = '') => {
      let result: Awaited<ReturnType<typeof window.kunGui.createWorkspaceFile>>
      try {
        result = await window.kunGui.createWorkspaceFile({ workspaceRoot, path, content })
      } catch (error) {
        if (workspaceIsCurrent(workspaceRoot)) set({ fileError: formatWriteFileActionError(error) })
        return null
      }
      if (!workspaceIsCurrent(workspaceRoot)) return null
      if (!result.ok) {
        set({ fileError: result.message })
        return null
      }
      invalidateWikilinkTargets()
      await get().refreshWorkspace(workspaceRoot)
      await get().openFile(workspaceRoot, result.path)
      return result.path
    },

    createDirectory: async (workspaceRoot, path) => {
      let result: Awaited<ReturnType<typeof window.kunGui.createWorkspaceDirectory>>
      try {
        result = await window.kunGui.createWorkspaceDirectory({ workspaceRoot, path })
      } catch (error) {
        if (workspaceIsCurrent(workspaceRoot)) set({ fileError: formatWriteFileActionError(error) })
        return null
      }
      if (!workspaceIsCurrent(workspaceRoot)) return null
      if (!result.ok) {
        set({ fileError: result.message })
        return null
      }
      set((state) => {
        const expandedDirs = new Set(state.expandedDirs)
        expandedDirs.add(writeDirnameFromPath(result.path))
        return { expandedDirs }
      })
      await get().refreshWorkspace(workspaceRoot)
      return result.path
    },

    renameEntry: async (workspaceRoot, path, newName) => {
      cancelExternalSyncAnimation()
      const nextName = ensureMarkdownRenameExtension(path, newName.trim())
      const plannedPath = `${writeDirnameFromPath(path)}/${nextName}`
      const renamedDocument = get().documentsByPath[writeDocumentKey(path)]
      const textToCodeRename = renamedDocument?.kind === 'text' && isWriteCodeFilePath(plannedPath)
      if (textToCodeRename && renamedDocument.saveStatus !== 'saved') {
        const saved = await get().saveDocument(workspaceRoot, path)
        if (!saved || !workspaceIsCurrent(workspaceRoot)) return null
      }
      if (textToCodeRename) {
        set((state) => projectRenamedDocumentKind(state, path, 'text', 'code'))
      }
      const renameLocked = textToCodeRename &&
        get().documentsByPath[writeDocumentKey(path)]?.kind === 'code'
      const restoreRenameLock = (): void => {
        if (renameLocked && workspaceIsCurrent(workspaceRoot)) {
          set((state) => projectRenamedDocumentKind(state, path, 'code', 'text'))
        }
      }
      let result: Awaited<ReturnType<typeof window.kunGui.renameWorkspaceEntry>>
      try {
        result = await window.kunGui.renameWorkspaceEntry({ workspaceRoot, path, newName: nextName })
      } catch (error) {
        restoreRenameLock()
        if (workspaceIsCurrent(workspaceRoot)) set({ fileError: formatWriteFileActionError(error) })
        return null
      }
      if (!workspaceIsCurrent(workspaceRoot)) return null
      if (!result.ok) {
        restoreRenameLock()
        set({ fileError: result.message })
        return null
      }
      saveWriteThreadRegistry(moveWriteFileThreads(
        workspaceRoot,
        result.previousPath,
        result.path
      ))
      const previousPrefix = `${normalizePath(result.previousPath)}/`
      set((state) => {
        const expandedDirs = new Set<string>()
        for (const dirPath of state.expandedDirs) {
          if (dirPath === result.previousPath) {
            expandedDirs.add(result.path)
          } else if (dirPath.startsWith(previousPrefix)) {
            expandedDirs.add(`${result.path}/${dirPath.slice(previousPrefix.length)}`)
          } else {
            expandedDirs.add(dirPath)
          }
        }
        const editorLayout = {
          ...state.editorLayout,
          groups: state.editorLayout.groups.map((group) => ({
            ...group,
            activePath: group.activePath && !writeWhiteboardIdFromTabKey(group.activePath)
              ? pathsUnderRenamedEntry(group.activePath, result.previousPath, result.path)
              : group.activePath,
            tabs: group.tabs.map((tab) => isWriteFileTab(tab)
              ? { ...tab, path: pathsUnderRenamedEntry(tab.path, result.previousPath, result.path) }
              : tab)
          }))
        }
        const documentsByPath: WriteWorkspaceState['documentsByPath'] = {}
        for (const document of Object.values(state.documentsByPath)) {
          const nextPath = pathsUnderRenamedEntry(document.path, result.previousPath, result.path)
          const epoch = nextPath === document.path
            ? document.documentEpoch
            : nextWriteDocumentEpoch(document.documentEpoch)
          const kind = renamedWritingDocumentKind(document.kind, nextPath)
          const becameCode = kind === 'code' && (
            document.kind === 'text' || (renameLocked && pathsEqual(document.path, result.previousPath))
          )
          documentsByPath[writeDocumentKey(nextPath)] = {
            ...document,
            path: nextPath,
            kind,
            documentEpoch: epoch,
            saveStatus: becameCode ? 'saved' : document.saveStatus,
            pendingAgentReview: becameCode
              ? null
              : document.pendingAgentReview
              ? { ...document.pendingAgentReview, filePath: nextPath, documentEpoch: epoch }
              : null,
            reviewActive: becameCode ? false : document.reviewActive,
            selection: becameCode ? emptySelection() : document.selection
          }
        }
        persistWriteEditorLayout(workspaceRoot, editorLayout)
        return {
          documentsByPath,
          editorLayout,
          ...projectFocusedDocument(editorLayout, documentsByPath),
          expandedDirs,
          entriesByDir: {},
          fileError: null
        }
      })
      if (get().activeFilePath) {
        rememberActiveFile(workspaceRoot, get().activeFilePath)
      } else {
        rememberActiveFile(workspaceRoot, null)
      }
      invalidateWikilinkTargets()
      await get().refreshWorkspace(workspaceRoot)
      return result.path
    },

    deleteEntry: async (workspaceRoot, path) => {
      cancelExternalSyncAnimation()
      let result: Awaited<ReturnType<typeof window.kunGui.deleteWorkspaceEntry>>
      try {
        result = await window.kunGui.deleteWorkspaceEntry({ workspaceRoot, path })
      } catch (error) {
        if (workspaceIsCurrent(workspaceRoot)) set({ fileError: formatWriteFileActionError(error) })
        return false
      }
      if (!workspaceIsCurrent(workspaceRoot)) return false
      if (!result.ok) {
        set({ fileError: result.message })
        return false
      }
      saveWriteThreadRegistry(forgetWriteFileThreads(workspaceRoot, result.path))
      const deletedPath = normalizePath(result.path)
      set((state) => {
        const expandedDirs = new Set<string>()
        for (const dirPath of state.expandedDirs) {
          const normalizedDir = normalizePath(dirPath)
          if (normalizedDir !== deletedPath && !normalizedDir.startsWith(`${deletedPath}/`)) {
            expandedDirs.add(dirPath)
          }
        }
        const removed = (candidate: string): boolean => {
          const normalized = normalizePath(candidate)
          return normalized === deletedPath || normalized.startsWith(`${deletedPath}/`)
        }
        const groups = state.editorLayout.groups.map((group) => {
          const tabs = group.tabs.filter((tab) => !isWriteFileTab(tab) || !removed(tab.path))
          return {
            ...group,
            tabs,
            activePath: group.activePath && (
              writeWhiteboardIdFromTabKey(group.activePath) || !removed(group.activePath)
            )
              ? group.activePath
              : tabs[0] ? writeEditorItemKey(tabs[0]) : null
          }
        })
        const editorLayout = { ...state.editorLayout, groups }
        const documentsByPath = { ...state.documentsByPath }
        for (const document of Object.values(documentsByPath)) {
          if (removed(document.path)) delete documentsByPath[writeDocumentKey(document.path)]
        }
        persistWriteEditorLayout(workspaceRoot, editorLayout)
        return {
          expandedDirs,
          documentsByPath,
          editorLayout,
          ...projectFocusedDocument(editorLayout, documentsByPath)
        }
      })
      rememberActiveFile(workspaceRoot, get().activeFilePath)
      invalidateWikilinkTargets()
      await get().refreshWorkspace(workspaceRoot)
      return true
    }
  }
}

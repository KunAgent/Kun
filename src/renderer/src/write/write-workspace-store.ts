import { create } from 'zustand'
import {
  DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL,
  DEFAULT_WRITE_INLINE_COMPLETION_DEBOUNCE_MS,
  DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS,
  DEFAULT_WRITE_INLINE_COMPLETION_MIN_ACCEPT_SCORE,
  DEFAULT_WRITE_INLINE_COMPLETION_MODEL,
  DEFAULT_WRITE_INLINE_LONG_COMPLETION_DEBOUNCE_MS,
  DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS,
  DEFAULT_WRITE_INLINE_LONG_COMPLETION_MIN_ACCEPT_SCORE,
  DEFAULT_WRITE_WORKSPACE_ROOT,
  normalizeWriteInlineCompletionModel,
  type WriteInlineCompletionSettingsV1,
  type WriteSettingsV1
} from '@shared/app-settings'
import type { WorkspaceEntry } from '@shared/workspace-file'
import type { WriteEditorSelectionState } from '../components/write/WriteMarkdownEditor'
import type { WriteQuotedSelection } from './quoted-selection'
import { quotedSelectionFromEditor } from './quoted-selection'

export type WritePreviewMode = 'source' | 'live' | 'split' | 'preview'
export type WriteSaveStatus = 'saved' | 'dirty' | 'saving' | 'error'

export type WriteWorkspaceState = {
  defaultWorkspaceRoot: string
  workspaceRoots: string[]
  inlineCompletion: WriteInlineCompletionSettingsV1
  inlineCompletionApiReady: boolean
  settingsLoading: boolean
  settingsError: string | null
  workspaceRoot: string
  rootDirectory: string
  entriesByDir: Record<string, WorkspaceEntry[]>
  expandedDirs: Set<string>
  loadingDirs: Record<string, boolean>
  treeError: string | null
  activeFilePath: string | null
  fileContent: string
  fileError: string | null
  fileLoading: boolean
  saveStatus: WriteSaveStatus
  previewMode: WritePreviewMode
  assistantOpen: boolean
  assistantModel: string
  selection: WriteEditorSelectionState
  quotedSelections: WriteQuotedSelection[]
  loadWriteSettings: () => Promise<void>
  selectWriteWorkspace: (workspaceRoot: string) => Promise<void>
  addWriteWorkspace: (workspaceRoot: string) => Promise<void>
  removeWriteWorkspace: (workspaceRoot: string) => Promise<void>
  initializeWorkspace: (workspaceRoot: string) => Promise<void>
  loadDirectory: (workspaceRoot: string, path?: string) => Promise<string | null>
  toggleDirectory: (workspaceRoot: string, path: string) => Promise<void>
  refreshWorkspace: (workspaceRoot: string) => Promise<void>
  openFile: (workspaceRoot: string, path: string) => Promise<void>
  setFileContent: (content: string) => void
  syncActiveFileFromDisk: (
    workspaceRoot: string,
    options?: { path?: string; content?: string; message?: string; animate?: boolean; force?: boolean }
  ) => Promise<boolean>
  flushSave: (workspaceRoot: string) => Promise<boolean>
  createFile: (workspaceRoot: string, path: string, content?: string) => Promise<string | null>
  createDirectory: (workspaceRoot: string, path: string) => Promise<string | null>
  renameEntry: (workspaceRoot: string, path: string, newName: string) => Promise<string | null>
  deleteEntry: (workspaceRoot: string, path: string) => Promise<boolean>
  setPreviewMode: (mode: WritePreviewMode) => void
  setAssistantOpen: (open: boolean) => void
  setAssistantModel: (model: string) => void
  setSelection: (selection: WriteEditorSelectionState) => void
  quoteCurrentSelection: (workspaceRoot: string) => void
  removeQuotedSelection: (id: string) => void
  clearQuotedSelections: () => void
  resetWorkspace: () => void
}

const WRITE_PREVIEW_MODE_KEY = 'deepseekgui.write.preview-mode'
const WRITE_ASSISTANT_OPEN_KEY = 'deepseekgui.write.assistant-open'
const WRITE_ASSISTANT_MODEL_KEY = 'deepseekgui.write.assistant-model'
const DEFAULT_WRITE_ASSISTANT_MODEL = 'auto'

let lastSavedContent = ''
let externalSyncTimer: number | null = null
let externalSyncAnimationToken = 0

function readStoredPreviewMode(): WritePreviewMode {
  try {
    const raw = window.localStorage.getItem(WRITE_PREVIEW_MODE_KEY)
    return raw === 'source' || raw === 'live' || raw === 'split' || raw === 'preview' ? raw : 'live'
  } catch {
    return 'live'
  }
}

function readStoredAssistantOpen(): boolean {
  try {
    return window.localStorage.getItem(WRITE_ASSISTANT_OPEN_KEY) !== '0'
  } catch {
    return true
  }
}

function readStoredAssistantModel(): string {
  try {
    return window.localStorage.getItem(WRITE_ASSISTANT_MODEL_KEY)?.trim() || DEFAULT_WRITE_ASSISTANT_MODEL
  } catch {
    return DEFAULT_WRITE_ASSISTANT_MODEL
  }
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+$/, '')
}

function pathsEqual(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b)
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length)
  let index = 0
  while (index < max && a.charCodeAt(index) === b.charCodeAt(index)) index += 1
  return index
}

function cancelExternalSyncAnimation(): void {
  externalSyncAnimationToken += 1
  if (externalSyncTimer !== null) {
    window.clearTimeout(externalSyncTimer)
    externalSyncTimer = null
  }
}

function compactWorkspaceRoots(values: string[]): string[] {
  const seen = new Set<string>()
  const roots: string[] = []
  for (const value of values) {
    const normalized = normalizePath(value.trim())
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    roots.push(normalized)
  }
  return roots
}

function normalizeWriteSettings(settings?: Partial<WriteSettingsV1> | null): {
  defaultWorkspaceRoot: string
  activeWorkspaceRoot: string
  workspaces: string[]
  inlineCompletion: WriteInlineCompletionSettingsV1
} {
  const defaultWorkspaceRoot = normalizePath(settings?.defaultWorkspaceRoot || DEFAULT_WRITE_WORKSPACE_ROOT)
  const activeWorkspaceRoot = normalizePath(settings?.activeWorkspaceRoot || defaultWorkspaceRoot)
  const workspaces = compactWorkspaceRoots([
    defaultWorkspaceRoot,
    activeWorkspaceRoot,
    ...(Array.isArray(settings?.workspaces) ? settings.workspaces : [])
  ])
  const rawInlineCompletion = (settings?.inlineCompletion ?? {}) as Partial<WriteInlineCompletionSettingsV1>
  const debounceMs = Number(rawInlineCompletion.debounceMs)
  const longDebounceMs = Number(rawInlineCompletion.longDebounceMs)
  const minAcceptScore = Number(rawInlineCompletion.minAcceptScore)
  const longMinAcceptScore = Number(rawInlineCompletion.longMinAcceptScore)
  const maxTokens = Number(rawInlineCompletion.maxTokens)
  const longMaxTokens = Number(rawInlineCompletion.longMaxTokens)
  return {
    defaultWorkspaceRoot,
    activeWorkspaceRoot: workspaces.includes(activeWorkspaceRoot) ? activeWorkspaceRoot : defaultWorkspaceRoot,
    workspaces: workspaces.length > 0 ? workspaces : [defaultWorkspaceRoot],
    inlineCompletion: {
      enabled: rawInlineCompletion.enabled !== false,
      retrievalEnabled: rawInlineCompletion.retrievalEnabled !== false,
      longCompletionEnabled: rawInlineCompletion.longCompletionEnabled !== false,
      baseUrl: rawInlineCompletion.baseUrl?.trim() || DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL,
      model: normalizeWriteInlineCompletionModel(rawInlineCompletion.model),
      debounceMs: Number.isFinite(debounceMs)
        ? Math.max(150, Math.min(5_000, Math.round(debounceMs)))
        : DEFAULT_WRITE_INLINE_COMPLETION_DEBOUNCE_MS,
      longDebounceMs: Number.isFinite(longDebounceMs)
        ? Math.max(1_000, Math.min(15_000, Math.round(longDebounceMs)))
        : DEFAULT_WRITE_INLINE_LONG_COMPLETION_DEBOUNCE_MS,
      minAcceptScore: Number.isFinite(minAcceptScore)
        ? Math.max(0.1, Math.min(0.95, minAcceptScore))
        : DEFAULT_WRITE_INLINE_COMPLETION_MIN_ACCEPT_SCORE,
      longMinAcceptScore: Number.isFinite(longMinAcceptScore)
        ? Math.max(0.1, Math.min(0.95, longMinAcceptScore))
        : DEFAULT_WRITE_INLINE_LONG_COMPLETION_MIN_ACCEPT_SCORE,
      maxTokens: Number.isFinite(maxTokens)
        ? Math.max(16, Math.min(512, Math.round(maxTokens)))
        : DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS,
      longMaxTokens: Number.isFinite(longMaxTokens)
        ? Math.max(64, Math.min(1_024, Math.round(longMaxTokens)))
        : DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS
    }
  }
}

export function writeBasenameFromPath(value: string): string {
  const normalized = normalizePath(value)
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] || normalized
}

export function writeDirnameFromPath(value: string): string {
  const normalized = normalizePath(value)
  const index = normalized.lastIndexOf('/')
  if (index <= 0) return normalized
  return normalized.slice(0, index)
}

export function writeJoinPath(base: string, next: string): string {
  if (!base) return next
  return `${normalizePath(base)}/${next.replace(/^\/+/, '')}`
}

export function writeRelativeToWorkspace(workspaceRoot: string, filePath: string): string {
  const normalizedRoot = normalizePath(workspaceRoot)
  const normalizedFile = normalizePath(filePath)
  const prefix = `${normalizedRoot}/`
  if (normalizedRoot && normalizedFile.startsWith(prefix)) return normalizedFile.slice(prefix.length)
  return writeBasenameFromPath(filePath)
}

function activeFileStorageKey(workspaceRoot: string): string {
  return `deepseekgui.write.active-file:${normalizePath(workspaceRoot)}`
}

function rememberActiveFile(workspaceRoot: string, nextPath: string | null): void {
  if (!workspaceRoot.trim()) return
  try {
    if (nextPath) {
      window.localStorage.setItem(activeFileStorageKey(workspaceRoot), nextPath)
    } else {
      window.localStorage.removeItem(activeFileStorageKey(workspaceRoot))
    }
  } catch {
    /* ignore local storage failures */
  }
}

function readRememberedActiveFile(workspaceRoot: string): string {
  try {
    return window.localStorage.getItem(activeFileStorageKey(workspaceRoot)) ?? ''
  } catch {
    return ''
  }
}

function emptySelection(): WriteEditorSelectionState {
  return { text: '', ranges: [], charCount: 0 }
}

function initialState(): Pick<
  WriteWorkspaceState,
  | 'workspaceRoot'
  | 'rootDirectory'
  | 'entriesByDir'
  | 'expandedDirs'
  | 'loadingDirs'
  | 'treeError'
  | 'activeFilePath'
  | 'fileContent'
  | 'fileError'
  | 'fileLoading'
  | 'saveStatus'
  | 'selection'
  | 'quotedSelections'
> {
  return {
    workspaceRoot: '',
    rootDirectory: '',
    entriesByDir: {},
    expandedDirs: new Set(),
    loadingDirs: {},
    treeError: null,
    activeFilePath: null,
    fileContent: '',
    fileError: null,
    fileLoading: false,
    saveStatus: 'saved',
    selection: emptySelection(),
    quotedSelections: []
  }
}

export const useWriteWorkspaceStore = create<WriteWorkspaceState>((set, get) => ({
  defaultWorkspaceRoot: '',
  workspaceRoots: [],
  inlineCompletion: {
    enabled: true,
    retrievalEnabled: true,
    longCompletionEnabled: true,
    baseUrl: DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL,
    model: DEFAULT_WRITE_INLINE_COMPLETION_MODEL,
    debounceMs: DEFAULT_WRITE_INLINE_COMPLETION_DEBOUNCE_MS,
    longDebounceMs: DEFAULT_WRITE_INLINE_LONG_COMPLETION_DEBOUNCE_MS,
    minAcceptScore: DEFAULT_WRITE_INLINE_COMPLETION_MIN_ACCEPT_SCORE,
    longMinAcceptScore: DEFAULT_WRITE_INLINE_LONG_COMPLETION_MIN_ACCEPT_SCORE,
    maxTokens: DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS,
    longMaxTokens: DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS
  },
  inlineCompletionApiReady: false,
  settingsLoading: false,
  settingsError: null,
  ...initialState(),
  previewMode: readStoredPreviewMode(),
  assistantOpen: readStoredAssistantOpen(),
  assistantModel: readStoredAssistantModel(),

  loadWriteSettings: async () => {
    if (get().settingsLoading) return
    set({ settingsLoading: true, settingsError: null })
    try {
      const settings = await window.dsGui.getSettings()
      const write = normalizeWriteSettings(settings.write)
      set({
        defaultWorkspaceRoot: write.defaultWorkspaceRoot,
        workspaceRoots: write.workspaces,
        inlineCompletion: write.inlineCompletion,
        inlineCompletionApiReady: Boolean(settings.deepseek?.apiKey?.trim()),
        settingsLoading: false,
        settingsError: null
      })
      await get().initializeWorkspace(write.activeWorkspaceRoot)
    } catch (error) {
      set({
        settingsLoading: false,
        settingsError: error instanceof Error ? error.message : String(error)
      })
    }
  },

  selectWriteWorkspace: async (workspaceRoot) => {
    const normalized = normalizePath(workspaceRoot)
    if (!normalized) return
    const roots = compactWorkspaceRoots([normalized, ...get().workspaceRoots])
    set({ workspaceRoots: roots })
    try {
      const settings = await window.dsGui.setSettings({
        write: {
          activeWorkspaceRoot: normalized,
          workspaces: roots
        }
      })
      const write = normalizeWriteSettings(settings.write)
      set({
        defaultWorkspaceRoot: write.defaultWorkspaceRoot,
        workspaceRoots: write.workspaces,
        inlineCompletion: write.inlineCompletion,
        inlineCompletionApiReady: Boolean(settings.deepseek?.apiKey?.trim()),
        settingsError: null
      })
      await get().initializeWorkspace(write.activeWorkspaceRoot)
    } catch (error) {
      set({ settingsError: error instanceof Error ? error.message : String(error) })
    }
  },

  addWriteWorkspace: async (workspaceRoot) => {
    const normalized = normalizePath(workspaceRoot)
    if (!normalized) return
    const roots = compactWorkspaceRoots([normalized, ...get().workspaceRoots])
    try {
      const settings = await window.dsGui.setSettings({
        write: {
          activeWorkspaceRoot: normalized,
          workspaces: roots
        }
      })
      const write = normalizeWriteSettings(settings.write)
      set({
        defaultWorkspaceRoot: write.defaultWorkspaceRoot,
        workspaceRoots: write.workspaces,
        inlineCompletion: write.inlineCompletion,
        inlineCompletionApiReady: Boolean(settings.deepseek?.apiKey?.trim()),
        settingsError: null
      })
      await get().initializeWorkspace(write.activeWorkspaceRoot)
    } catch (error) {
      set({ settingsError: error instanceof Error ? error.message : String(error) })
    }
  },

  removeWriteWorkspace: async (workspaceRoot) => {
    const normalized = normalizePath(workspaceRoot)
    if (!normalized) return
    const state = get()
    const fallback = state.defaultWorkspaceRoot || state.workspaceRoots.find((item) => item !== normalized) || state.workspaceRoot
    const roots = compactWorkspaceRoots([
      fallback,
      ...state.workspaceRoots.filter((item) => normalizePath(item) !== normalized)
    ])
    const activeWorkspaceRoot = normalizePath(state.workspaceRoot) === normalized
      ? fallback
      : state.workspaceRoot
    try {
      const settings = await window.dsGui.setSettings({
        write: {
          activeWorkspaceRoot,
          workspaces: roots
        }
      })
      const write = normalizeWriteSettings(settings.write)
      set({
        defaultWorkspaceRoot: write.defaultWorkspaceRoot,
        workspaceRoots: write.workspaces,
        inlineCompletion: write.inlineCompletion,
        inlineCompletionApiReady: Boolean(settings.deepseek?.apiKey?.trim()),
        settingsError: null
      })
      if (normalizePath(get().workspaceRoot) === normalized) {
        await get().initializeWorkspace(write.activeWorkspaceRoot)
      }
    } catch (error) {
      set({ settingsError: error instanceof Error ? error.message : String(error) })
    }
  },

  initializeWorkspace: async (workspaceRoot) => {
    const normalized = normalizePath(workspaceRoot.trim())
    if (!normalized) {
      cancelExternalSyncAnimation()
      lastSavedContent = ''
      set(initialState())
      return
    }
    const current = get()
    if (current.workspaceRoot === normalized && current.rootDirectory) return

    lastSavedContent = ''
    cancelExternalSyncAnimation()
    set({ ...initialState(), workspaceRoot: normalized })
    const root = await get().loadDirectory(normalized)
    if (!root) return
    set((state) => ({ rootDirectory: root, expandedDirs: new Set([...state.expandedDirs, root]) }))
    const remembered = readRememberedActiveFile(normalized)
    if (remembered.trim()) {
      await get().openFile(normalized, remembered)
    }
  },

  loadDirectory: async (workspaceRoot, path) => {
    const requestedRoot = normalizePath(path || workspaceRoot)
    const targetKey = path ? requestedRoot : '__root__'
    set((state) => ({ loadingDirs: { ...state.loadingDirs, [targetKey]: true } }))
    const result = await window.dsGui.listWorkspaceDirectory({ workspaceRoot, path })
    set((state) => {
      const loadingDirs = { ...state.loadingDirs }
      delete loadingDirs[targetKey]
      delete loadingDirs[requestedRoot]
      if (result.ok) delete loadingDirs[result.root]
      return { loadingDirs }
    })
    if (!result.ok) {
      set({ treeError: result.message })
      return null
    }
    set((state) => {
      const entriesByDir = { ...state.entriesByDir, [result.root]: result.entries }
      if (requestedRoot && requestedRoot !== result.root) {
        entriesByDir[requestedRoot] = result.entries
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

  openFile: async (workspaceRoot, path) => {
    cancelExternalSyncAnimation()
    const saved = await get().flushSave(workspaceRoot)
    if (!saved) return
    set({ fileLoading: true, fileError: null })
    try {
      const result = await window.dsGui.readWorkspaceFile({ path, workspaceRoot })
      if (!result.ok) {
        set({ fileLoading: false, fileError: result.message })
        return
      }
      lastSavedContent = result.content
      rememberActiveFile(workspaceRoot, result.path)
      set({
        activeFilePath: result.path,
        fileContent: result.content,
        fileLoading: false,
        fileError: null,
        saveStatus: 'saved',
        selection: emptySelection(),
        quotedSelections: []
      })
    } catch (error) {
      set({
        fileLoading: false,
        fileError: error instanceof Error ? error.message : String(error)
      })
    }
  },

  setFileContent: (content) => {
    cancelExternalSyncAnimation()
    set((state) => ({
      fileContent: content,
      saveStatus: state.activeFilePath && content !== lastSavedContent ? 'dirty' : 'saved'
    }))
  },

  syncActiveFileFromDisk: async (workspaceRoot, options = {}) => {
    const snapshot = get()
    const force = options.force === true
    if (!snapshot.activeFilePath) return false
    if (!force && (snapshot.saveStatus === 'dirty' || snapshot.saveStatus === 'saving')) return false
    if (options.path && !pathsEqual(options.path, snapshot.activeFilePath)) return false

    if (options.message) {
      set({ fileError: options.message, saveStatus: 'error' })
      return false
    }

    let content = options.content
    let resolvedPath = options.path ?? snapshot.activeFilePath
    if (typeof content !== 'string') {
      const result = await window.dsGui.readWorkspaceFile({
        path: snapshot.activeFilePath,
        workspaceRoot
      })
      if (!result.ok) {
        if (pathsEqual(get().activeFilePath ?? '', snapshot.activeFilePath)) {
          set({ fileError: result.message, saveStatus: 'error' })
        }
        return false
      }
      content = result.content
      resolvedPath = result.path
    }

    const latest = get()
    if (!latest.activeFilePath || !pathsEqual(latest.activeFilePath, resolvedPath)) return false
    if (!force && (latest.saveStatus === 'dirty' || latest.saveStatus === 'saving')) return false
    if (latest.fileContent === content && lastSavedContent === content) {
      set({ saveStatus: 'saved', fileError: null, fileLoading: false })
      return true
    }

    cancelExternalSyncAnimation()
    lastSavedContent = content

    if (options.animate !== false && content.length > latest.fileContent.length) {
      const token = externalSyncAnimationToken
      const prefix = commonPrefixLength(latest.fileContent, content)
      let cursor = prefix
      set({
        fileContent: content.slice(0, prefix),
        saveStatus: 'saved',
        fileError: null,
        fileLoading: false
      })
      const step = (): void => {
        if (token !== externalSyncAnimationToken) return
        const remaining = content.length - cursor
        const chunk = Math.max(24, Math.ceil(remaining * 0.1))
        cursor = Math.min(content.length, cursor + chunk)
        set({
          fileContent: content.slice(0, cursor),
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
      saveStatus: 'saved',
      fileError: null,
      fileLoading: false
    })
    return true
  },

  flushSave: async (workspaceRoot) => {
    const state = get()
    if (!state.activeFilePath) return true
    if (externalSyncTimer !== null) {
      cancelExternalSyncAnimation()
      set({ fileContent: lastSavedContent, saveStatus: 'saved', fileError: null })
      return true
    }
    cancelExternalSyncAnimation()
    if (state.fileContent === lastSavedContent) {
      set({ saveStatus: 'saved' })
      return true
    }
    set({ saveStatus: 'saving' })
    try {
      const result = await window.dsGui.writeWorkspaceFile({
        path: state.activeFilePath,
        workspaceRoot,
        content: state.fileContent
      })
      if (!result.ok) {
        set({ saveStatus: 'error', fileError: result.message })
        return false
      }
      lastSavedContent = state.fileContent
      set({ saveStatus: 'saved', fileError: null })
      return true
    } catch (error) {
      set({
        saveStatus: 'error',
        fileError: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  },

  createFile: async (workspaceRoot, path, content = '') => {
    const result = await window.dsGui.createWorkspaceFile({ workspaceRoot, path, content })
    if (!result.ok) {
      set({ fileError: result.message })
      return null
    }
    await get().refreshWorkspace(workspaceRoot)
    await get().openFile(workspaceRoot, result.path)
    return result.path
  },

  createDirectory: async (workspaceRoot, path) => {
    const result = await window.dsGui.createWorkspaceDirectory({ workspaceRoot, path })
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
    const result = await window.dsGui.renameWorkspaceEntry({ workspaceRoot, path, newName })
    if (!result.ok) {
      set({ fileError: result.message })
      return null
    }
    const previousPrefix = `${normalizePath(result.previousPath)}/`
    set((state) => {
      const activeFilePath = state.activeFilePath === result.previousPath
        ? result.path
        : state.activeFilePath?.startsWith(previousPrefix)
          ? `${result.path}/${state.activeFilePath.slice(previousPrefix.length)}`
          : state.activeFilePath
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
      return {
        activeFilePath: activeFilePath ?? null,
        expandedDirs,
        entriesByDir: {},
        fileError: null
      }
    })
    if (get().activeFilePath) rememberActiveFile(workspaceRoot, get().activeFilePath)
    await get().refreshWorkspace(workspaceRoot)
    return result.path
  },

  deleteEntry: async (workspaceRoot, path) => {
    cancelExternalSyncAnimation()
    const result = await window.dsGui.deleteWorkspaceEntry({ workspaceRoot, path })
    if (!result.ok) {
      set({ fileError: result.message })
      return false
    }
    const deletedPath = normalizePath(result.path)
    const currentActiveFilePath = get().activeFilePath
    const activePath = currentActiveFilePath ? normalizePath(currentActiveFilePath) : ''
    if (activePath === deletedPath || activePath.startsWith(`${deletedPath}/`)) {
      lastSavedContent = ''
      rememberActiveFile(workspaceRoot, null)
      set({
        activeFilePath: null,
        fileContent: '',
        fileError: null,
        saveStatus: 'saved',
        selection: emptySelection(),
        quotedSelections: []
      })
    }
    set((state) => {
      const expandedDirs = new Set<string>()
      for (const dirPath of state.expandedDirs) {
        const normalizedDir = normalizePath(dirPath)
        if (normalizedDir !== deletedPath && !normalizedDir.startsWith(`${deletedPath}/`)) {
          expandedDirs.add(dirPath)
        }
      }
      return { expandedDirs }
    })
    await get().refreshWorkspace(workspaceRoot)
    return true
  },

  setPreviewMode: (mode) => {
    try {
      window.localStorage.setItem(WRITE_PREVIEW_MODE_KEY, mode)
    } catch {
      /* ignore */
    }
    set({ previewMode: mode })
  },

  setAssistantOpen: (open) => {
    try {
      window.localStorage.setItem(WRITE_ASSISTANT_OPEN_KEY, open ? '1' : '0')
    } catch {
      /* ignore */
    }
    set({ assistantOpen: open })
  },

  setAssistantModel: (model) => {
    const normalized = model.trim()
    try {
      window.localStorage.setItem(WRITE_ASSISTANT_MODEL_KEY, normalized)
    } catch {
      /* ignore */
    }
    set({ assistantModel: normalized })
  },

  setSelection: (selection) => set({ selection }),

  quoteCurrentSelection: (workspaceRoot) => {
    const state = get()
    if (!state.activeFilePath) return
    const quote = quotedSelectionFromEditor(state.selection, state.activeFilePath, workspaceRoot)
    if (!quote) return
    set((current) => ({
      assistantOpen: true,
      quotedSelections: [...current.quotedSelections, quote],
      selection: emptySelection()
    }))
  },

  removeQuotedSelection: (id) =>
    set((state) => ({
      quotedSelections: state.quotedSelections.filter((selection) => selection.id !== id)
    })),

  clearQuotedSelections: () => set({ quotedSelections: [] }),

  resetWorkspace: () => {
    cancelExternalSyncAnimation()
    lastSavedContent = ''
    set(initialState())
  }
}))

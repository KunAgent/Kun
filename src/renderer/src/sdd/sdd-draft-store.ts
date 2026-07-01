import { create } from 'zustand'
import { buildSddDraftRelativePath, isSddDraftRelativePath, normalizeSddRelativePath } from '@shared/sdd'
import { browserStorage } from '../lib/browser-storage'

export type SddDraftSaveStatus = 'saved' | 'dirty' | 'saving' | 'error'
export type SddDraftOperationStatus = 'idle' | 'upgrading' | 'error'

/** Whether this requirement's surface is brand-led or product-led. */
export type SddDesignType = 'brand' | 'product'

/** Design intent captured on a requirement; injected into plan/prototype prompts. */
export type SddDesignContext = {
  designType?: SddDesignType
  /** Anchor brand color (any CSS color string), optional. */
  brandColor?: string
  /** Free-form tone chips, e.g. 编辑风 / 专业 / 活泼. */
  tone?: string[]
}

export type SddDraft = {
  id: string
  workspaceRoot: string
  relativePath: string
  absolutePath?: string
  createdAt: string
  updatedAt: string
  /** Optional design intent surfaced to generation prompts. */
  designContext?: SddDesignContext
}

type PersistedSddDraftRegistry = {
  version: 1
  activeByWorkspace: Record<string, string>
  drafts: Record<string, SddDraft>
  contentByDraft: Record<string, SddDraftContentSnapshot>
}

export type SddDraftContentSnapshot = {
  draftId: string
  content: string
  lastSavedContent: string
  updatedAt: string
}

export type SddDraftState = {
  activeDraft: SddDraft | null
  content: string
  lastSavedContent: string
  saveStatus: SddDraftSaveStatus
  operationStatus: SddDraftOperationStatus
  error: string | null
  setActiveDraft: (
    draft: SddDraft,
    content: string,
    options?: {
      lastSavedContent?: string
      saveStatus?: SddDraftSaveStatus
    }
  ) => void
  setContent: (content: string) => void
  /** Merge a design-context patch into the active draft and persist it. */
  updateDesignContext: (patch: Partial<SddDesignContext>) => void
  setSaveStatus: (status: SddDraftSaveStatus, error?: string | null) => void
  markSaved: (content: string) => void
  setOperationStatus: (status: SddDraftOperationStatus, error?: string | null) => void
  clearActiveDraft: () => void
}

const SDD_DRAFT_REGISTRY_STORAGE_KEY = 'kun.sdd.draft.registry.v1'

function normalizeWorkspaceRoot(value: string | undefined | null): string {
  return (value ?? '').trim().replaceAll('\\', '/').replace(/\/+$/, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function buildSddDraftId(workspaceRoot: string, relativePath: string): string {
  return `${normalizeWorkspaceRoot(workspaceRoot)}:${normalizeSddRelativePath(relativePath)}`
}

function normalizeContentSnapshot(raw: unknown, fallbackDraftId = ''): SddDraftContentSnapshot | null {
  if (!isRecord(raw)) return null
  const draftId = normalizeText(raw.draftId) || normalizeText(fallbackDraftId)
  if (!draftId || typeof raw.content !== 'string') return null
  const lastSavedContent = typeof raw.lastSavedContent === 'string' ? raw.lastSavedContent : raw.content
  return {
    draftId,
    content: raw.content,
    lastSavedContent,
    updatedAt: normalizeText(raw.updatedAt) || new Date(0).toISOString()
  }
}

export function normalizeSddDesignContext(raw: unknown): SddDesignContext | undefined {
  if (!isRecord(raw)) return undefined
  const out: SddDesignContext = {}
  const designType = normalizeText(raw.designType)
  if (designType === 'brand' || designType === 'product') out.designType = designType
  const brandColor = normalizeText(raw.brandColor)
  if (brandColor) out.brandColor = brandColor.slice(0, 64)
  if (Array.isArray(raw.tone)) {
    const tone = raw.tone
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim().slice(0, 40))
      .slice(0, 12)
    if (tone.length) out.tone = tone
  }
  return Object.keys(out).length ? out : undefined
}

function normalizeDraft(raw: unknown, fallbackId = ''): SddDraft | null {
  if (!isRecord(raw)) return null
  const id = normalizeText(raw.id) || normalizeText(fallbackId)
  const workspaceRoot = normalizeWorkspaceRoot(normalizeText(raw.workspaceRoot))
  const relativePath = normalizeSddRelativePath(normalizeText(raw.relativePath))
  if (!id || !workspaceRoot || !relativePath) return null
  // Pre-unit-layout registry entries (.kunsdd/draft/...) are retired here in
  // one place: dropping the draft also drops its activeByWorkspace pointer
  // and content snapshot downstream.
  if (!isSddDraftRelativePath(relativePath)) return null
  const absolutePath = normalizeText(raw.absolutePath)
  const createdAt = normalizeText(raw.createdAt) || new Date(0).toISOString()
  const updatedAt = normalizeText(raw.updatedAt) || createdAt
  const designContext = normalizeSddDesignContext(raw.designContext)
  return {
    id,
    workspaceRoot,
    relativePath,
    ...(absolutePath ? { absolutePath } : {}),
    createdAt,
    updatedAt,
    ...(designContext ? { designContext } : {})
  }
}

function emptyRegistry(): PersistedSddDraftRegistry {
  return { version: 1, activeByWorkspace: {}, drafts: {}, contentByDraft: {} }
}

function readRegistry(storage = browserStorage()): PersistedSddDraftRegistry {
  if (!storage) return emptyRegistry()
  try {
    const raw = storage.getItem(SDD_DRAFT_REGISTRY_STORAGE_KEY)
    if (!raw) return emptyRegistry()
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) return emptyRegistry()
    const drafts: Record<string, SddDraft> = {}
    if (isRecord(parsed.drafts)) {
      for (const [id, value] of Object.entries(parsed.drafts)) {
        const draft = normalizeDraft(value, id)
        if (draft) drafts[draft.id] = draft
      }
    }
    const activeByWorkspace: Record<string, string> = {}
    if (isRecord(parsed.activeByWorkspace)) {
      for (const [workspace, value] of Object.entries(parsed.activeByWorkspace)) {
        const normalizedWorkspace = normalizeWorkspaceRoot(workspace)
        const activeId = normalizeText(value)
        const draft = drafts[activeId]
        if (normalizedWorkspace && draft && normalizeWorkspaceRoot(draft.workspaceRoot) === normalizedWorkspace) {
          activeByWorkspace[normalizedWorkspace] = draft.id
        }
      }
    }
    const contentByDraft: Record<string, SddDraftContentSnapshot> = {}
    if (isRecord(parsed.contentByDraft)) {
      for (const [id, value] of Object.entries(parsed.contentByDraft)) {
        const snapshot = normalizeContentSnapshot(value, id)
        if (snapshot && drafts[snapshot.draftId]) {
          contentByDraft[snapshot.draftId] = snapshot
        }
      }
    }
    return { version: 1, activeByWorkspace, drafts, contentByDraft }
  } catch {
    return emptyRegistry()
  }
}

function writeRegistry(registry: PersistedSddDraftRegistry, storage = browserStorage()): void {
  if (!storage) return
  try {
    storage.setItem(SDD_DRAFT_REGISTRY_STORAGE_KEY, JSON.stringify(registry))
  } catch {
    /* ignore storage failures */
  }
}

export function createSddDraft(options: {
  id: string
  workspaceRoot: string
  absolutePath?: string
  now?: number
}): SddDraft {
  const now = new Date(options.now ?? Date.now()).toISOString()
  const workspaceRoot = normalizeWorkspaceRoot(options.workspaceRoot)
  const relativePath = buildSddDraftRelativePath(options.id)
  return {
    id: buildSddDraftId(workspaceRoot, relativePath),
    workspaceRoot,
    relativePath,
    ...(options.absolutePath ? { absolutePath: options.absolutePath } : {}),
    createdAt: now,
    updatedAt: now
  }
}

export function resolveSddRequirementWorkspace(
  threads: readonly { id: string; workspace?: string }[],
  activeThreadId: string | null,
  fallbackWorkspace: string
): string {
  return normalizeWorkspaceRoot(
    threads.find((thread) => thread.id === activeThreadId)?.workspace ?? fallbackWorkspace
  )
}

export function rememberSddDraft(draft: SddDraft): void {
  const normalized = normalizeDraft(draft)
  if (!normalized) return
  const registry = readRegistry()
  const workspace = normalizeWorkspaceRoot(normalized.workspaceRoot)
  registry.drafts[normalized.id] = normalized
  if (workspace) registry.activeByWorkspace[workspace] = normalized.id
  writeRegistry(registry)
}

export function rememberSddDraftContent(
  draft: Pick<SddDraft, 'id'>,
  content: string,
  lastSavedContent = content
): void {
  const draftId = normalizeText(draft.id)
  if (!draftId) return
  const registry = readRegistry()
  if (!registry.drafts[draftId]) return
  registry.contentByDraft[draftId] = {
    draftId,
    content,
    lastSavedContent,
    updatedAt: new Date().toISOString()
  }
  writeRegistry(registry)
}

export function readRememberedSddDraft(workspaceRoot: string): SddDraft | null {
  const registry = readRegistry()
  const workspace = normalizeWorkspaceRoot(workspaceRoot)
  const id = registry.activeByWorkspace[workspace]
  const draft = registry.drafts[id ?? ''] ?? null
  return draft && normalizeWorkspaceRoot(draft.workspaceRoot) === workspace ? draft : null
}

export function readRememberedSddDrafts(workspaceRoot?: string): SddDraft[] {
  const registry = readRegistry()
  const workspace = workspaceRoot ? normalizeWorkspaceRoot(workspaceRoot) : ''
  return Object.values(registry.drafts)
    .filter((draft) => !workspace || normalizeWorkspaceRoot(draft.workspaceRoot) === workspace)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
}

export function readRememberedSddDraftContent(
  draft: Pick<SddDraft, 'id'>
): SddDraftContentSnapshot | null {
  const draftId = normalizeText(draft.id)
  if (!draftId) return null
  const registry = readRegistry()
  return registry.contentByDraft[draftId] ?? null
}

export function forgetRememberedSddDraft(draft: Pick<SddDraft, 'id' | 'workspaceRoot'>): void {
  const normalizedId = normalizeText(draft.id)
  if (!normalizedId) return
  const registry = readRegistry()
  delete registry.drafts[normalizedId]
  delete registry.contentByDraft[normalizedId]
  for (const [key, activeId] of Object.entries(registry.activeByWorkspace)) {
    if (activeId === normalizedId) {
      delete registry.activeByWorkspace[key]
    }
  }
  writeRegistry(registry)
}

export const useSddDraftStore = create<SddDraftState>((set) => ({
  activeDraft: null,
  content: '',
  lastSavedContent: '',
  saveStatus: 'saved',
  operationStatus: 'idle',
  error: null,

  setActiveDraft: (draft, content, options = {}) => {
    const lastSavedContent = options.lastSavedContent ?? content
    const saveStatus = options.saveStatus ?? (content === lastSavedContent ? 'saved' : 'dirty')
    rememberSddDraft(draft)
    rememberSddDraftContent(draft, content, lastSavedContent)
    set({
      activeDraft: draft,
      content,
      lastSavedContent,
      saveStatus,
      operationStatus: 'idle',
      error: null
    })
  },

  setContent: (content) =>
    set((state) => {
      if (state.activeDraft) {
        rememberSddDraftContent(state.activeDraft, content, state.lastSavedContent)
      }
      return {
        content,
        saveStatus: content === state.lastSavedContent ? 'saved' : 'dirty',
        error: state.saveStatus === 'error' ? null : state.error
      }
    }),

  updateDesignContext: (patch) =>
    set((state) => {
      if (!state.activeDraft) return {}
      const merged = normalizeSddDesignContext({
        ...(state.activeDraft.designContext ?? {}),
        ...patch
      })
      const activeDraft: SddDraft = { ...state.activeDraft }
      if (merged) activeDraft.designContext = merged
      else delete activeDraft.designContext
      rememberSddDraft(activeDraft)
      return { activeDraft }
    }),

  setSaveStatus: (status, error = null) => set({ saveStatus: status, error }),

  markSaved: (content) =>
    set((state) => {
      const activeDraft = state.activeDraft
        ? { ...state.activeDraft, updatedAt: new Date().toISOString() }
        : state.activeDraft
      if (activeDraft) rememberSddDraft(activeDraft)
      if (activeDraft) rememberSddDraftContent(activeDraft, content, content)
      return {
        activeDraft,
        content,
        lastSavedContent: content,
        saveStatus: 'saved',
        error: state.operationStatus === 'error' ? state.error : null
      }
    }),

  setOperationStatus: (status, error = null) => set({ operationStatus: status, error }),

  clearActiveDraft: () =>
    set({
      activeDraft: null,
      content: '',
      lastSavedContent: '',
      saveStatus: 'saved',
      operationStatus: 'idle',
      error: null
    })
}))

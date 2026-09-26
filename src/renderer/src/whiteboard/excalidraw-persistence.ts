import {
  normalizeDesignPersistenceWorkspaceRoot,
  writeDesignWorkspaceFile
} from '../design/design-persistence-coordinator'
import { isKunCanvasDocumentEmpty, normalizeCanvasEngine, type CanvasEngine } from './canvas-engine'

export const EXCALIDRAW_SCENE_FILE = 'excalidraw.json'
export const EXCALIDRAW_PNG_FILE = 'excalidraw.png'
export const CODE_CANVAS_ENGINE_FILE = 'engine.json'

export type ExcalidrawSceneV1 = {
  type: 'excalidraw'
  version: 2
  source?: string
  elements: unknown[]
  appState?: Record<string, unknown>
  files?: Record<string, unknown>
}

const isObj = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const _saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const _pendingSaves = new Map<string, {
  workspaceRoot: string
  path: string
  content: string
}>()
const _inFlightSaves = new Map<string, Set<Promise<unknown>>>()
const _cancelledSaveKeys = new Set<string>()
const _liveScenes = new Map<string, ExcalidrawSceneV1>()
const _liveEngines = new Map<string, CanvasEngine>()
const _sceneMtimes = new Map<string, number>()
const _saveErrors = new Map<string, Error>()
const _saveErrorListeners = new Map<string, Set<(message: string) => void>>()

export function subscribeExcalidrawSaveError(workspaceRoot: string, identityId: string, baseDir: string,
  listener: (message: string) => void): () => void {
  const key = excalidrawSceneKey(workspaceRoot, identityId, baseDir)
  const listeners = _saveErrorListeners.get(key) ?? new Set()
  listeners.add(listener)
  _saveErrorListeners.set(key, listeners)
  listener(_saveErrors.get(key)?.message ?? '')
  return () => { listeners.delete(listener); if (!listeners.size) _saveErrorListeners.delete(key) }
}

export function pendingExcalidrawDraft(workspaceRoot: string, identityId: string, baseDir: string): ExcalidrawSceneV1 | null {
  const key = excalidrawSceneKey(workspaceRoot, identityId, baseDir)
  return _pendingSaves.has(key) || _saveErrors.has(key) || _inFlightSaves.has(key) ? _liveScenes.get(key) ?? null : null
}


export function excalidrawScenePath(identityId: string, baseDir: string): string {
  return `${baseDir}/${identityId}/${EXCALIDRAW_SCENE_FILE}`
}

export function excalidrawPngPath(identityId: string, baseDir: string): string {
  return `${baseDir}/${identityId}/${EXCALIDRAW_PNG_FILE}`
}

export function excalidrawSceneKey(
  workspaceRoot: string,
  identityId: string,
  baseDir: string
): string {
  return [workspaceRoot, excalidrawScenePath(identityId, baseDir)].join('\0')
}

export function createEmptyExcalidrawScene(): ExcalidrawSceneV1 {
  return {
    type: 'excalidraw',
    version: 2,
    source: 'kun',
    elements: [],
    appState: { viewBackgroundColor: '#ffffff' },
    files: {}
  }
}

export function isExcalidrawSceneEmpty(scene: ExcalidrawSceneV1 | null | undefined): boolean {
  if (!scene || !Array.isArray(scene.elements)) return true
  return !scene.elements.some((element) => {
    if (!isObj(element)) return false
    return element.isDeleted !== true
  })
}

function parseAppState(raw: unknown): Record<string, unknown> | undefined {
  if (!isObj(raw)) return undefined
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'collaborators' || key === 'cursorButton' || key === 'isLoading') continue
    next[key] = value
  }
  return Object.keys(next).length > 0 ? next : undefined
}

function parseFiles(raw: unknown): Record<string, unknown> | undefined {
  if (!isObj(raw)) return undefined
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!key.trim() || !isObj(value)) continue
    next[key] = value
  }
  return Object.keys(next).length > 0 ? next : undefined
}

export function parseExcalidrawScene(raw: string): ExcalidrawSceneV1 | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isObj(parsed)) return null
    if (parsed.type !== 'excalidraw') return null
    if (parsed.version !== 2 && parsed.version !== 1) return null
    if (!Array.isArray(parsed.elements)) return null
    const elements = parsed.elements.slice(0, 20_000)
    const appState = parseAppState(parsed.appState)
    const files = parseFiles(parsed.files)
    return {
      type: 'excalidraw',
      version: 2,
      source: typeof parsed.source === 'string' ? parsed.source : 'kun',
      elements,
      ...(appState ? { appState } : {}),
      ...(files ? { files } : {})
    }
  } catch {
    return null
  }
}

export function serializeExcalidrawScene(scene: ExcalidrawSceneV1): string {
  return `${JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: scene.source ?? 'kun',
    elements: scene.elements,
    appState: scene.appState ?? {},
    files: scene.files ?? {}
  }, null, 2)}\n`
}

function writePendingScene(
  key: string,
  pending: { workspaceRoot: string; path: string; content: string }
): Promise<void> {
  const previous = [...(_inFlightSaves.get(key) ?? [])]
  const write = Promise.all(previous).then(async () => {
    const failure = _saveErrors.get(key)
    if (failure) throw failure
    const expectedMtimeMs = _sceneMtimes.get(key)
    const result = await writeDesignWorkspaceFile({ ...pending,
      ...(expectedMtimeMs !== undefined ? { expectedMtimeMs } : {}) })
    if (!result.ok) throw new Error(result.message)
    if (result.mtimeMs !== undefined) _sceneMtimes.set(key, result.mtimeMs)
  }).catch((cause: unknown) => {
    const error = cause instanceof Error ? cause : new Error(String(cause))
    _saveErrors.set(key, error)
    for (const listener of _saveErrorListeners.get(key) ?? []) listener(error.message)
    // Retain the draft on IPC failures as well as explicit version conflicts.
    if (!_pendingSaves.has(key)) _pendingSaves.set(key, pending)
    throw error
  })
  const writes = _inFlightSaves.get(key) ?? new Set<Promise<unknown>>()
  writes.add(write)
  _inFlightSaves.set(key, writes)
  void write.finally(() => {
    const current = _inFlightSaves.get(key)
    if (!current) return
    current.delete(write)
    if (current.size === 0) _inFlightSaves.delete(key)
  }).catch(() => undefined)
  return write
}

export function rememberLiveExcalidrawScene(
  workspaceRoot: string,
  identityId: string,
  baseDir: string,
  scene: ExcalidrawSceneV1
): void {
  _liveScenes.set(excalidrawSceneKey(workspaceRoot, identityId, baseDir), scene)
}

export function liveExcalidrawScene(
  workspaceRoot: string,
  identityId: string,
  baseDir: string
): ExcalidrawSceneV1 | null {
  return _liveScenes.get(excalidrawSceneKey(workspaceRoot, identityId, baseDir)) ?? null
}

export async function resolveExcalidrawSceneForPrompt(
  workspaceRoot: string,
  identityId: string,
  baseDir: string
): Promise<ExcalidrawSceneV1 | null> {
  return liveExcalidrawScene(workspaceRoot, identityId, baseDir)
    ?? await loadExcalidrawScene(workspaceRoot, identityId, baseDir)
}

export function persistExcalidrawScene(
  workspaceRoot: string,
  identityId: string,
  baseDir: string,
  scene: ExcalidrawSceneV1
): void {
  if (!workspaceRoot.trim() || !identityId.trim()) return
  rememberLiveExcalidrawScene(workspaceRoot, identityId, baseDir, scene)
  const key = excalidrawSceneKey(workspaceRoot, identityId, baseDir)
  if (_cancelledSaveKeys.has(key)) return
  const existingTimer = _saveTimers.get(key)
  if (existingTimer) clearTimeout(existingTimer)
  _pendingSaves.set(key, {
    path: excalidrawScenePath(identityId, baseDir),
    workspaceRoot,
    content: serializeExcalidrawScene(scene)
  })
  const timer = setTimeout(() => {
    _saveTimers.delete(key)
    const pending = _pendingSaves.get(key)
    _pendingSaves.delete(key)
    if (pending && !_cancelledSaveKeys.has(key)) void writePendingScene(key, pending).catch(() => undefined)
  }, 600)
  _saveTimers.set(key, timer)
}

export async function flushPendingExcalidrawScenes(workspaceRoot?: string): Promise<void> {
  const normalizedRoot = workspaceRoot === undefined
    ? null
    : normalizeDesignPersistenceWorkspaceRoot(workspaceRoot)
  for (;;) {
    const entries = [..._pendingSaves.entries()].filter(([, pending]) => (
      normalizedRoot === null ||
      normalizeDesignPersistenceWorkspaceRoot(pending.workspaceRoot) === normalizedRoot
    ))
    if (entries.length === 0) return
    await Promise.all(entries.map(async ([key, pending]) => {
      const timer = _saveTimers.get(key)
      if (timer) clearTimeout(timer)
      _saveTimers.delete(key)
      _pendingSaves.delete(key)
      if (!_cancelledSaveKeys.has(key)) await writePendingScene(key, pending)
    }))
  }
}

export async function prepareExcalidrawReload(workspaceRoot: string, identityId: string, baseDir: string): Promise<void> {
  const key = excalidrawSceneKey(workspaceRoot, identityId, baseDir)
  const timer = _saveTimers.get(key)
  if (timer) clearTimeout(timer)
  _saveTimers.delete(key)
  const writes = _inFlightSaves.get(key)
  if (writes?.size) await Promise.all([...writes])
  if (_pendingSaves.has(key) || _saveErrors.has(key)) {
    const message = 'The board has unsaved local changes. Resolve the local/disk conflict before applying the Agent scene.'
    for (const listener of _saveErrorListeners.get(key) ?? []) listener(message)
    throw new Error(message)
  }
}

export async function flushPendingExcalidrawScene(
  workspaceRoot: string,
  identityId: string,
  baseDir: string
): Promise<void> {
  const key = excalidrawSceneKey(workspaceRoot, identityId, baseDir)
  const timer = _saveTimers.get(key)
  if (timer) clearTimeout(timer)
  _saveTimers.delete(key)
  const pending = _pendingSaves.get(key)
  _pendingSaves.delete(key)
  if (pending && !_cancelledSaveKeys.has(key)) await writePendingScene(key, pending)
  const writes = _inFlightSaves.get(key)
  if (writes?.size) await Promise.all([...writes])
  const failure = _saveErrors.get(key)
  if (failure) throw failure
}

/** Drop a pending local save only when the caller deliberately replaces it. */
export async function discardPendingExcalidrawScene(
  workspaceRoot: string,
  identityId: string,
  baseDir: string
): Promise<void> {
  const key = excalidrawSceneKey(workspaceRoot, identityId, baseDir)
  const timer = _saveTimers.get(key)
  if (timer) clearTimeout(timer)
  _saveTimers.delete(key)
  _pendingSaves.delete(key)
  const writes = _inFlightSaves.get(key)
  if (writes?.size) await Promise.allSettled([...writes])
  _saveErrors.delete(key)
  for (const listener of _saveErrorListeners.get(key) ?? []) listener('')
  _pendingSaves.delete(key)
  _sceneMtimes.delete(key)
}

export async function cancelPendingExcalidrawScene(
  workspaceRoot: string,
  identityId: string,
  baseDir: string
): Promise<void> {
  const key = excalidrawSceneKey(workspaceRoot, identityId, baseDir)
  _cancelledSaveKeys.add(key)
  const timer = _saveTimers.get(key)
  if (timer) clearTimeout(timer)
  _saveTimers.delete(key)
  _pendingSaves.delete(key)
  const writes = _inFlightSaves.get(key)
  if (writes?.size) await Promise.all([...writes])
}

export async function loadExcalidrawScene(
  workspaceRoot: string,
  identityId: string,
  baseDir: string
): Promise<ExcalidrawSceneV1 | null> {
  if (!workspaceRoot || typeof window === 'undefined' || typeof window.kunGui?.readWorkspaceFile !== 'function') return null
  try {
    const result = await window.kunGui.readWorkspaceFile({
      path: excalidrawScenePath(identityId, baseDir),
      workspaceRoot
    })
    if (!result || !result.ok || result.truncated) return null
    const key = excalidrawSceneKey(workspaceRoot, identityId, baseDir)
    // Reading for an Agent apply must not bless a conflicting local draft.
    if (!_pendingSaves.has(key) && !_saveErrors.has(key) && typeof result.mtimeMs === 'number') {
      _sceneMtimes.set(key, result.mtimeMs)
    }
    return parseExcalidrawScene(result.content)
  } catch {
    return null
  }
}

export function parseCanvasEngineRecord(raw: string): CanvasEngine {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isObj(parsed)) return 'kun'
    return normalizeCanvasEngine(parsed.engine)
  } catch {
    return 'kun'
  }
}

export function serializeCanvasEngineRecord(engine: CanvasEngine): string {
  return `${JSON.stringify({ engine: normalizeCanvasEngine(engine) }, null, 2)}\n`
}

export async function loadPersistedCanvasEngine(
  workspaceRoot: string,
  path: string
): Promise<CanvasEngine> {
  if (!workspaceRoot || typeof window === 'undefined' || typeof window.kunGui?.readWorkspaceFile !== 'function') return 'kun'
  try {
    const result = await window.kunGui.readWorkspaceFile({ path, workspaceRoot })
    if (!result || !result.ok) return 'kun'
    return parseCanvasEngineRecord(result.content)
  } catch {
    return 'kun'
  }
}

export function liveEngineRecordKey(workspaceRoot: string, path: string): string {
  return `${workspaceRoot}\0${path}`
}

export function rememberLiveCanvasEngine(
  workspaceRoot: string,
  path: string,
  engine: CanvasEngine
): void {
  const normalized = normalizeCanvasEngine(engine)
  _liveEngines.set(liveEngineRecordKey(workspaceRoot, path), normalized)
}

export function liveCanvasEngine(workspaceRoot: string, path: string): CanvasEngine | undefined {
  return _liveEngines.get(liveEngineRecordKey(workspaceRoot, path))
}

export async function resolvePersistedCanvasEngine(
  workspaceRoot: string,
  path: string
): Promise<CanvasEngine> {
  return liveCanvasEngine(workspaceRoot, path) ?? await loadPersistedCanvasEngine(workspaceRoot, path)
}

export async function persistCanvasEngineRecord(
  workspaceRoot: string,
  path: string,
  engine: CanvasEngine
): Promise<void> {
  if (!workspaceRoot.trim()) return
  const normalized = normalizeCanvasEngine(engine)
  rememberLiveCanvasEngine(workspaceRoot, path, normalized)
  await writeDesignWorkspaceFile({
    workspaceRoot,
    path,
    content: serializeCanvasEngineRecord(normalized)
  })
}

export function clearExcalidrawRuntimeCacheForTests(): void {
  _liveScenes.clear()
  _liveEngines.clear()
  _sceneMtimes.clear()
  _saveErrors.clear()
  for (const timer of _saveTimers.values()) clearTimeout(timer)
  _saveTimers.clear()
  _pendingSaves.clear()
  _cancelledSaveKeys.clear()
  _inFlightSaves.clear()
}

export function canSwitchCanvasEngine(input: {
  currentEngine: CanvasEngine
  kunEmpty: boolean
  excalidrawEmpty: boolean
}): boolean {
  return input.currentEngine === 'excalidraw' ? input.excalidrawEmpty : input.kunEmpty
}

export { isKunCanvasDocumentEmpty }

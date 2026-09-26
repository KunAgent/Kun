import { rendererRuntimeClient } from '../agent/runtime-client'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { normalizePath } from '../write/write-workspace-store-helpers'
import { usePaperStore } from '../write/paper/paper-store'
import { usePaperModeStore } from './paper-mode-store'
import { paperConversationResourcePath } from './paper-conversation-scope'
import { paperModeView } from './paper-view'

export type PaperModeToggleResult = { ok: true } | { ok: false; message: string }

/**
 * Enter/leave paper mode (plan §3.1 / §6.1). Both directions save dirty
 * documents first, persist `write.paperMode.enabled`, then let
 * `loadWriteSettings` flip the surface and re-root the workspace — keeping a
 * single ordering: save old layout → setWorkSurface → initializeWorkspace.
 */
async function setPaperModeEnabled(enabled: boolean): Promise<PaperModeToggleResult> {
  const store = useWriteWorkspaceStore.getState()
  if (store.paperMode.enabled === enabled) return { ok: true }
  const saved = await store.saveAllDocuments(store.workspaceRoot)
  if (!saved) {
    return { ok: false, message: 'save-failed' }
  }
  try {
    await rendererRuntimeClient.setSettings({ write: { paperMode: { enabled } } })
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  await useWriteWorkspaceStore.getState().loadWriteSettings()
  // loadWriteSettings rolls the flag back when the user keeps unsaved edits
  // on the outgoing surface; report that as a silent cancel.
  if (useWriteWorkspaceStore.getState().workSurface !== (enabled ? 'papers' : 'docs')) {
    return { ok: false, message: PAPER_MODE_SWITCH_CANCELED }
  }
  if (!enabled) usePaperModeStore.getState().clearSelection()
  return { ok: true }
}

/** Result message for a switch the user declined (no notice needed). */
export const PAPER_MODE_SWITCH_CANCELED = 'switch-canceled'

/**
 * Keyboard/command-palette entry: paper mode lives on the Work route, so a
 * shortcut pressed in Code or Rooms first navigates to Work. Toggling from
 * another route always lands in paper mode rather than silently turning it
 * off behind the user's back.
 */
export async function runPaperModeShortcut(command: 'toggle' | 'import'): Promise<void> {
  // Dynamic import: chat-store's send path imports this module.
  const { useChatStore } = await import('../store/chat-store')
  const onWorkRoute = useChatStore.getState().route === 'write'
  if (!onWorkRoute) await useChatStore.getState().openWrite()
  if (command === 'toggle' && onWorkRoute) {
    await togglePaperMode()
    return
  }
  const result = await enterPaperMode()
  if (command === 'import' && result.ok && useWriteWorkspaceStore.getState().paperMode.activeLibrary) {
    usePaperModeStore.getState().setImportDialogOpen(true)
  }
}

export function enterPaperMode(): Promise<PaperModeToggleResult> {
  return setPaperModeEnabled(true)
}

export function exitPaperMode(): Promise<PaperModeToggleResult> {
  return setPaperModeEnabled(false)
}

export function togglePaperMode(): Promise<PaperModeToggleResult> {
  const enabled = useWriteWorkspaceStore.getState().paperMode.enabled
  return setPaperModeEnabled(!enabled)
}

/**
 * Conversation thread key for a Work send: on the papers surface reader turns
 * map to the paper unit dir (PDF and NOTES share one thread) and `''` forces
 * the library-level thread in library/discover views; on the docs surface it
 * is just the active file path.
 */
export function writeConversationResourcePath(
  workspaceRoot: string | undefined,
  activeFilePath: string | null
): string {
  const state = useWriteWorkspaceStore.getState()
  if (state.workSurface !== 'papers') return activeFilePath ?? ''
  return paperConversationResourcePath({
    surface: 'papers',
    workspaceRoot: workspaceRoot ?? state.workspaceRoot,
    activeFilePath,
    unitDirs: Object.keys(usePaperStore.getState().unitsByDir),
    entriesByDir: state.entriesByDir,
    view: paperModeView(state),
    researchSessionId: state.paperResearch.sessionId
  }) ?? ''
}

function compactLibraries(libraries: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of libraries) {
    const normalized = normalizePath(item)
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized)
      out.push(normalized)
    }
  }
  return out
}

async function patchPaperModeLibraries(
  libraries: readonly string[],
  activeLibrary: string
): Promise<void> {
  await rendererRuntimeClient.setSettings({
    write: { paperMode: { libraries: [...libraries], activeLibrary } }
  })
  await useWriteWorkspaceStore.getState().loadWriteSettings()
}

/** Switch the mounted library while staying on the papers surface. */
export async function switchPaperLibrary(libraryRoot: string): Promise<PaperModeToggleResult> {
  const normalized = normalizePath(libraryRoot)
  if (!normalized) return { ok: false, message: 'invalid-path' }
  const store = useWriteWorkspaceStore.getState()
  const rootChanged = normalizePath(store.paperMode.activeLibrary) !== normalized
  const saved = await store.saveAllDocuments(store.workspaceRoot)
  if (!saved) return { ok: false, message: 'save-failed' }
  const paperMode = useWriteWorkspaceStore.getState().paperMode
  const libraries = compactLibraries([normalized, ...paperMode.libraries])
  try {
    await patchPaperModeLibraries(libraries, normalized)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  usePaperModeStore.getState().clearSelection()
  // A research selection from the previous root can never resolve here;
  // clearing it lets the view restore the new library's last session.
  if (rootChanged) {
    useWriteWorkspaceStore.getState().setPaperResearch({ sessionId: null })
  }
  return { ok: true }
}

/**
 * Register a folder as a library without mounting it. The first registered
 * library becomes active so the editor has a workspace; later additions only
 * join the sidebar workspace list.
 */
export async function registerPaperLibrary(libraryRoot: string): Promise<PaperModeToggleResult> {
  const normalized = normalizePath(libraryRoot)
  if (!normalized) return { ok: false, message: 'invalid-path' }
  const paperMode = useWriteWorkspaceStore.getState().paperMode
  if (paperMode.libraries.some((item) => normalizePath(item) === normalized)) {
    return { ok: true }
  }
  const libraries = compactLibraries([...paperMode.libraries, normalized])
  const activeLibrary = normalizePath(paperMode.activeLibrary) || normalized
  try {
    await patchPaperModeLibraries(libraries, activeLibrary)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  return { ok: true }
}

/** Register a folder as a library and make it active. */
export function addPaperLibrary(libraryRoot: string): Promise<PaperModeToggleResult> {
  return switchPaperLibrary(libraryRoot)
}

/** Remove a library from the list only; files on disk are untouched. */
export async function removePaperLibrary(libraryRoot: string): Promise<PaperModeToggleResult> {
  const normalized = normalizePath(libraryRoot)
  if (!normalized) return { ok: false, message: 'invalid-path' }
  const store = useWriteWorkspaceStore.getState()
  const paperMode = store.paperMode
  const libraries = paperMode.libraries.filter((item) => normalizePath(item) !== normalized)
  const wasActive = normalizePath(paperMode.activeLibrary) === normalized
  const activeLibrary = wasActive ? libraries[0] ?? '' : paperMode.activeLibrary
  if (wasActive) {
    const saved = await store.saveAllDocuments(store.workspaceRoot)
    if (!saved) return { ok: false, message: 'save-failed' }
  }
  try {
    await patchPaperModeLibraries(libraries, activeLibrary)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  if (wasActive) usePaperModeStore.getState().clearSelection()
  return { ok: true }
}

import { PAPER_MODE_MAX_LIBRARIES } from '@shared/app-settings-paper-mode'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { normalizePath } from '../write/write-workspace-store-helpers'
import { usePaperStore } from '../write/paper/paper-store'
import { usePaperModeStore } from './paper-mode-store'
import { paperConversationResourcePath } from './paper-conversation-scope'
import { paperModeView } from './paper-view'
import { usePaperWorkspaceBootstrapStore } from './paper-workspace-bootstrap'

export type PaperModeToggleResult = { ok: true } | { ok: false; message: string }

// Settings mutations must see the preceding selection, not the snapshot from
// another picker/click that is still saving. Failures never poison the queue.
let pendingLibraryAction: Promise<unknown> = Promise.resolve()
function serializeLibraryAction(action: () => Promise<PaperModeToggleResult>): Promise<PaperModeToggleResult> {
  const next = pendingLibraryAction.then(action).catch((error: unknown): PaperModeToggleResult => ({
    ok: false, message: error instanceof Error ? error.message : String(error)
  }))
  pendingLibraryAction = next
  return next
}

/**
 * Enter/leave paper mode (plan §3.1 / §6.1). Both directions save dirty
 * documents through the navigation guard, persist `write.paperMode.enabled`, then let
 * `loadWriteSettings` flip the surface and re-root the workspace — keeping a
 * single ordering: save old layout → setWorkSurface → initializeWorkspace.
 */
async function setPaperModeEnabled(enabled: boolean): Promise<PaperModeToggleResult> {
  const store = useWriteWorkspaceStore.getState()
  if (store.paperMode.enabled === enabled) {
    if (enabled && usePaperWorkspaceBootstrapStore.getState().status !== 'ready') {
      await store.loadWriteSettings()
      const error = usePaperWorkspaceBootstrapStore.getState().error
      if (error) return { ok: false, message: error }
    }
    return { ok: true }
  }
  try {
    await rendererRuntimeClient.setSettings({ write: { paperMode: { enabled } } })
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  await useWriteWorkspaceStore.getState().loadWriteSettings()
  const settingsError = useWriteWorkspaceStore.getState().settingsError
  if (settingsError) return { ok: false, message: settingsError }
  // loadWriteSettings rolls the flag back when the user keeps unsaved edits
  // on the outgoing surface; report that as a silent cancel.
  if (useWriteWorkspaceStore.getState().workSurface !== (enabled ? 'papers' : 'docs')) {
    return { ok: false, message: PAPER_MODE_SWITCH_CANCELED }
  }
  if (enabled && usePaperWorkspaceBootstrapStore.getState().error) {
    return { ok: false, message: usePaperWorkspaceBootstrapStore.getState().error! }
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
  return serializeLibraryAction(() => setPaperModeEnabled(true))
}

export function exitPaperMode(): Promise<PaperModeToggleResult> {
  return serializeLibraryAction(() => setPaperModeEnabled(false))
}

export function togglePaperMode(): Promise<PaperModeToggleResult> {
  return serializeLibraryAction(() => setPaperModeEnabled(!useWriteWorkspaceStore.getState().paperMode.enabled))
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
  activeLibrary: string,
  mount = false
): Promise<void> {
  await rendererRuntimeClient.setSettings({
    write: { paperMode: { libraries: [...libraries], activeLibrary, ...(mount ? { enabled: true } : {}) } }
  })
  await useWriteWorkspaceStore.getState().loadWriteSettings()
}

/**
 * Open a library: papers are part of Work, so switching to a library always
 * mounts the papers surface, whichever surface was showing before.
 */
async function switchPaperLibraryNow(libraryRoot: string): Promise<PaperModeToggleResult> {
  const normalized = normalizePath(libraryRoot)
  if (!normalized) return { ok: false, message: 'invalid-path' }
  // Dirty-document navigation is settled by loadWriteSettings before mounting;
  // respect autosave-off Save / Discard / Cancel rather than saving silently.
  // Validate a selected root without creating or changing anything on disk.
  if (typeof window.kunGui?.listWorkspaceDirectory === 'function') {
    const admission = await window.kunGui.listWorkspaceDirectory({ workspaceRoot: normalized })
    if (!admission.ok) return { ok: false, message: admission.message }
  }
  const paperMode = useWriteWorkspaceStore.getState().paperMode
  const libraries = compactLibraries([normalized, ...paperMode.libraries])
  if (libraries.length > PAPER_MODE_MAX_LIBRARIES) {
    return { ok: false, message: 'The workspace list is full. Remove a registration before adding another folder.' }
  }
  try {
    await patchPaperModeLibraries(libraries, normalized, true)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  const current = useWriteWorkspaceStore.getState()
  if (current.settingsError) return { ok: false, message: current.settingsError }
  if (current.paperMode.activeLibrary !== normalized || current.workSurface !== 'papers') {
    return { ok: false, message: PAPER_MODE_SWITCH_CANCELED }
  }
  if (normalizePath(current.workspaceRoot) !== normalized) {
    return { ok: false, message: usePaperWorkspaceBootstrapStore.getState().error ?? PAPER_MODE_SWITCH_CANCELED }
  }
  usePaperModeStore.getState().clearSelection()
  return { ok: true }
}

/**
 * Register a folder as a library without mounting it. The first registered
 * library becomes active so the editor has a workspace; later additions only
 * join the sidebar workspace list.
 */
async function registerPaperLibraryNow(libraryRoot: string): Promise<PaperModeToggleResult> {
  const normalized = normalizePath(libraryRoot)
  if (!normalized) return { ok: false, message: 'invalid-path' }
  const paperMode = useWriteWorkspaceStore.getState().paperMode
  if (!normalizePath(paperMode.activeLibrary)) return switchPaperLibraryNow(normalized)
  if (paperMode.libraries.some((item) => normalizePath(item) === normalized)) return { ok: true }
  if (typeof window.kunGui?.listWorkspaceDirectory === 'function') {
    const admission = await window.kunGui.listWorkspaceDirectory({ workspaceRoot: normalized })
    if (!admission.ok) return { ok: false, message: admission.message }
  }
  const libraries = compactLibraries([...paperMode.libraries, normalized])
  if (libraries.length > PAPER_MODE_MAX_LIBRARIES) {
    return { ok: false, message: 'The workspace list is full. Remove a registration before adding another folder.' }
  }
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
async function removePaperLibraryNow(libraryRoot: string): Promise<PaperModeToggleResult> {
  const normalized = normalizePath(libraryRoot)
  if (!normalized) return { ok: false, message: 'invalid-path' }
  const store = useWriteWorkspaceStore.getState()
  const paperMode = store.paperMode
  const libraries = paperMode.libraries.filter((item) => normalizePath(item) !== normalized)
  const wasActive = normalizePath(paperMode.activeLibrary) === normalized
  const activeLibrary = wasActive ? libraries[0] ?? '' : paperMode.activeLibrary
  try {
    await patchPaperModeLibraries(libraries, activeLibrary)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  const current = useWriteWorkspaceStore.getState()
  if (current.settingsError) return { ok: false, message: current.settingsError }
  if (current.paperMode.libraries.some((root) => normalizePath(root) === normalized)) {
    return { ok: false, message: PAPER_MODE_SWITCH_CANCELED }
  }
  if (wasActive) usePaperModeStore.getState().clearSelection()
  return { ok: true }
}

export function switchPaperLibrary(libraryRoot: string): Promise<PaperModeToggleResult> {
  return serializeLibraryAction(() => switchPaperLibraryNow(libraryRoot))
}

export function registerPaperLibrary(libraryRoot: string): Promise<PaperModeToggleResult> {
  return serializeLibraryAction(() => registerPaperLibraryNow(libraryRoot))
}

export function removePaperLibrary(libraryRoot: string): Promise<PaperModeToggleResult> {
  return serializeLibraryAction(() => removePaperLibraryNow(libraryRoot))
}

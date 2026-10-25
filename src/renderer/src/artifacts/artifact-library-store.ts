import { create } from 'zustand'
import { useChatStore } from '../store/chat-store'
import type { AppRoute } from '../store/chat-store-types'
import { useDesignWorkspaceStore } from '../design/design-workspace-store'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { scanArtifactLibrary, type ArtifactScanApi } from './artifact-index'
import type { LibraryArtifact } from './artifact-types'

export type ArtifactsReturnRoute = Exclude<AppRoute, 'artifacts' | 'settings' | 'design' | 'rooms'>

/** Which surface opened the library; Work only ever shows its own space. */
export type ArtifactLibrarySource = 'code' | 'work'

type ArtifactLibraryState = {
  items: LibraryArtifact[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  openId: string | null
  returnRoute: ArtifactsReturnRoute
  source: ArtifactLibrarySource
  /** Work space the library is scoped to; null in Code. */
  workRoot: string | null
  refresh: () => Promise<void>
  openArtifact: (id: string) => void
  closeArtifact: () => void
}

export function artifactsReturnRouteFor(route: AppRoute): ArtifactsReturnRoute {
  if (route === 'rooms') return 'agent-chat'
  if (route === 'artifacts' || route === 'settings' || route === 'design') return 'chat'
  return route
}

/** Every project Kun knows about in this window: Code projects, conversations, Design and Work. */
export function libraryRootsFromStores(): string[] {
  const chat = useChatStore.getState()
  return [
    chat.workspaceRoot,
    ...chat.codeWorkspaceRoots,
    ...chat.threads.map((thread) => thread.workspace),
    useDesignWorkspaceStore.getState().workspaceRoot,
    useWriteWorkspaceStore.getState().workspaceRoot
  ].filter((root): root is string => typeof root === 'string')
}

function scanApi(): ArtifactScanApi | null {
  const api = typeof window === 'undefined' ? undefined : window.kunGui
  if (!api?.listWorkspaceDirectory || !api?.readWorkspaceFile) return null
  return { listWorkspaceDirectory: api.listWorkspaceDirectory, readWorkspaceFile: api.readWorkspaceFile }
}

let scanGeneration = 0

export const useArtifactLibraryStore = create<ArtifactLibraryState>((set) => ({
  items: [],
  status: 'idle',
  error: null,
  openId: null,
  returnRoute: 'chat',
  source: 'code',
  workRoot: null,
  refresh: async () => {
    const api = scanApi()
    if (!api) {
      set({ status: 'error', error: 'unavailable' })
      return
    }
    const generation = ++scanGeneration
    const scope = useArtifactLibraryStore.getState()
    // Work browses one space at a time, so its scan never walks every project.
    const roots = scope.source === 'work'
      ? scope.workRoot?.trim() ? [scope.workRoot] : []
      : libraryRootsFromStores()
    set((state) => ({ status: state.items.length ? 'ready' : 'loading', error: null }))
    try {
      const items = await scanArtifactLibrary(api, roots)
      if (generation === scanGeneration) set({ items, status: 'ready' })
    } catch (error) {
      if (generation === scanGeneration) {
        set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      }
    }
  },
  openArtifact: (id) => set({ openId: id }),
  closeArtifact: () => set({ openId: null })
}))

useChatStore.subscribe((state, previous) => {
  if (state.route === 'artifacts' && previous.route !== 'artifacts') {
    useArtifactLibraryStore.setState({ returnRoute: artifactsReturnRouteFor(previous.route) })
  }
})

export function openArtifactsPage(options?: {
  from?: ArtifactLibrarySource
  workRoot?: string
}): void {
  const source = options?.from ?? 'code'
  const workRoot = source === 'work'
    ? (options?.workRoot ?? useWriteWorkspaceStore.getState().workspaceRoot).trim() || null
    : null
  useArtifactLibraryStore.setState((state) => {
    const scopeChanged = state.source !== source || state.workRoot !== workRoot
    return {
      openId: null,
      source,
      workRoot,
      // A different space means different rows; never show another scope's
      // items while the scoped scan is still running.
      ...(scopeChanged ? { items: [], status: 'idle' as const, error: null } : {})
    }
  })
  useChatStore.getState().setRoute('artifacts')
}

export function closeArtifactsPage(): void {
  const { route, setRoute } = useChatStore.getState()
  if (route === 'artifacts') setRoute(useArtifactLibraryStore.getState().returnRoute)
}

/** Back to the Work surface the library was opened from. */
export function returnToWorkFromArtifacts(): void {
  const { setRoute } = useChatStore.getState()
  setRoute('write')
}

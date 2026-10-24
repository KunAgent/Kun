import { create } from 'zustand'
import { useChatStore } from '../store/chat-store'
import type { AppRoute } from '../store/chat-store-types'
import { useDesignWorkspaceStore } from '../design/design-workspace-store'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { scanArtifactLibrary, type ArtifactScanApi } from './artifact-index'
import type { LibraryArtifact } from './artifact-types'

export type ArtifactsReturnRoute = Exclude<AppRoute, 'artifacts' | 'settings' | 'design' | 'rooms'>

type ArtifactLibraryState = {
  items: LibraryArtifact[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  openId: string | null
  returnRoute: ArtifactsReturnRoute
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
  if (!api?.listWorkspaceDirectory || !api.readWorkspaceFile) return null
  return { listWorkspaceDirectory: api.listWorkspaceDirectory, readWorkspaceFile: api.readWorkspaceFile }
}

let scanGeneration = 0

export const useArtifactLibraryStore = create<ArtifactLibraryState>((set) => ({
  items: [],
  status: 'idle',
  error: null,
  openId: null,
  returnRoute: 'chat',
  refresh: async () => {
    const api = scanApi()
    if (!api) {
      set({ status: 'error', error: 'unavailable' })
      return
    }
    const generation = ++scanGeneration
    set((state) => ({ status: state.items.length ? 'ready' : 'loading', error: null }))
    try {
      const items = await scanArtifactLibrary(api, libraryRootsFromStores())
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

export function openArtifactsPage(): void {
  useArtifactLibraryStore.setState({ openId: null })
  useChatStore.getState().setRoute('artifacts')
}

export function closeArtifactsPage(): void {
  const { route, setRoute } = useChatStore.getState()
  if (route === 'artifacts') setRoute(useArtifactLibraryStore.getState().returnRoute)
}

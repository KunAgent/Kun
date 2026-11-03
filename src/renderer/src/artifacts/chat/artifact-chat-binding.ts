import { create } from 'zustand'
import type { NormalizedThread } from '../../agent/types'
import { sourceThreadFor } from '../artifact-actions'
import type { LibraryArtifact } from '../artifact-types'

/**
 * Which conversation an artifact's chat panel talks to. By default it is the
 * conversation that produced the file; the user can start a file-only one,
 * and a conversation started from the panel is remembered for next time.
 */

const STORAGE_KEY = 'kun.artifactChat.bindings.v1'

type Stored = { threads: Record<string, string> }

type ArtifactChatBindingState = {
  /** Artifact id → thread the panel created or the user picked. */
  threads: Record<string, string>
  /** Artifacts whose next message starts a new conversation. */
  drafts: Record<string, true>
  bind: (artifactId: string, threadId: string) => void
  startFresh: (artifactId: string) => void
  useSource: (artifactId: string) => void
}

function readStored(): Stored {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null') as Partial<Stored> | null
    const threads = parsed?.threads && typeof parsed.threads === 'object' ? parsed.threads : {}
    return { threads: Object.fromEntries(Object.entries(threads).filter(([, id]) => typeof id === 'string' && id)) }
  } catch {
    return { threads: {} }
  }
}

function writeStored(threads: Record<string, string>): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ threads }))
  } catch {
    // Storage can be unavailable; the binding then lasts for this session only.
  }
}

export const useArtifactChatBinding = create<ArtifactChatBindingState>((set) => ({
  threads: readStored().threads,
  drafts: {},
  bind: (artifactId, threadId) => set((state) => {
    const threads = { ...state.threads, [artifactId]: threadId }
    writeStored(threads)
    const { [artifactId]: _cleared, ...drafts } = state.drafts
    return { threads, drafts }
  }),
  startFresh: (artifactId) => set((state) => ({ drafts: { ...state.drafts, [artifactId]: true } })),
  useSource: (artifactId) => set((state) => {
    const { [artifactId]: _dropped, ...threads } = state.threads
    writeStored(threads)
    const { [artifactId]: _cleared, ...drafts } = state.drafts
    return { threads, drafts }
  })
}))

export type ArtifactChatBinding = {
  /** Thread the panel shows and sends to; null means the next message starts one. */
  thread: NormalizedThread | null
  /** The conversation that produced the file, when known. */
  source: NormalizedThread | null
  kind: 'source' | 'bound' | 'draft'
}

export function resolveArtifactChatBinding(
  artifact: LibraryArtifact,
  threads: readonly NormalizedThread[],
  state: Pick<ArtifactChatBindingState, 'threads' | 'drafts'>
): ArtifactChatBinding {
  const source = sourceThreadFor(artifact, threads)
  if (state.drafts[artifact.id]) return { thread: null, source, kind: 'draft' }
  const boundId = state.threads[artifact.id]
  const bound = boundId ? threads.find((thread) => thread.id === boundId && !thread.archived) ?? null : null
  if (bound && bound.id !== source?.id) return { thread: bound, source, kind: 'bound' }
  return source ? { thread: source, source, kind: 'source' } : { thread: null, source: null, kind: 'draft' }
}

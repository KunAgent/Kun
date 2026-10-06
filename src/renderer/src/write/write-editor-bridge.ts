import { create } from 'zustand'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../lib/browser-storage'

/**
 * Bridge between the focused rich editor and the Work right panels. The
 * editor publishes its outline and diff-review chunks here; the outline and
 * review panels read them and call back through `commands`. Only the editor
 * that owns the focused group publishes, identified by `ownerId`.
 */
export type WriteOutlineEntry = {
  pos: number
  level: number
  text: string
  slug: string
}

export type WriteReviewChunkSummary = {
  id: string
  kind: 'added' | 'removed' | 'modified'
  before: string
  after: string
}

export type WriteEditorBridgeCommands = {
  jumpToHeading: (pos: number) => void
  resolveChunk: (id: string, action: 'accept' | 'reject') => void
  resolveAll: (action: 'accept' | 'reject') => void
  focusChunk: (index: number) => void
}

type WriteEditorBridgeState = {
  ownerId: string | null
  outline: WriteOutlineEntry[]
  activeHeadingSlug: string | null
  reviewActive: boolean
  reviewChunks: WriteReviewChunkSummary[]
  commands: WriteEditorBridgeCommands | null
  /** Show the compact outline rail inside the editor (off by default). */
  floatingOutline: boolean
  publish: (ownerId: string, patch: Partial<WriteEditorBridgePublishable>) => void
  release: (ownerId: string) => void
  setFloatingOutline: (enabled: boolean) => void
}

type WriteEditorBridgePublishable = Pick<
  WriteEditorBridgeState,
  'outline' | 'activeHeadingSlug' | 'reviewActive' | 'reviewChunks' | 'commands'
>

export const WRITE_FLOATING_OUTLINE_KEY = 'kun.write.floating-outline'

const EMPTY: WriteEditorBridgePublishable = {
  outline: [],
  activeHeadingSlug: null,
  reviewActive: false,
  reviewChunks: [],
  commands: null
}

export const useWriteEditorBridge = create<WriteEditorBridgeState>((set, get) => ({
  ownerId: null,
  ...EMPTY,
  floatingOutline: readBrowserStorageItem(WRITE_FLOATING_OUTLINE_KEY) === '1',
  publish: (ownerId, patch) => {
    if (get().ownerId !== ownerId) {
      set({ ...EMPTY, ...patch, ownerId })
      return
    }
    set(patch)
  },
  release: (ownerId) => {
    if (get().ownerId !== ownerId) return
    set({ ...EMPTY, ownerId: null })
  },
  setFloatingOutline: (enabled) => {
    writeBrowserStorageItem(WRITE_FLOATING_OUTLINE_KEY, enabled ? '1' : '0')
    set({ floatingOutline: enabled })
  }
}))

export function outlineEntriesEqual(a: WriteOutlineEntry[], b: WriteOutlineEntry[]): boolean {
  if (a.length !== b.length) return false
  return a.every((entry, index) => {
    const other = b[index]
    return other !== undefined && entry.pos === other.pos && entry.level === other.level &&
      entry.text === other.text
  })
}

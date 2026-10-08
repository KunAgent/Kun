import { create } from 'zustand'
import {
  composerFileReferenceFromPath,
  composerFileReferenceKey,
  mergeComposerFileReferences,
  type ComposerFileReference
} from '../lib/composer-file-references'
import { normalizePath } from './write-workspace-store-helpers'

/**
 * Files the user @-references in the Work assistant composer. They belong to
 * the current space (relative paths resolve against it), so switching spaces
 * starts over; the send consumes them, a failed send restores them.
 */
type WorkComposerReferencesState = {
  spaceRoot: string
  references: ComposerFileReference[]
  bindSpace: (root: string) => void
  add: (reference: ComposerFileReference) => void
  remove: (relativePath: string) => void
  restore: (references: readonly ComposerFileReference[]) => void
  consume: (references: readonly ComposerFileReference[]) => void
}

function relativeKey(relativePath: string): string {
  return relativePath.trim().replaceAll('\\', '/').replace(/\/+/g, '/').toLowerCase()
}

export const useWorkComposerReferences = create<WorkComposerReferencesState>((set) => ({
  spaceRoot: '',
  references: [],
  bindSpace: (root) => set((state) => {
    const spaceRoot = normalizePath(root)
    return spaceRoot === state.spaceRoot ? state : { spaceRoot, references: [] }
  }),
  add: (reference) => set((state) => ({ references: mergeComposerFileReferences(state.references, reference) })),
  remove: (relativePath) => set((state) => {
    const key = relativeKey(relativePath)
    const references = state.references.filter((reference) => relativeKey(reference.relativePath) !== key)
    return references.length === state.references.length ? state : { references }
  }),
  restore: (references) => set((state) => ({
    references: references.reduce(mergeComposerFileReferences, state.references)
  })),
  consume: (references) => set((state) => {
    const sent = new Set(references.map(composerFileReferenceKey))
    return { references: state.references.filter((reference) => !sent.has(composerFileReferenceKey(reference))) }
  })
}))

/** "Add local files…": the native picker opens in the space; outside files keep their absolute path. */
export async function pickWorkComposerReferences(spaceRoot: string): Promise<void> {
  const root = normalizePath(spaceRoot)
  if (typeof window.kunGui?.pickLocalFiles !== 'function') return
  const result = await window.kunGui.pickLocalFiles(root || undefined)
  if (result.canceled) return
  const store = useWorkComposerReferences.getState()
  if (root && store.spaceRoot !== root) return
  for (const path of result.paths) store.add(composerFileReferenceFromPath(path, root ? [root] : []))
}

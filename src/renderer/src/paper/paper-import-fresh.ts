import { create } from 'zustand'
import { normalizePath } from '../write/write-workspace-store-helpers'

/**
 * Folders that just received papers: the sidebar expands them and shows a
 * "new" count until the user opens them. In-memory on purpose — it only
 * answers "where did that import go?" right after it happens.
 */
type FreshState = {
  /** library root -> folder -> papers added by recent imports */
  byRoot: Readonly<Record<string, Readonly<Record<string, number>>>>
  /** Bumped on every mark so the tree can re-expand an already-open folder. */
  version: number
  mark: (root: string, folder: string, count: number) => void
  clear: (root: string, folder: string) => void
}

export const usePaperFreshFolders = create<FreshState>((set) => ({
  byRoot: {},
  version: 0,
  mark: (root, folder, count) =>
    set((state) => {
      const key = normalizePath(root)
      if (!key || !folder || count <= 0) return state
      const current = state.byRoot[key] ?? {}
      return {
        version: state.version + 1,
        byRoot: { ...state.byRoot, [key]: { ...current, [folder]: (current[folder] ?? 0) + count } }
      }
    }),
  clear: (root, folder) =>
    set((state) => {
      const key = normalizePath(root)
      const current = state.byRoot[key]
      if (!current) return state
      const next = Object.fromEntries(
        Object.entries(current).filter(([name]) => name !== folder && !name.startsWith(`${folder}/`))
      )
      if (Object.keys(next).length === Object.keys(current).length) return state
      return { byRoot: { ...state.byRoot, [key]: next } }
    })
}))

/** New-paper count shown on `folder`: its own plus everything below it. */
export function freshCountFor(fresh: Readonly<Record<string, number>> | undefined, folder: string): number {
  if (!fresh) return 0
  let total = 0
  for (const [name, count] of Object.entries(fresh)) {
    if (name === folder || name.startsWith(`${folder}/`)) total += count
  }
  return total
}

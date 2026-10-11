import { create } from 'zustand'

/**
 * One selection per research session, shared by the recommendation card in
 * the conversation, the paper pool and the quick-search list: a paper is
 * identified by all of its identity keys (DOI, arXiv id, venue id, title), so
 * a view that only knows one of them still lands on the same paper.
 */
export type SelectionRecord = readonly string[]

type SelectionState = {
  byScope: Readonly<Record<string, readonly SelectionRecord[]>>
  /** Signatures already seeded, so a recommendation list preselects once. */
  seeded: Readonly<Record<string, true>>
  /** Flip one paper (or force it with `on`). */
  toggle: (scope: string, keys: SelectionRecord, on?: boolean) => void
  /** Add or remove many papers at once. */
  setMany: (scope: string, groups: readonly SelectionRecord[], on: boolean) => void
  clear: (scope: string) => void
  /** Merge `groups` into the selection the first time `signature` is seen. */
  seed: (scope: string, signature: string, groups: readonly SelectionRecord[]) => void
}

const NONE: readonly SelectionRecord[] = []

function overlaps(a: SelectionRecord, b: SelectionRecord): boolean {
  return a.some((key) => b.includes(key))
}

export function selectionHas(records: readonly SelectionRecord[], keys: SelectionRecord): boolean {
  return records.some((record) => overlaps(record, keys))
}

function without(records: readonly SelectionRecord[], keys: SelectionRecord): SelectionRecord[] {
  return records.filter((record) => !overlaps(record, keys))
}

function merged(records: readonly SelectionRecord[], groups: readonly SelectionRecord[]): SelectionRecord[] {
  let next = [...records]
  for (const keys of groups) {
    if (!keys.length || selectionHas(next, keys)) continue
    next = [...next, keys]
  }
  return next
}

export const usePaperImportSelection = create<SelectionState>((set) => ({
  byScope: {},
  seeded: {},
  toggle: (scope, keys, on) =>
    set((state) => {
      const current = state.byScope[scope] ?? NONE
      const has = selectionHas(current, keys)
      const want = on ?? !has
      if (want === has) return state
      const next = want ? [...current, keys] : without(current, keys)
      return { byScope: { ...state.byScope, [scope]: next } }
    }),
  setMany: (scope, groups, on) =>
    set((state) => {
      const current = state.byScope[scope] ?? NONE
      let next: SelectionRecord[]
      if (on) next = merged(current, groups)
      else {
        next = [...current]
        for (const keys of groups) next = without(next, keys)
      }
      return { byScope: { ...state.byScope, [scope]: next } }
    }),
  clear: (scope) =>
    set((state) => (state.byScope[scope]?.length ? { byScope: { ...state.byScope, [scope]: [] } } : state)),
  seed: (scope, signature, groups) =>
    set((state) => {
      const mark = `${scope}\u0000${signature}`
      if (state.seeded[mark]) return state
      return {
        seeded: { ...state.seeded, [mark]: true },
        byScope: { ...state.byScope, [scope]: merged(state.byScope[scope] ?? NONE, groups) }
      }
    })
}))

/** Selection records of one scope (stable empty array when nothing is selected). */
export function usePaperSelectionRecords(scope: string): readonly SelectionRecord[] {
  return usePaperImportSelection((state) => state.byScope[scope] ?? NONE)
}

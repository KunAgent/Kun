/**
 * Batched store access for a ThreadEventSink: one inbound SSE batch can
 * produce several `set()` calls (item upsert, turn patch, cursor, effects).
 * While a batch runs, writes fold into a draft view so `get()` stays
 * consistent mid-batch, and flush replays the queued patches as one
 * functional `set()` — identical ordering semantics, one store commit.
 *
 * External writes during a batch still land through the raw `set`; the
 * replay applies our patches on top of the latest state. Functional patches
 * must be pure: they can run for both the draft and the final commit. Keep
 * mutable bookkeeping outside them and external store actions after commit.
 */
export type StorePatch<T> = Partial<T> | ((state: T) => Partial<T>)

export type BatchedStoreAccess<T> = {
  set: (patch: StorePatch<T>) => void
  get: () => T
  run: <R>(work: () => Promise<R>) => Promise<R>
  afterCommit: (effect: () => void) => void
}

export function createBatchedStoreAccess<T extends object>(
  set: (patch: StorePatch<T>) => void,
  get: () => T
): BatchedStoreAccess<T> {
  let depth = 0
  let draft: T | null = null
  let queued: StorePatch<T>[] = []
  let effects: Array<() => void> = []
  const applyPatch = (state: T, patch: StorePatch<T>): T => ({
    ...state,
    ...(typeof patch === 'function' ? (patch as (input: T) => Partial<T>)(state) : patch)
  })

  const batchedSet = (patch: StorePatch<T>): void => {
    if (depth === 0) {
      set(patch)
      return
    }
    queued.push(patch)
    draft = applyPatch(draft ?? get(), patch)
  }
  const batchedGet = (): T => draft ?? get()
  const afterCommit = (effect: () => void): void => {
    if (depth === 0) effect()
    else effects.push(effect)
  }

  const run = async <R>(work: () => Promise<R>): Promise<R> => {
    depth += 1
    try {
      return await work()
    } finally {
      depth -= 1
      if (depth === 0) {
        const pending = queued
        const committedEffects = effects
        queued = []
        effects = []
        draft = null
        if (pending.length > 0) {
          set((latest) => pending.reduce(applyPatch, latest))
        }
        for (const effect of committedEffects) effect()
      }
    }
  }

  return { set: batchedSet, get: batchedGet, run, afterCommit }
}

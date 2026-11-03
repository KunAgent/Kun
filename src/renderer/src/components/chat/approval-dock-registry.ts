import { useSyncExternalStore } from 'react'

/**
 * Approval ids currently shown by the composer-docked approval panel. The
 * timeline card reads this so a docked request is decided in one place
 * instead of rendering a second set of Allow/Deny buttons.
 */
let docked: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()

export function setDockedApprovalIds(ids: readonly string[]): void {
  if (ids.length === docked.size && ids.every((id) => docked.has(id))) return
  docked = new Set(ids)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useIsApprovalDocked(id: string): boolean {
  const read = () => docked.has(id)
  return useSyncExternalStore(subscribe, read, read)
}

import { useSyncExternalStore } from 'react'

/*
 * Hand-off between the approval card and the timeline records: the note a
 * user types when denying an approval ("告诉 Kun 换个做法…"). Approval
 * decisions carry no free text, so the note itself travels as a follow-up
 * message (../approval-deny-note.ts); this memory only lets the denied
 * record render "已拒绝 … · 附言：<note>" next to the approval block.
 *
 * - Writer: the approval card, right after a deny with a non-empty note:
 *   `rememberApprovalDenyNote(block.id, note)`.
 * - Reader: the timeline record of that approval block:
 *   `useApprovalDenyNote(block.id)`.
 *
 * In-memory only, keyed by approval block id: notes do not survive a reload
 * or a re-hydrated thread, so the record must render fine without one.
 */

const MAX_NOTES = 200
const notes = new Map<string, string>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** Stores (or, for a blank note, forgets) the deny note of `approvalId`. */
export function rememberApprovalDenyNote(approvalId: string, note: string): void {
  const text = note.trim()
  if (!approvalId) return
  if (!text) {
    if (notes.delete(approvalId)) emit()
    return
  }
  notes.delete(approvalId)
  notes.set(approvalId, text)
  // Oldest first: keep the map bounded across a long session.
  while (notes.size > MAX_NOTES) {
    const oldest = notes.keys().next().value
    if (oldest === undefined) break
    notes.delete(oldest)
  }
  emit()
}

export function readApprovalDenyNote(approvalId: string | null | undefined): string | null {
  return approvalId ? notes.get(approvalId) ?? null : null
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Deny note of `approvalId`, re-rendering when it is remembered. */
export function useApprovalDenyNote(approvalId: string | null | undefined): string | null {
  return useSyncExternalStore(
    subscribe,
    () => readApprovalDenyNote(approvalId),
    () => readApprovalDenyNote(approvalId)
  )
}

/** Test helper: forget every note. */
export function clearApprovalDenyNotes(): void {
  if (notes.size === 0) return
  notes.clear()
  emit()
}

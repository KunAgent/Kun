import { useCallback, useSyncExternalStore } from 'react'
import type { WorkAnnotation, WorkAnnotationDocument } from '@shared/work-annotations'
import { annotationDocumentKey, listAnnotations, moveStoredAnnotations } from './work-annotation-storage'

type Snapshot = { records: WorkAnnotation[]; error: string | null }
const EMPTY: Snapshot = { records: [], error: null }
type Entry = {
  doc: WorkAnnotationDocument
  snapshot: Snapshot
  generation: number
  listeners: Set<() => void>
}
const entries = new Map<string, Entry>()
let channel: BroadcastChannel | null = null

function connect(): void {
  if (channel || typeof window === 'undefined' || typeof window.BroadcastChannel !== 'function') return
  try {
    channel = new BroadcastChannel('kun-work-annotation-changes')
    channel.onmessage = (e) => { if (typeof e.data === 'string') void refresh(e.data) }
  } catch { /* Profile may disallow cross-window broadcasts. IndexedDB still owns the records. */ }
}

async function refresh(key: string): Promise<void> {
  const entry = entries.get(key)
  if (!entry) return
  const generation = ++entry.generation
  const snapshot = await listAnnotations(entry.doc).then((records) => ({ records, error: null }))
    .catch((e: unknown) => ({ ...entry.snapshot, error: e instanceof Error ? e.message : String(e) }))
  if (generation !== entry.generation || entries.get(key) !== entry) return
  entry.snapshot = snapshot
  for (const listener of entry.listeners) listener()
}

export function notifyAnnotationChange(doc: WorkAnnotationDocument): void {
  connect()
  const key = annotationDocumentKey(doc)
  channel?.postMessage(key)
  void refresh(key)
}

export function useAnnotationSnapshot(doc: WorkAnnotationDocument | null): Snapshot {
  const key = doc && annotationDocumentKey(doc)
  const subscribe = useCallback((listener: () => void) => {
    if (!key) return () => {}
    let entry = entries.get(key)
    if (!entry) {
      const [workspaceRoot, filePath] = JSON.parse(key) as [string, string]
      entry = { doc: { workspaceRoot, filePath }, snapshot: EMPTY, generation: 0, listeners: new Set() }
      entries.set(key, entry)
      connect()
      void refresh(key)
    }
    entry.listeners.add(listener)
    return () => {
      entry.listeners.delete(listener)
      if (!entry.listeners.size) entries.delete(key)
    }
  }, [key])
  return useSyncExternalStore(subscribe, () => (key && entries.get(key)?.snapshot) || EMPTY)
}

export async function moveWorkAnnotations(workspaceRoot: string, oldPath: string, newPath: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const affected = await moveStoredAnnotations(workspaceRoot, oldPath, newPath)
  affected.forEach(notifyAnnotationChange)
}

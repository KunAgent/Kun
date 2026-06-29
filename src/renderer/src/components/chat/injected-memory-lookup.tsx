import { createContext, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { getProvider } from '../../agent/registry'
import { memoryPreview } from '../../lib/memory-preview'

const InjectedMemoryLookupContext = createContext<Map<string, string>>(new Map())

export function InjectedMemoryLookupProvider({
  workspaceRoot,
  children
}: {
  workspaceRoot?: string
  children: ReactNode
}): ReactElement {
  const [lookup, setLookup] = useState<Map<string, string>>(() => new Map())

  useEffect(() => {
    const provider = getProvider()
    if (typeof provider.listMemories !== 'function') {
      setLookup(new Map())
      return
    }
    let cancelled = false
    void provider
      .listMemories({ workspace: workspaceRoot, includeDeleted: true })
      .then((records) => {
        if (cancelled) return
        setLookup(new Map(records.map((record) => [record.id, memoryPreview(record.content)])))
      })
      .catch(() => {
        if (!cancelled) setLookup(new Map())
      })
    return () => {
      cancelled = true
    }
  }, [workspaceRoot])

  return (
    <InjectedMemoryLookupContext.Provider value={lookup}>
      {children}
    </InjectedMemoryLookupContext.Provider>
  )
}

export function useInjectedMemoryLookup(): Map<string, string> {
  return useContext(InjectedMemoryLookupContext)
}

export function metaInjectedMemorySummaries(
  meta: Record<string, unknown> | undefined
): Array<{ id: string; content: string }> {
  const value = meta?.injectedMemorySummaries
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const raw = entry as Record<string, unknown>
      const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : ''
      const content = typeof raw.content === 'string' && raw.content.trim() ? raw.content.trim() : ''
      return id && content ? { id, content } : null
    })
    .filter((entry): entry is { id: string; content: string } => entry !== null)
}

export function resolveInjectedMemoryTooltipLines(
  meta: Record<string, unknown> | undefined,
  memoryIds: string[],
  lookup: Map<string, string>
): string[] {
  const summariesById = new Map(metaInjectedMemorySummaries(meta).map((entry) => [entry.id, entry.content]))
  return memoryIds.map((id, index) => {
    const content = summariesById.get(id) ?? lookup.get(id)
    if (!content) return memoryIds.length > 1 ? `${index + 1}. ${id}` : id
    return memoryIds.length > 1 ? `${index + 1}. ${content}` : content
  })
}

export function useInjectedMemoryTooltipText(
  meta: Record<string, unknown> | undefined,
  memoryIds: string[]
): string {
  const lookup = useInjectedMemoryLookup()
  return useMemo(
    () => resolveInjectedMemoryTooltipLines(meta, memoryIds, lookup).join('\n\n'),
    [lookup, memoryIds, meta]
  )
}

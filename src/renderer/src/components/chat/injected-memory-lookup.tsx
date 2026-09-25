import { createContext, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { getProvider } from '../../agent/registry'
import { memoryPreview } from '../../lib/memory-preview'

const InjectedMemoryLookupContext = createContext<Map<string, string>>(new Map())

export function InjectedMemoryLookupProvider({
  workspaceRoot,
  enabled = true,
  children
}: {
  workspaceRoot?: string
  enabled?: boolean
  children: ReactNode
}): ReactElement {
  const [lookup, setLookup] = useState<Map<string, string>>(() => new Map())

  useEffect(() => {
    if (!enabled) {
      setLookup(new Map())
      return
    }
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
  }, [enabled, workspaceRoot])

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

export function metaInjectedDirectiveIds(
  meta: Record<string, unknown> | undefined
): string[] {
  const value = meta?.injectedDirectiveIds
  if (!Array.isArray(value)) return []
  return value.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
}

export function metaInjectedDirectiveSummaries(
  meta: Record<string, unknown> | undefined
): Array<{ id: string; content: string }> {
  const value = meta?.injectedDirectiveSummaries
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

function resolveTooltipLines(
  ids: string[],
  summaries: Array<{ id: string; content: string }>,
  lookup: Map<string, string>
): string[] {
  const summariesById = new Map(summaries.map((entry) => [entry.id, entry.content]))
  return ids.map((id, index) => {
    const content = summariesById.get(id) ?? lookup.get(id)
    if (!content) return ids.length > 1 ? `${index + 1}. ${id}` : id
    return ids.length > 1 ? `${index + 1}. ${content}` : content
  })
}

export function resolveInjectedMemoryTooltipLines(
  meta: Record<string, unknown> | undefined,
  memoryIds: string[],
  lookup: Map<string, string>
): string[] {
  return resolveTooltipLines(memoryIds, metaInjectedMemorySummaries(meta), lookup)
}

export function resolveInjectedDirectiveTooltipLines(
  meta: Record<string, unknown> | undefined,
  directiveIds: string[],
  lookup: Map<string, string>
): string[] {
  return resolveTooltipLines(directiveIds, metaInjectedDirectiveSummaries(meta), lookup)
}

export function useInjectedMemoryTooltipText(
  meta: Record<string, unknown> | undefined,
  memoryIds: string[],
  directiveIds: string[] = [],
  groupLabels?: { directive: string; memory: string }
): string {
  const lookup = useInjectedMemoryLookup()
  return useMemo(() => {
    const sections: string[] = []
    if (directiveIds.length > 0) {
      const lines = resolveInjectedDirectiveTooltipLines(meta, directiveIds, lookup).join('\n')
      sections.push(groupLabels?.directive ? `${groupLabels.directive}\n${lines}` : lines)
    }
    if (memoryIds.length > 0) {
      const lines = resolveInjectedMemoryTooltipLines(meta, memoryIds, lookup).join('\n')
      sections.push(groupLabels?.memory ? `${groupLabels.memory}\n${lines}` : lines)
    }
    return sections.join('\n\n')
  }, [lookup, memoryIds, directiveIds, meta, groupLabels?.directive, groupLabels?.memory])
}

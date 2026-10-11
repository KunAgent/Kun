import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { AgentGroup, AgentPresentation } from './agent-center-presentation'

export type AgentIntegrationKind = 'chat' | 'terminal' | 'application'

export function agentIntegrationKind(row: AdeHarnessRow): AgentIntegrationKind {
  const transport = row.definition.transport
  return transport === 'terminal' || transport === 'application' ? transport : 'chat'
}

/**
 * The Agent Center lists only Agents Kun can hold a conversation with;
 * terminal-only CLIs and external applications are not part of the catalog.
 */
export function orderedAgentCatalog(rows: AdeHarnessRow[], order: string[]): AdeHarnessRow[] {
  return rows.filter((row) => row.definition.availability !== 'retired' && agentIntegrationKind(row) === 'chat').sort((a, b) => {
    const ai = order.indexOf(a.definition.id)
    const bi = order.indexOf(b.definition.id)
    if (ai !== -1 || bi !== -1) return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi)
    return a.definition.displayName.localeCompare(b.definition.displayName)
  })
}

export function filterAgentCatalog(rows: AdeHarnessRow[], search: string): AdeHarnessRow[] {
  const query = search.trim().toLocaleLowerCase()
  return rows.filter((row) => !query || `${row.definition.displayName} ${row.definition.id}`.toLocaleLowerCase().includes(query))
}

export type AgentListEntry = { row: AdeHarnessRow; presentation: AgentPresentation }
export type AgentListGroup = {
  id: AgentGroup
  /** Entries shown now; the rest of a long "not installed" group stays folded. */
  entries: AgentListEntry[]
  total: number
  hidden: number
}

/** A long list of uninstalled Agents shows this many until expanded or searched. */
export const FOLDED_AGENT_COUNT = 3
const GROUP_ORDER: readonly AgentGroup[] = ['connected', 'available', 'notInstalled']

const byName = (a: AgentListEntry, b: AgentListEntry): number =>
  a.row.definition.displayName.localeCompare(b.row.definition.displayName)

/**
 * Groups the chat Agents by what the user can do next. Kun
 * is the built-in default and is chosen from the page header, not listed.
 * Connected Agents keep the saved `agentOrder`; the other groups sort by name.
 */
export function groupAgentCatalog(entries: readonly AgentListEntry[], order: readonly string[], options: {
  search: string
  expanded: boolean
  selectedId?: string
}): AgentListGroup[] {
  const kept = entries.filter(({ row }) => row.definition.id !== 'kun' && row.definition.availability !== 'retired' &&
    agentIntegrationKind(row) === 'chat')
  const visible = new Set(filterAgentCatalog(kept.map((entry) => entry.row), options.search).map((row) => row.definition.id))
  const searching = options.search.trim().length > 0
  return GROUP_ORDER.flatMap((id): AgentListGroup[] => {
    const all = kept.filter((entry) => entry.presentation.group === id && visible.has(entry.row.definition.id))
    if (id === 'connected') {
      const rank = (entry: AgentListEntry): number => {
        const index = order.indexOf(entry.row.definition.id)
        return index === -1 ? order.length : index
      }
      all.sort((a, b) => rank(a) - rank(b) || byName(a, b))
    } else {
      all.sort(byName)
    }
    if (!all.length) return []
    const folded = id === 'notInstalled' && !options.expanded && !searching && all.length > FOLDED_AGENT_COUNT
    if (!folded) return [{ id, entries: all, total: all.length, hidden: 0 }]
    const shown = all.slice(0, FOLDED_AGENT_COUNT)
    // The selected Agent stays visible even when a deep link points past the fold.
    const selected = all.find((entry) => entry.row.definition.id === options.selectedId)
    if (selected && !shown.includes(selected)) shown.push(selected)
    return [{ id, entries: shown, total: all.length, hidden: all.length - shown.length }]
  })
}

/** Moves `id` so it lands at `targetIndex` within `visibleIds`, keeping every other saved id. */
export function reorderAgents(order: readonly string[], visibleIds: readonly string[], id: string, targetIndex: number): string[] {
  if (!visibleIds.includes(id)) return [...order]
  const rest = visibleIds.filter((candidate) => candidate !== id)
  const index = Math.max(0, Math.min(rest.length, targetIndex))
  const next = [...rest.slice(0, index), id, ...rest.slice(index)]
  return [...next, ...order.filter((candidate) => !next.includes(candidate))]
}

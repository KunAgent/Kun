import type { AdeHarnessRow } from '@shared/ade-harnesses'

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

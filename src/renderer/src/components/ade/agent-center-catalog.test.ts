import { describe, expect, it } from 'vitest'
import type { AdeHarnessRow, AdeHarnessTransport } from '@shared/ade-harnesses'
import { agentIntegrationKind, filterAgentCatalog, orderedAgentCatalog } from './agent-center-catalog'

function row(id: string, transport: AdeHarnessTransport = 'acp'): AdeHarnessRow {
  return { definition: { id, displayName: id.toUpperCase(), transport, credentialModes: ['native-login'],
    permissionModes: [], modelSource: 'static', staticModels: [], builtin: true },
  status: { harnessId: id, installed: 'yes', login: 'unknown', checkedAt: '' } }
}

describe('Agent Center catalog', () => {
  it('keeps the complete active catalog and honors the saved order without mutating server rows', () => {
    const entries = [row('z-agent'), row('gemini-cli'), row('a-agent'), row('old')]
    entries[3].definition.availability = 'retired'
    const ordered = orderedAgentCatalog(entries, ['z-agent', 'gemini-cli'])
    expect(ordered.map((entry) => entry.definition.id)).toEqual(['z-agent', 'gemini-cli', 'a-agent'])
    expect(entries.map((entry) => entry.definition.id)).toEqual(['z-agent', 'gemini-cli', 'a-agent', 'old'])
  })

  it('filters by genuine interaction type and searches names or ids case-insensitively', () => {
    const entries = [row('kun', 'native-loop'), row('aider', 'terminal'), row('editor', 'application'), row('gemini-cli')]
    expect(entries.map(agentIntegrationKind)).toEqual(['chat', 'terminal', 'application', 'chat'])
    expect(filterAgentCatalog(entries, 'chat', '').map((entry) => entry.definition.id)).toEqual(['kun', 'gemini-cli'])
    expect(filterAgentCatalog(entries, 'application', ' EDIT ').map((entry) => entry.definition.id)).toEqual(['editor'])
    expect(filterAgentCatalog(entries, 'terminal', 'KUN')).toEqual([])
    expect(filterAgentCatalog(entries, 'all', 'GEMINI').map((entry) => entry.definition.id)).toEqual(['gemini-cli'])
  })
})

import { describe, expect, it } from 'vitest'
import type { AdeHarnessRow, AdeHarnessTransport } from '@shared/ade-harnesses'
import {
  FOLDED_AGENT_COUNT, agentIntegrationKind, filterAgentCatalog, groupAgentCatalog, orderedAgentCatalog, reorderAgents,
  type AgentListEntry
} from './agent-center-catalog'
import type { AgentGroup } from './agent-center-presentation'

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

  it('lists only chat Agents and searches names or ids case-insensitively', () => {
    const entries = [row('kun', 'native-loop'), row('aider', 'terminal'), row('editor', 'application'), row('gemini-cli')]
    expect(entries.map(agentIntegrationKind)).toEqual(['chat', 'terminal', 'application', 'chat'])
    const chat = orderedAgentCatalog(entries, [])
    expect(chat.map((entry) => entry.definition.id)).toEqual(['gemini-cli', 'kun'])
    expect(filterAgentCatalog(chat, ' EDIT ')).toEqual([])
    expect(filterAgentCatalog(chat, 'GEMINI').map((entry) => entry.definition.id)).toEqual(['gemini-cli'])
    expect(filterAgentCatalog(chat, '').map((entry) => entry.definition.id)).toEqual(['gemini-cli', 'kun'])
  })
})

function entry(id: string, group: AgentGroup, transport: AdeHarnessTransport = 'acp'): AgentListEntry {
  return { row: row(id, transport), presentation: { state: 'ready', group, tone: 'success', switch: 'on', mode: 'manage', next: null,
    listLine: { key: 'k' }, statusLine: { key: 'k' } } }
}

describe('groupAgentCatalog', () => {
  const options = { search: '', expanded: false }

  it('groups by next step, hides Kun, and keeps the saved order only for connected Agents', () => {
    const entries = [entry('kun', 'connected', 'native-loop'), entry('b', 'connected'), entry('a', 'connected'), entry('z', 'available'),
      entry('m', 'available'), entry('n', 'notInstalled')]
    const groups = groupAgentCatalog(entries, ['b', 'z'], options)
    expect(groups.map((group) => [group.id, group.entries.map((item) => item.row.definition.id)])).toEqual([
      ['connected', ['b', 'a']], ['available', ['m', 'z']], ['notInstalled', ['n']]
    ])
  })

  it('omits empty groups, retired Agents, terminals and applications', () => {
    const retired = entry('old', 'available')
    retired.row.definition.availability = 'retired'
    const groups = groupAgentCatalog([retired, entry('term', 'available', 'terminal'), entry('app', 'available', 'application')], [], options)
    expect(groups).toEqual([])
  })

  it('folds a long not-installed group but keeps the selected Agent visible', () => {
    const many = Array.from({ length: 8 }, (_, index) => entry(`agent-${index}`, 'notInstalled'))
    const folded = groupAgentCatalog(many, [], options)[0]
    expect(folded.entries).toHaveLength(FOLDED_AGENT_COUNT)
    expect(folded).toMatchObject({ total: 8, hidden: 8 - FOLDED_AGENT_COUNT })
    const selected = groupAgentCatalog(many, [], { ...options, selectedId: 'agent-7' })[0]
    expect(selected.entries.map((item) => item.row.definition.id)).toContain('agent-7')
    expect(selected.hidden).toBe(8 - FOLDED_AGENT_COUNT - 1)
    expect(groupAgentCatalog(many, [], { ...options, expanded: true })[0]).toMatchObject({ hidden: 0 })
    expect(groupAgentCatalog(many, [], { ...options, search: 'agent' })[0]).toMatchObject({ hidden: 0 })
  })

  it('searches names and ids across groups', () => {
    const groups = groupAgentCatalog([entry('alpha', 'connected'), entry('beta', 'available')], [], { ...options, search: 'BET' })
    expect(groups.map((group) => group.id)).toEqual(['available'])
  })
})

describe('reorderAgents', () => {
  it('moves one Agent inside the visible list and keeps unrelated saved ids', () => {
    expect(reorderAgents(['x', 'a', 'b', 'c'], ['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b', 'x'])
    expect(reorderAgents([], ['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a'])
  })

  it('clamps the target and ignores unknown ids', () => {
    expect(reorderAgents(['a'], ['a', 'b'], 'a', 99)).toEqual(['b', 'a'])
    expect(reorderAgents(['a'], ['a', 'b'], 'ghost', 0)).toEqual(['a'])
  })
})

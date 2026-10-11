import { describe, expect, it } from 'vitest'
import { codingRouteGroups, splitCodingModel } from './coding-agent-route-select-logic'

describe('coding agent route select', () => {
  it('splits vendor prefixes only when both sides exist', () => {
    expect(splitCodingModel('openai/gpt-5.4')).toEqual({ vendor: 'openai', name: 'gpt-5.4' })
    expect(splitCodingModel('gpt-6.1-sol')).toEqual({ vendor: '', name: 'gpt-6.1-sol' })
    expect(splitCodingModel('/odd')).toEqual({ vendor: '', name: '/odd' })
  })

  it('groups by vendor and keeps gateway routes apart', () => {
    const groups = codingRouteGroups([
      { model: 'openai/gpt-5.2', credentialMode: 'native-login' },
      { model: 'anthropic/claude-x', credentialMode: 'native-login' },
      { model: 'openai/gpt-5.4', credentialMode: 'native-login' },
      { model: 'openai/gpt-5.4', credentialMode: 'kun-gateway' }
    ])
    expect(groups.map((group) => [group.label, group.gateway, group.rows.map((row) => row.name)])).toEqual([
      ['openai', false, ['gpt-5.2', 'gpt-5.4']],
      ['anthropic', false, ['claude-x']],
      ['openai', true, ['gpt-5.4']]
    ])
    expect(new Set(groups.flatMap((group) => group.rows.map((row) => row.key))).size).toBe(4)
  })

  it('requires every query word in the model id', () => {
    const routes = [{ model: 'openai/gpt-5.4-mini' }, { model: 'openai/gpt-5.4' }, { model: 'openai/gpt-5.2-codex' }]
    expect(codingRouteGroups(routes, ' 5.4 MINI ').flatMap((group) => group.rows.map((row) => row.route.model))).toEqual(['openai/gpt-5.4-mini'])
    expect(codingRouteGroups(routes, 'claude')).toEqual([])
  })
})

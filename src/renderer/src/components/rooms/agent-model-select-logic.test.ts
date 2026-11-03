import { describe, expect, it } from 'vitest'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import { modelBindingKey } from './agent-client'
import { agentModelPopoverPlacement, agentModelSections, agentProviderLabel, findAgentModelOption } from './agent-model-select-logic'
import type { DirectModelOption } from './room-direct-model-groups'

const option = (model: string, providerId: string | undefined, extra: Partial<DirectModelOption> = {}): DirectModelOption => ({
  model, providerId, accountId: providerId ? `account:${providerId}` : undefined, label: model, providerLabel: providerId ?? 'Kun',
  available: true, groupAvailable: true, fastAvailable: true, ...extra
})

const OPTIONS: DirectModelOption[] = [
  option('gpt-6-sol', 'codex'),
  option('gpt-6-luna', 'codex', { groupAvailable: false }),
  option('grok-4.6', 'cursor-subscription', { available: false, groupAvailable: false, fastAvailable: false, reason: 'agent_scope_unsupported' }),
  option('deepseek-flash', 'deepseek', { fastAvailable: false }),
  option('grok-4.5', 'grok-subscription')
]
const CODE: ModelProviderModelGroup[] = [
  { providerId: 'codex', presetSource: 'codex', label: 'ChatGPT subscription', modelIds: ['gpt-6-sol', 'gpt-6-luna'],
    modelInfo: { 'gpt-6-sol': { id: 'gpt-6-sol', displayName: 'GPT-6 Sol' } } } as ModelProviderModelGroup
]

describe('agentModelSections', () => {
  it('groups by connection with Code labels and sinks unusable connections with one reason', () => {
    const sections = agentModelSections({ options: OPTIONS, codeGroups: CODE, selected: null, role: 'main' })
    expect(sections.available.map((group) => group.label)).toEqual(['ChatGPT subscription', 'deepseek', 'grok-subscription'])
    expect(sections.available[0]!.presetSource).toBe('codex')
    expect(sections.available[0]!.rows.map((row) => [row.label, row.note, row.disabled])).toEqual([
      ['GPT-6 Sol', undefined, false], ['gpt-6-luna', 'privateOnly', false]
    ])
    expect(sections.unavailable).toHaveLength(1)
    expect(sections.unavailable[0]).toMatchObject({ label: 'cursor-subscription', reason: 'scope' })
    expect(sections.unavailable[0]!.rows[0]).toMatchObject({ disabled: true, note: undefined })
    expect(sections.navigable.map((row) => row.option.model)).toEqual(['gpt-6-sol', 'gpt-6-luna', 'deepseek-flash', 'grok-4.5'])
  })

  it('blocks models that cannot run background work for the lightweight role', () => {
    const sections = agentModelSections({ options: OPTIONS, codeGroups: CODE, selected: null, role: 'fast' })
    const deepseek = sections.available.find((group) => group.providerId === 'deepseek')!
    expect(deepseek.rows[0]).toMatchObject({ disabled: true, note: 'noBackground' })
    expect(sections.navigable.some((row) => row.option.model === 'deepseek-flash')).toBe(false)
    expect(sections.available[0]!.rows[1]!.note).toBeUndefined()
  })

  it('filters by model, provider or account and marks the matched range', () => {
    const byModel = agentModelSections({ options: OPTIONS, codeGroups: CODE, selected: null, role: 'main', query: ' SOL ' })
    expect(byModel.available.flatMap((group) => group.rows.map((row) => [row.label, row.match]))).toEqual([['GPT-6 Sol', [6, 9]]])
    const byAccount = agentModelSections({ options: OPTIONS, codeGroups: CODE, selected: null, role: 'main', query: 'account:grok' })
    expect(byAccount.available.flatMap((group) => group.rows.map((row) => row.option.model))).toEqual(['grok-4.5'])
    expect(byAccount.available[0]!.rows[0]!.match).toBeUndefined()
    const byProvider = agentModelSections({ options: OPTIONS, codeGroups: CODE, selected: null, role: 'main', query: 'grok' })
    expect(byProvider.available.map((group) => group.providerId)).toEqual(['grok-subscription'])
    expect(byProvider.unavailable.map((group) => group.providerId)).toEqual(['cursor-subscription'])
    expect(agentModelSections({ options: OPTIONS, codeGroups: CODE, selected: null, role: 'main', query: 'gemini' }))
      .toMatchObject({ available: [], unavailable: [], navigable: [] })
  })

  it('marks the exact selected route', () => {
    const selected = { providerId: 'codex', accountId: 'account:codex', model: 'gpt-6-luna' }
    const sections = agentModelSections({ options: OPTIONS, codeGroups: CODE, selected, role: 'main' })
    expect(sections.available[0]!.rows.map((row) => row.selected)).toEqual([false, true])
    expect(sections.available[0]!.rows[1]!.key).toBe(modelBindingKey(selected))
  })

  it('names the account only when one provider has several', () => {
    const shared = [option('a', 'p', { accountId: 'one' }), option('b', 'p', { accountId: 'two' })]
    expect(agentModelSections({ options: shared, codeGroups: [], selected: null, role: 'main' }).available.map((group) => group.label))
      .toEqual(['p · one', 'p · two'])
    expect(agentProviderLabel({ providerId: 'codex', accountId: 'account:codex' }, OPTIONS, CODE)).toBe('ChatGPT subscription')
  })
})

describe('findAgentModelOption', () => {
  it('matches an account-less inherited binding by provider and model only', () => {
    expect(findAgentModelOption(OPTIONS, { providerId: 'deepseek', model: 'deepseek-flash' })?.accountId).toBe('account:deepseek')
    expect(findAgentModelOption(OPTIONS, { providerId: 'deepseek', accountId: 'other', model: 'deepseek-flash' })).toBeUndefined()
  })
})

describe('agentModelPopoverPlacement', () => {
  const anchor = { left: 100, top: 200, bottom: 252, width: 340 }
  it('opens below at the trigger width', () => {
    expect(agentModelPopoverPlacement({ anchor, contentHeight: 300, viewportWidth: 1200, viewportHeight: 900 }))
      .toEqual({ left: 100, top: 258, width: 340, maxHeight: 520, above: false })
  })
  it('flips above when the space below is too small and keeps a minimum width', () => {
    const placement = agentModelPopoverPlacement({ anchor: { left: 900, top: 600, bottom: 652, width: 200 },
      contentHeight: 400, viewportWidth: 1000, viewportHeight: 760 })
    expect(placement).toMatchObject({ above: true, width: 300, left: 688, maxHeight: 520 })
    expect(placement.top).toBe(600 - 6 - 400)
  })
  it('converts zoomed viewport rects into layout pixels', () => {
    const placement = agentModelPopoverPlacement({ anchor: { left: 82, top: 164, bottom: 205, width: 328 },
      contentHeight: 300, viewportWidth: 984, viewportHeight: 738, scale: 0.82 })
    expect(placement.left).toBeCloseTo(100)
    expect(placement.width).toBeCloseTo(400)
    expect(placement.top).toBeCloseTo(205 / 0.82 + 6)
  })
})

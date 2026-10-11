import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TFunction } from 'i18next'
import { defaultModelProviderSettings, type ModelRoutePoolV1 } from '@shared/app-settings'
import { APP_LOCALES } from '@shared/app-locales'
import { ModelRouteDecisions } from './settings-section-model-routes-rules'

const t = ((key: string) => key) as TFunction

function fixture(patch: Partial<ModelRoutePoolV1> = {}) {
  const settings = defaultModelProviderSettings()
  const base = settings.providers[0]!
  settings.providers = [
    { ...base, id: 'fast', name: 'Fast', models: ['flash'] },
    { ...base, id: 'deep', name: 'Deep', models: ['pro'] },
    { ...base, id: 'native', name: 'Native', kind: 'agent-sdk', models: ['sdk-only'] }
  ]
  const pool: ModelRoutePoolV1 = {
    id: 'pool', name: 'Coding', modelId: 'coding', enabled: true, strategy: 'priority',
    targets: [{ id: 't-fast', providerId: 'fast', modelId: 'flash', enabled: true, weight: 1 },
      { id: 't-deep', providerId: 'deep', modelId: 'pro', enabled: true, weight: 1 }],
    failurePolicy: { failoverHttpStatusCodes: [429], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: false },
    healthPolicy: { failureThreshold: 3, cooldownMs: 60_000, halfOpenMaxAttempts: 1 },
    ...patch
  }
  return { settings, pool }
}

const text = (node: ReactTestInstance): string => node.children.map((child) => typeof child === 'string' ? child : text(child)).join('')
const byLabel = (root: ReactTestInstance, label: string): ReactTestInstance => root.find((node) => node.props['aria-label'] === label)
async function render(pool: ModelRoutePoolV1, settings = fixture().settings, onUpdate = vi.fn()) {
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(createElement(ModelRouteDecisions, { settings, pool, onUpdate, t })) })
  return { root: renderer.root, onUpdate }
}

beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000) })
afterEach(() => vi.restoreAllMocks())

describe('route decisions panel', () => {
  it('offers the manual pick only for the manual strategy', async () => {
    const plain = await render(fixture().pool)
    expect(plain.root.findAll((node) => node.type === 'select' && node.props.value === 't-fast' && !node.props['aria-label'])).toHaveLength(0)
    const { pool } = fixture({ strategy: 'manual' })
    const manual = await render(pool)
    const pick = manual.root.findAll((node) => node.type === 'select')[0]!
    expect(pick.props.value).toBe('t-fast')
    await act(async () => pick.props.onChange({ target: { value: 't-deep' } }))
    expect(manual.onUpdate).toHaveBeenCalledWith({ pick: 't-deep' })
  })
  it('adds a rule for the first member and removes it', async () => {
    const { pool } = fixture()
    const view = await render(pool)
    expect(text(view.root)).toContain('routeRules.empty')
    const add = view.root.find((node) => node.type === 'button' && text(node).includes('routeRules.addRule'))
    await act(async () => add.props.onClick())
    expect(view.onUpdate).toHaveBeenCalledWith({ rules: [{ id: `rule-${(1_700_000_000_000).toString(36)}`, enabled: true, use: 't-fast', when: {} }] })
    const withRule = await render({ ...pool, rules: [{ id: 'r1', enabled: true, use: 't-fast', when: {} }] })
    await act(async () => byLabel(withRule.root, 'routeRules.removeRule').props.onClick())
    expect(withRule.onUpdate).toHaveBeenCalledWith({ rules: [] })
  })
  it('merges rule edits and drops cleared conditions', async () => {
    const { pool } = fixture({ classifier: { providerId: 'fast', modelId: 'flash', intents: ['tests', 'chat'] } })
    const rule = { id: 'r1', enabled: true, use: 't-fast', when: { agents: ['codex'], contains: 'refactor' } }
    const view = await render({ ...pool, rules: [rule] })
    await act(async () => byLabel(view.root, 'routeRules.use').props.onChange({ target: { value: 't-deep' } }))
    expect(view.onUpdate).toHaveBeenLastCalledWith({ rules: [{ ...rule, use: 't-deep' }] })
    const contains = view.root.find((node) => node.type === 'input' && node.props.value === 'refactor')
    await act(async () => contains.props.onChange({ target: { value: '' } }))
    expect(view.onUpdate).toHaveBeenLastCalledWith({ rules: [{ ...rule, when: { agents: ['codex'] } }] })
    const intent = view.root.findAll((node) => node.type === 'select').find((node) =>
      node.findAll((child) => child.type === 'option' && child.props.value === 'tests').length > 0 && node.props.value === '')!
    await act(async () => intent.props.onChange({ target: { value: 'tests' } }))
    expect(view.onUpdate).toHaveBeenLastCalledWith({ rules: [{ ...rule, when: { ...rule.when, intent: 'tests' } }] })
    await act(async () => byLabel(view.root, 'routeRules.minTokens').props.onChange({ target: { value: '-3' } }))
    expect(view.onUpdate).toHaveBeenLastCalledWith({ rules: [{ ...rule }] })
  })
  it('turns the classifier on with default intents, caps intents and turns it off', async () => {
    const { pool, settings } = fixture()
    const view = await render(pool, settings)
    const model = view.root.findAll((node) => node.type === 'select').at(-1)!
    // Delegated providers cannot classify turns.
    expect(model.findAll((node) => node.type === 'option').map((node) => node.props.value)).toEqual(['',
      JSON.stringify(['fast', 'flash']), JSON.stringify(['deep', 'pro'])])
    await act(async () => model.props.onChange({ target: { value: JSON.stringify(['deep', 'pro']) } }))
    expect(view.onUpdate).toHaveBeenLastCalledWith({ classifier: { providerId: 'deep', modelId: 'pro', intents: ['code', 'chat'] } })
    const on = await render({ ...pool, classifier: { providerId: 'deep', modelId: 'pro', intents: ['code'] } }, settings)
    const intents = on.root.find((node) => node.type === 'input' && node.props.placeholder === 'tests, refactor, chat')
    await act(async () => intents.props.onChange({ target: { value: Array.from({ length: 15 }, (_, index) => `i${index}`).join(',') } }))
    expect((on.onUpdate.mock.calls.at(-1)![0] as { classifier: { intents: string[] } }).classifier.intents).toHaveLength(12)
    await act(async () => on.root.findAll((node) => node.type === 'select').at(-1)!.props.onChange({ target: { value: '' } }))
    expect(on.onUpdate).toHaveBeenLastCalledWith({ classifier: undefined })
  })
  it('defaults overflow demotion on and can switch it off', async () => {
    const view = await render(fixture().pool)
    const toggle = byLabel(view.root, 'routeRules.overflow')
    expect(toggle.props.checked ?? toggle.props['aria-checked']).toBe(true)
    await act(async () => (toggle.props.onChange ?? toggle.props.onClick)(false))
    expect(view.onUpdate).toHaveBeenLastCalledWith({ overflowMove: false })
  })
})

describe('route rule locales', () => {
  it('ship the same routeRules keys in every language', async () => {
    const load = async (locale: string) => (await import(`../locales/${locale}/settings/route-rules.json`)).default as Record<string, unknown>
    const keys = (value: unknown, prefix = ''): string[] => typeof value === 'object' && value
      ? Object.entries(value).flatMap(([key, entry]) => keys(entry, `${prefix}${key}.`)) : [prefix.slice(0, -1)]
    const english = keys(await load('en')).sort()
    for (const code of APP_LOCALES) expect(keys(await load(code)).sort(), code).toEqual(english)
  })
})

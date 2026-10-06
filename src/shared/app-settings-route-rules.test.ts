import { describe, expect, it } from 'vitest'
import { normalizeModelRoutePools, projectExecutableModelRoutePools } from './app-settings-provider'
import { normalizeRouteClassifier, normalizeRouteRules } from './app-settings-route-rules'

describe('route rule normalization', () => {
  it('keeps valid rules, drops rules for unknown members and bounds every field', () => {
    const rules = normalizeRouteRules([
      { id: 'tests', use: 'strong', effort: 'max', when: { agents: ['Claude-Code', ''], contains: '  test ', minTokens: -1, hours: { from: 9, to: 18 }, efforts: ['high', 'bogus'] } },
      { id: 'ghost', use: 'missing', when: {} },
      { id: 'tests', use: 'strong', when: {} }
    ], new Set(['strong']))
    expect(rules).toEqual([{ id: 'tests', enabled: true, use: 'strong', effort: 'max',
      when: { agents: ['claude-code'], contains: 'test', hours: { from: 9, to: 18 }, efforts: ['high'] } }])
    expect(normalizeRouteClassifier({ providerId: 'p', modelId: 'm', intents: ['only-one'] })).toBeUndefined()
    expect(normalizeRouteClassifier({ providerId: 'p', modelId: 'm', intents: ['a', 'b', 'a'] })).toEqual({ providerId: 'p', modelId: 'm', intents: ['a', 'b'] })
  })
  it('round-trips manual pick, member effort, overflow and nested members through settings', () => {
    const [outer, inner] = normalizeModelRoutePools([
      { id: 'outer', modelId: 'outer', strategy: 'manual', pick: 'group', overflowMove: false,
        targets: [{ id: 'group', providerId: '@route', modelId: 'inner', enabled: true, weight: 1, effort: 'high' }] },
      { id: 'inner', modelId: 'inner', targets: [{ id: 'x', providerId: 'p', modelId: 'm', enabled: true, weight: 1 }] }
    ] as never)
    expect(outer).toMatchObject({ strategy: 'manual', pick: 'group', overflowMove: false,
      targets: [{ id: 'group', providerId: '@route', modelId: 'inner', effort: 'high' }] })
    const projected = projectExecutableModelRoutePools({ providers: [{ id: 'p', models: ['m'] } as never], routePools: [outer!, inner!] })
    expect(projected[0]!.targets).toHaveLength(1)
    expect(projectExecutableModelRoutePools({ providers: [], routePools: [outer!] })[0]!.enabled).toBe(false)
  })
})

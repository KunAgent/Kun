import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { TFunction } from 'i18next'
import { defaultModelProviderSettings, type ModelRoutePoolV1 } from '@shared/app-settings'
import { ModelRouteTargets } from './settings-section-model-routes-targets'

const t = ((key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key) as TFunction
function fixture() {
  const settings = defaultModelProviderSettings()
  const base = settings.providers[0]
  settings.providers = [
    { ...base, id: 'account/a', name: 'Account A', models: ['model/one', 'model/two'] },
    { ...base, id: 'account/b', name: 'Account B', models: ['model/one'] },
    { ...base, id: 'native', name: 'Native subscription', kind: 'agent-sdk', models: ['native-only'] }
  ]
  const pool: ModelRoutePoolV1 = {
    id: 'pool', name: 'Shared', modelId: 'shared-code', enabled: true, strategy: 'priority',
    targets: [{ id: 'target', providerId: 'account/a', modelId: 'model/one', enabled: true, weight: 1 }],
    failurePolicy: { failoverHttpStatusCodes: [429, 503], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: false },
    healthPolicy: { failureThreshold: 3, cooldownMs: 60_000, halfOpenMaxAttempts: 1 }
  }
  return { settings, pool }
}

describe('gateway account/model target menu', () => {
  it('changes the exact account and model together without changing the public alias', async () => {
    const { settings, pool } = fixture()
    const onUpdate = vi.fn()
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(createElement(ModelRouteTargets, { settings, pool, t, onUpdate })) })
    const menus = renderer.root.findAllByType('select')
    // Account/model first, then the member's pinned reasoning.
    expect(menus).toHaveLength(2)
    await act(async () => menus[0].props.onChange({ target: { value: JSON.stringify(['account/b', 'model/one']) } }))
    expect(onUpdate).toHaveBeenCalledWith({ targets: [{ ...pool.targets[0], providerId: 'account/b' }] })
    expect(pool.modelId).toBe('shared-code')
    onUpdate.mockClear()
    await act(async () => menus[0].props.onChange({ target: { value: JSON.stringify(['native', 'native-only']) } }))
    expect(onUpdate).not.toHaveBeenCalled()
    await act(async () => menus[1].props.onChange({ target: { value: 'max' } }))
    expect(onUpdate).toHaveBeenCalledWith({ targets: [{ ...pool.targets[0], effort: 'max' }] })
    await act(async () => renderer.unmount())
  })

  it('offers other routes as nested members and explains them', async () => {
    const { settings, pool } = fixture()
    const other = { ...pool, id: 'other', name: 'Other route', modelId: 'other-alias' }
    const nested = { ...pool, targets: [{ ...pool.targets[0], providerId: '@route', modelId: 'other-alias' }] }
    const html = renderToStaticMarkup(createElement(ModelRouteTargets, { settings, pool: nested, routes: [nested, other], t, onUpdate: vi.fn() }))
    expect(html).toContain('Other route (other-alias)')
    expect(html).toContain('routeRules.nestedHint')
  })

  it('does not advertise native subscription models as gateway choices', () => {
    const { settings, pool } = fixture()
    const html = renderToStaticMarkup(createElement(ModelRouteTargets, { settings, pool, t, onUpdate: vi.fn() }))
    expect(html).toContain('Account A / model/one')
    expect(html).toContain('Account B / model/one')
    expect(html).not.toContain('native-only')
    expect(html).toContain('in-flight requests keep their route')
  })

  it('preserves a stale native target visibly without offering it as a selectable export', () => {
    const { settings, pool } = fixture()
    pool.targets[0] = { ...pool.targets[0], providerId: 'native', modelId: 'native-only' }
    const html = renderToStaticMarkup(createElement(ModelRouteTargets, { settings, pool, t, onUpdate: vi.fn() }))
    expect(html).toContain('Native subscription / native-only (unavailable for gateway)')
    expect(html).toContain('only through its native Agent')
    expect(html).toContain('disabled="" selected=""')
    expect(pool.targets[0].providerId).toBe('native')
  })
})

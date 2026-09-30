import { createElement } from 'react'
import { act, create as createRenderer, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultModelProviderSettings,
  type ModelProviderSettingsV1
} from '@shared/app-settings'
import i18n from '../i18n'
import { ModelRoutesSettings } from './settings-section-model-routes'

function settings(): ModelProviderSettingsV1 {
  const defaults = defaultModelProviderSettings()
  return {
    ...defaults,
    localGateway: { enabled: true, name: 'Kun API', exposeProviderModels: false },
    routePools: [
      {
        id: 'kimi-pool', name: 'Kimi pool', modelId: 'kimi-auto', enabled: true, strategy: 'adaptive',
        targets: [{ id: 'target', providerId: defaults.providers[0].id, modelId: defaults.providers[0].models[0], enabled: true, weight: 2 }],
        failurePolicy: { failoverHttpStatusCodes: [429, 503], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: true },
        healthPolicy: { failureThreshold: 3, cooldownMs: 60_000, halfOpenMaxAttempts: 1 }
      }
    ]
  }
}

function routeStatus(draft: ModelProviderSettingsV1): string {
  return JSON.stringify({
    localGateway: {
      enabled: draft.localGateway.enabled,
      exposeProviderModels: draft.localGateway.exposeProviderModels
    },
    pools: draft.routePools, configuredPools: draft.routePools,
    metrics: {}, events: [], tests: []
  })
}

function textContent(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : textContent(child)).join('')
}

function stubWindow(
  draft: ModelProviderSettingsV1,
  sections: Record<string, { code: string; message: string }>,
  gatewayCredential: ReturnType<typeof vi.fn>,
  generation = 7
): void {
  vi.stubGlobal('window', {
    kunGui: {
      runtimeRequest: vi.fn(async () => ({ ok: true, status: 200, body: routeStatus(draft) })),
      getRuntimeSettingsSyncStatus: vi.fn(async () => ({
        state: 'synced' as const,
        generation,
        at: '2026-07-22T08:00:07.000Z',
        sections
      })),
      onRuntimeSettingsSyncStatus: vi.fn(() => () => undefined),
      gatewayCredential
    }
  })
}

describe('ModelRoutesSettings gateway section rejection', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await i18n.changeLanguage('en')
  })

  it('shows the localized rejection reason with an ensure fix action', async () => {
    const draft = settings()
    const gatewayCredential = vi.fn(async (action: string) => ({
      ok: true,
      status: 200,
      credential: { configured: action !== 'revoke' }
    }))
    stubWindow(draft, {
      localModelGateway: {
        code: 'gateway_key_missing',
        message: 'local model gateway requires an independent API key'
      }
    }, gatewayCredential)

    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement(ModelRoutesSettings, {
        settings: draft,
        onChange: () => undefined,
        saveStatus: 'saved'
      }))
    })

    const content = textContent(renderer!.root)
    expect(content).toContain('Kun Runtime synced')
    expect(content).toContain('Local gateway is missing its independent API key')
    expect(content).not.toContain('Kun rejected the updated configuration')
    const fix = renderer!.root.findAllByType('button').find((button) => textContent(button).includes('Fix'))
    expect(fix).toBeTruthy()
    await act(async () => { fix!.props.onClick() })
    expect(gatewayCredential).toHaveBeenCalledWith('ensure')

    await act(async () => { renderer!.unmount() })
  })

  it('offers re-enable as the fix action when the gateway was auto-disabled', async () => {
    const draft = { ...settings(), localGateway: { ...settings().localGateway, enabled: false } }
    const gatewayCredential = vi.fn(async (action: string) => ({
      ok: true,
      status: 200,
      credential: { configured: action === 'ensure' || action === 'rotate' }
    }))
    const onChange = vi.fn()
    stubWindow(draft, {
      localModelGateway: {
        code: 'gateway_disabled',
        message: 'gateway turned off because its API key could not be created'
      }
    }, gatewayCredential, 8)

    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement(ModelRoutesSettings, {
        settings: draft,
        onChange,
        saveStatus: 'saved'
      }))
    })

    expect(textContent(renderer!.root)).toContain('Local gateway was turned off (could not create an API key)')
    const fix = renderer!.root.findAllByType('button').find((button) => textContent(button).includes('Fix'))
    expect(fix).toBeTruthy()
    await act(async () => { fix!.props.onClick() })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      localGateway: expect.objectContaining({ enabled: true })
    }))

    await act(async () => { renderer!.unmount() })
  })
})

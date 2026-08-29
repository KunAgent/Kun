import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create as createRenderer, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultModelProviderSettings,
  getModelProviderPreset,
  modelProviderPresetAccountProfile,
  type ModelProviderSettingsV1
} from '@shared/app-settings'
import { APP_LOCALES, type AppLocale } from '@shared/app-locales'
import i18n from '../i18n'
import { ModelRoutesSettings } from './settings-section-model-routes'

function settings(): ModelProviderSettingsV1 {
  const defaults = defaultModelProviderSettings()
  return {
    ...defaults,
    localGateway: { enabled: true, name: 'Kun API' },
    routePools: [
      {
        id: 'kimi-pool', name: 'Kimi pool', modelId: 'kimi-auto', enabled: true, strategy: 'adaptive',
        targets: [{ id: 'target', providerId: defaults.providers[0].id, modelId: defaults.providers[0].models[0], enabled: true, weight: 2 }],
        failurePolicy: { failoverHttpStatusCodes: [429, 503], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: true },
        healthPolicy: { failureThreshold: 3, cooldownMs: 60_000, halfOpenMaxAttempts: 1 }
      },
      {
        id: 'code-pool', name: 'Coding pool', modelId: 'code-auto', enabled: true, strategy: 'priority',
        targets: [{ id: 'code-target', providerId: defaults.providers[0].id, modelId: defaults.providers[0].models[0], enabled: true, weight: 1 }],
        failurePolicy: { failoverHttpStatusCodes: [429, 503], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: true },
        healthPolicy: { failureThreshold: 3, cooldownMs: 60_000, halfOpenMaxAttempts: 1 }
      }
    ]
  }
}

const localRelayProviderLabels: Record<AppLocale, string> = {
  en: 'Local relay provider',
  zh: '本地中转供应商',
  ru: 'Местный поставщик ретрансляции',
  hi: 'स्थानीय रिले प्रदाता',
  th: 'ผู้ให้บริการรีเลย์ท้องถิ่น',
  ja: 'ローカルリレープロバイダー',
  ko: '지역 중계 제공업체'
}

describe('ModelRoutesSettings', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    await i18n.changeLanguage('en')
  })

  it('renders four persistent task tabs with matching panels', () => {
    const html = renderToStaticMarkup(createElement(ModelRoutesSettings, {
      settings: settings(),
      onChange: () => undefined
    }))

    for (const tabId of ['gateway', 'models', 'resilience', 'monitoring']) {
      expect(html).toContain(`id="model-routes-settings-tab-${tabId}"`)
      expect(html).toContain(`aria-controls="model-routes-settings-panel-${tabId}"`)
      expect(html).toContain(`id="model-routes-settings-panel-${tabId}"`)
      expect(html).toContain(`aria-labelledby="model-routes-settings-tab-${tabId}"`)
    }
  })

  it('pauses Runtime polling while its persistent parent panel is hidden', async () => {
    vi.useFakeTimers()
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: '{"localGateway":{"enabled":true},"pools":[],"metrics":{},"events":[]}'
    }))
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement(ModelRoutesSettings, {
        settings: settings(),
        onChange: () => undefined,
        active: false
      }))
    })
    expect(runtimeRequest).not.toHaveBeenCalled()

    await act(async () => {
      renderer.update(createElement(ModelRoutesSettings, {
        settings: settings(),
        onChange: () => undefined,
        active: true
      }))
      await Promise.resolve()
    })
    expect(runtimeRequest).toHaveBeenCalledOnce()

    await act(async () => {
      renderer.update(createElement(ModelRoutesSettings, {
        settings: settings(),
        onChange: () => undefined,
        active: false
      }))
    })
    await act(async () => {
      vi.advanceTimersByTime(1_100)
      await Promise.resolve()
    })
    expect(runtimeRequest).toHaveBeenCalledOnce()

    await act(async () => renderer.unmount())
  })

  it('renders the complete local provider workspace in English', () => {
    const html = renderToStaticMarkup(createElement(ModelRoutesSettings, { settings: settings(), onChange: () => undefined }))
    expect(html).toContain('Local relay provider')
    expect(html).toContain('Kun API')
    expect(html).toContain('2 / 2 models enabled')
    expect(html).toContain('Routed models')
    expect(html).toContain('Kimi pool')
    expect(html).toContain('kimi-auto')
    expect(html).toContain('Coding pool')
    expect(html).toContain('code-auto')
    expect(html).toContain('Add model')
    expect(html).toContain('Stability-first adaptive')
    expect(html).toContain('After streaming output begins')
    expect(html).toContain('Bearer key required; loopback only')
    expect(html).toContain('http://127.0.0.1:18899/v1')
    expect(html).toContain('GET /models')
    expect(html).toContain('POST /chat/completions')
    expect(html).toContain('POST /responses')
    expect(html).not.toMatch(/[\p{Script=Han}]/u)
  })

  it('reacts to a Simplified Chinese locale change without remounting', async () => {
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement(ModelRoutesSettings, {
        settings: settings(),
        onChange: () => undefined,
        active: false
      }))
    })
    expect(textContent(renderer.root)).toContain('Local relay provider')

    await act(async () => {
      await i18n.changeLanguage('zh')
    })

    const localized = textContent(renderer.root)
    expect(localized).toContain('本地中转供应商')
    expect(localized).toContain('2 / 2 个模型已启用')
    expect(localized).toContain('稳定性优先自适应')
    expect(localized).not.toContain('Local relay provider')
    await act(async () => { renderer.unmount() })
  })

  it('reacts to every selectable locale without remounting or fallback copy', async () => {
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement(ModelRoutesSettings, {
        settings: settings(),
        onChange: () => undefined,
        active: false
      }))
    })

    for (const locale of APP_LOCALES) {
      await act(async () => {
        await i18n.changeLanguage(locale)
      })
      expect(textContent(renderer.root)).toContain(localRelayProviderLabels[locale])
    }

    await act(async () => { renderer.unmount() })
  })

  it('uses the parent provider translation consistently when nested i18n state lags', async () => {
    await i18n.changeLanguage('zh')
    const translation = i18n.getFixedT('en', 'settings')
    const html = renderToStaticMarkup(createElement(ModelRoutesSettings, {
      settings: settings(),
      onChange: () => undefined,
      translation
    }))

    expect(html).toContain('Local relay provider')
    expect(html).toContain('Gateway &amp; API')
    expect(html).not.toMatch(/[\p{Script=Han}]/u)
  })

  it('opens a detailed local API dialog with endpoint examples', async () => {
    vi.stubGlobal('window', {
      kunGui: {
        runtimeRequest: vi.fn(async () => ({ ok: true, status: 200, body: '{"localGateway":{"enabled":true},"pools":[],"metrics":{},"events":[]}' }))
      }
    })
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement(ModelRoutesSettings, {
        settings: settings(),
        onChange: () => undefined,
        publicBaseUrl: 'http://127.0.0.1:19999'
      }))
    })

    await act(async () => {
      const button = renderer!.root.findAllByType('button').find((item) => item.children.join('')?.includes('API guide'))
      button!.props.onClick()
    })

    expect(renderer!.root.findByProps({ role: 'dialog' })).toBeDefined()
    const dialogTree = JSON.stringify(renderer!.toJSON())
    expect(dialogTree).toContain('Local API guide')
    expect(dialogTree).toContain('Chat Completions')
    expect(dialogTree).toContain('http://127.0.0.1:19999/v1')
    expect(dialogTree).toContain('/chat/completions')
    expect(dialogTree).toContain('Hello, Kun!')
    expect(dialogTree).not.toMatch(/[\p{Script=Han}]/u)

    await act(async () => { renderer!.unmount() })
  })

  it('keeps every numbered account available as an independent route target', () => {
    const draft = settings()
    const kimi = getModelProviderPreset('kimi-code')!
    const first = modelProviderPresetAccountProfile(kimi, 'api', [])!
    const second = modelProviderPresetAccountProfile(kimi, 'api', [first])!
    draft.providers = [...draft.providers, first, second]
    draft.routePools[0].targets = [
      { id: 'kimi-1', providerId: first.id, modelId: first.models[0], enabled: true, weight: 1 },
      { id: 'kimi-2', providerId: second.id, modelId: second.models[0], enabled: true, weight: 1 }
    ]

    const html = renderToStaticMarkup(createElement(ModelRoutesSettings, { settings: draft, onChange: () => undefined }))
    expect(html).toContain('Kimi Code')
    expect(html).toContain('Kimi Code 2')
    expect(html).toContain('value="kimi-code"')
    expect(html).toContain('value="kimi-code-2"')
  })

  it('dispatches local API and route pool enable switches', async () => {
    const draft = settings()
    draft.localGateway.enabled = false
    draft.routePools[0].enabled = false
    const onChange = vi.fn()
    vi.stubGlobal('window', {
      kunGui: {
        runtimeRequest: vi.fn(async () => ({ ok: true, status: 200, body: '{"pools":[],"metrics":{},"events":[]}' })),
        gatewayCredential: vi.fn(async () => ({ ok: true, status: 200, credential: { configured: true } }))
      }
    })
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement(ModelRoutesSettings, { settings: draft, onChange }))
    })

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': 'Enable local API' }).props.onClick()
    })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      localGateway: expect.objectContaining({ enabled: true })
    }))

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': 'Enable route pool' }).props.onClick()
    })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      routePools: expect.arrayContaining([expect.objectContaining({ id: 'kimi-pool', enabled: true })])
    }))

    await act(async () => { renderer!.unmount() })
  })

  it('shows separate local save and Runtime synchronization states with retry', async () => {
    const draft = settings()
    const onRetrySave = vi.fn()
    vi.stubGlobal('window', {
      kunGui: {
        runtimeRequest: vi.fn(async () => ({ ok: false, status: 503, body: '{"error":{"message":"Kun stopped"}}' }))
      }
    })
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement(ModelRoutesSettings, {
        settings: draft,
        onChange: () => undefined,
        saveStatus: 'error',
        saveError: 'disk write failed',
        onRetrySave
      }))
    })

    const content = textContent(renderer!.root)
    expect(content).toContain('Local save failed')
    expect(content).toContain('Kun Runtime not connected')
    expect(content).toContain('disk write failed')
    const retry = renderer!.root.findAllByType('button').find((button) => textContent(button).includes('Retry save'))
    await act(async () => { retry!.props.onClick() })
    expect(onRetrySave).toHaveBeenCalledOnce()

    await act(async () => { renderer!.unmount() })
  })

  it('keeps missing route references visible and blocks stale chain tests', async () => {
    const draft = settings()
    draft.routePools[0].targets = [{
      id: 'missing-target', providerId: 'removed-provider', modelId: 'removed-model', enabled: true, weight: 1
    }]
    vi.stubGlobal('window', {
      kunGui: {
        runtimeRequest: vi.fn(async () => ({ ok: true, status: 200, body: routeStatus(draft, [], [{ ...draft.routePools[0], enabled: false, targets: [] }, draft.routePools[1]]) }))
      }
    })
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement(ModelRoutesSettings, { settings: draft, onChange: () => undefined, saveStatus: 'saved' }))
    })

    const content = textContent(renderer!.root)
    expect(content).toContain('Provider deleted: removed-provider')
    expect(content).toContain('Original model: removed-model')
    expect(content).toContain('The reference was preserved')
    expect(content).toContain('Fix invalid targets to test')
    expect(content).toContain('no executable target')

    await act(async () => { renderer!.unmount() })
  })

  it('starts an asynchronous full-chain test and renders server-owned progress', async () => {
    const draft = settings()
    const running = testRecord('running')
    let tests: ReturnType<typeof testRecord>[] = []
    const runtimeRequest = vi.fn(async (_path: string, method?: string) => {
      if (method === 'POST') {
        tests = [running]
        return { ok: true, status: 202, body: JSON.stringify({ test: running }) }
      }
      return { ok: true, status: 200, body: routeStatus(draft, tests) }
    })
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement(ModelRoutesSettings, { settings: draft, onChange: () => undefined }))
    })
    const testButton = renderer!.root.findAllByType('button').find((button) => textContent(button).includes('Test complete route'))
    expect(testButton).toBeDefined()

    await act(async () => {
      testButton!.props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(runtimeRequest).toHaveBeenCalledWith('/v1/model-routes/kimi-pool/test', 'POST')
    expect(textContent(renderer!.root)).toContain('Test in progress')
    expect(textContent(renderer!.root)).toContain('Attempted 2 / 2 targets')
    expect(textContent(renderer!.root)).toContain('Testing: provider-backup / kimi-backup')

    await act(async () => { renderer!.unmount() })
  })

  it('restores asynchronous test progress and results after leaving the page', async () => {
    const draft = settings()
    let statusBody = routeStatus(draft, [testRecord('running')])
    const runtimeRequest = vi.fn(async () => ({ ok: true, status: 200, body: statusBody }))
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })

    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement(ModelRoutesSettings, { settings: draft, onChange: () => undefined }))
    })
    expect(textContent(renderer!.root)).toContain('Test in progress')
    expect(textContent(renderer!.root)).toContain('Testing: provider-backup / kimi-backup')
    await act(async () => { renderer!.unmount() })

    statusBody = routeStatus(draft, [testRecord('succeeded')])
    await act(async () => {
      renderer = createRenderer(createElement(ModelRoutesSettings, { settings: draft, onChange: () => undefined }))
    })
    const restored = textContent(renderer!.root)
    expect(restored).toContain('Route test succeeded')
    expect(restored).toContain('Final target: provider-backup / kimi-backup')
    expect(restored).toContain('Model response: OK')
    expect(restored).toContain('Recent test records')

    await act(async () => { renderer!.unmount() })
  })

  it('waits for the saved route pool to reach the runtime before testing', async () => {
    const draft = settings()
    const runtimeRequest = vi.fn(async (_path: string, _method?: string) => ({ ok: true, status: 200, body: routeStatus(draft, [], []) }))
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement(ModelRoutesSettings, { settings: draft, onChange: () => undefined }))
    })

    const testButton = renderer!.root.findAllByType('button').find((button) => textContent(button).includes('Waiting for configuration sync'))
    expect(testButton?.props.disabled).toBe(true)
    expect(textContent(renderer!.root)).toContain('Local configuration was saved and is waiting for Kun Runtime')
    expect(textContent(renderer!.root)).toContain('Waiting for Kun Runtime sync')
    expect(textContent(renderer!.root)).not.toContain('Kun Runtime sync failed')
    expect(runtimeRequest.mock.calls.some((call) => call[1] === 'POST')).toBe(false)

    await act(async () => { renderer!.unmount() })
  })

  it('uses configured pools, not only executable pools, when checking runtime synchronization', async () => {
    const draft = settings()
    draft.routePools[1]!.enabled = false
    vi.stubGlobal('window', {
      kunGui: {
        runtimeRequest: vi.fn(async () => ({
          ok: true,
          status: 200,
          body: routeStatus(draft, [], draft.routePools.filter((pool) => pool.enabled), draft.routePools)
        }))
      }
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement(ModelRoutesSettings, { settings: draft, onChange: () => undefined }))
    })

    expect(textContent(renderer.root)).toContain('Kun Runtime synced')
    expect(textContent(renderer.root)).not.toContain('Waiting for Kun Runtime sync')
    await act(async () => { renderer.unmount() })
  })

  it('keeps invalid alias and failover code drafts local until they pass validation', async () => {
    const draft = settings()
    const onChange = vi.fn()
    vi.stubGlobal('window', {
      kunGui: { runtimeRequest: vi.fn(async () => ({ ok: true, status: 200, body: routeStatus(draft) })) }
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement(ModelRoutesSettings, { settings: draft, onChange }))
    })

    const alias = renderer.root.findByProps({ 'aria-label': 'Public model ID' })
    await act(async () => {
      alias.props.onFocus()
      alias.props.onChange({ target: { value: 'code-auto' } })
    })
    await act(async () => { alias.props.onBlur() })
    expect(onChange).not.toHaveBeenCalled()
    expect(textContent(renderer.root)).toContain('already used by another route')

    const codes = renderer.root.findByProps({ 'aria-label': 'Failover HTTP status codes' })
    await act(async () => {
      codes.props.onFocus()
      codes.props.onChange({ target: { value: '429, 700' } })
    })
    await act(async () => { codes.props.onBlur() })
    expect(onChange).not.toHaveBeenCalled()
    expect(textContent(renderer.root)).toContain('HTTP status codes from 400 to 599')
    await act(async () => { renderer.unmount() })
  })

  it('shows synchronization failure only when the main process reports one', async () => {
    const draft = settings()
    vi.stubGlobal('window', {
      kunGui: {
        runtimeRequest: vi.fn(async () => ({
          ok: true,
          status: 200,
          body: routeStatus(draft, [], [])
        })),
        getRuntimeSettingsSyncStatus: vi.fn(async () => ({
          state: 'failed' as const,
          generation: 4,
          message: 'hot apply rejected the route config',
          at: '2026-07-22T08:00:00.000Z'
        })),
        onRuntimeSettingsSyncStatus: vi.fn(() => () => undefined)
      }
    })

    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement(ModelRoutesSettings, {
        settings: draft,
        onChange: () => undefined,
        saveStatus: 'saved'
      }))
      await Promise.resolve()
    })

    const content = textContent(renderer!.root)
    expect(content).toContain('Kun Runtime sync failed')
    expect(content).toContain('hot apply rejected the route config')
    expect(content).toContain('Local configuration was saved, but Kun Runtime sync failed')

    await act(async () => { renderer!.unmount() })
  })

  it('does not let an older status snapshot overwrite a newer sync event', async () => {
    const draft = settings()
    let resolveSnapshot!: (value: {
      state: 'syncing'
      generation: number
      at: string
    }) => void
    let statusHandler!: (value: {
      state: 'failed'
      generation: number
      message: string
      at: string
    }) => void
    vi.stubGlobal('window', {
      kunGui: {
        runtimeRequest: vi.fn(async () => ({
          ok: true,
          status: 200,
          body: routeStatus(draft, [], [])
        })),
        getRuntimeSettingsSyncStatus: vi.fn(() => new Promise((resolve) => {
          resolveSnapshot = resolve
        })),
        onRuntimeSettingsSyncStatus: vi.fn((handler) => {
          statusHandler = handler
          return () => undefined
        })
      }
    })

    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement(ModelRoutesSettings, {
        settings: draft,
        onChange: () => undefined,
        saveStatus: 'saved'
      }))
    })
    await act(async () => {
      statusHandler({
        state: 'failed',
        generation: 5,
        message: 'latest apply failed',
        at: '2026-07-22T08:00:05.000Z'
      })
      resolveSnapshot({
        state: 'syncing',
        generation: 4,
        at: '2026-07-22T08:00:04.000Z'
      })
      await Promise.resolve()
    })

    expect(textContent(renderer!.root)).toContain('Kun Runtime sync failed')
    expect(textContent(renderer!.root)).toContain('latest apply failed')

    await act(async () => { renderer!.unmount() })
  })
})

function routeStatus(
  draft: ModelProviderSettingsV1,
  tests: ReturnType<typeof testRecord>[] = [],
  pools = draft.routePools,
  configuredPools = pools
): string {
  return JSON.stringify({ localGateway: { enabled: draft.localGateway.enabled }, pools, configuredPools, metrics: {}, events: [], tests })
}

function testRecord(status: 'running' | 'succeeded') {
  const target = { targetId: 'backup-target', providerId: 'provider-backup', modelId: 'kimi-backup' }
  return {
    id: 'route-test-1',
    poolId: 'kimi-pool',
    modelId: 'kimi-auto',
    status,
    createdAt: '2026-07-22T08:00:00.000Z',
    startedAt: '2026-07-22T08:00:00.010Z',
    ...(status === 'succeeded' ? { completedAt: '2026-07-22T08:00:00.200Z', selectedTarget: target, output: 'OK' } : { currentTarget: target }),
    totalTargets: 2,
    attemptedTargets: 2,
    attempts: [
      {
        index: 1,
        targetId: 'primary-target',
        providerId: 'provider-primary',
        modelId: 'kimi-primary',
        status: 'failed',
        startedAt: '2026-07-22T08:00:00.010Z',
        completedAt: '2026-07-22T08:00:00.100Z',
        latencyMs: 90,
        category: 'rate_limit',
        message: '429 quota exhausted'
      },
      {
        index: 2,
        ...target,
        status: status === 'succeeded' ? 'succeeded' : 'running',
        startedAt: '2026-07-22T08:00:00.110Z',
        ...(status === 'succeeded' ? { completedAt: '2026-07-22T08:00:00.200Z', latencyMs: 90 } : {})
      }
    ]
  } as const
}

function textContent(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : textContent(child)).join('')
}

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultModelProviderSettings } from '@shared/app-settings'
import type { ModelRoutePoolV1 } from '@shared/app-settings'
import i18n from '../i18n'
import { useHarnessStore } from '../store/harness-store'
import { GatewayConnectionCenter } from './gateway-connection-center'
import { LocalGatewayApiDialog, buildGatewayModelsCurlExample, buildGatewayMessagesCurlExample, buildGatewayCurlExample } from './settings-section-model-routes-support'

const pool: ModelRoutePoolV1 = { id: 'route', modelId: 'coding', name: 'Coding', enabled: true, strategy: 'priority',
  targets: [{ id: 'target', providerId: 'deepseek', modelId: 'deepseek-chat', enabled: true, weight: 1 }],
  failurePolicy: { failoverHttpStatusCodes: [429], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: false },
  healthPolicy: { failureThreshold: 3, cooldownMs: 60000, halfOpenMaxAttempts: 1 } }
function props() { return { settings: defaultModelProviderSettings(), pools: [pool], baseUrl: 'http://127.0.0.1:18899/v1', synced: true, active: false, tests: [], exportableModelIds: ['coding'], gatewayExportPools: [{ id: pool.id, modelId: pool.modelId, exportable: true, targets: pool.targets.map((target) => ({ ...target, exportable: true })) }], onEditRoute: vi.fn() } }
const text = (node: ReactTestInstance): string => node.children.map((child) => typeof child === 'string' ? child : text(child)).join('')
beforeEach(async () => { await i18n.changeLanguage('en'); useHarnessStore.setState({ rows: [], rowsLoading: false, rowsError: undefined }) })
describe('gateway connection center', () => {
  it('offers the stable alias, implemented clients, and honest status distinctions', () => {
    const html = renderToStaticMarkup(createElement(GatewayConnectionCenter, props()))
    for (const label of ['Codex', 'Claude Code', 'OpenCode', 'Pi', 'coding', 'Native login', 'not tested', 'needs explicit enablement']) expect(html).toContain(label)
    expect(html).not.toContain('value="cursor"'); expect(html).not.toContain('value="gemini-cli"'); expect(html).not.toContain('value="workbuddy"')
    expect(html).toContain('A readiness check does not prove API-key authentication or quota')
  })
  it('will not generate setup for a configured pool absent from authoritative exportability', () => {
    const html = renderToStaticMarkup(createElement(GatewayConnectionCenter, { ...props(), exportableModelIds: [] }))
    expect(html).toContain('eligible API-key target first')
    expect(html).not.toContain('value="route"')
  })
  it('shows only runtime-eligible fallback targets for a mixed public/native alias', () => {
    const mixed = { ...pool, targets: [...pool.targets,
      { id: 'native', providerId: 'native-account', modelId: 'subscription-model', enabled: true, weight: 1 },
      { id: 'unready', providerId: 'missing-key', modelId: 'unready-model', enabled: true, weight: 1 }] }
    const gatewayExportPools = [{ id: mixed.id, modelId: mixed.modelId, exportable: true,
      targets: mixed.targets.map((target) => ({ ...target, exportable: target.id === 'target',
        ...(target.id === 'native' ? { reason: 'native_authentication' } : target.id === 'unready' ? { reason: 'credential_not_ready' } : {}) })) }]
    const html = renderToStaticMarkup(createElement(GatewayConnectionCenter, { ...props(), pools: [mixed], gatewayExportPools }))
    expect(html).toContain('Eligible public targets:')
    expect(html).toContain('deepseek-chat')
    expect(html).toContain('2 configured targets are skipped by the public gateway')
    expect(html).not.toContain('subscription-model')
    expect(html).not.toContain('unready-model')
    expect(html).not.toContain('native-account')
  })
  it('does not infer eligible targets from enabled settings while metadata is unavailable', () => {
    const html = renderToStaticMarkup(createElement(GatewayConnectionCenter, { ...props(), gatewayExportPools: [] }))
    expect(html).toContain('Waiting for authoritative target availability')
    expect(html).not.toContain('deepseek-chat')
  })
  it('honors a fixed parent translator even while global language changes', async () => {
    await i18n.changeLanguage('zh')
    const html = renderToStaticMarkup(createElement(GatewayConnectionCenter, { ...props(), translation: i18n.getFixedT('en', 'settings') }))
    expect(html).not.toMatch(/[\p{Script=Han}]/u)
  })
  it('opens a redacted preview without enabling an agent or invoking inference', async () => {
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(createElement(GatewayConnectionCenter, props())) })
    const button = renderer.root.findAllByType('button').find((node) => text(node) === 'Set up a standalone client')!
    await act(async () => { button.props.onClick() })
    expect(text(renderer.root)).toContain('KUN_GATEWAY_API_KEY')
    expect(text(renderer.root)).not.toContain('Apply reviewed profile')
    expect(text(renderer.root)).toContain('Choose folder and preview')
    expect(text(renderer.root)).not.toContain('kun_local_')
    await act(async () => { renderer.unmount() })
  })
  it('includes authenticated models and Anthropic samples with valid JSON and shell escaping', async () => {
    expect(buildGatewayModelsCurlExample('http://localhost:18899/v1')).toContain('Authorization: Bearer <LOCAL_GATEWAY_API_KEY>')
    const messages = buildGatewayMessagesCurlExample('http://localhost:18899/v1', 'coding')
    expect(messages).toContain('/v1/messages'); expect(messages).toContain('x-api-key: <LOCAL_GATEWAY_API_KEY>')
    expect(messages).toContain('anthropic-version: 2023-06-01'); expect(messages).toContain('"max_tokens": 256')
    expect(buildGatewayCurlExample('http://localhost/v1', 'my"model', i18n.getFixedT('en', 'settings'))).toContain('"model": "my\\"model"')
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(createElement(LocalGatewayApiDialog, { baseUrl: 'http://localhost/v1', modelId: 'coding', copied: false, onClose: vi.fn(), onCopy: vi.fn() })) })
    const button = renderer.root.findAllByType('button').find((node) => text(node).includes('Anthropic Messages'))!
    await act(async () => { button.props.onClick() })
    expect(text(renderer.root)).toContain('anthropic-version: 2023-06-01')
    await act(async () => { renderer.unmount() })
  })
})

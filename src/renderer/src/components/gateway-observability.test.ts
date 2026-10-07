import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultModelProviderSettings } from '@shared/app-settings'
import i18n from '../i18n'
import { GatewayClientLimitBar } from './gateway-client-limit'
import { GatewayDiscoveryRow } from './gateway-discovery-row'
import { GatewayMiddlewarePanel } from './gateway-middleware-panel'
import { GatewayRouteTracePanel, mergeRouteTraces } from './gateway-route-trace-panel'

const t = i18n.getFixedT('en', 'settings')
const text = (node: ReactTestInstance): string => node.children.map((child) => typeof child === 'string' ? child : text(child)).join('')
const ok = (body: unknown) => ({ ok: true, status: 200, body: JSON.stringify(body) })
const trace = (requestId: string, seq: number, extra = {}) => ({ seq, requestId, asked: 'coding', startedAt: '2030-01-01T10:00:00.000Z',
  tries: [{ providerId: 'beta', modelId: 'b1', decision: 'rule' }], done: true, status: 'completed', served: 'beta/b1', decision: 'rule', rule: 'tests', ...extra })

beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(() => { vi.useRealTimers(); delete (globalThis as { window?: unknown }).window })

describe('recent routes', () => {
  it('merges updates by request id, newest first', () => {
    const merged = mergeRouteTraces([trace('a', 1) as never, trace('b', 2) as never], [trace('a', 3, { status: 'failed' }) as never])
    expect(merged.map((item) => [item.requestId, item.status])).toEqual([['a', 'failed'], ['b', 'completed']])
  })
  it('shows asked, served, why and expands the tries; pauses polling', async () => {
    vi.useFakeTimers()
    const runtimeRequest = vi.fn(async (path: string) => path.includes('wait=')
      ? await new Promise<ReturnType<typeof ok>>(() => undefined) : ok({ seq: 4, traces: [trace('r1', 4, {
        tries: [{ providerId: 'alpha', modelId: 'a1', fail: 'rate' }, { providerId: 'beta', modelId: 'b1', decision: 'failover' }], decision: 'failover', rule: undefined,
        agent: 'codex', durationMs: 840 })] }))
    const cancelRuntimeRequest = vi.fn()
    ;(globalThis as { window?: unknown }).window = { kunGui: { runtimeRequest, cancelRuntimeRequest } }
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(createElement(GatewayRouteTracePanel, { active: true, t })) })
    const body = text(renderer.root)
    expect(body).toContain('codex')
    expect(body).toContain('beta/b1')
    expect(body).toContain('Fallback')
    expect(body).toContain('840 ms')
    expect(runtimeRequest).toHaveBeenCalledWith('/v1/model-gateway/route-traces?after=4&wait=15', 'GET', undefined, expect.objectContaining({ priority: 'background' }))
    const row = renderer.root.find((node) => node.type === 'tr' && node.props['aria-expanded'] === false)
    await act(async () => row.props.onClick())
    expect(text(renderer.root)).toContain('a1 failed: rate')
    const pause = renderer.root.find((node) => node.type === 'button' && text(node).includes('Pause'))
    await act(async () => pause.props.onClick())
    expect(cancelRuntimeRequest).toHaveBeenCalled()
    renderer.unmount()
  })
  it('says when recent routes cannot be loaded and clears it once they can', async () => {
    let failing = true
    const runtimeRequest = vi.fn(async (path: string) => path.includes('wait=')
      ? await new Promise<ReturnType<typeof ok>>(() => undefined)
      : failing ? { ok: false, status: 503, body: '{}' } : ok({ seq: 1, traces: [trace('r1', 1)] }))
    ;(globalThis as { window?: unknown }).window = { kunGui: { runtimeRequest, cancelRuntimeRequest: vi.fn() } }
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(createElement(GatewayRouteTracePanel, { active: false, t })) })
    const refresh = renderer.root.find((node) => node.type === 'button' && node.props['aria-label'] === 'Refresh')
    await act(async () => refresh.props.onClick())
    expect(renderer.root.findAll((node) => node.props.role === 'alert').map(text).join('')).toContain('HTTP 503')
    failing = false
    await act(async () => refresh.props.onClick())
    expect(renderer.root.findAll((node) => node.props.role === 'alert')).toHaveLength(0)
    expect(text(renderer.root)).toContain('beta/b1')
    renderer.unmount()
  })
  it('starts over when the runtime counts from zero again', async () => {
    const seqs = [9, 2]
    const runtimeRequest = vi.fn(async () => {
      const seq = seqs.shift() ?? 2
      return ok({ seq, traces: seq === 9 ? [trace('old', 9)] : [trace('new', 2)] })
    })
    ;(globalThis as { window?: unknown }).window = { kunGui: { runtimeRequest, cancelRuntimeRequest: vi.fn() } }
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(createElement(GatewayRouteTracePanel, { active: false, t })) })
    const refresh = renderer.root.find((node) => node.type === 'button' && node.props['aria-label'] === 'Refresh')
    await act(async () => refresh.props.onClick())
    await act(async () => refresh.props.onClick())
    expect(runtimeRequest).toHaveBeenLastCalledWith('/v1/model-gateway/route-traces?after=0', 'GET', undefined, expect.anything())
    const rows = renderer.root.findAll((node) => node.type === 'tr' && node.props['aria-expanded'] !== undefined)
    expect(rows).toHaveLength(1)
    renderer.unmount()
  })
  it('does not poll while the page is hidden', async () => {
    const runtimeRequest = vi.fn()
    ;(globalThis as { window?: unknown }).window = { kunGui: { runtimeRequest } }
    await act(async () => { create(createElement(GatewayRouteTracePanel, { active: false, t })) })
    expect(runtimeRequest).not.toHaveBeenCalled()
  })
})

describe('client limit bar', () => {
  it('shows token and cost usage with reset time and the limited badge', async () => {
    const gatewayClients = vi.fn(async () => ({ ok: true, status: 200, limit: { client: { id: 'gc_1' }, limited: true,
      rate: { requestsPerMinute: 60, burst: 20, maxConcurrent: 2, active: 1 },
      tokenBudget: { mode: 'hard', period: 'day', timeZone: 'UTC', tokens: 1000, used: 1000, left: 0, resetsAt: '2030-01-02T00:00:00.000Z' },
      cost: { period: 'day', timeZone: 'UTC', usd: 2, used: 0.5, left: 1.5, enforce: true, resetsAt: '2030-01-02T00:00:00.000Z' } } }))
    ;(globalThis as { window?: unknown }).window = { kunGui: { gatewayClients } }
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(createElement(GatewayClientLimitBar, { clientId: 'gc_1', active: true, t })) })
    expect(gatewayClients).toHaveBeenCalledWith({ action: 'limit', clientId: 'gc_1' })
    const body = text(renderer.root)
    expect(body).toContain('Limit reached')
    expect(body).toContain('Tokens 1,000 / 1,000 this day')
    expect(body).toContain('Cost $0.50 / $2.00 this day')
    expect(body).toContain('(enforced)')
    expect(body).toContain('1 / 2 in flight')
  })
})

describe('discovery row', () => {
  it('reports the published file and stores the setting only when turned off', async () => {
    const runtimeRequest = vi.fn(async () => ok({ allowed: true, advertised: true, path: '/Users/me/.kun/gateway.json' }))
    ;(globalThis as { window?: unknown }).window = { kunGui: { runtimeRequest } }
    const settings = defaultModelProviderSettings()
    const onChange = vi.fn()
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(createElement(GatewayDiscoveryRow, { settings, onChange, active: true, t })) })
    expect(text(renderer.root)).toContain('Agents on this computer can find the gateway through ~/.kun/gateway.json.')
    const toggle = renderer.root.find((node) => node.props.ariaLabel === 'Publish discovery file' || node.props['aria-label'] === 'Publish discovery file')
    await act(async () => (toggle.props.onChange ?? toggle.props.onClick)(false))
    expect(onChange.mock.calls[0]![0].localGateway.advertiseDiscovery).toBe(false)
    const off = { ...settings, localGateway: { ...settings.localGateway, advertiseDiscovery: false as const } }
    await act(async () => { renderer.update(createElement(GatewayDiscoveryRow, { settings: off, onChange, active: true, t })) })
    expect(text(renderer.root)).toContain('Off. Give agents the gateway address by hand.')
    const on = renderer.root.find((node) => node.props.ariaLabel === 'Publish discovery file' || node.props['aria-label'] === 'Publish discovery file')
    await act(async () => (on.props.onChange ?? on.props.onClick)(true))
    expect('advertiseDiscovery' in onChange.mock.calls[1]![0].localGateway).toBe(false)
  })
})

describe('middleware folder', () => {
  it('shows the folder and scripts, creates the example and opens the folder through Main', async () => {
    const runtimeRequest = vi.fn(async (path: string, method?: string) => path.endsWith('/example') && method === 'POST'
      ? { ok: false, status: 409, body: JSON.stringify({ file: 'example-middleware.js' }) }
      : ok({ middleware: [], directory: '/data/gateway-middleware', files: ['example-middleware.js'] }))
    const openGatewayMiddlewareFolder = vi.fn(async () => ({ ok: true }))
    ;(globalThis as { window?: unknown }).window = { kunGui: { runtimeRequest, openGatewayMiddlewareFolder } }
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(createElement(GatewayMiddlewarePanel, { settings: defaultModelProviderSettings(), onChange: vi.fn(), active: true, t })) })
    expect(text(renderer.root)).toContain('/data/gateway-middleware')
    expect(text(renderer.root)).toContain('example-middleware.js')
    await act(async () => renderer.root.find((node) => node.type === 'button' && text(node).includes('Create example script')).props.onClick())
    expect(text(renderer.root)).toContain('example-middleware.js already exists.')
    await act(async () => renderer.root.find((node) => node.type === 'button' && text(node).includes('Open folder')).props.onClick())
    expect(openGatewayMiddlewareFolder).toHaveBeenCalledTimes(1)
  })
})

describe('usage by session', () => {
  it('groups requests per agent session, busiest first, ignoring requests without one', async () => {
    const { usageBySession } = await import('./gateway-client-usage')
    const groups = usageBySession([
      { timestamp: '2030-01-01T10:00:00Z', sessionId: 's1', promptTokens: 10, completionTokens: 5 },
      { timestamp: '2030-01-01T11:00:00Z', sessionId: 's2', promptTokens: 100, completionTokens: 50 },
      { timestamp: '2030-01-01T12:00:00Z', sessionId: 's1', promptTokens: 1, completionTokens: 1 },
      { timestamp: '2030-01-01T13:00:00Z' }
    ])
    expect(groups).toEqual([{ sessionId: 's2', requests: 1, tokens: 150, last: '2030-01-01T11:00:00Z' },
      { sessionId: 's1', requests: 2, tokens: 17, last: '2030-01-01T12:00:00Z' }])
  })
})

import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GatewayClientCredentials } from './gateway-client-credentials'
import { GatewayClientUsage } from './gateway-client-usage'
import i18n from '../i18n'

const text = (node: ReactTestInstance): string => node.children.map((child) => typeof child === 'string' ? child : text(child)).join('')
const classes = (node: ReactTestInstance): string[] => node.props.className.split(' ')
beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(() => { vi.unstubAllGlobals() })

describe('gateway client details responsive bounds', () => {
  it('wraps a long client identity while preserving the input and actions', async () => {
    const name = 'x'.repeat(80), clientId = `gc_${'a'.repeat(36)}`
    const bridge = vi.fn(async () => ({ ok: true, status: 200, clients: [{ clientId, name, createdAt: '2026-10-04' }] }))
    vi.stubGlobal('window', { kunGui: { gatewayClients: bridge } })
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(createElement(GatewayClientCredentials, { clientName: name, active: true })) })
    const root = renderer.root.findByProps({ 'data-gateway-client-credentials': true })
    for (const token of ['min-w-0', 'grid-cols-1']) expect(classes(root)).toContain(token)
    const identity = root.findAllByType('span').find((node) => text(node).includes(name))!
    for (const token of ['min-w-0', 'max-w-full', 'break-all']) expect(classes(identity)).toContain(token)
    expect(text(identity)).toContain(clientId)
    const input = root.findByType('input')
    expect(input.props.value).toBe(name)
    expect(classes(input)).toContain('min-w-0')
    expect(root.findAllByType('button').map(text)).toEqual(['Create key and copy', 'Read usage', 'Rotate and copy key', 'Revoke', 'Revoke and cancel requests'])
    expect(bridge).toHaveBeenCalledTimes(1)
    expect(bridge).toHaveBeenCalledWith({ action: 'list' })
    await act(async () => { renderer.unmount() })
  })

  it('wraps opaque session/model values and long titles inside a bounded usage track', async () => {
    const clientName = 'x'.repeat(80), model = 'model'.repeat(100), session = `gs_${'f'.repeat(64)}`
    const usage = { clientId: 'gc_client', totalRequests: 1, totalTokens: 1,
      requests: [{ timestamp: '2026-10-04T00:00:00.000Z', requestedModelId: model,
        actualProviderId: 'provider'.repeat(16), actualModelId: model, sessionId: session,
        status: 'completed', tokenUsage: 'upstream', promptTokens: 1, completionTokens: 0 }] }
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(createElement(GatewayClientUsage, { usage, clientName })) })
    const root = renderer.root.findByProps({ 'data-gateway-client-usage': true })
    for (const token of ['min-w-0', 'grid-cols-1']) expect(classes(root)).toContain(token)
    const title = root.findByType('h5')
    expect(classes(title)).toContain('break-words')
    expect(text(title)).toContain(clientName)
    for (const value of [model, session]) {
      const paragraph = root.findAllByType('p').find((node) => text(node).includes(value))!
      expect(classes(paragraph)).toContain('break-all')
    }
    const scroller = root.findAllByType('div').find((node) => classes(node).includes('overflow-y-auto'))!
    for (const token of ['min-w-0', 'max-w-full']) expect(classes(scroller)).toContain(token)
    await act(async () => { renderer.unmount() })
  })
})

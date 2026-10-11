import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { defaultModelProviderSettings } from '@shared/app-settings'
import i18n from '../i18n'
import { GatewayMiddlewarePanel } from './gateway-middleware-panel'

const t = i18n.getFixedT('en', 'settings')
const text = (node: ReactTestInstance): string => node.children.map((child) => typeof child === 'string' ? child : text(child)).join('')

describe('gateway middleware panel', () => {
  it('explains the empty state and adds the chosen middleware', async () => {
    const settings = defaultModelProviderSettings()
    const onChange = vi.fn()
    ;(globalThis as { window?: unknown }).window = { kunGui: { runtimeRequest: vi.fn(async () => ({ ok: true, body: '{"middleware":[]}' })) } }
    let renderer!: ReturnType<typeof create>
    await act(async () => { renderer = create(createElement(GatewayMiddlewarePanel, { settings, onChange, active: true, t })) })
    expect(text(renderer.root)).toContain('No middleware')
    const add = renderer.root.findAll((node) => node.type === 'button' && text(node).includes('Add'))[0]!
    await act(async () => { add.props.onClick() })
    expect(onChange.mock.calls[0]![0].localGateway.middleware[0]).toMatchObject({ type: 'model-map', enabled: true })
  })
  it('shows counters and failures for configured entries', () => {
    const settings = { ...defaultModelProviderSettings() }
    settings.localGateway = { ...settings.localGateway, middleware: [{ id: 'tags', enabled: true, type: 'think-tags', mode: 'reasoning' }] }
    const html = renderToStaticMarkup(createElement(GatewayMiddlewarePanel, { settings, onChange: vi.fn(), active: false, t }))
    expect(html).toContain('Think tags')
    expect(html).toContain('Move &lt;think&gt; text into reasoning')
  })
})

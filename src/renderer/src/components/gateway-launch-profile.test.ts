import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildGatewayClientSetup } from '@shared/gateway-client-setup'
import { GatewayLaunchProfile } from './gateway-launch-profile'
import i18n from '../i18n'
const text = (node: ReactTestInstance): string => node.children.map((child) => typeof child === 'string' ? child : text(child)).join('')
const button = (renderer: ReactTestRenderer, label: string) => renderer.root.findAllByType('button').find((node) => text(node) === label)!
beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(() => { vi.unstubAllGlobals() })
describe('explicit isolated profile controls', () => {
  it('requires separate folder/preview and apply actions and then exposes restore', async () => {
    const setup = buildGatewayClientSetup('codex', 'http://localhost:18899', 'coding')
    const preview = { planId: 'review-token', path: '/chosen/.kun-gateway/codex/config.toml', before: '', after: setup.content!, launch: setup.launch, canRestore: false }
    const bridge = vi.fn(async (request: { action: string }) => request.action === 'restore' ? { ok: true, restored: true }
      : { ok: true, preview: { ...preview, ...(request.action === 'apply' ? { applied: true, canRestore: true } : {}) } })
    vi.stubGlobal('window', { kunGui: { gatewayLaunchProfile: bridge } })
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(createElement(GatewayLaunchProfile, { setup })) })
    expect(bridge).not.toHaveBeenCalled()
    expect(renderer.root.findAllByType('pre')).toHaveLength(0)
    await act(async () => { await button(renderer, 'Choose folder and preview').props.onClick() })
    expect(bridge).toHaveBeenCalledWith({ action: 'preview', clientId: 'codex', baseUrl: 'http://localhost:18899/v1', modelId: 'coding' })
    expect(bridge).toHaveBeenCalledTimes(1)
    expect(button(renderer, 'Restore previous profile').props.disabled).toBe(true)
    await act(async () => { await button(renderer, 'Apply reviewed profile').props.onClick() })
    expect(bridge).toHaveBeenLastCalledWith({ action: 'apply', planId: 'review-token' })
    expect(button(renderer, 'Apply reviewed profile').props.disabled).toBe(true)
    expect(button(renderer, 'Restore previous profile').props.disabled).toBe(false)
    await act(async () => { await button(renderer, 'Restore previous profile').props.onClick() })
    expect(bridge).toHaveBeenLastCalledWith({ action: 'restore', planId: 'review-token' })
    expect(text(renderer.root)).toContain('Previous profile restored')
    await act(async () => { renderer.unmount() })
  })
  it('bounds reviewed long configuration columns and the launch command without truncating their contents', async () => {
    const setup = buildGatewayClientSetup('pi', 'http://localhost:18899', `coding-${'long-alias-'.repeat(40)}`)
    const preview = { planId: 'review', path: '/chosen/profile', before: setup.content!, after: setup.content!, launch: setup.launch, canRestore: true }
    const bridge = vi.fn(async () => ({ ok: true, preview }))
    vi.stubGlobal('window', { kunGui: { gatewayLaunchProfile: bridge } })
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(createElement(GatewayLaunchProfile, { setup })) })
    await act(async () => { await button(renderer, 'Choose folder and preview').props.onClick() })
    const profile = renderer.root.findByProps({ 'data-gateway-launch-profile': true })
    for (const token of ['min-w-0', 'grid-cols-1']) expect(profile.props.className.split(' ')).toContain(token)
    const columns = renderer.root.findAllByType('div').find((node) => node.props.className?.includes('lg:grid-cols-2'))!
    for (const token of ['min-w-0', 'grid-cols-1']) expect(columns.props.className.split(' ')).toContain(token)
    const snippets = renderer.root.findAllByType('pre')
    expect(snippets.map(text)).toEqual([preview.before, preview.after, preview.launch])
    for (const snippet of snippets) {
      for (const token of ['min-w-0', 'max-w-full', 'overflow-x-auto']) expect(snippet.props.className.split(' ')).toContain(token)
      expect(snippet.parent!.props.className.split(' ')).toContain('min-w-0')
    }
    expect(bridge).toHaveBeenCalledTimes(1)
    await act(async () => { renderer.unmount() })
  })
  it('invalidates the reviewed file when the client alias changes', async () => {
    const setup = buildGatewayClientSetup('pi', 'http://localhost:18899', 'coding')
    const bridge = vi.fn(async () => ({ ok: true, preview: { planId: 'old', path: '/chosen/profile', before: '', after: setup.content!, launch: setup.launch, canRestore: false } }))
    vi.stubGlobal('window', { kunGui: { gatewayLaunchProfile: bridge } })
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(createElement(GatewayLaunchProfile, { setup })) })
    await act(async () => { await button(renderer, 'Choose folder and preview').props.onClick() })
    await act(async () => { renderer.update(createElement(GatewayLaunchProfile, { setup: buildGatewayClientSetup('pi', 'http://localhost:18899', 'fast') })) })
    expect(text(renderer.root)).not.toContain('Apply reviewed profile')
    expect(bridge).toHaveBeenCalledTimes(1)
    await act(async () => { renderer.unmount() })
  })
})

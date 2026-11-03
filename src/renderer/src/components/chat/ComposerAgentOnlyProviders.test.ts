// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withHarnessReadiness } from '@shared/test-support/harness-readiness'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import i18n from '../../i18n'
import { useHarnessStore } from '../../store/harness-store'
import { agentHarnessIdForProviderKind, isKunModelProviderGroup } from '../../lib/kun-model-provider-groups'
import { ComposerAgentOnlyProviders } from './ComposerAgentOnlyProviders'
import { FloatingComposerModelPicker } from './FloatingComposerModelPicker'

const cursorRow = (ready: boolean): AdeHarnessRow => {
  const row = {
    definition: { builtin: true, id: 'cursor', displayName: 'Cursor', transport: 'cursor-sdk',
      credentialModes: ['provider'], modelSource: 'provider', staticModels: [], permissionModes: [] },
    status: { harnessId: 'cursor', checkedAt: '2026-10-18T00:00:00Z', installed: 'yes', ready: 'yes', login: 'unknown' }
  } as unknown as AdeHarnessRow
  return ready ? withHarnessReadiness(row) : { ...row, enabled: false, enabledProfiles: [], readyProfiles: [] }
}
const cursorGroup: ModelProviderModelGroup = { providerId: 'cursor-subscription', label: 'Cursor subscription',
  kind: 'cursor-sdk', modelIds: ['auto', 'composer-2.5', 'grok-4.6', 'grok-4.7'] }

let host: HTMLDivElement
let root: Root
beforeEach(async () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  await i18n.changeLanguage('en')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  useHarnessStore.setState({ rows: [] })
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false
})

const render = async (props: Partial<Parameters<typeof ComposerAgentOnlyProviders>[0]> = {}) => {
  const callbacks = { needsConfirm: vi.fn(() => false), onSwitch: vi.fn(), onManage: vi.fn(), close: vi.fn() }
  await act(async () => root.render(createElement(ComposerAgentOnlyProviders, { groups: [cursorGroup], ...callbacks, ...props })))
  return callbacks
}

describe('agent-only providers in the Kun model picker', () => {
  it('maps every agent-only provider kind to the Agent that runs it', () => {
    expect(agentHarnessIdForProviderKind('cursor-sdk')).toBe('cursor')
    expect(agentHarnessIdForProviderKind('agent-sdk')).toBe('claude-code')
    expect(agentHarnessIdForProviderKind('antigravity-cli')).toBe('antigravity')
    expect(agentHarnessIdForProviderKind('http')).toBeUndefined()
    expect(isKunModelProviderGroup(cursorGroup)).toBe(false)
    expect(isKunModelProviderGroup({ kind: 'http' })).toBe(true)
  })

  it('names a Cursor subscription whose Agent is not enabled and opens its settings', async () => {
    useHarnessStore.setState({ rows: [cursorRow(false)] })
    const callbacks = await render()
    expect(host.textContent).toContain('Cursor subscription')
    expect(host.textContent).toContain('Cursor Agent is not enabled yet')
    expect(host.querySelector('[data-agent-only-switch]')).toBeNull()
    await act(async () => host.querySelector<HTMLButtonElement>('[data-agent-only-enable="cursor"]')!.click())
    expect(callbacks.close).toHaveBeenCalled()
    expect(callbacks.onManage).toHaveBeenCalledWith('cursor')
  })

  it('switches to a ready Cursor Agent, confirming first in a started conversation', async () => {
    useHarnessStore.setState({ rows: [cursorRow(true)] })
    const fresh = await render()
    expect(host.textContent).toContain('Runs in the Cursor Agent')
    await act(async () => host.querySelector<HTMLButtonElement>('[data-agent-only-switch="cursor"]')!.click())
    expect(fresh.onSwitch).toHaveBeenCalledWith('cursor')

    const started = await render({ needsConfirm: vi.fn(() => true) })
    await act(async () => host.querySelector<HTMLButtonElement>('[data-agent-only-switch="cursor"]')!.click())
    expect(started.onSwitch).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Cursor?')
    await act(async () => host.querySelector<HTMLButtonElement>('[data-agent-only-confirm]')!.click())
    expect(started.onSwitch).toHaveBeenCalledWith('cursor')
  })

  it('renders nothing for Kun model providers', async () => {
    await render({ groups: [{ providerId: 'deepseek', label: 'DeepSeek', kind: 'http', modelIds: ['deepseek-chat'] }] })
    expect(host.querySelector('[data-composer-agent-only-providers]')).toBeNull()
  })

  it('keeps the configure-providers footer next to the notice', async () => {
    useHarnessStore.setState({ rows: [cursorRow(false)] })
    await act(async () => root.render(createElement(FloatingComposerModelPicker, {
      compact: false, mode: 'select', composerModel: 'deepseek-chat', composerProviderId: 'deepseek',
      composerPickList: ['deepseek-chat'],
      composerModelGroups: [{ providerId: 'deepseek', label: 'DeepSeek', kind: 'http', modelIds: ['deepseek-chat'] }],
      canChangeModel: true, onComposerModelChange: vi.fn(), onConfigureProviders: vi.fn(),
      renderNotice: (close: () => void) => createElement(ComposerAgentOnlyProviders, { groups: [cursorGroup],
        needsConfirm: () => false, onSwitch: vi.fn(), onManage: vi.fn(), close })
    })))
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!.click())
    const panel = document.querySelector('[data-composer-model-panel]')!
    expect(panel.querySelector('[data-agent-only-provider="cursor-subscription"]')).not.toBeNull()
    expect(panel.textContent).toContain(i18n.t('composerConfigureProviders', { ns: 'common' }))
  })
})

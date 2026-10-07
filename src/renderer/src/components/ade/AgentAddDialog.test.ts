// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import type { KunHarnessSettingsV1 } from '@shared/app-settings'
import { useHarnessStore } from '../../store/harness-store'

const provider = vi.hoisted(() => ({ probeHarnessDefinition: vi.fn(), listHarnesses: vi.fn(), storeHarnessSecret: vi.fn(), deleteHarnessSecret: vi.fn() }))
vi.mock('../../agent/registry', () => ({ getProvider: () => provider }))
import { AgentAddDialog } from './AgentAddDialog'

const settings: KunHarnessSettingsV1 = { enabledProfiles: [], disabledIds: [], providers: {}, defaults: {}, defaultHarnessId: 'kun', agentOrder: [] }
const opencode = { definition: { id: 'opencode', displayName: 'OpenCode', transport: 'acp' as const, credentialModes: ['native-login' as const], permissionModes: [],
  modelSource: 'probe' as const, staticModels: [], builtin: true, launch: { command: 'opencode', args: ['acp'] } },
status: { harnessId: 'opencode', installed: 'yes' as const, login: 'unknown' as const, checkedAt: '' } }

let root: Root, host: HTMLDivElement
const onClose = vi.fn(), onSelectAgent = vi.fn(), updateKun = vi.fn()
const mount = async (surface = false) => act(async () => root.render(createElement(AgentAddDialog, { settings, updateKun, onClose, onSelectAgent, settingsSurface: surface })))
const query = <T extends Element>(selector: string): T | null => document.querySelector<T>(selector)
const click = async (selector: string): Promise<void> => { await act(async () => query<HTMLElement>(selector)!.click()) }
const type = async (input: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> => {
  await act(async () => {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks(); window.sessionStorage.clear()
  provider.listHarnesses.mockResolvedValue([opencode])
  provider.probeHarnessDefinition.mockResolvedValue({ durationMs: 12, ok: true, supported: true, agent: { name: 'Fork', version: '1' } })
  useHarnessStore.setState({ rows: [opencode] })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ''; window.sessionStorage.clear(); vi.unstubAllGlobals() })

describe('AgentAddDialog', () => {
  it('offers three ways to add an Agent and never lists the built-in ones', async () => {
    await mount()
    expect([...document.querySelectorAll('[data-agent-add-kind]')].map((el) => el.getAttribute('data-agent-add-kind'))).toEqual(['derive', 'acp', 'import'])
    expect(query('[data-agent-add-select]')).toBeNull()
    expect(query('[data-agent-add-kind="derive"]')?.getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement?.getAttribute('data-agent-add-kind')).toBe('derive')
  })

  it('scopes the portal styling to a Settings host only', async () => {
    await mount()
    expect(query('[data-agent-add-wizard]')!.className).not.toContain('ds-settings-surface')
    await act(async () => root.unmount()); root = createRoot(host)
    await mount(true)
    expect(query('[data-agent-add-wizard]')!.className).toContain('ds-settings-surface')
  })

  it('derives from a built-in engine: the base is required and starts on the first engine', async () => {
    await mount()
    await click('[data-agent-add-next]')
    expect(query('[data-agent-custom-form]')?.getAttribute('data-agent-custom-mode')).toBe('derive')
    expect(query('[data-agent-custom-base]')).not.toBeNull()
    await vi.waitFor(() => expect(query('[data-agent-custom-base]')!.textContent).toContain('OpenCode'))
    await click('[data-agent-add-back]')
    expect(query('[data-agent-add-choose]')).not.toBeNull()
  })

  it('adds a generic ACP Agent without a base and selects it once saved', async () => {
    await mount()
    await click('[data-agent-add-kind="acp"]')
    await click('[data-agent-add-next]')
    expect(query('[data-agent-custom-base]')).toBeNull()
    const inputs = document.querySelectorAll<HTMLInputElement>('[data-agent-custom-form] input')
    await type(inputs[0]!, 'My Agent'); await type(inputs[1]!, '/bin/my-agent')
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-agent-custom-form] button')]
    const label = (text: string) => buttons.find((button) => button.textContent?.includes(text))!
    expect(label('Add agent').disabled).toBe(true)
    await act(async () => label('Test connection').click())
    expect(provider.probeHarnessDefinition).toHaveBeenCalledWith(expect.not.objectContaining({ extends: expect.anything() }), expect.anything())
    await act(async () => label('Add agent').click())
    expect(updateKun).toHaveBeenCalledWith({ harnesses: expect.objectContaining({ providers: { 'custom-my-agent': expect.objectContaining({ extends: 'acp', command: '/bin/my-agent' }) } }) })
    expect(onSelectAgent).toHaveBeenCalledWith('custom-my-agent')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('starts the import path with a file chooser', async () => {
    await mount()
    await click('[data-agent-add-kind="import"]')
    await click('[data-agent-add-next]')
    expect(query('[data-agent-custom-form]')?.getAttribute('data-agent-custom-mode')).toBe('import')
    expect(query('[data-agent-import-pick]')).not.toBeNull()
    expect(provider.probeHarnessDefinition).not.toHaveBeenCalled()
  })

  it('remembers the form step across a reload and drops an unknown saved state', async () => {
    await mount()
    await click('[data-agent-add-kind="acp"]'); await click('[data-agent-add-next]')
    await act(async () => root.unmount()); root = createRoot(host)
    await mount()
    expect(query('[data-agent-custom-form]')?.getAttribute('data-agent-custom-mode')).toBe('acp')
    await act(async () => root.unmount()); root = createRoot(host)
    window.sessionStorage.setItem('kun-agent-add-dialog-v1', JSON.stringify({ step: 'form', kind: 'terminal' }))
    await mount()
    expect(query('[data-agent-add-choose]')).not.toBeNull()
  })

  it('closes on Escape and from the close button', async () => {
    await mount()
    await act(async () => { query('[data-agent-add-wizard]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(onClose).toHaveBeenCalledTimes(1)
    await click('[data-agent-add-close]')
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('restores typed command fields after a reload without persisting the secret value', async () => {
    await mount()
    await click('[data-agent-add-kind="acp"]'); await click('[data-agent-add-next]')
    const fields = document.querySelectorAll<HTMLInputElement>('[data-agent-custom-form] input')
    await type(fields[0]!, 'My Agent'); await type(fields[1]!, '/usr/bin/my-agent'); await type(fields[4]!, 'super-secret')
    await act(async () => root.unmount()); root = createRoot(host)
    await mount()
    const restored = document.querySelectorAll<HTMLInputElement>('[data-agent-custom-form] input')
    expect(restored[0]?.value).toBe('My Agent')
    expect(restored[1]?.value).toBe('/usr/bin/my-agent')
    expect(restored[4]?.value ?? '').toBe('')
    expect(window.sessionStorage.getItem('kun-agent-custom-draft-v1') ?? '').not.toContain('super-secret')
  })
})

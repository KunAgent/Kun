import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UninstallStatus } from '@shared/uninstall'
import i18n from '../i18n'
import { UninstallSettingsSection } from './settings-section-uninstall'

function textContent(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : textContent(child)).join('')
}

function status(overrides: Partial<UninstallStatus> = {}): UninstallStatus {
  return {
    schemaVersion: 1,
    platform: 'darwin',
    isPackaged: true,
    canRemoveApp: true,
    removeAppMode: 'bundle',
    removeAppTarget: '/Applications/Kun.app',
    appInstallPath: '/Applications/Kun.app',
    paths: [
      { kind: 'userData', path: '/Users/Alice/Library/Application Support/Kun', exists: true },
      { kind: 'kunData', path: '/Users/Alice/.kun/data', exists: true },
      { kind: 'legacyKunData', path: '/Users/Alice/.deepseekgui/kun', exists: false }
    ],
    ...overrides
  }
}

function api(overrides: Record<string, unknown> = {}) {
  return {
    getStatus: vi.fn(async () => status()),
    perform: vi.fn(async () => ({
      scheduled: true as const,
      operationId: '123e4567-e89b-42d3-a456-426614174000',
      pathCount: 2,
      removeAppMode: 'bundle' as const,
      cleanupScriptPath: '/tmp/kun-uninstall-x/cleanup.sh'
    })),
    ...overrides
  }
}

function findButton(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const button = renderer.root.findAllByType('button').find((node) => textContent(node).includes(label))
  if (!button) throw new Error(`button not found: ${label}`)
  return button
}

function findInput(renderer: ReactTestRenderer, id: string): ReactTestInstance {
  const input = renderer.root.findAllByType('input').find((node) => node.props.id === id)
  if (!input) throw new Error(`input not found: ${id}`)
  return input
}

/**
 * Checkbox order in the component: 0 = deleteAllData, 1 = removeApp, and once
 * the confirmation dialog is open, 2 = acknowledged.
 */
function checkbox(renderer: ReactTestRenderer, index: number): ReactTestInstance {
  const boxes = renderer.root.findAllByType('input').filter((node) => node.props.type === 'checkbox')
  const box = boxes[index]
  if (!box) throw new Error(`checkbox #${index} not found`)
  return box
}

describe('UninstallSettingsSection', () => {
  beforeEach(async () => { await i18n.changeLanguage('en') })
  afterEach(() => vi.unstubAllGlobals())

  it('shows the paths that would be deleted and the app removal mode', async () => {
    vi.stubGlobal('window', { kunGui: { uninstall: api() } })
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(createElement(UninstallSettingsSection)) })
    const text = textContent(renderer.root)
    expect(text).toContain('/Users/Alice/Library/Application Support/Kun')
    expect(text).toContain('/Users/Alice/.kun/data')
    expect(text).not.toContain('/Users/Alice/.deepseekgui/kun')
    expect(text).toContain('/Applications/Kun.app')
    expect(text).toContain('Uninstall Kun')
  })

  it('requires acknowledgement and the typed word before calling perform', async () => {
    const uninstall = api()
    vi.stubGlobal('window', { kunGui: { uninstall } })
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(createElement(UninstallSettingsSection)) })
    await act(async () => { await findButton(renderer, 'Uninstall Kun').props.onClick() })
    const confirm = findButton(renderer, 'Confirm uninstall')
    expect(confirm.props.disabled).toBe(true)

    // Acknowledge only: still disabled.
    await act(async () => { checkbox(renderer, 2).props.onChange({ target: { checked: true } }) })
    expect(confirm.props.disabled).toBe(true)

    // Wrong word: still disabled.
    await act(async () => {
      findInput(renderer, 'uninstall-confirm-word').props.onChange({ target: { value: 'UNINSTAL' } })
    })
    expect(confirm.props.disabled).toBe(true)

    // Correct word: enabled and performs with the default options.
    await act(async () => {
      findInput(renderer, 'uninstall-confirm-word').props.onChange({ target: { value: 'UNINSTALL' } })
    })
    expect(confirm.props.disabled).toBe(false)
    await act(async () => { await confirm.props.onClick() })
    expect(uninstall.perform).toHaveBeenCalledWith({ deleteAllData: true, removeApp: true })
    expect(textContent(renderer.root)).toContain('Uninstalling…')
  })

  it('names the confirmation dialog and cancels Escape without authorizing removal', async () => {
    const uninstall = api()
    vi.stubGlobal('window', { kunGui: { uninstall } })
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(createElement(UninstallSettingsSection)) })
    await act(async () => { findButton(renderer, 'Uninstall Kun').props.onClick() })
    const dialog = renderer.root.findByProps({ role: 'dialog' })
    expect(dialog.props['aria-modal']).toBe('true')
    expect(dialog.props['aria-label']).toBeTruthy()
    expect(dialog.props.style.margin).toBe(0)
    expect(renderer.root.findAllByProps({ 'data-uninstall-cancel': true })).toHaveLength(1)
    await act(async () => {
      dialog.props.onKeyDown({ key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() })
    })
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
    expect(uninstall.perform).not.toHaveBeenCalled()
  })

  it('hides the app-removal checkbox and shows the hint when the app cannot be removed', async () => {
    vi.stubGlobal('window', { kunGui: { uninstall: api({
      getStatus: vi.fn(async () => status({
        canRemoveApp: false,
        removeAppMode: 'none',
        appRemovalHint: 'sudo dpkg -r <package>'
      }))
    }) } })
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(createElement(UninstallSettingsSection)) })
    const text = textContent(renderer.root)
    expect(text).not.toContain('Remove the application itself')
    expect(text).toContain('sudo dpkg -r <package>')
  })

  it('passes unchecked options when the user disables both destructive steps', async () => {
    const uninstall = api()
    vi.stubGlobal('window', { kunGui: { uninstall } })
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(createElement(UninstallSettingsSection)) })
    await act(async () => { checkbox(renderer, 0).props.onChange({ target: { checked: false } }) })
    await act(async () => { checkbox(renderer, 1).props.onChange({ target: { checked: false } }) })
    await act(async () => { await findButton(renderer, 'Uninstall Kun').props.onClick() })
    await act(async () => { checkbox(renderer, 2).props.onChange({ target: { checked: true } }) })
    await act(async () => {
      findInput(renderer, 'uninstall-confirm-word').props.onChange({ target: { value: 'UNINSTALL' } })
    })
    await act(async () => { await findButton(renderer, 'Confirm uninstall').props.onClick() })
    expect(uninstall.perform).toHaveBeenCalledWith({ deleteAllData: false, removeApp: false })
  })

  it('surfaces main-process errors in the section', async () => {
    vi.stubGlobal('window', { kunGui: { uninstall: api({
      getStatus: vi.fn(async () => { throw new Error('cannot_remove_app: Not packaged') })
    }) } })
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(createElement(UninstallSettingsSection)) })
    expect(textContent(renderer.root)).toContain('cannot_remove_app')
  })
})

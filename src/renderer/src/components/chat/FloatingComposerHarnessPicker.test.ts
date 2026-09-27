import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { FloatingComposerHarnessPicker } from './FloatingComposerHarnessPicker'

function row(
  id: string,
  displayName: string,
  status: Partial<AdeHarnessRow['status']> = {}
): AdeHarnessRow {
  return {
    definition: {
      id,
      displayName,
      transport: id === 'kun' ? 'native-loop' : 'agent-sdk',
      credentialModes: ['native-login'],
      permissionModes: [],
      modelSource: 'static',
      staticModels: [],
      builtin: id === 'kun'
    },
    status: {
      harnessId: id,
      installed: 'yes',
      login: 'signed-in',
      checkedAt: '2026-01-01T00:00:00Z',
      ...status
    }
  }
}

const rows = [
  row('kun', 'Kun'),
  row('claude-code', 'Claude Code'),
  row('cursor', 'Cursor', { installed: 'no' }),
  row('codex', 'Codex', { installed: 'yes', login: 'signed-out' })
]

function textOf(root: ReactTestRenderer): string {
  const collect = (node: unknown): string => {
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(collect).join('')
    if (node && typeof node === 'object' && 'children' in (node as { children?: unknown[] })) {
      return collect((node as { children?: unknown[] }).children)
    }
    return ''
  }
  return collect(root.toJSON())
}

async function renderPicker(props: {
  needsConfirm?: (id: string) => boolean
  onSelect?: (id: string) => void
  onContinueLocalSession?: () => void
}): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(FloatingComposerHarnessPicker, {
      harnessId: 'kun',
      harnessLabel: 'Kun',
      rows,
      loading: false,
      needsConfirm: props.needsConfirm ?? (() => false),
      ...(props.onContinueLocalSession
        ? { onContinueLocalSession: props.onContinueLocalSession }
        : {}),
      onSelect: props.onSelect ?? vi.fn()
    }))
  })
  return renderer
}

async function openMenu(renderer: ReactTestRenderer): Promise<void> {
  const trigger = renderer.root.findByProps({ 'data-composer-harness-picker': true })
  await act(async () => {
    trigger.props.onClick()
  })
}

beforeEach(() => {
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  })
})

describe('FloatingComposerHarnessPicker', () => {
  it('disables unavailable harnesses and surfaces the reason', async () => {
    const renderer = await renderPicker({})
    await openMenu(renderer)
    const cursor = renderer.root.findByProps({ 'data-harness-id': 'cursor' })
    const codex = renderer.root.findByProps({ 'data-harness-id': 'codex' })
    const claude = renderer.root.findByProps({ 'data-harness-id': 'claude-code' })
    expect(cursor.props.disabled).toBe(true)
    expect(codex.props.disabled).toBe(true)
    expect(claude.props.disabled).toBe(false)
    const menuText = textOf(renderer)
    expect(menuText).toContain('Not installed')
    expect(menuText).toContain('Signed out')
  })

  it('selects immediately when no confirmation is needed', async () => {
    const onSelect = vi.fn()
    const renderer = await renderPicker({ onSelect, needsConfirm: () => false })
    await openMenu(renderer)
    await act(async () => {
      renderer.root.findByProps({ 'data-harness-id': 'claude-code' }).props.onClick()
    })
    expect(onSelect).toHaveBeenCalledWith('claude-code')
  })

  it('requires a confirmation step before switching mid-conversation', async () => {
    const onSelect = vi.fn()
    const renderer = await renderPicker({ onSelect, needsConfirm: () => true })
    await openMenu(renderer)
    await act(async () => {
      renderer.root.findByProps({ 'data-harness-id': 'claude-code' }).props.onClick()
    })
    // Selection is deferred until the inline confirmation resolves.
    expect(onSelect).not.toHaveBeenCalled()
    expect(renderer.root.findByProps({ 'data-harness-switch-confirm': true })).toBeTruthy()
    await act(async () => {
      renderer.root.findByProps({ 'data-harness-switch-confirm-yes': true }).props.onClick()
    })
    expect(onSelect).toHaveBeenCalledWith('claude-code')
  })

  it('shows the continue-local-session entry only when wired', async () => {
    const onContinue = vi.fn()
    const withEntry = await renderPicker({ onContinueLocalSession: onContinue })
    await openMenu(withEntry)
    const entry = withEntry.root.findByProps({ 'data-continue-local-session': true })
    await act(async () => entry.props.onClick())
    expect(onContinue).toHaveBeenCalledTimes(1)

    const without = await renderPicker({})
    await openMenu(without)
    expect(without.root.findAllByProps({ 'data-continue-local-session': true })).toHaveLength(0)
  })

  it('never confirms a re-pick of the current harness', async () => {
    const onSelect = vi.fn()
    const renderer = await renderPicker({ onSelect, needsConfirm: () => true })
    await openMenu(renderer)
    await act(async () => {
      renderer.root.findByProps({ 'data-harness-id': 'kun' }).props.onClick()
    })
    expect(onSelect).not.toHaveBeenCalled()
    expect(renderer.root.findAllByProps({ 'data-harness-switch-confirm': true })).toHaveLength(0)
  })
})

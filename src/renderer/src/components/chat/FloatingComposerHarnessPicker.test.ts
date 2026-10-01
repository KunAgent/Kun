// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

async function renderPicker(props: {
  needsConfirm?: (id: string) => boolean
  onSelect?: (id: string) => void
  onContinueLocalSession?: () => void
}): Promise<void> {
  await act(async () => {
    root.render(createElement(FloatingComposerHarnessPicker, {
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
}

function menu(): HTMLElement | null {
  return document.body.querySelector('[data-harness-picker-menu]')
}

async function openMenu(): Promise<void> {
  const trigger = host.querySelector<HTMLButtonElement>('[data-composer-harness-picker]')
  await act(async () => trigger!.click())
}

describe('FloatingComposerHarnessPicker', () => {
  it('disables unavailable harnesses and surfaces the reason', async () => {
    await renderPicker({})
    await openMenu()
    const cursor = menu()!.querySelector<HTMLButtonElement>('[data-harness-id="cursor"]')!
    const codex = menu()!.querySelector<HTMLButtonElement>('[data-harness-id="codex"]')!
    const claude = menu()!.querySelector<HTMLButtonElement>('[data-harness-id="claude-code"]')!
    expect(cursor.disabled).toBe(true)
    expect(codex.disabled).toBe(true)
    expect(claude.disabled).toBe(false)
    expect(menu()!.textContent).toContain('Not installed')
    expect(menu()!.textContent).toContain('Signed out')
    expect(menu()!.querySelector<HTMLButtonElement>('[data-harness-repair="cursor"]')?.disabled).toBe(false)
    expect(menu()!.querySelector('[data-agent-icon="cursor"]')).toBeTruthy()
    expect(menu()!.textContent).not.toContain('native-login')
  })

  it('selects immediately when no confirmation is needed', async () => {
    const onSelect = vi.fn()
    await renderPicker({ onSelect, needsConfirm: () => false })
    await openMenu()
    await act(async () => {
      menu()!.querySelector<HTMLButtonElement>('[data-harness-id="claude-code"]')!.click()
    })
    expect(onSelect).toHaveBeenCalledWith('claude-code')
  })

  it('requires a confirmation step before switching mid-conversation', async () => {
    const onSelect = vi.fn()
    await renderPicker({ onSelect, needsConfirm: () => true })
    await openMenu()
    await act(async () => {
      menu()!.querySelector<HTMLButtonElement>('[data-harness-id="claude-code"]')!.click()
    })
    // Selection is deferred until the inline confirmation resolves.
    expect(onSelect).not.toHaveBeenCalled()
    expect(menu()!.querySelector('[data-harness-switch-confirm]')).toBeTruthy()
    await act(async () => {
      menu()!.querySelector<HTMLButtonElement>('[data-harness-switch-confirm-yes]')!.click()
    })
    expect(onSelect).toHaveBeenCalledWith('claude-code')
  })

  it('shows the continue-local-session entry only when wired', async () => {
    const onContinue = vi.fn()
    await renderPicker({ onContinueLocalSession: onContinue })
    await openMenu()
    const entry = menu()!.querySelector<HTMLButtonElement>('[data-continue-local-session]')!
    await act(async () => entry.click())
    expect(onContinue).toHaveBeenCalledTimes(1)
    await renderPicker({})
    expect(menu()).toBeNull()
    await openMenu()
    expect(menu()!.querySelector('[data-continue-local-session]')).toBeNull()
  })

  it('never confirms a re-pick of the current harness', async () => {
    const onSelect = vi.fn()
    await renderPicker({ onSelect, needsConfirm: () => true })
    await openMenu()
    await act(async () => {
      menu()!.querySelector<HTMLButtonElement>('[data-harness-id="kun"]')!.click()
    })
    expect(onSelect).not.toHaveBeenCalled()
    expect(document.body.querySelector('[data-harness-switch-confirm]')).toBeNull()
  })
})

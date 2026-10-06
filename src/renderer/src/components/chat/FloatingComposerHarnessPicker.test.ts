// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { withHarnessReadiness } from '@shared/test-support/harness-readiness'
import { FloatingComposerHarnessPicker } from './FloatingComposerHarnessPicker'

function row(
  id: string,
  displayName: string,
  status: Partial<AdeHarnessRow['status']> = {}
): AdeHarnessRow {
  return withHarnessReadiness({
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
  })
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
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

async function renderPicker(props: {
  rows?: AdeHarnessRow[]
  needsConfirm?: (id: string) => boolean
  onSelect?: (id: string) => void
  onContinueLocalSession?: () => void
}): Promise<void> {
  await act(async () => {
    root.render(createElement(FloatingComposerHarnessPicker, {
      harnessId: 'kun',
      harnessLabel: 'Kun',
      rows: props.rows ?? rows,
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
  it('hides unavailable profiles and keeps agent management reachable', async () => {
    await renderPicker({})
    await openMenu()
    expect(menu()!.querySelector('[data-harness-id="cursor"]')).toBeNull()
    expect(menu()!.querySelector('[data-harness-id="codex"]')).toBeNull()
    expect(menu()!.querySelector<HTMLButtonElement>('[data-harness-id="claude-code"]')!.disabled).toBe(false)
    expect(menu()!.querySelector('[data-harness-manage]')).toBeTruthy()
    expect(menu()!.querySelector('[data-agent-icon="claude-code"]')).toBeTruthy()
    expect(menu()!.textContent).not.toContain('native-login')
  })

  it('omits installed profiles without opt-in, missing readiness, expired proofs and retired Gemini', async () => {
    await renderPicker({ rows: [rows[0],
      { ...row('disabled', 'Disabled'), enabled: false },
      { ...row('unchecked', 'Unchecked'), readyProfiles: [] },
      { ...row('expired', 'Expired'), readyProfiles: [{ harnessId: 'expired', credentialMode: 'native-login', expiresAt: '2000-01-01T00:00:00Z' }] },
      { ...row('gemini-cli', 'Gemini CLI'), definition: { ...row('gemini-cli', 'Gemini CLI').definition, availability: 'retired' } }] })
    await openMenu()
    expect([...menu()!.querySelectorAll<HTMLElement>('[data-harness-id]')].map((element) => element.dataset.harnessId)).toEqual(['kun'])
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

  it('cannot confirm a switch after the profile is disabled', async () => {
    const onSelect = vi.fn()
    await renderPicker({ onSelect, needsConfirm: () => true })
    await openMenu()
    await act(async () => { menu()!.querySelector<HTMLButtonElement>('[data-harness-id="claude-code"]')!.click() })
    await renderPicker({ rows: rows.map((entry) => entry.definition.id === 'claude-code' ? { ...entry, enabled: false } : entry), onSelect })
    await act(async () => { menu()!.querySelector<HTMLButtonElement>('[data-harness-switch-confirm-yes]')!.click() })
    expect(onSelect).not.toHaveBeenCalled()
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

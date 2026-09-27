// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { FloatingComposerHarnessPicker } from './FloatingComposerHarnessPicker'
import { FloatingComposerIsolationPicker } from './FloatingComposerIsolationPicker'
import { FloatingComposerAgentPicker } from './FloatingComposerAgentPicker'
import { useChatStore } from '../../store/chat-store'

vi.mock('../../agent/runtime-client', () => ({
  rendererRuntimeClient: {
    getSettings: vi.fn(async () => ({
      agents: {
        kun: {
          subagents: {
            profiles: [{
              id: 'agent-1',
              name: 'Reviewer',
              enabled: true,
              mode: 'primary',
              surfaces: ['code']
            }]
          }
        }
      }
    }))
  }
}))

function harnessRow(id: string, displayName: string): AdeHarnessRow {
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
      checkedAt: '2026-01-01T00:00:00Z'
    }
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  host.className = 'ds-composer-toolbar-actions'
  document.body.appendChild(host)
  root = createRoot(host)
  useChatStore.setState({ composerAgentId: '' })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

describe('composer picker popovers', () => {
  it('harness picker renders its menu in document.body, outside the clipped toolbar', async () => {
    await act(async () => {
      root.render(createElement(FloatingComposerHarnessPicker, {
        harnessId: 'kun',
        harnessLabel: 'Kun',
        rows: [harnessRow('kun', 'Kun'), harnessRow('claude-code', 'Claude Code')],
        loading: false,
        needsConfirm: () => false,
        onSelect: vi.fn()
      }))
    })
    const trigger = host.querySelector<HTMLButtonElement>('[data-composer-harness-picker]')
    expect(trigger).toBeTruthy()
    await act(async () => trigger!.click())
    const menu = document.body.querySelector<HTMLElement>('[data-harness-picker-menu]')
    expect(menu).toBeTruthy()
    expect(menu!.closest('.ds-composer-toolbar-actions')).toBeNull()
    expect(menu!.parentElement).toBe(document.body)
    expect(menu!.querySelector('[data-harness-id="claude-code"]')).toBeTruthy()
  })

  it('isolation picker renders its menu in document.body', async () => {
    await act(async () => {
      root.render(createElement(FloatingComposerIsolationPicker, {
        showPicker: true,
        value: 'local',
        onSelect: vi.fn()
      }))
    })
    const trigger = host.querySelector<HTMLButtonElement>('[data-composer-isolation-picker]')
    await act(async () => trigger!.click())
    const menu = document.body.querySelector<HTMLElement>('[data-isolation-picker-menu]')
    expect(menu).toBeTruthy()
    expect(menu!.closest('.ds-composer-toolbar-actions')).toBeNull()
    expect(menu!.querySelector('[data-isolation="worktree"]')).toBeTruthy()
  })

  it('agent picker renders its menu in document.body', async () => {
    await act(async () => {
      root.render(createElement(FloatingComposerAgentPicker, {}))
    })
    const trigger = host.querySelector<HTMLButtonElement>('.ds-composer-agent-picker button')
    expect(trigger).toBeTruthy()
    await act(async () => trigger!.click())
    const menu = document.body.querySelector<HTMLElement>('[data-agent-picker-menu]')
    expect(menu).toBeTruthy()
    expect(menu!.closest('.ds-composer-toolbar-actions')).toBeNull()
  })

  it('Escape closes the menu and returns focus to the trigger', async () => {
    await act(async () => {
      root.render(createElement(FloatingComposerHarnessPicker, {
        harnessId: 'kun',
        harnessLabel: 'Kun',
        rows: [harnessRow('kun', 'Kun')],
        loading: false,
        needsConfirm: () => false,
        onSelect: vi.fn()
      }))
    })
    const trigger = host.querySelector<HTMLButtonElement>('[data-composer-harness-picker]')
    await act(async () => trigger!.click())
    expect(document.body.querySelector('[data-harness-picker-menu]')).toBeTruthy()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(document.body.querySelector('[data-harness-picker-menu]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('pointer-down outside closes the menu', async () => {
    await act(async () => {
      root.render(createElement(FloatingComposerHarnessPicker, {
        harnessId: 'kun',
        harnessLabel: 'Kun',
        rows: [harnessRow('kun', 'Kun')],
        loading: false,
        needsConfirm: () => false,
        onSelect: vi.fn()
      }))
    })
    const trigger = host.querySelector<HTMLButtonElement>('[data-composer-harness-picker]')
    await act(async () => trigger!.click())
    expect(document.body.querySelector('[data-harness-picker-menu]')).toBeTruthy()
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    await act(async () => {
      outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    })
    expect(document.body.querySelector('[data-harness-picker-menu]')).toBeNull()
  })
})

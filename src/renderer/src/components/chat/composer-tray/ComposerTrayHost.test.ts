// @vitest-environment jsdom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../i18n'
import type { FloatingComposerRenderContext } from '../floating-composer-view-context'
import { ComposerTrayHost } from './ComposerTrayHost'
import type { TrayKind } from './tray-kind'

const hookState = vi.hoisted(() => ({ renders: 0, bump: null as null | (() => void) }))

vi.mock('./todo-tray-kind', () => ({
  useTodoTrayKind: (): TrayKind => {
    const [count, setCount] = useState(0)
    hookState.bump = () => setCount((value) => value + 1)
    return {
      id: 'todo',
      align: 'start',
      tone: 'running',
      ariaLabel: 'Tasks',
      renderSegment: () => createElement('span', null, `Tasks ${count}`),
      renderSheet: () => createElement('div', { 'data-todo-sheet': true }, 'sheet')
    }
  }
}))

function context(overrides: Record<string, unknown> = {}): FloatingComposerRenderContext {
  return {
    activeThreadId: 'thr_1',
    compact: false,
    composerInterrupt: null,
    composerMenuOpen: false,
    fileMentions: { showMenu: false },
    goalPanelOpen: false,
    slashQuery: null,
    ...overrides
  }
}

/** Stand-in for the composer surface: counts its renders. */
function Surface(): null {
  hookState.renders += 1
  return null
}

describe('ComposerTrayHost', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await i18n.changeLanguage('en')
    hookState.renders = 0
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  const render = async (overrides: Record<string, unknown> = {}): Promise<void> => {
    await act(async () => root.render(createElement('div', null,
      createElement(ComposerTrayHost, { context: context(overrides), queue: null }),
      createElement(Surface))))
  }
  const sheet = (): Element | null => host.querySelector('[data-tray-sheet]')

  it('closes the open sheet when an interrupt card takes the input slot', async () => {
    await render()
    await act(async () => host.querySelector<HTMLButtonElement>('[data-tray-kind="todo"]')!.click())
    expect(sheet()).not.toBeNull()
    await render({ composerInterrupt: { kind: 'approval', approvals: [] } })
    expect(sheet()).toBeNull()
  })

  it('re-renders only the tray when a kind updates its own state', async () => {
    await render()
    const before = hookState.renders
    await act(async () => hookState.bump?.())
    expect(host.textContent).toContain('Tasks 1')
    expect(hookState.renders).toBe(before)
  })
})

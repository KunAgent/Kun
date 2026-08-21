import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, create as createRenderer } from 'react-test-renderer'
import {
  FloatingComposerActionMenu,
  calculateActionMenuPlacement,
  calculatePersonaMenuPlacement
} from './FloatingComposerActionMenu'

describe('calculateActionMenuPlacement', () => {
  it('keeps the menu above the composer shell with the requested gap', () => {
    const placement = calculateActionMenuPlacement({
      buttonRect: { left: 24, right: 60 },
      shellRect: { top: 420 },
      menuHeight: 220,
      viewportHeight: 800,
      viewportWidth: 1000
    })

    expect(placement.top + 220).toBe(412)
    expect(placement.maxHeight).toBeGreaterThanOrEqual(220)
  })

  it('clamps the menu horizontally inside a narrow viewport', () => {
    const placement = calculateActionMenuPlacement({
      buttonRect: { left: 260, right: 296 },
      shellRect: { top: 500 },
      menuHeight: 200,
      viewportHeight: 700,
      viewportWidth: 300,
      preferredWidth: 236,
      margin: 12
    })

    expect(placement.left).toBe(52)
    expect(placement.width).toBe(236)
  })

  it('shrinks the scrollable height instead of opening over the composer', () => {
    const placement = calculateActionMenuPlacement({
      buttonRect: { left: 20, right: 56 },
      shellRect: { top: 92 },
      menuHeight: 360,
      viewportHeight: 700,
      viewportWidth: 900,
      margin: 12,
      gap: 8
    })

    expect(placement.maxHeight).toBe(72)
    expect(placement.top).toBe(12)
    expect(placement.top + placement.maxHeight).toBe(84)
  })

  it('uses zero height rather than crossing the composer when no space exists', () => {
    const placement = calculateActionMenuPlacement({
      buttonRect: { left: 48, right: 120 },
      shellRect: { top: 10 },
      menuHeight: 180,
      viewportWidth: 800,
      coordinateScale: 2
    })

    expect(placement.maxHeight).toBe(0)
    expect(placement.top + placement.maxHeight).toBeLessThanOrEqual(5)
  })

  it('normalizes anchor coordinates for non-default body zoom', () => {
    const placement = calculateActionMenuPlacement({
      buttonRect: { left: 48, right: 120 },
      shellRect: { top: 600 },
      menuHeight: 180,
      viewportHeight: 1200,
      viewportWidth: 1600,
      coordinateScale: 2
    })

    expect(placement.top).toBe(112)
    expect(placement.left).toBe(24)
    expect(placement.top + 180).toBe(292)
  })
})

describe('calculatePersonaMenuPlacement', () => {
  it('opens to the right of the parent menu and stays above the composer', () => {
    const placement = calculatePersonaMenuPlacement({
      triggerRect: { top: 310 },
      parentMenuRect: { left: 20, right: 244 },
      shellRect: { top: 500 },
      menuHeight: 220,
      viewportWidth: 1000
    })

    expect(placement.left).toBe(252)
    expect(placement.top + 220).toBe(492)
  })

  it('flips to the left when there is not enough room on the right', () => {
    const placement = calculatePersonaMenuPlacement({
      triggerRect: { top: 180 },
      parentMenuRect: { left: 340, right: 564 },
      shellRect: { top: 600 },
      menuHeight: 180,
      viewportWidth: 600
    })

    expect(placement.left).toBe(108)
    expect(placement.top).toBe(180)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('FloatingComposerActionMenu persona controls', () => {
  it('opens personas in a separate panel, selects one, and closes both menus', async () => {
    installMenuGlobals()
    const onComposerPersonaChange = vi.fn()
    const setComposerMenuOpen = vi.fn()
    let renderer: ReturnType<typeof createRenderer>

    await act(async () => {
      renderer = createRenderer(createElement(FloatingComposerActionMenu, {
        context: menuContext({ onComposerPersonaChange, setComposerMenuOpen })
      }))
    })

    await act(async () => renderer!.root.findByProps({ 'data-composer-persona-menu-item': true }).props.onClick())
    expect(renderer!.root.findByProps({ 'data-composer-persona-panel': true }).props.role).toBe('menu')
    const options = renderer!.root.findAllByProps({ role: 'menuitemradio' })
    expect(options).toHaveLength(2)
    await act(async () => options[1].props.onClick())

    expect(onComposerPersonaChange).toHaveBeenCalledWith('doubter')
    expect(setComposerMenuOpen).toHaveBeenCalledWith(false)
    await act(async () => renderer!.unmount())
  })

  it('collapses persona options if the composer becomes disabled', async () => {
    installMenuGlobals()
    const onComposerPersonaChange = vi.fn()
    let renderer: ReturnType<typeof createRenderer>

    await act(async () => {
      renderer = createRenderer(createElement(FloatingComposerActionMenu, {
        context: menuContext({ onComposerPersonaChange })
      }))
    })
    await act(async () => renderer!.root.findByProps({ 'data-composer-persona-menu-item': true }).props.onClick())
    expect(renderer!.root.findAllByProps({ role: 'menuitemradio' })).toHaveLength(2)

    await act(async () => {
      renderer!.update(createElement(FloatingComposerActionMenu, {
        context: menuContext({ canCompose: false, onComposerPersonaChange })
      }))
    })

    expect(renderer!.root.findByProps({ 'data-composer-persona-menu-item': true }).props.disabled).toBe(true)
    expect(renderer!.root.findAllByProps({ role: 'menuitemradio' })).toHaveLength(0)
    expect(onComposerPersonaChange).not.toHaveBeenCalled()
    await act(async () => renderer!.unmount())
  })

  it('closes on Escape and restores focus to the trigger', async () => {
    const focus = vi.fn()
    const setComposerMenuOpen = vi.fn()
    installMenuGlobals()
    let renderer: ReturnType<typeof createRenderer>

    await act(async () => {
      renderer = createRenderer(createElement(FloatingComposerActionMenu, {
        context: menuContext({
          setComposerMenuOpen,
          composerMenuButtonRef: {
            current: {
              focus,
              getBoundingClientRect: () => ({ left: 20, right: 56 })
            }
          }
        })
      }))
    })
    const menu = renderer!.root.findByProps({ role: 'menu' })
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    await act(async () => menu.props.onKeyDown({ key: 'Escape', preventDefault, stopPropagation }))

    expect(preventDefault).toHaveBeenCalled()
    expect(stopPropagation).toHaveBeenCalled()
    expect(setComposerMenuOpen).toHaveBeenCalledWith(false)
    expect(focus).toHaveBeenCalled()
    await act(async () => renderer!.unmount())
  })

  it('closes the menu before opening persona management', async () => {
    installMenuGlobals()
    const openSettings = vi.fn()
    const setComposerMenuOpen = vi.fn()
    let renderer: ReturnType<typeof createRenderer>

    await act(async () => {
      renderer = createRenderer(createElement(FloatingComposerActionMenu, {
        context: menuContext({ openSettings, setComposerMenuOpen })
      }))
    })
    await act(async () => renderer!.root.findByProps({ 'data-composer-persona-menu-item': true }).props.onClick())
    const manage = renderer!.root.findAllByProps({ role: 'menuitem' }).find((node) =>
      node.findAllByType('span').some((span) => span.children.includes('codeAgentPersonaManage'))
    )
    await act(async () => manage!.props.onClick())

    expect(setComposerMenuOpen).toHaveBeenCalledWith(false)
    expect(openSettings).toHaveBeenCalledWith('laboratory')
    await act(async () => renderer!.unmount())
  })
})

function installMenuGlobals(): void {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('document', { body: {} })
  vi.stubGlobal('window', {
    innerHeight: 800,
    innerWidth: 1200,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    },
    cancelAnimationFrame: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  })
}

function menuContext(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    composerMenuOpen: true,
    composerMenuButtonRef: { current: null },
    composerMenuPanelRef: { current: null },
    composerShellRef: { current: null },
    canCompose: true,
    codeAgentPresets: [{ id: 'doubter' }],
    resolvedCodeAgentPresets: [{
      id: 'doubter',
      icon: 'SearchCheck',
      name: 'Doubter',
      persona: 'Challenge assumptions.'
    }],
    composerPersonaId: '',
    onComposerPersonaChange: vi.fn(),
    setComposerMenuOpen: vi.fn(),
    openSettings: vi.fn(),
    t: (key: string) => key,
    fileReferenceEnabled: false,
    attachmentUploadEnabled: false,
    showPlanMenuOption: false,
    showGraphMenuOption: false,
    showGoalMenuOption: false,
    ...overrides
  }
}

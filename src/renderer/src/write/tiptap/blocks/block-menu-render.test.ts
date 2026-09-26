// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { MenuEntry } from './block-menu'
import { renderMenuPanel } from './block-menu-render'

const anchor = { getBoundingClientRect: () => new DOMRect(0, 0, 24, 24) }

function mountPanel(entries: MenuEntry[], extra?: {
  onSubmenuOpen?: () => void
  onPanelMount?: (dom: HTMLElement) => void
}) {
  const openDoms: HTMLElement[] = []
  const panel = renderMenuPanel({
    entries,
    anchor,
    placement: 'left-start',
    requestCloseAll: () => {},
    openDoms,
    ...extra
  })
  openDoms.push(panel.dom)
  return { panel, openDoms }
}

function cleanup(panel: { dom: HTMLElement; dispose: () => void }): void {
  panel.dispose()
  panel.dom.remove()
  document.body.querySelectorAll('.write-block-menu').forEach((el) => el.remove())
}

describe('renderMenuPanel rows', () => {
  const entries: MenuEntry[] = [
    { kind: 'item', id: 'copy', label: 'Copy', hint: '⌘C', run: () => {} },
    { kind: 'submenu', id: 'convert', label: 'Convert to', entries: () => [] }
  ]

  it('renders a submenu row as exactly three grid children ending with the chevron', () => {
    const { panel } = mountPanel(entries)
    const row = panel.dom.querySelectorAll('.write-block-menu-item')[1]
    expect(row.children).toHaveLength(3)
    const last = row.lastElementChild
    expect(last?.classList.contains('write-block-menu-chevron')).toBe(true)
    expect(last?.classList.contains('write-block-menu-hint')).toBe(true)
    cleanup(panel)
  })

  it('renders an item row with the shortcut hint as its last child', () => {
    const { panel } = mountPanel(entries)
    const row = panel.dom.querySelectorAll('.write-block-menu-item')[0]
    expect(row.children).toHaveLength(3)
    const last = row.lastElementChild
    expect(last?.classList.contains('write-block-menu-hint')).toBe(true)
    expect(last?.textContent).toBe('⌘C')
    cleanup(panel)
  })

  it('highlights a hovered row without moving DOM focus', () => {
    const { panel } = mountPanel(entries)
    const row = panel.dom.querySelector<HTMLButtonElement>('.write-block-menu-item')
    row?.dispatchEvent(new MouseEvent('mouseenter'))
    expect(row?.classList.contains('is-active')).toBe(true)
    expect(document.activeElement).toBe(document.body)
    cleanup(panel)
  })

  it('opens a submenu on row click and reports it through onSubmenuOpen/onPanelMount', () => {
    const onSubmenuOpen = vi.fn()
    const onPanelMount = vi.fn()
    const { panel, openDoms } = mountPanel([
      { kind: 'submenu', id: 'convert', label: 'Convert to', entries: () => [
        { kind: 'item', id: 'convert:paragraph', label: 'Paragraph', run: () => {} }
      ] }
    ], { onSubmenuOpen, onPanelMount })
    const row = panel.dom.querySelector<HTMLButtonElement>('.write-block-menu-item')
    row?.dispatchEvent(new MouseEvent('click'))
    expect(onSubmenuOpen).toHaveBeenCalledTimes(1)
    expect(openDoms).toHaveLength(2)
    expect(onPanelMount).toHaveBeenCalledTimes(2)
    cleanup(panel)
  })
})

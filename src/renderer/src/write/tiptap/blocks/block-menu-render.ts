import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'
import {
  ChevronRight,
  Copy,
  CopyPlus,
  Ellipsis,
  Repeat2,
  Scissors,
  Trash2,
  createElement
} from './lucide-dom-icons'
import { bodyZoom, toLayoutPx } from '../../../lib/body-zoom'
import type { MenuEntry, MenuIconName } from './block-menu'

const SUBMENU_OPEN_MS = 150

const ICONS: Record<MenuIconName, Parameters<typeof createElement>[0]> = {
  copy: Copy,
  cut: Scissors,
  duplicate: CopyPlus,
  delete: Trash2,
  convert: Repeat2,
  more: Ellipsis
}

function iconEl(name: MenuIconName | undefined): HTMLElement {
  const span = document.createElement('span')
  span.className = 'write-block-menu-icon'
  span.setAttribute('aria-hidden', 'true')
  if (name) {
    span.append(createElement(ICONS[name], { width: 16, height: 16, 'stroke-width': 1.75 }))
  }
  return span
}

function labelEl(text: string): HTMLElement {
  const span = document.createElement('span')
  span.className = 'write-block-menu-label'
  span.textContent = text
  return span
}

function hintEl(text: string | undefined): HTMLElement {
  const span = document.createElement('span')
  span.className = 'write-block-menu-hint'
  if (text) span.textContent = text
  return span
}

/**
 * One floating menu panel. Submenus are the same panel mounted on the parent
 * row; `requestCloseAll` tears down the whole tree (root + open submenus).
 * `openDoms` collects every mounted panel so the outside-pointer check covers
 * the root and any open submenu.
 */
export function renderMenuPanel(opts: {
  entries: MenuEntry[]
  anchor: { getBoundingClientRect: () => DOMRect }
  placement: 'left-start' | 'right-start'
  requestCloseAll: () => void
  openDoms: HTMLElement[]
  /** Present on submenus: ArrowLeft closes this panel and refocuses the row. */
  onArrowLeft?: () => void
  /** Fired when this panel opens a submenu; the handle pins hover mode. */
  onSubmenuOpen?: () => void
  /** Fired for every mounted panel (root and submenus) once it is in the DOM. */
  onPanelMount?: (dom: HTMLElement) => void
}): { dom: HTMLElement; dispose: () => void } {
  const { entries, anchor, placement, requestCloseAll, openDoms, onArrowLeft, onSubmenuOpen, onPanelMount } = opts
  const dom = document.createElement('div')
  dom.className = 'write-block-menu'
  dom.setAttribute('role', 'menu')

  let sub: { dom: HTMLElement; dispose: () => void; row: HTMLElement } | null = null
  let subTimer: ReturnType<typeof setTimeout> | null = null
  const clearSubTimer = (): void => {
    if (subTimer !== null) {
      clearTimeout(subTimer)
      subTimer = null
    }
  }
  const closeSub = (): void => {
    clearSubTimer()
    if (sub) {
      const index = openDoms.indexOf(sub.dom)
      if (index >= 0) openDoms.splice(index, 1)
      sub.dispose()
      sub.dom.remove()
      sub = null
    }
  }
  const openSub = (row: HTMLElement, entry: Extract<MenuEntry, { kind: 'submenu' }>): void => {
    clearSubTimer()
    if (sub?.row === row) return
    closeSub()
    const panel = renderMenuPanel({
      entries: entry.entries(),
      anchor: row,
      placement: 'right-start',
      requestCloseAll,
      openDoms,
      onSubmenuOpen,
      onPanelMount,
      onArrowLeft: () => {
        closeSub()
        row.focus()
      }
    })
    panel.dom.classList.add('is-submenu')
    openDoms.push(panel.dom)
    sub = { ...panel, row }
    onSubmenuOpen?.()
  }
  const scheduleSub = (row: HTMLElement, entry: Extract<MenuEntry, { kind: 'submenu' }>): void => {
    clearSubTimer()
    if (sub?.row === row) return
    subTimer = setTimeout(() => {
      subTimer = null
      openSub(row, entry)
    }, SUBMENU_OPEN_MS)
  }

  const rows: Array<{ button: HTMLButtonElement; entry: MenuEntry }> = []
  const setActive = (active: HTMLButtonElement): void => {
    for (const row of rows) row.button.classList.toggle('is-active', row.button === active)
  }
  for (const entry of entries) {
    if (entry.kind === 'separator') {
      const sep = document.createElement('div')
      sep.className = 'write-block-menu-separator'
      dom.append(sep)
      continue
    }
    if (entry.kind === 'header') {
      const header = document.createElement('div')
      header.className = 'write-block-menu-header'
      header.textContent = entry.label
      dom.append(header)
      continue
    }
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `write-block-menu-item${entry.kind === 'item' && entry.danger ? ' is-danger' : ''}`
    button.setAttribute('role', 'menuitem')
    button.append(iconEl(entry.icon), labelEl(entry.label))
    if (entry.kind === 'submenu') {
      const chevron = document.createElement('span')
      chevron.className = 'write-block-menu-hint write-block-menu-chevron'
      chevron.setAttribute('aria-hidden', 'true')
      chevron.append(createElement(ChevronRight, { width: 14, height: 14 }))
      button.append(chevron)
      button.setAttribute('aria-haspopup', 'menu')
      button.addEventListener('mouseenter', () => {
        setActive(button)
        scheduleSub(button, entry)
      })
      button.addEventListener('click', () => openSub(button, entry))
    } else {
      button.append(hintEl(entry.hint))
      if (entry.disabled) button.disabled = true
      button.addEventListener('mouseenter', () => {
        if (!button.disabled) setActive(button)
        if (sub && sub.row !== button) closeSub()
      })
      button.addEventListener('click', () => {
        requestCloseAll()
        entry.run()
      })
    }
    rows.push({ button, entry })
    dom.append(button)
  }

  dom.addEventListener('keydown', (event) => {
    const enabled = rows.filter((row) => !row.button.disabled)
    const current = enabled.findIndex((row) => row.button === document.activeElement)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      const next = enabled[(current + delta + enabled.length) % enabled.length]?.button
      next?.focus()
      if (next) setActive(next)
      return
    }
    if (event.key === 'ArrowRight') {
      const row = rows.find((item) => item.button === document.activeElement)
      if (row?.entry.kind === 'submenu') {
        event.preventDefault()
        event.stopPropagation()
        openSub(row.button, row.entry)
        sub?.dom.querySelector<HTMLButtonElement>('.write-block-menu-item:not(:disabled)')?.focus()
      }
      return
    }
    if (event.key === 'ArrowLeft' && onArrowLeft) {
      event.preventDefault()
      event.stopPropagation()
      onArrowLeft()
    }
  })

  document.body.append(dom)
  onPanelMount?.(dom)
  const stopAutoUpdate = autoUpdate(anchor, dom, () => {
    void computePosition(anchor, dom, {
      placement,
      strategy: 'fixed',
      middleware: [
        offset({ mainAxis: 6, crossAxis: -6 }),
        flip({ fallbackPlacements: placement === 'left-start' ? ['bottom-start', 'right-start'] : undefined }),
        shift({ padding: 8 })
      ]
    }).then(({ x, y }) => {
      const zoom = bodyZoom()
      dom.style.left = `${toLayoutPx(x, zoom)}px`
      dom.style.top = `${toLayoutPx(y, zoom)}px`
    })
  })

  return {
    dom,
    dispose() {
      closeSub()
      stopAutoUpdate()
    }
  }
}

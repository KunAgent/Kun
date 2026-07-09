import type { WorkspaceFileTarget } from '@shared/workspace-file'
import { findFileReferences } from './file-references'
import { previewWorkspaceFile } from './workspace-file-preview'

const LINKIFIED_ATTR = 'data-kun-issue781-linkified'
const FILE_PATH_ATTR = 'data-kun-issue781-file-path'
const FILE_LINE_ATTR = 'data-kun-issue781-file-line'
const FILE_COLUMN_ATTR = 'data-kun-issue781-file-column'
const ENHANCED_ATTR = 'data-kun-issue781-enhanced'
const STYLE_ID = 'kun-issue-781-document-usability-style'
const PINNED_TABS_KEY = 'kun.issue781.pinnedPreviewTabs'
const SCROLL_POSITIONS_KEY = 'kun.issue781.previewScrollPositions'

const LABELS = {
  zh: {
    pinTab: '固定标签',
    unpinTab: '取消固定标签',
    closeOtherTabs: '关闭其他标签页',
    read: '阅读',
    exitRead: '退出阅读',
    expandRead: '放大阅读'
  },
  en: {
    pinTab: 'Pin tab',
    unpinTab: 'Unpin tab',
    closeOtherTabs: 'Close other tabs',
    read: 'Read',
    exitRead: 'Exit reading',
    expandRead: 'Expand reading'
  }
} as const

let installed = false
let observer: MutationObserver | null = null
let scanTimer: number | null = null
let menuEl: HTMLDivElement | null = null
let cleanups: Array<() => void> = []

function trackCleanup(cleanup: () => void): void {
  cleanups.push(cleanup)
}

function label(key: keyof typeof LABELS.en): string {
  const language = document.documentElement.lang || navigator.language || ''
  return language.toLowerCase().startsWith('zh') ? LABELS.zh[key] : LABELS.en[key]
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

function writeJson<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore storage quota / private-mode errors. The feature remains usable in-memory.
  }
}

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .ds-issue781-file-link {
      display: inline;
      max-width: 100%;
      border: 0;
      border-radius: 5px;
      background: color-mix(in srgb, var(--ds-accent) 10%, transparent);
      color: var(--ds-accent);
      cursor: pointer;
      font: inherit;
      padding: 0 2px;
      text-align: inherit;
      text-decoration: underline;
      text-decoration-color: color-mix(in srgb, var(--ds-accent) 45%, transparent);
      text-underline-offset: 2px;
    }
    .ds-issue781-file-link:hover {
      background: color-mix(in srgb, var(--ds-accent) 17%, transparent);
      text-decoration-color: var(--ds-accent);
    }
    .ds-code-sidebar-tab.kun-issue781-pinned::before {
      content: '📌';
      margin-right: 2px;
      font-size: 10px;
      opacity: 0.78;
    }
    .kun-issue781-menu {
      position: fixed;
      z-index: 9999;
      min-width: 172px;
      border: 1px solid var(--ds-border);
      border-radius: 10px;
      background: var(--ds-card);
      box-shadow: 0 18px 50px rgba(15, 23, 42, 0.22);
      padding: 5px;
    }
    .kun-issue781-menu button {
      display: block;
      width: 100%;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: var(--ds-ink);
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      padding: 7px 9px;
      text-align: left;
    }
    .kun-issue781-menu button:hover { background: var(--ds-hover); }
    .ds-code-sidebar.kun-issue781-reader-mode {
      position: fixed;
      inset: 18px;
      z-index: 9998;
      width: auto !important;
      min-width: 0 !important;
      border: 1px solid var(--ds-border);
      border-radius: 18px;
      background: var(--ds-main);
      box-shadow: 0 28px 80px rgba(15, 23, 42, 0.36);
      overflow: hidden;
    }
  `
  document.head.appendChild(style)
  trackCleanup(() => {
    style.remove()
  })
}

function isBlockedTextNode(node: Text): boolean {
  const parent = node.parentElement
  if (!parent) return true
  return Boolean(parent.closest('a, button, textarea, script, style, [contenteditable="true"]'))
}

function targetFromDataset(element: HTMLElement): WorkspaceFileTarget | null {
  const path = element.getAttribute(FILE_PATH_ATTR)?.trim()
  if (!path) return null
  const line = Number.parseInt(element.getAttribute(FILE_LINE_ATTR) ?? '', 10)
  const column = Number.parseInt(element.getAttribute(FILE_COLUMN_ATTR) ?? '', 10)
  return {
    path,
    ...(Number.isFinite(line) && line > 0 ? { line } : {}),
    ...(Number.isFinite(column) && column > 0 ? { column } : {})
  }
}

function tabKey(tab: Element | null): string {
  return tab instanceof HTMLElement ? (tab.title || tab.textContent || '').trim() : ''
}

function tabScopeKey(tab: Element | null): string {
  if (!(tab instanceof HTMLElement)) return ''
  const rawKey = tabKey(tab)
  if (!rawKey) return ''
  const sidebar = tab.closest('.ds-code-sidebar')
  const explicitWorkspaceRoot = sidebar instanceof HTMLElement
    ? sidebar.getAttribute('data-kun-workspace-root')
    : ''
  const explicitPreviewKey = tab.getAttribute('data-kun-preview-key')
  const fallbackPageScope = `${window.location.origin}${window.location.pathname}`
  return `${explicitWorkspaceRoot || fallbackPageScope}\n${explicitPreviewKey || rawKey}`
    .replaceAll('\\', '/')
    .toLowerCase()
}

function activeTabKey(): string {
  return tabScopeKey(document.querySelector('.ds-code-sidebar-tab.is-active'))
}

function pinnedTabs(): string[] {
  return readJson<string[]>(PINNED_TABS_KEY, [])
}

function setPinnedTabs(next: string[]): void {
  writeJson(PINNED_TABS_KEY, Array.from(new Set(next.filter(Boolean))))
}

function scrollPositions(): Record<string, number> {
  return readJson<Record<string, number>>(SCROLL_POSITIONS_KEY, {})
}

function setScrollPosition(key: string, value: number): void {
  if (!key) return
  const next = scrollPositions()
  next[key] = value
  writeJson(SCROLL_POSITIONS_KEY, next)
}

function linkifyTextNode(node: Text): void {
  if (isBlockedTextNode(node)) return
  const text = node.nodeValue ?? ''
  const matches = findFileReferences(text)
  if (matches.length === 0) return

  const fragment = document.createDocumentFragment()
  let cursor = 0
  for (const match of matches) {
    if (match.start > cursor) {
      fragment.appendChild(document.createTextNode(text.slice(cursor, match.start)))
    }
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'ds-issue781-file-link ds-file-reference-link'
    button.setAttribute(LINKIFIED_ATTR, '1')
    button.setAttribute(FILE_PATH_ATTR, match.target.path)
    if (match.target.line) button.setAttribute(FILE_LINE_ATTR, String(match.target.line))
    if (match.target.column) button.setAttribute(FILE_COLUMN_ATTR, String(match.target.column))
    button.title = match.target.line ? `${match.target.path}:${match.target.line}` : match.target.path
    button.textContent = match.text
    fragment.appendChild(button)
    cursor = match.end
  }
  if (cursor < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(cursor)))
  }
  node.replaceWith(fragment)
}

function linkifyContainer(container: ParentNode): void {
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!(node instanceof Text)) return NodeFilter.FILTER_REJECT
        if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT
        return isBlockedTextNode(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
      }
    }
  )
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  for (const node of nodes) linkifyTextNode(node)
}

function scanRenderedOutput(): void {
  const containers = document.querySelectorAll('.ds-markdown, .ds-code-block-html, .ds-file-preview-code-html')
  for (const container of containers) linkifyContainer(container)
}

function applyPinnedClasses(): void {
  const pinned = new Set(pinnedTabs())
  document.querySelectorAll('.ds-code-sidebar-tab').forEach((tab) => {
    tab.classList.toggle('kun-issue781-pinned', pinned.has(tabScopeKey(tab)))
  })
}

function closeIssue781Menu(): void {
  menuEl?.remove()
  menuEl = null
}

function showTabMenu(tab: HTMLElement, x: number, y: number): void {
  closeIssue781Menu()
  const key = tabScopeKey(tab)
  if (!key) return
  const pinned = new Set(pinnedTabs())
  const menu = document.createElement('div')
  menu.className = 'kun-issue781-menu'
  menu.style.left = `${x}px`
  menu.style.top = `${y}px`
  const pinButton = document.createElement('button')
  pinButton.type = 'button'
  pinButton.textContent = pinned.has(key) ? label('unpinTab') : label('pinTab')
  const closeOthersButton = document.createElement('button')
  closeOthersButton.type = 'button'
  closeOthersButton.textContent = label('closeOtherTabs')
  pinButton.addEventListener('click', () => {
    if (pinned.has(key)) pinned.delete(key)
    else pinned.add(key)
    setPinnedTabs([...pinned])
    applyPinnedClasses()
    closeIssue781Menu()
  })
  closeOthersButton.addEventListener('click', () => {
    const pinnedNow = new Set(pinnedTabs())
    document.querySelectorAll('.ds-code-sidebar-tab').forEach((item) => {
      const itemKey = tabScopeKey(item)
      if (item === tab || pinnedNow.has(itemKey)) return
      const close = item.querySelector('.ds-code-sidebar-tab-close')
      if (close instanceof HTMLButtonElement) close.click()
    })
    closeIssue781Menu()
  })
  menu.append(pinButton, closeOthersButton)
  document.body.appendChild(menu)
  menuEl = menu
}

function enhancePreviewTabs(): void {
  applyPinnedClasses()
  const tabs = document.querySelector('.ds-code-sidebar-tabs')
  if (!(tabs instanceof HTMLElement) || tabs.getAttribute(ENHANCED_ATTR) === 'tabs') return
  tabs.setAttribute(ENHANCED_ATTR, 'tabs')
  const onWheel = (event: WheelEvent): void => {
    const tabList = Array.from(tabs.querySelectorAll('.ds-code-sidebar-tab')) as HTMLElement[]
    if (tabList.length < 2) return
    event.preventDefault()
    const activeIndex = Math.max(0, tabList.findIndex((tab) => tab.classList.contains('is-active')))
    const nextIndex = (activeIndex + (event.deltaY > 0 ? 1 : -1) + tabList.length) % tabList.length
    tabList[nextIndex]?.click()
  }
  const onContextMenu = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const tab = target.closest('.ds-code-sidebar-tab')
    if (!(tab instanceof HTMLElement)) return
    event.preventDefault()
    showTabMenu(tab, event.clientX, event.clientY)
  }
  tabs.addEventListener('wheel', onWheel, { passive: false })
  tabs.addEventListener('contextmenu', onContextMenu)
  trackCleanup(() => {
    tabs.removeEventListener('wheel', onWheel)
    tabs.removeEventListener('contextmenu', onContextMenu)
    if (tabs.getAttribute(ENHANCED_ATTR) === 'tabs') tabs.removeAttribute(ENHANCED_ATTR)
  })
}

function enhanceScrollMemory(): void {
  const scrollers = document.querySelectorAll('.ds-file-preview-scroll, .ds-file-preview-markdown')
  scrollers.forEach((element) => {
    if (!(element instanceof HTMLElement)) return
    if (element.getAttribute(ENHANCED_ATTR) !== 'scroll') {
      element.setAttribute(ENHANCED_ATTR, 'scroll')
      const onScroll = (): void => setScrollPosition(activeTabKey(), element.scrollTop)
      element.addEventListener('scroll', onScroll, { passive: true })
      trackCleanup(() => {
        element.removeEventListener('scroll', onScroll)
        if (element.getAttribute(ENHANCED_ATTR) === 'scroll') element.removeAttribute(ENHANCED_ATTR)
      })
    }
    const key = activeTabKey()
    const stored = scrollPositions()[key]
    if (key && typeof stored === 'number' && Math.abs(element.scrollTop - stored) > 4) {
      window.requestAnimationFrame(() => {
        element.scrollTop = stored
      })
    }
  })
}

function setReadingMode(enabled: boolean): void {
  const sidebar = document.querySelector('.ds-code-sidebar')
  if (!(sidebar instanceof HTMLElement)) return
  sidebar.classList.toggle('kun-issue781-reader-mode', enabled)
  const button = sidebar.querySelector('.kun-issue781-expand-button')
  if (button instanceof HTMLButtonElement) {
    const title = enabled ? label('exitRead') : label('expandRead')
    button.textContent = enabled ? label('exitRead') : label('read')
    button.title = title
    button.setAttribute('aria-label', title)
  }
}

function enhanceReadingButton(): void {
  const actions = document.querySelector('.ds-code-sidebar-actions')
  if (!(actions instanceof HTMLElement) || actions.querySelector('.kun-issue781-expand-button')) return
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'kun-issue781-expand-button ds-code-sidebar-icon-button'
  button.title = label('expandRead')
  button.setAttribute('aria-label', label('expandRead'))
  button.textContent = label('read')
  const onClick = (event: MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    const sidebar = document.querySelector('.ds-code-sidebar')
    setReadingMode(!(sidebar instanceof HTMLElement && sidebar.classList.contains('kun-issue781-reader-mode')))
  }
  button.addEventListener('click', onClick)
  actions.insertBefore(button, actions.firstChild)
  trackCleanup(() => {
    button.removeEventListener('click', onClick)
    button.remove()
  })
}

function scheduleScan(): void {
  if (scanTimer !== null) return
  scanTimer = window.setTimeout(() => {
    scanTimer = null
    scanRenderedOutput()
    enhancePreviewTabs()
    enhanceScrollMemory()
    enhanceReadingButton()
  }, 120)
}

function onDocumentClick(event: MouseEvent): void {
  const target = event.target
  if (!(target instanceof HTMLElement)) return

  const fileLink = target.closest(`[${LINKIFIED_ATTR}]`)
  if (fileLink instanceof HTMLElement) {
    const fileTarget = targetFromDataset(fileLink)
    if (!fileTarget) return
    event.preventDefault()
    event.stopPropagation()
    previewWorkspaceFile(fileTarget)
  }
}

function onDocumentKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') setReadingMode(false)
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (menuEl && event.target instanceof Node && !menuEl.contains(event.target)) closeIssue781Menu()
}

export function uninstallIssue781DocumentUsability(): void {
  if (!installed || typeof window === 'undefined' || typeof document === 'undefined') return
  installed = false
  if (scanTimer !== null) {
    window.clearTimeout(scanTimer)
    scanTimer = null
  }
  observer?.disconnect()
  observer = null
  closeIssue781Menu()
  document.querySelectorAll('.kun-issue781-reader-mode').forEach((element) => {
    element.classList.remove('kun-issue781-reader-mode')
  })
  document.querySelectorAll('.kun-issue781-pinned').forEach((element) => {
    element.classList.remove('kun-issue781-pinned')
  })
  for (const cleanup of cleanups.splice(0).reverse()) {
    cleanup()
  }
}

export function installIssue781DocumentUsability(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  if (installed) return uninstallIssue781DocumentUsability
  installed = true
  cleanups = []
  injectStyle()
  scanRenderedOutput()
  enhancePreviewTabs()
  enhanceScrollMemory()
  enhanceReadingButton()
  document.addEventListener('click', onDocumentClick, true)
  document.addEventListener('keydown', onDocumentKeyDown)
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
  trackCleanup(() => {
    document.removeEventListener('click', onDocumentClick, true)
    document.removeEventListener('keydown', onDocumentKeyDown)
    document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  })
  observer = new MutationObserver(() => {
    scheduleScan()
  })
  observer.observe(document.body, { childList: true, subtree: true })
  return uninstallIssue781DocumentUsability
}

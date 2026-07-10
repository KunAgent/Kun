import type { WorkspaceFileTarget } from '@shared/workspace-file'
import { findFileReferences } from './file-references'
import { previewWorkspaceFile } from './workspace-file-preview'

const LINKIFIED_ATTR = 'data-kun-issue781-linkified'
const FILE_PATH_ATTR = 'data-kun-issue781-file-path'
const FILE_LINE_ATTR = 'data-kun-issue781-file-line'
const FILE_COLUMN_ATTR = 'data-kun-issue781-file-column'
const STYLE_ID = 'kun-issue-781-document-usability-style'
const OUTPUT_CONTAINER_SELECTOR = '.ds-markdown, .ds-code-block-html, .ds-file-preview-code-html'

let installed = false
let observer: MutationObserver | null = null
let scanTimer: number | null = null
let styleElement: HTMLStyleElement | null = null
const pendingContainers = new Set<Element>()

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
  `
  document.head.appendChild(style)
  styleElement = style
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

function linkifyTextNode(node: Text): void {
  if (isBlockedTextNode(node)) return
  const text = node.nodeValue ?? ''
  const matches = findFileReferences(text)
  if (matches.length === 0) return

  const fragment = document.createDocumentFragment()
  let cursor = 0
  for (const match of matches) {
    if (match.start > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, match.start)))
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
  if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)))
  node.replaceWith(fragment)
}

function linkifyContainer(container: ParentNode): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!(node instanceof Text) || !node.nodeValue?.trim() || isBlockedTextNode(node)) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    }
  })
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  for (const node of nodes) linkifyTextNode(node)
}

function scanRenderedOutput(root: ParentNode = document): void {
  const containers = root.querySelectorAll(OUTPUT_CONTAINER_SELECTOR)
  for (const container of containers) linkifyContainer(container)
}

function collectOutputContainers(node: Node): void {
  const element = node instanceof Element ? node : node.parentElement
  if (!element) return
  const containing = element.closest(OUTPUT_CONTAINER_SELECTOR)
  if (containing) pendingContainers.add(containing)
  if (node instanceof Element) {
    if (node.matches(OUTPUT_CONTAINER_SELECTOR)) pendingContainers.add(node)
    node.querySelectorAll(OUTPUT_CONTAINER_SELECTOR).forEach((container) => pendingContainers.add(container))
  }
}

function scheduleScan(): void {
  if (scanTimer !== null) return
  scanTimer = window.setTimeout(() => {
    scanTimer = null
    const containers = [...pendingContainers]
    pendingContainers.clear()
    for (const container of containers) linkifyContainer(container)
  }, 120)
}

function onRenderedOutputMutations(mutations: MutationRecord[]): void {
  for (const mutation of mutations) {
    mutation.addedNodes.forEach(collectOutputContainers)
  }
  if (pendingContainers.size > 0) scheduleScan()
}

function onDocumentClick(event: MouseEvent): void {
  const target = event.target
  if (!(target instanceof HTMLElement)) return
  const fileLink = target.closest(`[${LINKIFIED_ATTR}]`)
  if (!(fileLink instanceof HTMLElement)) return
  const fileTarget = targetFromDataset(fileLink)
  if (!fileTarget) return
  event.preventDefault()
  event.stopPropagation()
  previewWorkspaceFile(fileTarget)
}

export function uninstallIssue781DocumentUsability(): void {
  if (!installed || typeof window === 'undefined' || typeof document === 'undefined') return
  installed = false
  if (scanTimer !== null) window.clearTimeout(scanTimer)
  scanTimer = null
  observer?.disconnect()
  observer = null
  pendingContainers.clear()
  document.removeEventListener('click', onDocumentClick, true)
  styleElement?.remove()
  styleElement = null
}

export function installIssue781DocumentUsability(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  if (installed) return uninstallIssue781DocumentUsability
  installed = true
  injectStyle()
  scanRenderedOutput()
  document.addEventListener('click', onDocumentClick, true)
  observer = new MutationObserver(onRenderedOutputMutations)
  observer.observe(document.body, { childList: true, subtree: true })
  return uninstallIssue781DocumentUsability
}

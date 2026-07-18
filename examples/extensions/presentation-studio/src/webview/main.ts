import {
  ExtensionHostClient,
  type HostMessage,
  type HostTransport,
  type JsonObject,
  type JsonValue,
  type Theme
} from '@kun/extension-api'
import {
  MAX_PRESENTATION_OPERATIONS,
  applyPresentationOperations,
  createImageElement,
  createPresentationSlide,
  createShapeElement,
  createTextElement,
  type PresentationElement,
  type PresentationFontFamily,
  type PresentationImageElement,
  type PresentationOperation,
  type PresentationProject,
  type PresentationShapeElement,
  type PresentationSlide,
  type PresentationTextElement
} from '../shared/presentation.js'
import {
  decidePresentationChange,
  latestPresentationPath,
  presentationPathsFromWorkspaceEntries
} from '../shared/presentation-sync.js'
import {
  applyEditableElementCss,
  editableCssPropertiesForElement,
  serializeEditableElementCss
} from '../shared/presentation-css.js'

declare global {
  interface Window {
    readonly kunExtension: HostTransport
  }
}

type SaveTone = 'idle' | 'saving' | 'saved' | 'error'
type StudioPanel = 'slides' | 'canvas' | 'properties'
type CommandResponse = { path: string; project: PresentationProject }
type SaveResponse = CommandResponse & {
  resultingRevision: number
  currentRevision: number
  changedIds: string[]
  warnings: Array<{ code: string; path: string; message: string }>
  idempotentReplay: boolean
}
type ExportResponse = {
  sourcePath: string
  destinationPath: string
  revision: number
  bytes: number
}
type PresentationChangedPayload = {
  path: string
  revision: number
  source: 'command' | 'tool'
  changedIds: string[]
}
type HistoryEntry = {
  forward: PresentationOperation[]
  inverse: PresentationOperation[]
  label: string
}
type PointerSession = {
  pointerId: number
  slideId: string
  elementId: string
  mode: 'move' | 'resize'
  handle?: 'nw' | 'ne' | 'se' | 'sw'
  startClientX: number
  startClientY: number
  original: PresentationElement
  preview: PresentationElement
}
type ImageCacheEntry =
  | { state: 'loading' }
  | { state: 'ready'; url: string }
  | { state: 'error'; message: string }
type PersistedViewState = {
  path?: string
  selectedSlideId?: string
  activePanel?: StudioPanel
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const SAVE_DEBOUNCE_MS = 450
const INLINE_EDIT_DOUBLE_CLICK_MS = 500
const MAX_INLINE_TEXT_LENGTH = 12_000
const MAX_IMAGE_BASE64_CHARS = 8 * 1024 * 1024
const MAX_IMPORTED_IMAGE_BYTES = Math.floor(MAX_IMAGE_BASE64_CHARS / 4) * 3
const client = new ExtensionHostClient(window.kunExtension)

function required<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector)
  if (!node) throw new Error(`Kun PPT is missing ${selector}`)
  return node
}

const ui = {
  studio: required<HTMLElement>('#studio'),
  path: required<HTMLInputElement>('#deck-path'),
  newDeck: required<HTMLButtonElement>('#new-deck'),
  deckMenu: required<HTMLDetailsElement>('#deck-menu'),
  loadDeck: required<HTMLButtonElement>('#load-deck'),
  openExport: required<HTMLButtonElement>('#open-copy'),
  saveState: required<HTMLElement>('#save-state'),
  conflictBanner: required<HTMLElement>('#conflict-banner'),
  conflictDetail: required<HTMLElement>('#conflict-detail'),
  reloadConflict: required<HTMLButtonElement>('#reload-conflict'),
  panelTabs: [...document.querySelectorAll<HTMLButtonElement>('[data-studio-tab]')],
  slidesPanel: required<HTMLElement>('#slides-panel'),
  canvasPanel: required<HTMLElement>('#canvas-panel'),
  propertiesPanel: required<HTMLElement>('#properties-panel'),
  deckTitle: required<HTMLElement>('#deck-title'),
  slideList: required<HTMLOListElement>('#slide-list'),
  addSlide: required<HTMLButtonElement>('#add-slide'),
  duplicateSlide: required<HTMLButtonElement>('#duplicate-slide'),
  deleteSlide: required<HTMLButtonElement>('#delete-slide'),
  undo: required<HTMLButtonElement>('#undo'),
  redo: required<HTMLButtonElement>('#redo'),
  addText: required<HTMLButtonElement>('#add-text'),
  addShape: required<HTMLButtonElement>('#add-shape'),
  openImage: required<HTMLButtonElement>('#open-image'),
  imageFilePicker: required<HTMLInputElement>('#image-file-picker'),
  selectionActions: required<HTMLElement>('#selection-actions'),
  editSelectedText: required<HTMLButtonElement>('#edit-selected-text'),
  deleteSelectedElement: required<HTMLButtonElement>('#delete-selected-element'),
  openPreview: required<HTMLButtonElement>('#open-preview'),
  canvasEmpty: required<HTMLElement>('#canvas-empty'),
  canvas: required<SVGSVGElement>('#slide-canvas'),
  canvasBackground: required<SVGRectElement>('#slide-canvas > .canvas-background'),
  canvasElements: required<SVGGElement>('#canvas-elements'),
  canvasSelection: required<SVGGElement>('#canvas-selection'),
  canvasCaption: required<HTMLElement>('#canvas-caption'),
  selectionCaption: required<HTMLElement>('#selection-caption'),
  inspectorTitle: required<HTMLElement>('#inspector-title'),
  inspectorBody: required<HTMLElement>('#inspector-body'),
  exportDialog: required<HTMLDialogElement>('#export-dialog'),
  exportForm: required<HTMLFormElement>('#export-form'),
  exportPath: required<HTMLInputElement>('#export-path'),
  exportError: required<HTMLElement>('#export-dialog-error'),
  previewDialog: required<HTMLDialogElement>('#preview-dialog'),
  previewCanvas: required<SVGSVGElement>('#preview-canvas'),
  previewBackground: required<SVGRectElement>('#preview-canvas > .canvas-background'),
  previewElements: required<SVGGElement>('#preview-elements'),
  previewPrev: required<HTMLButtonElement>('#preview-prev'),
  previewNext: required<HTMLButtonElement>('#preview-next'),
  previewPosition: required<HTMLElement>('#preview-position')
}

let project: PresentationProject | null = null
let activePath = ''
let selectedSlideId: string | null = null
let selectedElementId: string | null = null
let pendingOperations: PresentationOperation[] = []
let undoStack: HistoryEntry[] = []
let redoStack: HistoryEntry[] = []
let saveTimer = 0
let savePromise: Promise<void> | null = null
let ownSaveTargetRevision: number | null = null
let conflicted = false
let pointerSession: PointerSession | null = null
let recentPointerSelection: { elementId: string; at: number } | null = null
let inlineEditingId: string | null = null
let inlineDraft: string | null = null
let previewIndex = 0
let idCounter = 0
let viewStateTimer = 0
let activePanel: StudioPanel = 'canvas'
const imageCache = new Map<string, ImageCacheEntry>()

function svg<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag)
}

function html<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
  return document.createElement(tag)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function makeId(prefix: string): string {
  idCounter += 1
  const random = globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 12)
    ?? Math.random().toString(36).slice(2, 14)
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}-${random}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizePath(value: string): string {
  const path = value.trim()
  if (
    !path ||
    path.length > 240 ||
    !/^[A-Za-z0-9][A-Za-z0-9._ -]*\.kun-ppt\.html$/u.test(path)
  ) {
    throw new Error('Use a root-level filename ending in .kun-ppt.html.')
  }
  if (path.includes('/') || path.includes('\\') || path === '.' || path === '..') {
    throw new Error('Presentation files must use a root-level workspace filename.')
  }
  return path
}

function setSaveStatus(message: string, tone: SaveTone = 'idle'): void {
  ui.saveState.textContent = message
  ui.saveState.dataset.tone = tone
}

function setConflict(message: string): void {
  conflicted = true
  ui.conflictDetail.textContent = message
  ui.conflictBanner.hidden = false
  setSaveStatus('Revision conflict — reload required', 'error')
  renderControls()
  renderInspector()
}

function clearConflict(): void {
  conflicted = false
  ui.conflictBanner.hidden = true
  ui.conflictDetail.textContent = 'Reload before making more edits.'
}

function currentSlide(): PresentationSlide | null {
  if (!project) return null
  return project.slides.find((slide) => slide.id === selectedSlideId) ?? project.slides[0] ?? null
}

function currentElement(): PresentationElement | null {
  const slide = currentSlide()
  if (!slide || !selectedElementId) return null
  return slide.elements.find((element) => element.id === selectedElementId) ?? null
}

function executeCommand<T>(id: string, args: JsonObject): Promise<T> {
  return client.commands.executeCommand(id, args).then((value) => value as unknown as T)
}

function scheduleViewState(): void {
  if (viewStateTimer) window.clearTimeout(viewStateTimer)
  viewStateTimer = window.setTimeout(() => {
    viewStateTimer = 0
    const state: PersistedViewState = {
      ...(activePath ? { path: activePath } : {}),
      ...(selectedSlideId ? { selectedSlideId } : {}),
      activePanel
    }
    void client.ui.setViewState(state as unknown as JsonValue).catch(() => undefined)
  }, 150)
}

function isStudioPanel(value: unknown): value is StudioPanel {
  return value === 'slides' || value === 'canvas' || value === 'properties'
}

function setActivePanel(panel: StudioPanel, focus = false): void {
  ui.deckMenu.open = false
  activePanel = panel
  ui.studio.dataset.activePanel = panel
  // The slide rail stays visible beside Canvas and Properties at normal sidebar
  // widths. CSS collapses it back into the Slides tab on very narrow Views.
  ui.slidesPanel.hidden = false
  ui.canvasPanel.hidden = panel !== 'canvas'
  ui.propertiesPanel.hidden = panel !== 'properties'
  for (const tab of ui.panelTabs) {
    const selected = tab.dataset.studioTab === panel
    tab.setAttribute('aria-selected', String(selected))
    tab.tabIndex = selected ? 0 : -1
    if (selected && focus) tab.focus()
  }
  scheduleViewState()
}

function renderControls(): void {
  const loaded = project !== null
  const editable = loaded && !conflicted
  const slide = currentSlide()
  const element = currentElement()
  ui.openExport.disabled = !loaded || conflicted
  ui.addSlide.disabled = !editable
  ui.duplicateSlide.disabled = !editable || !slide
  ui.deleteSlide.disabled = !editable || !slide || (project?.slides.length ?? 0) <= 1
  ui.undo.disabled = !editable || undoStack.length === 0
  ui.redo.disabled = !editable || redoStack.length === 0
  ui.addText.disabled = !editable || !slide
  ui.addShape.disabled = !editable || !slide
  ui.openImage.disabled = !editable || !slide
  ui.selectionActions.hidden = !element
  ui.editSelectedText.hidden = element?.type !== 'text'
  ui.editSelectedText.disabled = !editable || element?.type !== 'text'
  ui.deleteSelectedElement.disabled = !editable || !element
  ui.openPreview.disabled = !loaded || !slide
}

function fontFamily(token: PresentationFontFamily): string {
  if (token === 'serif') return 'Georgia, Times New Roman, serif'
  if (token === 'mono') return 'SFMono-Regular, Consolas, Liberation Mono, monospace'
  return 'Inter, Arial, Helvetica, sans-serif'
}

function geometry(element: PresentationElement): { x: number; y: number; width: number; height: number } {
  return {
    x: finite(element.x, 0) * 16,
    y: finite(element.y, 0) * 9,
    width: Math.max(1, finite(element.width, 1) * 16),
    height: Math.max(1, finite(element.height, 1) * 9)
  }
}

function setTransform(node: SVGElement, element: PresentationElement): void {
  const box = geometry(element)
  const rotation = finite(element.rotation, 0)
  if (rotation !== 0) {
    node.setAttribute(
      'transform',
      `rotate(${rotation} ${box.x + box.width / 2} ${box.y + box.height / 2})`
    )
  }
  node.setAttribute('opacity', String(clamp(finite(element.opacity, 1), 0, 1)))
}

function renderTextElement(
  group: SVGGElement,
  element: PresentationTextElement,
  interactive: boolean
): void {
  const box = geometry(element)
  const hit = svg('rect')
  hit.setAttribute('x', String(box.x))
  hit.setAttribute('y', String(box.y))
  hit.setAttribute('width', String(box.width))
  hit.setAttribute('height', String(box.height))
  hit.setAttribute('fill', 'transparent')
  group.append(hit)

  const fontSize = clamp(finite(element.fontSize, 48), 8, 240)
  const editing = interactive && inlineEditingId === element.id
  const frame = svg('foreignObject')
  frame.classList.add('canvas-text-frame')
  if (editing) frame.classList.add('is-editing')
  frame.setAttribute('x', String(box.x))
  frame.setAttribute('y', String(box.y))
  frame.setAttribute('width', String(box.width))
  frame.setAttribute('height', String(box.height))

  const shell = html('div')
  shell.className = 'canvas-text-shell'
  shell.style.justifyContent = element.verticalAlign === 'bottom'
    ? 'flex-end'
    : element.verticalAlign === 'middle' ? 'center' : 'flex-start'

  const content = html('div')
  content.className = 'canvas-text-content'
  content.style.color = element.color
  content.style.fontSize = `${fontSize}px`
  content.style.fontWeight = String(element.fontWeight)
  content.style.fontFamily = fontFamily(element.fontFamily ?? project?.theme.fontFamily ?? 'sans')
  content.style.textAlign = element.align
  content.textContent = editing ? (inlineDraft ?? element.text) : element.text
  if (editing) {
    content.contentEditable = 'plaintext-only'
    content.spellcheck = false
    content.setAttribute('role', 'textbox')
    content.setAttribute('aria-label', 'Edit text on slide')
    content.setAttribute('aria-multiline', 'true')
  }
  shell.append(content)
  frame.append(shell)
  group.append(frame)
}

function renderShapeElement(group: SVGGElement, element: PresentationShapeElement): void {
  const box = geometry(element)
  if (element.shape === 'ellipse') {
    const ellipse = svg('ellipse')
    ellipse.setAttribute('cx', String(box.x + box.width / 2))
    ellipse.setAttribute('cy', String(box.y + box.height / 2))
    ellipse.setAttribute('rx', String(box.width / 2))
    ellipse.setAttribute('ry', String(box.height / 2))
    ellipse.setAttribute('fill', element.fillColor)
    ellipse.setAttribute('stroke', element.strokeColor)
    ellipse.setAttribute('stroke-width', String(element.strokeWidth))
    group.append(ellipse)
    return
  }
  if (element.shape === 'line') {
    const line = svg('line')
    line.setAttribute('x1', String(box.x))
    line.setAttribute('y1', String(box.y + box.height / 2))
    line.setAttribute('x2', String(box.x + box.width))
    line.setAttribute('y2', String(box.y + box.height / 2))
    line.setAttribute('stroke', element.strokeColor)
    line.setAttribute('stroke-width', String(Math.max(1, element.strokeWidth)))
    line.setAttribute('stroke-linecap', 'round')
    group.append(line)
    return
  }
  const rect = svg('rect')
  rect.setAttribute('x', String(box.x))
  rect.setAttribute('y', String(box.y))
  rect.setAttribute('width', String(box.width))
  rect.setAttribute('height', String(box.height))
  rect.setAttribute('rx', String(Math.max(0, element.cornerRadius)))
  rect.setAttribute('fill', element.fillColor)
  rect.setAttribute('stroke', element.strokeColor)
  rect.setAttribute('stroke-width', String(element.strokeWidth))
  group.append(rect)
}

function imageMime(path: string): string | null {
  const lower = path.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  return null
}

function imageExtension(path: string): 'png' | 'jpg' | 'jpeg' | 'gif' | 'webp' | null {
  const match = path.toLowerCase().match(/\.([a-z0-9]+)$/u)
  const extension = match?.[1]
  return extension === 'png' || extension === 'jpg' || extension === 'jpeg'
    || extension === 'gif' || extension === 'webp'
    ? extension
    : null
}

function safeAssetStem(value: string, fallback: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/\.[^.]+$/u, '')
    .replace(/[^A-Za-z0-9_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48)
  return normalized || fallback
}

async function importedImagePath(file: File): Promise<string> {
  const extension = imageExtension(file.name)
  if (!extension || imageMime(file.name) === null) {
    throw new Error('Choose a PNG, JPEG, GIF, or WebP image.')
  }
  const declaredMime = file.type.trim().toLowerCase()
  if (declaredMime && !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(declaredMime)) {
    throw new Error('Choose a PNG, JPEG, GIF, or WebP image.')
  }
  let directory = ''
  try {
    const assets = await client.workspace.stat('assets')
    if (assets.type === 'directory') directory = 'assets/'
  } catch {
    // Extension API v1 cannot create directories. A unique root-level asset
    // remains workspace-confined when the conventional assets directory is absent.
  }
  const deck = safeAssetStem(activePath.replace(/\.kun-ppt\.html$/u, ''), 'presentation')
  const source = safeAssetStem(file.name, 'image')
  const nonce = globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 12)
    ?? Math.random().toString(36).slice(2, 14)
  return assertImagePath(
    `${directory}kun-ppt-${deck}-${source}-${Date.now().toString(36)}-${nonce}.${extension}`
  )
}

function readImportedImage(file: File): Promise<string> {
  if (file.size <= 0) return Promise.reject(new Error('The selected image is empty.'))
  if (file.size > MAX_IMPORTED_IMAGE_BYTES) {
    return Promise.reject(new Error('The selected image is too large. Choose an image smaller than 6 MiB.'))
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener(
      'error',
      () => reject(new Error('Kun could not read the selected image.')),
      { once: true }
    )
    reader.addEventListener('load', () => {
      const value = reader.result
      if (typeof value !== 'string') {
        reject(new Error('Kun could not read the selected image.'))
        return
      }
      const separator = value.indexOf(',')
      const content = separator >= 0 ? value.slice(separator + 1) : ''
      if (!value.slice(0, separator).endsWith(';base64') || !content
        || content.length > MAX_IMAGE_BASE64_CHARS) {
        reject(new Error('The selected image is too large or has an unsupported encoding.'))
        return
      }
      resolve(content)
    }, { once: true })
    reader.readAsDataURL(file)
  })
}

async function importSelectedImage(file: File): Promise<void> {
  const path = await importedImagePath(file)
  const content = await readImportedImage(file)
  await client.workspace.writeFile({ path, content, encoding: 'base64' })
  await resolveImage(path)
  insertElement(createImageElement(makeId('image'), path, { alt: file.name }), 'add image')
}

function assertImagePath(path: string): string {
  const normalized = path.trim().replaceAll('\\', '/')
  const segments = normalized.split('/')
  if (
    !normalized ||
    normalized.length > 260 ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/u.test(normalized) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(normalized) ||
    // eslint-disable-next-line no-control-regex -- path validation intentionally matches ASCII controls
    /[\u0000-\u001F\u007F%:*?"<>|#]/u.test(normalized) ||
    segments.some((part) => part === '' || part === '.' || part === '..') ||
    imageMime(normalized) === null
  ) {
    throw new Error('Use a workspace-relative PNG, JPEG, GIF, or WebP path.')
  }
  return normalized
}

async function resolveImage(path: string): Promise<string> {
  const normalized = assertImagePath(path)
  const current = imageCache.get(normalized)
  if (current?.state === 'ready') return current.url
  if (current?.state === 'error') throw new Error(current.message)
  imageCache.set(normalized, { state: 'loading' })
  try {
    const file = await client.workspace.readFile(normalized, 'base64')
    if (file.encoding !== 'base64' || file.content.length > MAX_IMAGE_BASE64_CHARS) {
      throw new Error('The image is too large for the editor preview.')
    }
    const mime = imageMime(normalized)
    if (!mime) throw new Error('Unsupported image format.')
    const url = `data:${mime};base64,${file.content}`
    imageCache.set(normalized, { state: 'ready', url })
    return url
  } catch (error) {
    const message = errorMessage(error)
    imageCache.set(normalized, { state: 'error', message })
    throw error
  }
}

function requestImage(path: string): ImageCacheEntry | undefined {
  const normalized = path.trim().replaceAll('\\', '/')
  const cached = imageCache.get(normalized)
  if (!cached) {
    void resolveImage(normalized)
      .then(() => renderAllVisuals())
      .catch(() => renderAllVisuals())
    return { state: 'loading' }
  }
  return cached
}

function renderImageElement(group: SVGGElement, element: PresentationImageElement): void {
  const box = geometry(element)
  let cache: ImageCacheEntry | undefined
  try {
    cache = requestImage(assertImagePath(element.src))
  } catch (error) {
    cache = { state: 'error', message: errorMessage(error) }
  }
  if (cache?.state === 'ready') {
    const image = svg('image')
    image.setAttribute('x', String(box.x))
    image.setAttribute('y', String(box.y))
    image.setAttribute('width', String(box.width))
    image.setAttribute('height', String(box.height))
    image.setAttribute('href', cache.url)
    image.setAttribute('preserveAspectRatio', element.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet')
    image.setAttribute('aria-label', element.alt || element.src)
    group.append(image)
    return
  }
  const placeholder = svg('rect')
  placeholder.classList.add('image-placeholder')
  placeholder.setAttribute('x', String(box.x))
  placeholder.setAttribute('y', String(box.y))
  placeholder.setAttribute('width', String(box.width))
  placeholder.setAttribute('height', String(box.height))
  group.append(placeholder)
  const mark = svg('text')
  mark.classList.add('image-placeholder-mark')
  mark.setAttribute('x', String(box.x + box.width / 2))
  mark.setAttribute('y', String(box.y + box.height / 2))
  mark.textContent = cache?.state === 'error' ? '!' : '…'
  group.append(mark)
}

function renderElement(element: PresentationElement, interactive: boolean): SVGGElement {
  const group = svg('g')
  group.classList.add('canvas-item')
  group.dataset.elementId = element.id
  group.dataset.kind = element.type
  if (interactive) {
    group.setAttribute('role', 'button')
    group.setAttribute('tabindex', '0')
    group.setAttribute('aria-label', `${element.type} element ${element.id}`)
  }
  setTransform(group, element)
  if (element.type === 'text') renderTextElement(group, element, interactive)
  else if (element.type === 'shape') renderShapeElement(group, element)
  else renderImageElement(group, element)
  return group
}

function projectElementForRender(element: PresentationElement): PresentationElement {
  if (pointerSession?.elementId === element.id) return pointerSession.preview
  return element
}

function renderSelection(element: PresentationElement | null): void {
  ui.canvasSelection.replaceChildren()
  if (!element || inlineEditingId === element.id) return
  const box = geometry(projectElementForRender(element))
  const outline = svg('rect')
  outline.classList.add('selection-outline')
  outline.setAttribute('x', String(box.x))
  outline.setAttribute('y', String(box.y))
  outline.setAttribute('width', String(box.width))
  outline.setAttribute('height', String(box.height))
  ui.canvasSelection.append(outline)
  const handles: Array<['nw' | 'ne' | 'se' | 'sw', number, number]> = [
    ['nw', box.x, box.y],
    ['ne', box.x + box.width, box.y],
    ['se', box.x + box.width, box.y + box.height],
    ['sw', box.x, box.y + box.height]
  ]
  for (const [name, x, y] of handles) {
    const handle = svg('rect')
    handle.classList.add('selection-handle')
    handle.dataset.handle = name
    handle.setAttribute('x', String(x - 9))
    handle.setAttribute('y', String(y - 9))
    handle.setAttribute('width', '18')
    handle.setAttribute('height', '18')
    handle.setAttribute('rx', '3')
    ui.canvasSelection.append(handle)
  }
}

function renderCanvas(): void {
  const focusedElementId = document.activeElement instanceof SVGElement
    ? document.activeElement.closest<SVGGElement>('[data-element-id]')?.dataset.elementId
    : undefined
  const slide = currentSlide()
  if (!project || !slide) {
    ui.canvas.setAttribute('hidden', '')
    ui.canvasEmpty.hidden = false
    ui.canvasElements.replaceChildren()
    ui.canvasSelection.replaceChildren()
    return
  }
  ui.canvas.removeAttribute('hidden')
  ui.canvasEmpty.hidden = true
  ui.canvasBackground.setAttribute('fill', slide.backgroundColor ?? project.theme.backgroundColor)
  ui.canvasElements.replaceChildren(
    ...slide.elements.map((element) => renderElement(projectElementForRender(element), true))
  )
  const selected = currentElement()
  renderSelection(selected)
  ui.canvasCaption.textContent = `16:9 · ${slide.title} · revision ${project.revision}`
  ui.selectionCaption.textContent = selected
    ? `${selected.type} · ${selected.id}`
    : 'Nothing selected'
  if (focusedElementId && focusedElementId === selected?.id && inlineEditingId === null) {
    focusCanvasElement(focusedElementId)
  }
}

function slideTitle(slide: PresentationSlide, index: number): string {
  return slide.title.trim() || `Slide ${index + 1}`
}

function renderSlideList(): void {
  if (!project) {
    ui.slideList.replaceChildren()
    ui.deckTitle.textContent = 'Untitled presentation'
    return
  }
  ui.deckTitle.textContent = project.title
  const cards = project.slides.map((slide, index) => {
    const item = html('li')
    const card = html('button')
    card.type = 'button'
    card.className = 'slide-card'
    card.dataset.slideId = slide.id
    card.setAttribute('role', 'option')
    card.setAttribute('aria-selected', String(slide.id === selectedSlideId))
    card.draggable = !conflicted

    const number = html('span')
    number.className = 'slide-card-number'
    number.textContent = String(index + 1)
    const shell = html('span')
    shell.className = 'slide-thumbnail-shell'
    const thumbnail = html('span')
    thumbnail.className = 'slide-thumbnail'
    const preview = svg('svg')
    preview.setAttribute('viewBox', '0 0 1600 900')
    preview.setAttribute('aria-hidden', 'true')
    const background = svg('rect')
    background.setAttribute('x', '0')
    background.setAttribute('y', '0')
    background.setAttribute('width', '1600')
    background.setAttribute('height', '900')
    background.setAttribute('fill', slide.backgroundColor ?? project!.theme.backgroundColor)
    preview.append(background, ...slide.elements.map((element) => renderElement(element, false)))
    thumbnail.append(preview)
    const title = html('span')
    title.className = 'slide-thumbnail-title'
    title.textContent = slideTitle(slide, index)
    shell.append(thumbnail, title)
    card.append(number, shell)
    card.addEventListener('click', () => selectSlide(slide.id))
    card.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault()
        reorderSlide(slide.id, Math.max(0, index - 1))
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault()
        reorderSlide(slide.id, Math.min(project!.slides.length - 1, index + 1))
      }
    })
    card.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/plain', slide.id)
      card.dataset.dragging = 'true'
    })
    card.addEventListener('dragend', () => {
      delete card.dataset.dragging
      for (const node of ui.slideList.querySelectorAll<HTMLElement>('[data-drop-target]')) {
        delete node.dataset.dropTarget
      }
    })
    card.addEventListener('dragover', (event) => {
      if (conflicted) return
      event.preventDefault()
      const before = event.clientY < card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2
      card.dataset.dropTarget = before ? 'before' : 'after'
    })
    card.addEventListener('dragleave', () => delete card.dataset.dropTarget)
    card.addEventListener('drop', (event) => {
      event.preventDefault()
      const draggedId = event.dataTransfer?.getData('text/plain')
      if (!draggedId || draggedId === slide.id) return
      const remaining = project!.slides.filter((candidate) => candidate.id !== draggedId)
      const target = remaining.findIndex((candidate) => candidate.id === slide.id)
      const insertAfter = card.dataset.dropTarget === 'after'
      reorderSlide(draggedId, clamp(target + (insertAfter ? 1 : 0), 0, remaining.length))
    })
    item.append(card)
    return item
  })
  ui.slideList.replaceChildren(...cards)
}

function renderPreview(): void {
  if (!project || project.slides.length === 0) return
  previewIndex = clamp(previewIndex, 0, project.slides.length - 1)
  const slide = project.slides[previewIndex]
  ui.previewBackground.setAttribute('fill', slide.backgroundColor ?? project.theme.backgroundColor)
  ui.previewElements.replaceChildren(...slide.elements.map((element) => renderElement(element, false)))
  ui.previewPosition.textContent = `${previewIndex + 1} / ${project.slides.length}`
  ui.previewPrev.disabled = previewIndex === 0
  ui.previewNext.disabled = previewIndex === project.slides.length - 1
  ui.previewCanvas.setAttribute('aria-label', `Preview: ${slideTitle(slide, previewIndex)}`)
}

function renderAllVisuals(): void {
  renderSlideList()
  renderCanvas()
  if (ui.previewDialog.open) renderPreview()
}

function commitProject(next: PresentationProject, responsePath: string, selectedId?: string): void {
  project = next
  activePath = responsePath
  ui.path.value = responsePath
  selectedSlideId = next.slides.some((slide) => slide.id === selectedId)
    ? selectedId!
    : next.slides[0]?.id ?? null
  selectedElementId = null
  pendingOperations = []
  undoStack = []
  redoStack = []
  pointerSession = null
  inlineEditingId = null
  imageCache.clear()
  clearConflict()
  setSaveStatus(`Loaded revision ${next.revision}`, 'saved')
  renderAll()
  scheduleViewState()
}

function renderAll(): void {
  renderAllVisuals()
  renderInspector()
  renderControls()
}

function selectSlide(slideId: string): void {
  if (!project?.slides.some((slide) => slide.id === slideId)) return
  commitInlineEdit()
  selectedSlideId = slideId
  selectedElementId = null
  previewIndex = project.slides.findIndex((slide) => slide.id === slideId)
  setActivePanel('canvas')
  renderAll()
  scheduleViewState()
}

function selectElement(elementId: string | null): void {
  if (inlineEditingId && inlineEditingId !== elementId) commitInlineEdit()
  selectedElementId = elementId
  renderCanvas()
  renderInspector()
  renderControls()
}

function focusCanvasElement(elementId: string): void {
  const node = [...ui.canvasElements.querySelectorAll<SVGGElement>('[data-element-id]')]
    .find((candidate) => candidate.dataset.elementId === elementId)
  node?.focus({ preventScroll: true })
}

function localApply(
  operations: PresentationOperation[],
  label: string,
  options: { recordHistory?: boolean } = {}
): boolean {
  if (!project || conflicted || operations.length === 0) return false
  try {
    const result = applyPresentationOperations(project, operations)
    project = result.project
    pendingOperations.push(...operations)
    if (options.recordHistory !== false) {
      undoStack.push({ forward: operations, inverse: result.inverseOperations, label })
      if (undoStack.length > 100) undoStack.shift()
      redoStack = []
    }
    if (pendingOperations.length >= MAX_PRESENTATION_OPERATIONS) scheduleSave(0)
    else scheduleSave()
    setSaveStatus(`Unsaved · ${label}`, 'saving')
    renderAll()
    return true
  } catch (error) {
    setSaveStatus(errorMessage(error), 'error')
    return false
  }
}

function scheduleSave(delay = SAVE_DEBOUNCE_MS): void {
  if (saveTimer) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = 0
    void flushPending('autosave').catch(() => undefined)
  }, delay)
}

async function flushPending(reason: string): Promise<void> {
  if (saveTimer) {
    window.clearTimeout(saveTimer)
    saveTimer = 0
  }
  if (savePromise) {
    await savePromise
    if (pendingOperations.length > 0 && !conflicted) await flushPending(reason)
    return
  }
  if (!project || !activePath || pendingOperations.length === 0) {
    if (conflicted) throw new Error('Reload the conflicted deck before continuing.')
    return
  }
  if (conflicted) throw new Error('Reload the conflicted deck before continuing.')

  const batch = pendingOperations.splice(0, MAX_PRESENTATION_OPERATIONS)
  const expectedRevision = project.revision
  ownSaveTargetRevision = expectedRevision + 1
  setSaveStatus(`Saving ${batch.length} edit${batch.length === 1 ? '' : 's'}…`, 'saving')
  savePromise = (async () => {
    try {
      const response = await executeCommand<SaveResponse>('presentation-save', {
        path: activePath,
        expectedRevision,
        operations: batch,
        operationId: makeId(`ui-${reason}`)
      } as unknown as JsonObject)
      if (!project) return
      if (pendingOperations.length === 0) {
        project = response.project
      } else {
        project = {
          ...project,
          revision: response.currentRevision,
          operationReceipts: response.project.operationReceipts
        }
      }
      setSaveStatus(
        response.warnings.length > 0
          ? `Saved revision ${response.currentRevision} · ${response.warnings.length} warning(s)`
          : `Saved revision ${response.currentRevision}`,
        'saved'
      )
      renderAll()
      scheduleViewState()
    } catch (error) {
      pendingOperations.unshift(...batch)
      const message = errorMessage(error)
      if (/revision|conflict|stale/i.test(message)) setConflict(message)
      else setSaveStatus(`Save failed: ${message}`, 'error')
      throw error
    } finally {
      ownSaveTargetRevision = null
      savePromise = null
    }
  })()
  await savePromise
  if (pendingOperations.length > 0 && !conflicted) await flushPending(reason)
}

function undo(): void {
  const entry = undoStack.pop()
  if (!entry || !project || conflicted) return
  try {
    const result = applyPresentationOperations(project, entry.inverse)
    project = result.project
    pendingOperations.push(...entry.inverse)
    redoStack.push(entry)
    scheduleSave()
    setSaveStatus(`Unsaved · undo ${entry.label}`, 'saving')
    renderAll()
  } catch (error) {
    undoStack.push(entry)
    setSaveStatus(errorMessage(error), 'error')
  }
}

function redo(): void {
  const entry = redoStack.pop()
  if (!entry || !project || conflicted) return
  try {
    const result = applyPresentationOperations(project, entry.forward)
    project = result.project
    pendingOperations.push(...entry.forward)
    undoStack.push(entry)
    scheduleSave()
    setSaveStatus(`Unsaved · redo ${entry.label}`, 'saving')
    renderAll()
  } catch (error) {
    redoStack.push(entry)
    setSaveStatus(errorMessage(error), 'error')
  }
}

function addSlide(): void {
  if (!project) return
  const slide = createPresentationSlide(makeId('slide'), `Slide ${project.slides.length + 1}`)
  const index = Math.max(0, project.slides.findIndex((candidate) => candidate.id === selectedSlideId) + 1)
  if (localApply([{ kind: 'slide.insert', slide, index }], 'add slide')) selectSlide(slide.id)
}

function duplicateSlide(): void {
  const source = currentSlide()
  if (!source || !project) return
  const copy: PresentationSlide = {
    ...structuredClone(source),
    id: makeId('slide'),
    title: `${source.title.slice(0, 115)} copy`,
    elements: source.elements.map((element) => ({ ...element, id: makeId(element.type) }))
  }
  const index = project.slides.findIndex((slide) => slide.id === source.id) + 1
  if (localApply([{ kind: 'slide.insert', slide: copy, index }], 'duplicate slide')) selectSlide(copy.id)
}

function deleteSlide(): void {
  const slide = currentSlide()
  if (!slide || !project || project.slides.length <= 1) return
  const index = project.slides.findIndex((candidate) => candidate.id === slide.id)
  const nextId = project.slides[index + 1]?.id ?? project.slides[index - 1]?.id ?? null
  if (localApply([{ kind: 'slide.delete', slideId: slide.id }], 'delete slide')) {
    selectedSlideId = nextId
    selectedElementId = null
    renderAll()
  }
}

function reorderSlide(slideId: string, index: number): void {
  if (!project || conflicted) return
  const current = project.slides.findIndex((slide) => slide.id === slideId)
  if (current < 0 || current === index) return
  localApply([{ kind: 'slide.reorder', slideId, index }], 'reorder slide')
  selectedSlideId = slideId
  renderAll()
}

function insertElement(element: PresentationElement, label: string): void {
  const slide = currentSlide()
  if (!slide) return
  if (localApply([{ kind: 'element.upsert', slideId: slide.id, element }], label)) {
    selectedElementId = element.id
    renderAll()
  }
}

function upsertElement(element: PresentationElement, label: string): void {
  const slide = currentSlide()
  if (!slide) return
  localApply([{ kind: 'element.upsert', slideId: slide.id, element }], label)
}

function reorderElement(elementId: string, index: number): void {
  const slide = currentSlide()
  if (!slide || conflicted) return
  const current = slide.elements.findIndex((element) => element.id === elementId)
  const boundedIndex = clamp(index, 0, slide.elements.length - 1)
  if (current < 0 || current === boundedIndex) return
  const element = slide.elements[current]!
  selectedElementId = element.id
  localApply([{
    kind: 'element.upsert',
    slideId: slide.id,
    element,
    index: boundedIndex
  }], boundedIndex > current ? 'bring layer forward' : 'send layer backward')
}

function deleteSelectedElement(): void {
  const slide = currentSlide()
  const element = currentElement()
  if (!slide || !element) return
  inlineEditingId = null
  inlineDraft = null
  if (localApply([{ kind: 'element.delete', slideId: slide.id, elementId: element.id }], 'delete element')) {
    selectedElementId = null
    renderAll()
  }
}

function beginInlineEdit(element: PresentationTextElement): void {
  if (conflicted) return
  if (inlineEditingId === element.id) {
    inlineEditorNode()?.focus()
    return
  }
  inlineEditingId = element.id
  inlineDraft = element.text
  selectedElementId = element.id
  renderCanvas()
  window.setTimeout(() => focusInlineEditorAtEnd(), 0)
}

function commitInlineEdit(cancel = false): void {
  if (!inlineEditingId) return
  const element = currentElement()
  const currentText = element?.type === 'text' ? element.text : ''
  const nextText = inlineEditorNode()?.innerText.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
    ?? inlineDraft
    ?? currentText
  inlineEditingId = null
  inlineDraft = null
  if (!cancel && element?.type === 'text' && nextText !== element.text) {
    upsertElement({ ...element, text: nextText }, 'edit text')
  } else {
    renderCanvas()
  }
}

function inlineEditorNode(): HTMLElement | null {
  if (!inlineEditingId) return null
  for (const editor of ui.canvasElements.querySelectorAll<HTMLElement>(
    '.canvas-text-content[contenteditable]'
  )) {
    const item = editor.closest<SVGGElement>('[data-element-id]')
    if (item?.dataset.elementId === inlineEditingId) return editor
  }
  return null
}

function focusInlineEditorAtEnd(): void {
  const editor = inlineEditorNode()
  if (!editor) return
  editor.focus()
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()
  range.selectNodeContents(editor)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

function beginPointer(event: PointerEvent): void {
  if (event.button !== 0 || conflicted) return
  if (event.target instanceof Element
    && event.target.closest('.canvas-text-content[contenteditable]')) return
  const slide = currentSlide()
  if (!slide) return
  const target = event.target instanceof Element ? event.target : null
  const handle = target?.closest<SVGElement>('[data-handle]')?.dataset.handle as PointerSession['handle']
  const elementNode = target?.closest<SVGElement>('[data-element-id]')
  const elementId = handle ? selectedElementId : elementNode?.dataset.elementId
  const element = slide.elements.find((candidate) => candidate.id === elementId)
  if (!element) {
    recentPointerSelection = null
    if (!handle) selectElement(null)
    return
  }
  const isRepeatedTextSelection = !handle
    && element.type === 'text'
    && recentPointerSelection?.elementId === element.id
    && event.timeStamp - recentPointerSelection.at <= INLINE_EDIT_DOUBLE_CLICK_MS
  recentPointerSelection = handle ? null : { elementId: element.id, at: event.timeStamp }
  if (isRepeatedTextSelection && element.type === 'text') {
    event.preventDefault()
    beginInlineEdit(element)
    return
  }
  event.preventDefault()
  selectedElementId = element.id
  pointerSession = {
    pointerId: event.pointerId,
    slideId: slide.id,
    elementId: element.id,
    mode: handle ? 'resize' : 'move',
    ...(handle ? { handle } : {}),
    startClientX: event.clientX,
    startClientY: event.clientY,
    original: structuredClone(element),
    preview: structuredClone(element)
  }
  ui.canvas.setPointerCapture(event.pointerId)
  renderCanvas()
  renderInspector()
  focusCanvasElement(element.id)
}

function updatePointer(event: PointerEvent): void {
  const session = pointerSession
  if (!session || session.pointerId !== event.pointerId) return
  event.preventDefault()
  const rect = ui.canvas.getBoundingClientRect()
  const dx = ((event.clientX - session.startClientX) / Math.max(1, rect.width)) * 100
  const dy = ((event.clientY - session.startClientY) / Math.max(1, rect.height)) * 100
  const original = session.original
  let x = original.x
  let y = original.y
  let width = original.width
  let height = original.height
  if (session.mode === 'move') {
    x = clamp(original.x + dx, 0, 100 - original.width)
    y = clamp(original.y + dy, 0, 100 - original.height)
  } else {
    const min = 2
    if (session.handle === 'nw' || session.handle === 'sw') {
      x = clamp(original.x + dx, 0, original.x + original.width - min)
      width = original.width + (original.x - x)
    } else {
      width = clamp(original.width + dx, min, 100 - original.x)
    }
    if (session.handle === 'nw' || session.handle === 'ne') {
      y = clamp(original.y + dy, 0, original.y + original.height - min)
      height = original.height + (original.y - y)
    } else {
      height = clamp(original.height + dy, min, 100 - original.y)
    }
  }
  session.preview = { ...original, x, y, width, height }
  renderCanvas()
}

function endPointer(event: PointerEvent): void {
  const session = pointerSession
  if (!session || session.pointerId !== event.pointerId) return
  pointerSession = null
  if (ui.canvas.hasPointerCapture(event.pointerId)) ui.canvas.releasePointerCapture(event.pointerId)
  const changed = ['x', 'y', 'width', 'height'].some(
    (key) => session.preview[key as 'x'] !== session.original[key as 'x']
  )
  if (changed) upsertElement(session.preview, session.mode === 'move' ? 'move element' : 'resize element')
  else renderAll()
  focusCanvasElement(session.elementId)
}

function field(
  labelText: string,
  value: string,
  onChange: (value: string) => void,
  options: { type?: string; min?: string; max?: string; step?: string; multiline?: boolean } = {}
): HTMLLabelElement {
  const label = html('label')
  label.className = 'field'
  const caption = html('span')
  caption.textContent = labelText
  const control = options.multiline ? html('textarea') : html('input')
  if (control instanceof HTMLInputElement) {
    control.type = options.type ?? 'text'
    if (options.min) control.min = options.min
    if (options.max) control.max = options.max
    if (options.step) control.step = options.step
  }
  control.value = value
  control.disabled = conflicted
  if (options.multiline) {
    control.addEventListener('blur', () => {
      if (control.value !== value) onChange(control.value)
    })
  } else {
    control.addEventListener('change', () => onChange(control.value))
  }
  label.append(caption, control)
  return label
}

function selectField<T extends string>(
  labelText: string,
  value: T,
  choices: readonly T[],
  onChange: (value: T) => void
): HTMLLabelElement {
  const label = html('label')
  label.className = 'field'
  const caption = html('span')
  caption.textContent = labelText
  const select = html('select')
  select.disabled = conflicted
  for (const choice of choices) {
    const option = html('option')
    option.value = choice
    option.textContent = choice
    option.selected = choice === value
    select.append(option)
  }
  select.addEventListener('change', () => onChange(select.value as T))
  label.append(caption, select)
  return label
}

function section(titleText: string, ...children: HTMLElement[]): HTMLElement {
  const node = html('section')
  node.className = 'inspector-section'
  const title = html('h3')
  title.textContent = titleText
  node.append(title, ...children)
  return node
}

function elementTag(element: PresentationElement): 'div' | 'img' {
  return element.type === 'image' ? 'img' : 'div'
}

function layerSection(slide: PresentationSlide): HTMLElement {
  const list = html('div')
  list.className = 'layer-tree'
  if (slide.elements.length === 0) {
    const empty = html('p')
    empty.className = 'muted'
    empty.textContent = 'This slide has no editable DIV or image elements yet.'
    list.append(empty)
    return section('DOM / Layers', list)
  }

  const layers = slide.elements.map((element, index) => ({ element, index })).reverse()
  for (const { element, index } of layers) {
    const row = html('div')
    row.className = 'layer-row'
    row.dataset.selected = String(element.id === selectedElementId)

    const select = html('button')
    select.type = 'button'
    select.className = 'layer-select'
    select.setAttribute('aria-pressed', String(element.id === selectedElementId))
    select.title = `Select ${element.type} ${element.id}`
    const tag = html('code')
    tag.className = 'layer-tag'
    tag.textContent = `<${elementTag(element)}>`
    const name = html('span')
    name.className = 'layer-name'
    name.textContent = `${element.type} · ${element.id}`
    select.append(tag, name)
    select.addEventListener('click', () => selectElement(element.id))

    const actions = html('span')
    actions.className = 'layer-actions'
    const forward = html('button')
    forward.type = 'button'
    forward.className = 'layer-order-button'
    forward.textContent = '↑'
    forward.title = 'Bring forward'
    forward.setAttribute('aria-label', `Bring ${element.id} forward`)
    forward.disabled = conflicted || index === slide.elements.length - 1
    forward.addEventListener('click', () => reorderElement(element.id, index + 1))
    const backward = html('button')
    backward.type = 'button'
    backward.className = 'layer-order-button'
    backward.textContent = '↓'
    backward.title = 'Send backward'
    backward.setAttribute('aria-label', `Send ${element.id} backward`)
    backward.disabled = conflicted || index === 0
    backward.addEventListener('click', () => reorderElement(element.id, index - 1))
    actions.append(forward, backward)
    row.append(select, actions)
    list.append(row)
  }
  return section('DOM / Layers', list)
}

function cssEditorSection(element: PresentationElement): HTMLElement {
  const editor = html('div')
  editor.className = 'css-editor'
  const selector = html('code')
  selector.className = 'css-selector'
  selector.textContent = `${elementTag(element)}[data-kun-element-id="${element.id}"]`
  const textarea = html('textarea')
  textarea.className = 'css-declarations'
  textarea.value = serializeEditableElementCss(element)
  textarea.spellcheck = false
  textarea.disabled = conflicted
  textarea.setAttribute('aria-label', `Editable CSS declarations for ${element.id}`)
  const help = html('small')
  help.className = 'css-help'
  help.textContent = `Allowed: ${editableCssPropertiesForElement(element).join(', ')}`
  const error = html('p')
  error.className = 'field-error css-error'
  error.setAttribute('role', 'alert')
  const apply = html('button')
  apply.type = 'button'
  apply.className = 'button button-primary button-compact'
  apply.textContent = 'Apply CSS'
  apply.disabled = conflicted
  apply.addEventListener('click', () => {
    try {
      const slide = currentSlide()
      if (!slide) return
      applyEditableElementCss(element, textarea.value)
      error.textContent = ''
      localApply([{
        kind: 'element.style',
        slideId: slide.id,
        elementId: element.id,
        css: textarea.value
      }], 'edit element CSS')
    } catch (cause) {
      error.textContent = errorMessage(cause)
    }
  })
  editor.append(selector, textarea, help, error, apply)
  return section('Safe CSS', editor)
}

function geometryFields(element: PresentationElement): HTMLElement {
  const grid = html('div')
  grid.className = 'inspector-grid'
  const number = (name: 'x' | 'y' | 'width' | 'height', label: string): HTMLLabelElement => {
    const min = name === 'width' || name === 'height' ? 0.1 : 0
    const max = name === 'x'
      ? 100 - element.width
      : name === 'y'
        ? 100 - element.height
        : name === 'width'
          ? 100 - element.x
          : 100 - element.y
    return field(
      label,
      String(element[name]),
      (value) => upsertElement({ ...element, [name]: clamp(Number(value), min, max) }, `change ${label}`),
      { type: 'number', min: String(min), max: String(max), step: '0.1' }
    )
  }
  grid.append(number('x', 'X %'), number('y', 'Y %'), number('width', 'Width %'), number('height', 'Height %'))
  return grid
}

function renderInspector(): void {
  ui.inspectorBody.replaceChildren()
  const slide = currentSlide()
  const element = currentElement()
  if (!project || !slide) {
    ui.inspectorTitle.textContent = 'No selection'
    const message = html('p')
    message.className = 'muted'
    message.textContent = 'Open or create a deck to edit its properties.'
    ui.inspectorBody.append(message)
    return
  }
  if (!element) {
    ui.inspectorTitle.textContent = slide.title
    ui.inspectorBody.append(
      section(
        'Document',
        field('Deck title', project.title, (title) => localApply([{ kind: 'document.update', patch: { title } }], 'rename deck')),
        selectField('Typeface', project.theme.fontFamily, ['sans', 'serif', 'mono'] as const, (fontFamily) =>
          localApply([{ kind: 'document.update', patch: { theme: { fontFamily } } }], 'change typeface')),
        field('Deck background', project.theme.backgroundColor, (backgroundColor) =>
          localApply([{ kind: 'document.update', patch: { theme: { backgroundColor } } }], 'change deck background'), { type: 'color' }),
        field('Text color', project.theme.textColor, (textColor) =>
          localApply([{ kind: 'document.update', patch: { theme: { textColor } } }], 'change text color'), { type: 'color' }),
        field('Accent color', project.theme.accentColor, (accentColor) =>
          localApply([{ kind: 'document.update', patch: { theme: { accentColor } } }], 'change accent'), { type: 'color' })
      ),
      section(
        'Slide',
        field('Slide title', slide.title, (title) =>
          localApply([{ kind: 'slide.update', slideId: slide.id, patch: { title } }], 'rename slide')),
        field('Background', slide.backgroundColor ?? project.theme.backgroundColor, (backgroundColor) =>
          localApply([{ kind: 'slide.update', slideId: slide.id, patch: { backgroundColor } }], 'change slide background'), { type: 'color' })
      ),
      layerSection(slide)
    )
    return
  }

  ui.inspectorTitle.textContent = `${element.type} · ${element.id}`
  ui.inspectorBody.append(layerSection(slide))
  const common = section(
    'Layout',
    geometryFields(element),
    field('Rotation', String(element.rotation), (value) =>
      upsertElement({ ...element, rotation: clamp(Number(value), -180, 180) }, 'rotate element'),
    { type: 'number', min: '-180', max: '180', step: '1' }),
    field('Opacity', String(element.opacity), (value) =>
      upsertElement({ ...element, opacity: clamp(Number(value), 0, 1) }, 'change opacity'),
    { type: 'number', min: '0', max: '1', step: '0.05' })
  )
  ui.inspectorBody.append(common)

  if (element.type === 'text') {
    ui.inspectorBody.append(section(
      'Text',
      field('Content', element.text, (text) => upsertElement({ ...element, text }, 'edit text'), { multiline: true }),
      field('Font size', String(element.fontSize), (value) =>
        upsertElement({ ...element, fontSize: clamp(Number(value), 8, 240) }, 'change font size'),
      { type: 'number', min: '8', max: '240', step: '1' }),
      selectField('Weight', String(element.fontWeight), ['400', '500', '600', '700'] as const, (weight) =>
        upsertElement({ ...element, fontWeight: Number(weight) as 400 | 500 | 600 | 700 }, 'change weight')),
      field('Color', element.color, (color) => upsertElement({ ...element, color }, 'change text color'), { type: 'color' }),
      selectField('Align', element.align, ['left', 'center', 'right'] as const, (align) =>
        upsertElement({ ...element, align }, 'change text align')),
      selectField('Vertical', element.verticalAlign, ['top', 'middle', 'bottom'] as const, (verticalAlign) =>
        upsertElement({ ...element, verticalAlign }, 'change vertical align'))
    ))
  } else if (element.type === 'shape') {
    ui.inspectorBody.append(section(
      'Shape',
      selectField('Kind', element.shape, ['rectangle', 'ellipse', 'line'] as const, (shape) =>
        upsertElement({ ...element, shape }, 'change shape')),
      field('Fill', element.fillColor, (fillColor) => upsertElement({ ...element, fillColor }, 'change fill'), { type: 'color' }),
      field('Stroke', element.strokeColor, (strokeColor) => upsertElement({ ...element, strokeColor }, 'change stroke'), { type: 'color' }),
      field('Stroke width', String(element.strokeWidth), (value) =>
        upsertElement({ ...element, strokeWidth: clamp(Number(value), 0, 32) }, 'change stroke width'),
      { type: 'number', min: '0', max: '32', step: '1' }),
      field('Corner radius', String(element.cornerRadius), (value) =>
        upsertElement({ ...element, cornerRadius: clamp(Number(value), 0, 100) }, 'change corner radius'),
      { type: 'number', min: '0', max: '100', step: '1' })
    ))
  } else {
    ui.inspectorBody.append(section(
      'Image',
      field('Workspace path', element.src, (src) => {
        try {
          upsertElement({ ...element, src: assertImagePath(src) }, 'change image')
        } catch (error) {
          setSaveStatus(errorMessage(error), 'error')
        }
      }),
      field('Alt text', element.alt, (alt) => upsertElement({ ...element, alt }, 'change alt text')),
      selectField('Fit', element.fit, ['contain', 'cover'] as const, (fit) =>
        upsertElement({ ...element, fit }, 'change image fit'))
    ))
  }

  ui.inspectorBody.append(cssEditorSection(element))

  const remove = html('button')
  remove.type = 'button'
  remove.className = 'button button-danger'
  remove.textContent = 'Delete element'
  remove.disabled = conflicted
  remove.addEventListener('click', deleteSelectedElement)
  ui.inspectorBody.append(remove)
}

async function loadDeck(path: string, preferredSlideId?: string): Promise<void> {
  if (pendingOperations.length > 0) await flushPending('before-load')
  setSaveStatus('Loading presentation…', 'saving')
  const response = await executeCommand<CommandResponse>('presentation-load', { path })
  commitProject(response.project, response.path, preferredSlideId)
}

async function createDeck(path: string): Promise<void> {
  if (pendingOperations.length > 0) await flushPending('before-create')
  setSaveStatus('Creating presentation…', 'saving')
  const response = await executeCommand<CommandResponse>('presentation-create', {
    path,
    title: path.replace(/\.kun-ppt\.html$/u, '').replaceAll('-', ' ')
  })
  commitProject(response.project, response.path)
}

async function latestWorkspaceDeckPath(): Promise<string | undefined> {
  const entries = await client.workspace.list('.')
  const paths = presentationPathsFromWorkspaceEntries(entries)
  const candidates = await Promise.all(paths.map(async (path) => {
    try {
      const info = await client.workspace.stat(path)
      return {
        path,
        modifiedAt: typeof info.modifiedAt === 'string' ? info.modifiedAt : ''
      }
    } catch {
      return null
    }
  }))
  return latestPresentationPath(candidates.filter((candidate) => candidate !== null))
}

function isChangedPayload(value: JsonValue): value is JsonObject & PresentationChangedPayload {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false
  return typeof value.path === 'string' &&
    typeof value.revision === 'number' &&
    (value.source === 'command' || value.source === 'tool') &&
    Array.isArray(value.changedIds)
}

async function handleHostMessage(message: HostMessage): Promise<void> {
  if (message.channel !== 'presentation.changed' || !isChangedPayload(message.payload)) return
  const change = message.payload
  if (change.source === 'command' && ownSaveTargetRevision === change.revision) return
  const action = decidePresentationChange({
    hasProject: project !== null,
    activePath,
    currentRevision: project?.revision ?? 0,
    changePath: change.path,
    changeRevision: change.revision,
    source: change.source
  })
  if (action === 'ignore') return
  if (action === 'refresh-current' && (pendingOperations.length > 0 || savePromise)) {
    setConflict(`Revision ${change.revision} arrived while local edits were pending.`)
    return
  }
  try {
    const path = action === 'follow-tool' ? change.path : activePath
    const slideId = action === 'refresh-current' ? selectedSlideId ?? undefined : undefined
    await loadDeck(path, slideId)
    setActivePanel('canvas')
    setSaveStatus(
      action === 'follow-tool'
        ? `Showing Agent presentation · revision ${change.revision}`
        : `Refreshed after ${change.source} change · revision ${change.revision}`,
      'saved'
    )
  } catch (error) {
    setConflict(`Could not refresh revision ${change.revision}: ${errorMessage(error)}`)
  }
}

function applyTheme(theme: Theme): void {
  ui.studio.dataset.theme = theme.kind
  document.documentElement.dataset.reducedMotion = String(theme.reducedMotion)
}

function bindEvents(): void {
  for (const [index, tab] of ui.panelTabs.entries()) {
    const panel = tab.dataset.studioTab
    if (!isStudioPanel(panel)) continue
    tab.addEventListener('click', () => setActivePanel(panel))
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const lastIndex = ui.panelTabs.length - 1
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? lastIndex
          : (index + (event.key === 'ArrowLeft' ? -1 : 1) + ui.panelTabs.length) % ui.panelTabs.length
      const nextPanel = ui.panelTabs[nextIndex]?.dataset.studioTab
      if (isStudioPanel(nextPanel)) setActivePanel(nextPanel, true)
    })
  }
  ui.newDeck.addEventListener('click', () => {
    void createDeck(normalizePath(ui.path.value)).catch((error) => setSaveStatus(errorMessage(error), 'error'))
  })
  ui.loadDeck.addEventListener('click', () => {
    ui.deckMenu.open = false
    void loadDeck(normalizePath(ui.path.value)).catch((error) => setSaveStatus(errorMessage(error), 'error'))
  })
  ui.reloadConflict.addEventListener('click', () => {
    pendingOperations = []
    void loadDeck(activePath, selectedSlideId ?? undefined).catch((error) => setSaveStatus(errorMessage(error), 'error'))
  })
  ui.addSlide.addEventListener('click', addSlide)
  ui.duplicateSlide.addEventListener('click', duplicateSlide)
  ui.deleteSlide.addEventListener('click', deleteSlide)
  ui.undo.addEventListener('click', undo)
  ui.redo.addEventListener('click', redo)
  ui.addText.addEventListener('click', () => {
    if (!project) return
    insertElement(createTextElement(makeId('text'), { color: project.theme.textColor }), 'add text')
  })
  ui.addShape.addEventListener('click', () => {
    if (!project) return
    insertElement(createShapeElement(makeId('shape'), {
      fillColor: project.theme.accentColor,
      strokeColor: project.theme.accentColor
    }), 'add shape')
  })
  ui.openImage.addEventListener('click', () => {
    ui.imageFilePicker.value = ''
    ui.imageFilePicker.click()
  })
  ui.imageFilePicker.addEventListener('change', () => {
    const file = ui.imageFilePicker.files?.item(0)
    if (!file) return
    ui.openImage.disabled = true
    setSaveStatus(`Importing ${file.name}…`, 'saving')
    void importSelectedImage(file)
      .catch((error) => setSaveStatus(errorMessage(error), 'error'))
      .finally(() => {
        ui.imageFilePicker.value = ''
        renderControls()
      })
  })
  ui.editSelectedText.addEventListener('click', () => {
    const element = currentElement()
    if (element?.type === 'text') beginInlineEdit(element)
  })
  ui.deleteSelectedElement.addEventListener('click', deleteSelectedElement)
  ui.openExport.addEventListener('click', () => {
    ui.deckMenu.open = false
    ui.exportError.textContent = ''
    ui.exportPath.value = activePath.replace(/\.kun-ppt\.html$/u, '-copy.kun-ppt.html')
    ui.exportDialog.showModal()
    ui.exportPath.focus()
  })
  ui.exportForm.addEventListener('submit', (event) => {
    event.preventDefault()
    void (async () => {
      if (!project) return
      await flushPending('before-copy')
      const destinationPath = normalizePath(ui.exportPath.value)
      if (destinationPath === activePath) throw new Error('Choose a different destination filename.')
      const response = await executeCommand<ExportResponse>('presentation-export-copy', {
        path: activePath,
        destinationPath,
        expectedRevision: project.revision
      })
      ui.exportDialog.close()
      setSaveStatus(`Exported ${response.destinationPath} · ${response.bytes} bytes`, 'saved')
    })().catch((error) => { ui.exportError.textContent = errorMessage(error) })
  })
  for (const close of document.querySelectorAll<HTMLButtonElement>('[data-close-dialog]')) {
    close.addEventListener('click', () => {
      const dialog = document.getElementById(close.dataset.closeDialog ?? '')
      if (dialog instanceof HTMLDialogElement) dialog.close()
    })
  }
  ui.openPreview.addEventListener('click', () => {
    if (!project) return
    previewIndex = Math.max(0, project.slides.findIndex((slide) => slide.id === selectedSlideId))
    renderPreview()
    ui.previewDialog.showModal()
  })
  ui.previewPrev.addEventListener('click', () => { previewIndex -= 1; renderPreview() })
  ui.previewNext.addEventListener('click', () => { previewIndex += 1; renderPreview() })
  ui.previewDialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); previewIndex -= 1; renderPreview() }
    if (event.key === 'ArrowRight') { event.preventDefault(); previewIndex += 1; renderPreview() }
  })

  ui.canvas.addEventListener('pointerdown', beginPointer)
  ui.canvas.addEventListener('pointermove', updatePointer)
  ui.canvas.addEventListener('pointerup', endPointer)
  ui.canvas.addEventListener('pointercancel', endPointer)
  ui.canvas.addEventListener('dblclick', (event) => {
    if (event.target instanceof Element
      && event.target.closest('.canvas-text-content[contenteditable]')) return
    const target = event.target instanceof Element ? event.target.closest<SVGElement>('[data-element-id]') : null
    const element = currentSlide()?.elements.find((candidate) => candidate.id === target?.dataset.elementId)
    if (element?.type === 'text') beginInlineEdit(element)
  })
  ui.canvas.addEventListener('keydown', (event) => {
    const inlineEditor = event.target instanceof Element
      ? event.target.closest<HTMLElement>('.canvas-text-content[contenteditable]')
      : null
    if (inlineEditor) {
      if (event.key === 'Escape') {
        event.preventDefault()
        commitInlineEdit(true)
      } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        commitInlineEdit()
      }
      return
    }
    if (inlineEditingId) return
    const element = currentElement()
    if ((event.key === 'Delete' || event.key === 'Backspace') && element) {
      event.preventDefault()
      deleteSelectedElement()
      return
    }
    if (event.key === 'Enter' && element?.type === 'text') {
      event.preventDefault()
      beginInlineEdit(element)
      return
    }
    if (!element || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const step = event.shiftKey ? 1 : 0.25
    const next = {
      ...element,
      x: clamp(element.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), 0, 100 - element.width),
      y: clamp(element.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0), 0, 100 - element.height)
    }
    upsertElement(next, 'nudge element')
  })
  ui.canvas.addEventListener('input', (event) => {
    const editor = event.target instanceof HTMLElement
      ? event.target.closest<HTMLElement>('.canvas-text-content[contenteditable]')
      : null
    if (!editor || !inlineEditingId) return
    const value = editor.innerText.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
    if (value.length <= MAX_INLINE_TEXT_LENGTH) {
      inlineDraft = value
      return
    }
    inlineDraft = value.slice(0, MAX_INLINE_TEXT_LENGTH)
    editor.textContent = inlineDraft
    focusInlineEditorAtEnd()
  })
  ui.canvas.addEventListener('focusout', (event) => {
    const editor = event.target instanceof HTMLElement
      ? event.target.closest<HTMLElement>('.canvas-text-content[contenteditable]')
      : null
    if (!editor || !inlineEditingId) return
    window.setTimeout(() => {
      if (document.activeElement !== editor && inlineEditingId) commitInlineEdit()
    }, 0)
  })
  document.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement
      || event.target instanceof HTMLTextAreaElement
      || event.target instanceof HTMLSelectElement
      || (event.target instanceof HTMLElement && event.target.isContentEditable)) return
    const modifier = event.metaKey || event.ctrlKey
    if (modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    }
  })

  client.ui.onDidReceiveMessage((message) => void handleHostMessage(message))
  client.ui.onDidChangeTheme(applyTheme)
  client.ui.onDidChangeLocale((locale) => {
    document.documentElement.lang = locale.language
    document.documentElement.dir = locale.direction
  })
}

async function initialize(): Promise<void> {
  bindEvents()
  const [theme, locale, restored] = await Promise.all([
    client.ui.getTheme(),
    client.ui.getLocale(),
    client.ui.getViewState<PersistedViewState & JsonObject>()
  ])
  applyTheme(theme)
  document.documentElement.lang = locale.language
  document.documentElement.dir = locale.direction
  setActivePanel(isStudioPanel(restored?.activePanel) ? restored.activePanel : 'canvas')
  renderAll()
  let initialPath = restored?.path
  if (!initialPath) {
    try {
      initialPath = await latestWorkspaceDeckPath()
    } catch {
      // Workspace discovery is a convenience; an empty editor remains usable when it is unavailable.
    }
  }
  if (initialPath) {
    ui.path.value = initialPath
    try {
      await loadDeck(normalizePath(initialPath), restored?.selectedSlideId)
    } catch (error) {
      setSaveStatus(`Could not restore deck: ${errorMessage(error)}`, 'error')
    }
  }
}

window.addEventListener('pagehide', () => {
  void (async () => {
    try {
      await flushPending('pagehide')
    } catch {
      // The visible conflict/error state already explains why the save was not completed.
    }
    await client.dispose()
  })()
}, { once: true })

await initialize()

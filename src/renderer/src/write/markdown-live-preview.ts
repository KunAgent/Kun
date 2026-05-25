import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { EditorSelection, Facet, RangeSetBuilder, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { resolveWriteMarkdownResource } from '../components/write/WriteMarkdownPreview'

type DecorationRange = {
  from: number
  to: number
  deco: Decoration
}

type BlockRange = {
  from: number
  to: number
}

type MarkdownImageContext = {
  filePath?: string | null
}

const CONCEAL_MARKS = new Set([
  'HeaderMark',
  'EmphasisMark',
  'CodeMark',
  'StrikethroughMark',
  'LinkMark',
  'URL',
  'QuoteMark'
])

const markdownImageContextFacet = Facet.define<MarkdownImageContext, MarkdownImageContext>({
  combine(values) {
    return values[0] ?? {}
  }
})

const hideMark = Decoration.mark({ class: 'cm-write-md-hidden-mark' })
const centerLineDeco = Decoration.line({ class: 'cm-write-md-center-line' })
const blockquoteLineDeco = Decoration.line({ class: 'cm-write-md-blockquote-line' })
const autolinkDeco = Decoration.mark({ class: 'cm-write-md-link-text' })
const markDeco = Decoration.mark({ class: 'cm-write-md-mark' })
const codeBlockLineDeco = Decoration.line({ class: 'cm-write-md-codeblock-line' })

const writeMarkdownHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.95em', fontWeight: '700', letterSpacing: '-0.035em' },
  { tag: tags.heading2, fontSize: '1.45em', fontWeight: '650', letterSpacing: '-0.025em' },
  { tag: tags.heading3, fontSize: '1.18em', fontWeight: '650' },
  { tag: tags.heading4, fontSize: '1.05em', fontWeight: '650' },
  { tag: tags.heading5, fontSize: '1em', fontWeight: '650' },
  { tag: tags.heading6, fontSize: '0.96em', fontWeight: '650', color: 'var(--ds-text-muted)' },
  { tag: tags.processingInstruction, color: 'var(--ds-text-faint)', opacity: '0.58' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  {
    tag: tags.monospace,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
    fontSize: '0.9em',
    backgroundColor: 'color-mix(in srgb, var(--ds-text) 6%, transparent)',
    borderRadius: '5px'
  },
  { tag: tags.link, color: 'var(--ds-accent)', textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--ds-text-faint)', fontSize: '0.86em' },
  { tag: tags.quote, color: 'var(--ds-text-muted)', fontStyle: 'italic' },
  { tag: tags.meta, color: 'var(--ds-text-faint)' }
])

const writeMarkdownLiveTheme = EditorView.theme({
  '&.cm-write-live-preview .cm-activeLine': {
    backgroundColor: 'transparent'
  },
  '&.cm-write-live-preview .cm-line': {
    paddingTop: '0.18rem',
    paddingBottom: '0.18rem'
  },
  '&.cm-write-live-preview .cm-write-md-center-line': {
    textAlign: 'center'
  },
  '&.cm-write-live-preview .cm-write-md-blockquote-line': {
    borderLeft: '3px solid color-mix(in srgb, var(--ds-accent) 42%, transparent)',
    color: 'var(--ds-text-muted)',
    paddingLeft: '0.9rem'
  },
  '&.cm-write-live-preview .cm-write-md-link-text': {
    color: 'var(--ds-accent)',
    textDecoration: 'underline',
    textUnderlineOffset: '3px'
  },
  '&.cm-write-live-preview .cm-write-md-mark': {
    borderRadius: '4px',
    backgroundColor: 'color-mix(in srgb, #f7d154 48%, transparent)',
    padding: '0 2px'
  }
})

class HrWidget extends WidgetType {
  eq(): boolean {
    return true
  }

  toDOM(): HTMLElement {
    const element = document.createElement('div')
    element.className = 'cm-write-md-hr'
    return element
  }
}

class ListBulletWidget extends WidgetType {
  eq(): boolean {
    return true
  }

  toDOM(): HTMLElement {
    const element = document.createElement('span')
    element.className = 'cm-write-md-list-bullet'
    return element
  }
}

class TaskCheckboxWidget extends WidgetType {
  constructor(
    private checked: boolean,
    private from: number,
    private to: number
  ) {
    super()
  }

  eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked && other.from === this.from && other.to === this.to
  }

  toDOM(view: EditorView): HTMLElement {
    const label = document.createElement('label')
    label.className = 'cm-write-md-task'
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = this.checked
    checkbox.tabIndex = -1
    checkbox.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const insert = this.checked ? '[ ]' : '[x]'
      view.focus()
      view.dispatch({
        changes: { from: this.from, to: this.to, insert },
        selection: EditorSelection.cursor(this.from + insert.length)
      })
    })
    label.appendChild(checkbox)
    return label
  }
}

class ImageWidget extends WidgetType {
  constructor(
    private src: string,
    private alt: string
  ) {
    super()
  }

  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement('span')
    wrapper.className = 'cm-write-md-image-wrap'
    const image = document.createElement('img')
    image.className = 'cm-write-md-image'
    image.src = this.src
    image.alt = this.alt
    image.loading = 'lazy'
    wrapper.appendChild(image)
    return wrapper
  }
}

type ParsedTable = {
  headers: string[]
  rows: string[][]
}

type ParsedCodeBlock = {
  code: string
  language: string
}

type CodeBlockRange = BlockRange & {
  block: ParsedCodeBlock
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseFencedCodeBlock(source: string): ParsedCodeBlock {
  const normalized = source.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const opener = lines[0] ?? ''
  const match = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(opener)
  if (!match) return { code: normalized, language: '' }

  const fence = match[2]
  const language = match[3].trim().split(/\s+/)[0] ?? ''
  const body = lines.slice(1)
  const closingPattern = new RegExp(`^\\s*${escapeRegExp(fence[0])}{${fence.length},}\\s*$`)
  if (body.length > 0 && closingPattern.test(body[body.length - 1] ?? '')) {
    body.pop()
  }
  return { code: body.join('\n'), language }
}

function parseIndentedCodeBlock(source: string): ParsedCodeBlock {
  return {
    code: source
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(/^(?: {4}|\t)/, ''))
      .join('\n'),
    language: ''
  }
}

function openingFence(line: string): { marker: string; language: string } | null {
  const match = /^(?: {0,3})(`{3,}|~{3,})(.*)$/.exec(line)
  if (!match) return null
  return {
    marker: match[1],
    language: match[2].trim().split(/\s+/)[0] ?? ''
  }
}

function closingFencePattern(marker: string): RegExp {
  return new RegExp(`^(?: {0,3})${escapeRegExp(marker[0])}{${marker.length},}\\s*$`)
}

class TableWidget extends WidgetType {
  constructor(private table: ParsedTable) {
    super()
  }

  eq(other: TableWidget): boolean {
    return JSON.stringify(other.table) === JSON.stringify(this.table)
  }

  toDOM(): HTMLElement {
    const table = document.createElement('table')
    table.className = 'cm-write-md-table'
    const thead = document.createElement('thead')
    const headerRow = document.createElement('tr')
    for (const header of this.table.headers) {
      const cell = document.createElement('th')
      cell.textContent = header
      headerRow.appendChild(cell)
    }
    thead.appendChild(headerRow)
    table.appendChild(thead)

    const tbody = document.createElement('tbody')
    for (const row of this.table.rows) {
      const tr = document.createElement('tr')
      for (const cellText of row) {
        const cell = document.createElement('td')
        cell.textContent = cellText
        tr.appendChild(cell)
      }
      tbody.appendChild(tr)
    }
    table.appendChild(tbody)
    return table
  }
}

class CodeBlockWidget extends WidgetType {
  constructor(private block: ParsedCodeBlock) {
    super()
  }

  eq(other: CodeBlockWidget): boolean {
    return other.block.code === this.block.code && other.block.language === this.block.language
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'cm-write-md-code-block'
    if (this.block.language) {
      const label = document.createElement('div')
      label.className = 'cm-write-md-code-lang'
      label.textContent = this.block.language
      wrapper.appendChild(label)
    }
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    code.textContent = this.block.code
    pre.appendChild(code)
    wrapper.appendChild(pre)
    return wrapper
  }
}

class CodeBlockToolbarWidget extends WidgetType {
  constructor(private block: ParsedCodeBlock) {
    super()
  }

  eq(other: CodeBlockToolbarWidget): boolean {
    return other.block.code === this.block.code && other.block.language === this.block.language
  }

  toDOM(): HTMLElement {
    const toolbar = document.createElement('span')
    toolbar.className = 'cm-write-md-codeblock-toolbar'

    if (this.block.language) {
      const language = document.createElement('span')
      language.className = 'cm-write-md-codeblock-lang'
      language.textContent = this.block.language
      toolbar.appendChild(language)
    }

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cm-write-md-codeblock-copy'
    button.title = 'Copy code'
    button.setAttribute('aria-label', 'Copy code')
    button.textContent = 'copy'
    button.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
    })
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const reset = (): void => {
        button.dataset.copied = 'false'
        button.textContent = 'copy'
        button.title = 'Copy code'
        button.setAttribute('aria-label', 'Copy code')
      }
      void navigator.clipboard?.writeText?.(this.block.code).then(() => {
        button.dataset.copied = 'true'
        button.textContent = 'copied'
        button.title = 'Copied'
        button.setAttribute('aria-label', 'Copied')
        window.setTimeout(reset, 1400)
      })
    })

    toolbar.appendChild(button)
    return toolbar
  }
}

const hrDecoration = Decoration.replace({
  widget: new HrWidget(),
  block: true
})

const listBulletDeco = Decoration.replace({
  widget: new ListBulletWidget()
})

function collectActiveLines(view: EditorView): Set<number> {
  const active = new Set<number>()
  if (!view.hasFocus) return active
  for (const range of view.state.selection.ranges) {
    const start = view.state.doc.lineAt(range.from).number
    const end = view.state.doc.lineAt(range.to).number
    for (let line = start; line <= end; line += 1) active.add(line)
  }
  return active
}

function nodeTouchesActiveLine(view: EditorView, from: number, to: number, activeLines: Set<number>): boolean {
  const start = view.state.doc.lineAt(from).number
  const end = view.state.doc.lineAt(Math.max(from, to - 1)).number
  for (let line = start; line <= end; line += 1) {
    if (activeLines.has(line)) return true
  }
  return false
}

function markdownImageFromSource(source: string, filePath?: string | null): { src: string; alt: string } | null {
  const match = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)$/.exec(source.trim())
  if (!match) return null
  const resolved = resolveWriteMarkdownResource(match[2], filePath)
  if (!resolved) return null
  return { alt: match[1] || '', src: resolved }
}

function splitTableLine(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function parseMarkdownTable(source: string): ParsedTable | null {
  const lines = source.split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines.length < 2) return null
  const headers = splitTableLine(lines[0])
  const delimiter = splitTableLine(lines[1])
  if (headers.length === 0 || delimiter.length !== headers.length) return null
  const validDelimiter = delimiter.every((cell) => /^:?-{3,}:?$/.test(cell))
  if (!validDelimiter) return null
  const rows = lines.slice(2).map((line) => {
    const cells = splitTableLine(line)
    while (cells.length < headers.length) cells.push('')
    return cells.slice(0, headers.length)
  })
  return { headers, rows }
}

function looksLikeTableRow(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('|') && trimmed.endsWith('|') && splitTableLine(trimmed).length >= 2
}

function looksLikeTableDelimiter(line: string, expectedCells: number): boolean {
  const delimiter = splitTableLine(line)
  return delimiter.length === expectedCells && delimiter.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function collectMarkdownTableRanges(
  view: EditorView,
  from: number,
  to: number,
  activeLines: Set<number>
): Array<BlockRange & { table: ParsedTable }> {
  const tables: Array<BlockRange & { table: ParsedTable }> = []
  let line = view.state.doc.lineAt(from)
  const endLine = view.state.doc.lineAt(to).number

  while (line.number < endLine) {
    const headerText = line.text
    if (!looksLikeTableRow(headerText)) {
      if (line.to >= to) break
      line = view.state.doc.line(line.number + 1)
      continue
    }

    const delimiterLine = view.state.doc.line(line.number + 1)
    const headers = splitTableLine(headerText)
    if (!looksLikeTableDelimiter(delimiterLine.text, headers.length)) {
      if (line.to >= to) break
      line = view.state.doc.line(line.number + 1)
      continue
    }

    let lastLine = delimiterLine
    let nextNumber = delimiterLine.number + 1
    while (nextNumber <= view.state.doc.lines) {
      const nextLine = view.state.doc.line(nextNumber)
      if (!looksLikeTableRow(nextLine.text)) break
      lastLine = nextLine
      nextNumber += 1
    }

    if (!nodeTouchesActiveLine(view, line.from, lastLine.to, activeLines)) {
      const source = view.state.doc.sliceString(line.from, lastLine.to)
      const table = parseMarkdownTable(source)
      if (table) tables.push({ from: line.from, to: lastLine.to, table })
    }

    if (lastLine.number >= endLine || lastLine.to >= to) break
    line = view.state.doc.line(lastLine.number + 1)
  }

  return tables
}

function collectMarkdownCodeBlockRanges(
  view: EditorView,
  from: number,
  to: number,
  activeLines: Set<number>
): CodeBlockRange[] {
  const blocks: CodeBlockRange[] = []
  let line = view.state.doc.lineAt(from)
  const endLine = view.state.doc.lineAt(to).number

  while (line.number <= endLine) {
    const fence = openingFence(line.text)
    if (!fence) {
      if (line.to >= to || line.number >= view.state.doc.lines) break
      line = view.state.doc.line(line.number + 1)
      continue
    }

    const closePattern = closingFencePattern(fence.marker)
    let lastLine = line
    let nextNumber = line.number + 1
    while (nextNumber <= view.state.doc.lines) {
      const nextLine = view.state.doc.line(nextNumber)
      lastLine = nextLine
      if (closePattern.test(nextLine.text)) break
      nextNumber += 1
    }

    const source = view.state.doc.sliceString(line.from, lastLine.to)
    blocks.push({ from: line.from, to: lastLine.to, block: parseFencedCodeBlock(source) })

    if (lastLine.number >= endLine || lastLine.to >= to || lastLine.number >= view.state.doc.lines) break
    line = view.state.doc.line(lastLine.number + 1)
  }

  return blocks
}

function addFencedCodeLineDecorations(
  view: EditorView,
  block: CodeBlockRange,
  activeLines: Set<number>,
  ranges: DecorationRange[]
): void {
  const startLine = view.state.doc.lineAt(block.from)
  const endLine = view.state.doc.lineAt(Math.max(block.from, block.to - 1))
  let blockActive = false
  for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber += 1) {
    if (activeLines.has(lineNumber)) {
      blockActive = true
      break
    }
  }

  for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber += 1) {
    const line = view.state.doc.line(lineNumber)
    ranges.push({ from: line.from, to: line.from, deco: codeBlockLineDeco })
  }

  if (blockActive) return

  if (startLine.from < startLine.to) {
    ranges.push({
      from: startLine.from,
      to: startLine.to,
      deco: Decoration.replace({ widget: new CodeBlockToolbarWidget(block.block) })
    })
  }

  if (endLine.number !== startLine.number && endLine.from < endLine.to) {
    ranges.push({
      from: endLine.from,
      to: endLine.to,
      deco: Decoration.replace({})
    })
  }
}

function isInsideBlockRanges(from: number, to: number, blocks: BlockRange[]): boolean {
  return blocks.some((block) => from >= block.from && to <= block.to)
}

function addConcealRange(view: EditorView, nodeName: string, from: number, to: number, ranges: DecorationRange[]): void {
  let hideTo = to
  if (nodeName === 'HeaderMark' && view.state.doc.sliceString(hideTo, hideTo + 1) === ' ') {
    hideTo += 1
  }
  ranges.push({ from, to: hideTo, deco: hideMark })
}

function addTaskMarker(view: EditorView, from: number, to: number, ranges: DecorationRange[]): void {
  const marker = view.state.doc.sliceString(from, to)
  const checked = /\[[xX]\]/.test(marker)
  ranges.push({
    from,
    to,
    deco: Decoration.replace({
      widget: new TaskCheckboxWidget(checked, from, to)
    })
  })
}

function buildMarkdownDecorations(view: EditorView): DecorationSet {
  const activeLines = collectActiveLines(view)
  const imageContext = view.state.facet(markdownImageContextFacet)
  const ranges: DecorationRange[] = []
  const renderedBlocks: BlockRange[] = []

  for (const { from, to } of view.visibleRanges) {
    for (const codeRange of collectMarkdownCodeBlockRanges(view, from, to, activeLines)) {
      renderedBlocks.push({ from: codeRange.from, to: codeRange.to })
      addFencedCodeLineDecorations(view, codeRange, activeLines, ranges)
    }
  }

  for (const { from, to } of view.visibleRanges) {
    for (const tableRange of collectMarkdownTableRanges(view, from, to, activeLines)) {
      renderedBlocks.push({ from: tableRange.from, to: tableRange.to })
      ranges.push({
        from: tableRange.from,
        to: tableRange.to,
        deco: Decoration.replace({ widget: new TableWidget(tableRange.table), block: true })
      })
    }
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== 'Document' && isInsideBlockRanges(node.from, node.to, renderedBlocks)) {
          return false
        }
        const line = view.state.doc.lineAt(node.from)
        const isActive = activeLines.has(line.number)

        switch (node.name) {
          case 'FencedCode':
          case 'CodeBlock':
            if (!nodeTouchesActiveLine(view, node.from, node.to, activeLines)) {
              const source = view.state.doc.sliceString(node.from, node.to)
              const block = node.name === 'FencedCode'
                ? parseFencedCodeBlock(source)
                : parseIndentedCodeBlock(source)
              ranges.push({
                from: node.from,
                to: node.to,
                deco: Decoration.replace({ widget: new CodeBlockWidget(block), block: true })
              })
            }
            return false
          case 'ATXHeading1':
            ranges.push({ from: line.from, to: line.from, deco: centerLineDeco })
            break
          case 'Blockquote':
            ranges.push({ from: line.from, to: line.from, deco: blockquoteLineDeco })
            break
          case 'HorizontalRule':
            if (!isActive) {
              ranges.push({ from: node.from, to: node.to, deco: hrDecoration })
              ranges.push({ from: line.from, to: line.from, deco: centerLineDeco })
            }
            return false
          default:
            break
        }

        if (node.name === 'TaskMarker') {
          if (!isActive) addTaskMarker(view, node.from, node.to, ranges)
          return false
        }

        if (isActive) return

        switch (node.name) {
          case 'Image': {
            const parsed = markdownImageFromSource(
              view.state.doc.sliceString(node.from, node.to),
              imageContext.filePath
            )
            if (parsed) {
              ranges.push({
                from: node.from,
                to: node.to,
                deco: Decoration.replace({ widget: new ImageWidget(parsed.src, parsed.alt) })
              })
              return false
            }
            break
          }
          case 'Table': {
            if (nodeTouchesActiveLine(view, node.from, node.to, activeLines)) return false
            const parsed = parseMarkdownTable(view.state.doc.sliceString(node.from, node.to))
            if (parsed) {
              ranges.push({
                from: node.from,
                to: node.to,
                deco: Decoration.replace({ widget: new TableWidget(parsed), block: true })
              })
              return false
            }
            break
          }
          case 'Autolink': {
            const source = view.state.doc.sliceString(node.from, node.to)
            if (source.startsWith('<') && source.endsWith('>')) {
              ranges.push({ from: node.from, to: node.from + 1, deco: hideMark })
              ranges.push({ from: node.from + 1, to: node.to - 1, deco: autolinkDeco })
              ranges.push({ from: node.to - 1, to: node.to, deco: hideMark })
              return false
            }
            break
          }
          case 'ListMark': {
            const markText = view.state.doc.sliceString(node.from, node.to)
            if (markText !== '-' && markText !== '*' && markText !== '+') break
            let hideTo = node.to
            if (view.state.doc.sliceString(hideTo, hideTo + 1) === ' ') hideTo += 1
            const rest = view.state.doc.sliceString(node.to, Math.min(node.to + 5, line.to))
            if (/^ ?\[[ xX]\]/.test(rest)) {
              ranges.push({ from: node.from, to: hideTo, deco: hideMark })
            } else {
              ranges.push({ from: node.from, to: hideTo, deco: listBulletDeco })
            }
            break
          }
          case 'Mark': {
            ranges.push({ from: node.from, to: node.to, deco: markDeco })
            break
          }
          default:
            if (CONCEAL_MARKS.has(node.name)) addConcealRange(view, node.name, node.from, node.to, ranges)
            break
        }
      }
    })
  }

  ranges.sort((a, b) => a.from - b.from || a.to - b.to)
  const builder = new RangeSetBuilder<Decoration>()
  let previousTo = -1
  for (const range of ranges) {
    if (range.to < range.from) continue
    if (range.from < previousTo && range.to > range.from) continue
    builder.add(range.from, range.to, range.deco)
    previousTo = Math.max(previousTo, range.to)
  }
  return builder.finish()
}

const markdownLivePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildMarkdownDecorations(view)
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.focusChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildMarkdownDecorations(update.view)
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations
  }
)

export function writeMarkdownLivePreviewExtensions(filePath?: string | null): Extension[] {
  return [
    EditorView.editorAttributes.of({ class: 'cm-write-live-preview' }),
    markdownImageContextFacet.of({ filePath }),
    syntaxHighlighting(writeMarkdownHighlight),
    writeMarkdownLiveTheme,
    markdownLivePreviewPlugin
  ]
}

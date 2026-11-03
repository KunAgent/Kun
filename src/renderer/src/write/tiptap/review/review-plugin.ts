/**
 * ProseMirror plugin for the rich diff review.
 *
 * State is a list of chunks whose `from`/`to` are positions in the *current*
 * (AI-written) document; `removed` chunks keep `from === to` at the anchor
 * and carry their original nodes for the read-only red widget. Chunks map
 * through transactions and are consumed by `resolve` metas dispatched by the
 * review session.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { DOMSerializer, Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { computeInlineWordDiff } from './inline-word-diff'
import type { WriteReviewOrigin } from '../../../components/write/write-document-editor-handle'
import i18n from '../../../i18n'

export type ReviewChunkKind = 'added' | 'removed' | 'modified'

export type ReviewChunkState = {
  id: string
  kind: ReviewChunkKind
  from: number
  /** For `removed` chunks `from === to` (insertion anchor). */
  to: number
  /** Original top-level nodes — `removed` runs may hold several. */
  original: PMNode[]
  /** Verbatim Markdown of the original blocks — rendered for `removed`. */
  originalRaw?: string[]
}

export type WriteReviewPluginState = {
  active: boolean
  origin: WriteReviewOrigin
  chunks: ReviewChunkState[]
}

export const writeReviewPluginKey = new PluginKey<WriteReviewPluginState>('writeDiffReview')

export type WriteReviewMeta =
  | { type: 'start'; chunks: ReviewChunkState[]; origin?: WriteReviewOrigin }
  | { type: 'resolve'; id: string }
  | { type: 'finish' }

const EMPTY_STATE: WriteReviewPluginState = { active: false, origin: 'agent', chunks: [] }

/** Per-view callback used by chunk action widgets to resolve their chunk. */
const resolvers = new WeakMap<EditorView, (id: string, action: 'accept' | 'reject') => void>()

export function registerWriteReviewResolver(
  view: EditorView,
  resolver: (id: string, action: 'accept' | 'reject') => void
): void {
  resolvers.set(view, resolver)
}

function actionButtonsDom(view: EditorView, chunk: ReviewChunkState): HTMLElement {
  const dom = document.createElement('span')
  dom.className = 'write-diff-actions'
  dom.contentEditable = 'false'
  const accept = document.createElement('button')
  accept.type = 'button'
  accept.className = 'write-diff-accept'
  accept.textContent = i18n.t('common:writeDiffAccept')
  accept.addEventListener('click', () => resolvers.get(view)?.(chunk.id, 'accept'))
  const reject = document.createElement('button')
  reject.type = 'button'
  reject.className = 'write-diff-reject'
  reject.textContent = i18n.t('common:writeDiffReject')
  reject.addEventListener('click', () => resolvers.get(view)?.(chunk.id, 'reject'))
  dom.addEventListener('mousedown', (event) => event.preventDefault())
  // Quiet reject first, the strong accept last — same order as the review bar.
  dom.append(reject, accept)
  return dom
}

function removedWidgetDom(view: EditorView, chunk: ReviewChunkState, controls = true): HTMLElement {
  const dom = document.createElement('div')
  dom.className = 'write-diff-removed'
  dom.contentEditable = 'false'
  const body = document.createElement('div')
  body.className = 'write-diff-removed-body'
  const raws = chunk.originalRaw ?? []
  if (raws.length > 0) {
    // Render the removed blocks' Markdown through the shared pipeline —
    // PM serialization would emit an empty div for math/raw/html nodes.
    void Promise.all([
      import('@shared/markdown/render-html'),
      import('dompurify')
    ]).then(([renderer, purify]) => {
      if (!body.isConnected) return
      const html = renderer.renderWorkMarkdownToHtml(raws.join('\n\n'), { math: 'html' })
      body.innerHTML = (purify.default ?? purify).sanitize(html)
      if (!body.textContent?.trim() && !body.querySelector('img,svg,table,math,hr')) {
        body.classList.add('write-diff-removed-plain')
        body.textContent = raws.join('\n\n')
        return
      }
      const filePath = reviewFilePathFor(view)
      for (const img of Array.from(body.querySelectorAll('img'))) {
        const src = img.getAttribute('src') ?? ''
        if (!src || src.startsWith('data:')) continue
        void import('../../markdown-image').then(({ loadWriteMarkdownImage }) =>
          loadWriteMarkdownImage(src, filePath).then((result) => {
            if (img.isConnected && result.ok) img.src = result.src
          })
        )
      }
    }).catch(() => {
      body.classList.add('write-diff-removed-plain')
      body.textContent = raws.join('\n\n')
    })
  } else {
    const serializer = DOMSerializer.fromSchema(view.state.schema)
    body.appendChild(serializer.serializeFragment(Fragment.from(chunk.original)))
  }
  dom.append(body)
  if (controls) dom.append(actionButtonsDom(view, chunk))
  return dom
}

/**
 * Word-level diff inside a `modified` chunk, only when both revisions are a
 * single plain-text block (paragraph/heading): added words get a green
 * underline, removed words render as struck-through red widgets.
 */
function wordDiffDecorations(state: EditorState, chunk: ReviewChunkState): Decoration[] | null {
  const next = state.doc.nodeAt(chunk.from)
  const diff = next && chunk.original.length === 1
    ? computeInlineWordDiff(chunk.original[0], next, chunk.from) : null
  if (!diff || !diff.hunks) return null
  return [
    ...diff.inserts.map(({ from, to }) => Decoration.inline(from, to, { class: 'write-diff-word-added' })),
    ...diff.deletes.map(({ pos, text }) => Decoration.widget(pos, () => {
      const span = document.createElement('span')
      span.className = 'write-diff-word-removed'
      span.textContent = text
      span.contentEditable = 'false'
      return span
    }, { side: -1, ignoreSelection: true }))
  ]
}

function buildDecorations(state: EditorState): DecorationSet {
  const pluginState = writeReviewPluginKey.getState(state)
  if (!pluginState?.active) return DecorationSet.empty
  const decorations: Decoration[] = []
  for (const chunk of pluginState.chunks) {
    if (!isChunkValidForDoc(state.doc, chunk)) continue
    if (chunk.kind === 'removed') {
      decorations.push(
        Decoration.widget(chunk.from, (view) => removedWidgetDom(view, chunk, pluginState.origin !== 'selection'), {
          side: -1,
          ignoreSelection: true,
          key: `write-diff-removed-${chunk.id}`
        })
      )
      continue
    }
    decorations.push(
      Decoration.node(chunk.from, chunk.to, {
        class: chunk.kind === 'added' ? 'write-diff-added' : 'write-diff-modified'
      })
    )
    if (chunk.kind === 'modified') {
      const words = wordDiffDecorations(state, chunk)
      if (words) decorations.push(...words)
      else if (pluginState.origin === 'selection') decorations.push(
        Decoration.widget(chunk.from, (view) => removedWidgetDom(view, chunk, false), { side: -1, ignoreSelection: true })
      )
    }
    if (pluginState.origin !== 'selection') decorations.push(
      Decoration.widget(chunk.from, (view) => actionButtonsDom(view, chunk), {
        side: -1,
        ignoreSelection: true,
        key: `write-diff-actions-${chunk.id}`
      })
    )
  }
  try {
    return DecorationSet.create(state.doc, decorations)
  } catch {
    return DecorationSet.empty
  }
}

/** True when `pos` sits between two top-level blocks (or at either end). */
function isTopLevelBoundary(doc: PMNode, pos: number): boolean {
  if (!Number.isInteger(pos) || pos < 0 || pos > doc.content.size) return false
  return doc.resolve(pos).depth === 0
}

/**
 * A chunk is usable only while it still addresses the current document:
 * removed chunks are an anchor on a block boundary, the others span exactly
 * one top-level block. Anything else would make `Decoration.node` throw.
 */
export function isChunkValidForDoc(doc: PMNode, chunk: Pick<ReviewChunkState, 'kind' | 'from' | 'to'>): boolean {
  if (!isTopLevelBoundary(doc, chunk.from)) return false
  if (chunk.kind === 'removed') return chunk.from === chunk.to
  const node = doc.resolve(chunk.from).nodeAfter
  return Boolean(node) && !node!.isText && chunk.from + node!.nodeSize === chunk.to
}

function mapChunks(chunks: ReviewChunkState[], transaction: Transaction): ReviewChunkState[] {
  if (!transaction.docChanged) return chunks
  const mapped: ReviewChunkState[] = []
  for (const chunk of chunks) {
    if (chunk.kind === 'removed') {
      const pos = transaction.mapping.map(chunk.from, 1)
      mapped.push({ ...chunk, from: pos, to: pos })
      continue
    }
    const from = transaction.mapping.mapResult(chunk.from, 1)
    const to = transaction.mapping.mapResult(chunk.to, -1)
    // A chunk whose block was deleted has nothing left to review.
    if (from.deleted && to.deleted) continue
    mapped.push({ ...chunk, from: from.pos, to: to.pos })
  }
  // Edits that reshape blocks can leave a stale range; drop it instead of
  // rendering it (the document keeps the AI version of that block).
  return mapped.filter((chunk) => isChunkValidForDoc(transaction.doc, chunk))
}

export const writeReviewPlugin = new Plugin<WriteReviewPluginState>({
  key: writeReviewPluginKey,
  state: {
    init: () => EMPTY_STATE,
    apply(transaction, state): WriteReviewPluginState {
      const meta = transaction.getMeta(writeReviewPluginKey) as WriteReviewMeta | undefined
      if (meta?.type === 'start') return { active: true, origin: meta.origin ?? state.origin, chunks: meta.chunks }
      if (meta?.type === 'finish') return EMPTY_STATE
      const chunks = mapChunks(state.chunks, transaction)
      if (meta?.type === 'resolve') {
        return { ...state, active: true, chunks: chunks.filter((chunk) => chunk.id !== meta.id) }
      }
      if (chunks === state.chunks) return state
      return { ...state, chunks }
    }
  },
  props: {
    decorations: buildDecorations,
    attributes: (state) => ({ 'data-review-origin': writeReviewPluginKey.getState(state)?.origin ?? 'agent' })
  }
})

/** Review extension — added to the rich editor's extension list. */
export type WriteDiffReviewOptions = {
  /** Current file path — removed-block previews resolve relative images. */
  getFilePath: () => string
}

const reviewFilePaths = new WeakMap<EditorView, () => string>()

function reviewFilePathFor(view: EditorView): string {
  return reviewFilePaths.get(view)?.() ?? ''
}

export const WriteDiffReview = Extension.create<WriteDiffReviewOptions>({
  name: 'writeDiffReview',
  addOptions() {
    return { getFilePath: () => '' }
  },
  addProseMirrorPlugins() {
    return [writeReviewPlugin]
  },
  onCreate() {
    reviewFilePaths.set(this.editor.view, this.options.getFilePath)
  }
})

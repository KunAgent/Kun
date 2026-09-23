/**
 * ProseMirror plugin for the rich diff review (implementation §6.3).
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
import { diffWordsWithSpace } from 'diff'
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
}

export type WriteReviewPluginState = {
  active: boolean
  chunks: ReviewChunkState[]
}

export const writeReviewPluginKey = new PluginKey<WriteReviewPluginState>('writeDiffReview')

export type WriteReviewMeta =
  | { type: 'start'; chunks: ReviewChunkState[] }
  | { type: 'resolve'; id: string }
  | { type: 'finish' }

const EMPTY_STATE: WriteReviewPluginState = { active: false, chunks: [] }

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
  accept.textContent = '✓'
  accept.title = i18n.t('common:writeDiffAccept')
  accept.addEventListener('click', () => resolvers.get(view)?.(chunk.id, 'accept'))
  const reject = document.createElement('button')
  reject.type = 'button'
  reject.className = 'write-diff-reject'
  reject.textContent = '✕'
  reject.title = i18n.t('common:writeDiffReject')
  reject.addEventListener('click', () => resolvers.get(view)?.(chunk.id, 'reject'))
  dom.addEventListener('mousedown', (event) => event.preventDefault())
  dom.append(accept, reject)
  return dom
}

function removedWidgetDom(view: EditorView, chunk: ReviewChunkState): HTMLElement {
  const dom = document.createElement('div')
  dom.className = 'write-diff-removed'
  dom.contentEditable = 'false'
  const body = document.createElement('div')
  body.className = 'write-diff-removed-body'
  const serializer = DOMSerializer.fromSchema(view.state.schema)
  body.appendChild(serializer.serializeFragment(Fragment.from(chunk.original)))
  dom.append(body, actionButtonsDom(view, chunk))
  return dom
}

/**
 * Word-level diff inside a `modified` chunk, only when both revisions are a
 * single plain-text block (paragraph/heading): added words get a green
 * underline, removed words render as struck-through red widgets.
 */
function wordDiffDecorations(state: EditorState, chunk: ReviewChunkState): Decoration[] {
  if (chunk.original.length !== 1) return []
  const prevNode = chunk.original[0]
  const nextNode = state.doc.nodeAt(chunk.from)
  if (!nextNode || !prevNode.isTextblock || !nextNode.isTextblock) return []
  if (prevNode.childCount !== 1 || !prevNode.firstChild?.isText) return []
  if (nextNode.childCount !== 1 || !nextNode.firstChild?.isText) return []
  const prevText = prevNode.textContent
  const nextText = nextNode.textContent
  if (prevText === nextText) return []
  const textStart = chunk.from + 1
  const decorations: Decoration[] = []
  let offset = 0
  for (const part of diffWordsWithSpace(prevText, nextText)) {
    const length = part.value.length
    if (part.added) {
      decorations.push(
        Decoration.inline(textStart + offset, textStart + offset + length, {
          class: 'write-diff-word-added'
        })
      )
      offset += length
    } else if (part.removed) {
      const text = part.value
      decorations.push(
        Decoration.widget(textStart + offset, () => {
          const span = document.createElement('span')
          span.className = 'write-diff-word-removed'
          span.textContent = text
          span.contentEditable = 'false'
          return span
        }, { side: -1, ignoreSelection: true })
      )
    } else {
      offset += length
    }
  }
  return decorations
}

function buildDecorations(state: EditorState): DecorationSet {
  const pluginState = writeReviewPluginKey.getState(state)
  if (!pluginState?.active) return DecorationSet.empty
  const decorations: Decoration[] = []
  for (const chunk of pluginState.chunks) {
    if (chunk.kind === 'removed') {
      decorations.push(
        Decoration.widget(chunk.from, (view) => removedWidgetDom(view, chunk), {
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
      decorations.push(...wordDiffDecorations(state, chunk))
    }
    decorations.push(
      Decoration.widget(chunk.from, (view) => actionButtonsDom(view, chunk), {
        side: -1,
        ignoreSelection: true,
        key: `write-diff-actions-${chunk.id}`
      })
    )
  }
  return DecorationSet.create(state.doc, decorations)
}

function mapChunks(chunks: ReviewChunkState[], transaction: Transaction): ReviewChunkState[] {
  return chunks.map((chunk) => {
    if (chunk.kind === 'removed') {
      const pos = transaction.mapping.map(chunk.from, 1)
      return { ...chunk, from: pos, to: pos }
    }
    return {
      ...chunk,
      from: transaction.mapping.map(chunk.from, 1),
      to: transaction.mapping.map(chunk.to, -1)
    }
  })
}

export const writeReviewPlugin = new Plugin<WriteReviewPluginState>({
  key: writeReviewPluginKey,
  state: {
    init: () => EMPTY_STATE,
    apply(transaction, state): WriteReviewPluginState {
      const meta = transaction.getMeta(writeReviewPluginKey) as WriteReviewMeta | undefined
      if (meta?.type === 'start') return { active: true, chunks: meta.chunks }
      if (meta?.type === 'finish') return EMPTY_STATE
      const chunks = mapChunks(state.chunks, transaction)
      if (meta?.type === 'resolve') {
        return { active: true, chunks: chunks.filter((chunk) => chunk.id !== meta.id) }
      }
      if (chunks === state.chunks) return state
      return { ...state, chunks }
    }
  },
  props: {
    decorations: buildDecorations
  }
})

/** Review extension — added to the rich editor's extension list. */
export const WriteDiffReview = Extension.create({
  name: 'writeDiffReview',
  addProseMirrorPlugins() {
    return [writeReviewPlugin]
  }
})

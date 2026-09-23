/**
 * Review session orchestration (implementation §6.3–§6.6).
 *
 * Owns the lifecycle of one rich diff review on a Tiptap `Editor`:
 * `begin` parses original + next markdown with the work codec, swaps the
 * document to the AI version as a history-less external transaction, and
 * seeds the review plugin with positioned chunks. Per-chunk and bulk
 * resolves apply history-less edits; when the last chunk resolves, the doc
 * is restored to the pre-review nodes and swapped to the final content in
 * ONE undoable transaction, so Cmd-Z reverts the whole AI change.
 */
import type { Editor } from '@tiptap/core'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import {
  parseWorkDocument,
  serializeWorkDocument,
  type WorkDocContext
} from '../../markdown/document-codec'
import { writeRichExternalSyncMeta } from '../extensions/term-propagation'
import { alignBlocks, type ReviewChunk } from './align-blocks'
import {
  registerWriteReviewResolver,
  writeReviewPluginKey,
  type ReviewChunkState
} from './review-plugin'

export type WriteReviewSessionCallbacks = {
  /** Serialize + emit when the review finishes. */
  onFinish: (markdown: string) => void
  /** Review active state for React (bar visibility, autosave pause). */
  onStateChange: (active: boolean) => void
  /** Chunk count changes so the review bar can show progress. */
  onChunksChange: (count: number) => void
}

type ParsedSide = {
  /** Whole-doc node built from the parsed top-level children. */
  pmDoc: PMNode
  /** Top-level PM nodes of this revision (aligned with `keys`). */
  nodes: PMNode[]
  /** Block keys for `alignBlocks` (verbatim raws, trailing blanks trimmed). */
  keys: string[]
  /** The codec context produced while parsing (source registrations). */
  ctx: WorkDocContext
}

let chunkCounter = 0

function topNodes(doc: PMNode): PMNode[] {
  const nodes: PMNode[] = []
  doc.forEach((node) => nodes.push(node))
  return nodes
}

/** Map a `next` block index to a document position (start of that block). */
function nextBlockPos(doc: PMNode, index: number): number {
  if (index >= doc.childCount) return doc.content.size
  let pos = 0
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize
  return pos
}

function isEmptyParagraph(node: PMNode): boolean {
  return node.type.name === 'paragraph' && node.content.size === 0
}

export class WriteReviewSession {
  private editor: Editor
  private callbacks: WriteReviewSessionCallbacks
  private getCtx: () => WorkDocContext
  private setCtx: (ctx: WorkDocContext) => void

  /** Doc captured before the first `begin` of this review. */
  private preReviewDoc: PMNode | null = null
  private preReviewCtx: WorkDocContext | null = null
  private baseline = ''
  private active = false

  constructor(
    editor: Editor,
    callbacks: WriteReviewSessionCallbacks,
    getCtx: () => WorkDocContext,
    setCtx: (ctx: WorkDocContext) => void
  ) {
    this.editor = editor
    this.callbacks = callbacks
    this.getCtx = getCtx
    this.setCtx = setCtx
    registerWriteReviewResolver(editor.view, (id, action) => this.resolve(id, action))
  }

  isActive(): boolean {
    return this.active
  }

  chunkCount(): number {
    return writeReviewPluginKey.getState(this.editor.state)?.chunks.length ?? 0
  }

  begin(params: { original: string; nextDoc: string }): boolean {
    const { original, nextDoc } = params
    if (nextDoc === original) return false

    const prev = this.parseSide(original)
    const next = this.parseSide(nextDoc)
    const aligned = alignBlocks(prev.keys, next.keys)
    if (!aligned.length) return false
    const chunks = this.buildChunks(aligned, prev, next)
    if (!chunks.length) return false

    if (!this.active) {
      this.preReviewDoc = this.editor.state.doc
      this.preReviewCtx = this.getCtx()
      this.baseline = original
    } else if (original !== this.baseline) {
      // The caller may pass a different baseline when the agent rewrites a
      // dirty doc; the review still displays against what was on disk.
      this.baseline = original
    }

    // The active context becomes the AI version's, plus the original's and
    // the pre-review editor context's registrations so every block that can
    // appear in the final document serializes byte-identically.
    next.ctx.sourceMap.absorb(prev.ctx.sourceMap)
    if (this.preReviewCtx) next.ctx.sourceMap.absorb(this.preReviewCtx.sourceMap)
    this.setCtx(next.ctx)

    this.swapToTopNodes(next.nodes)

    const tr = this.editor.state.tr
    tr.setMeta(writeReviewPluginKey, { type: 'start', chunks })
    tr.setMeta(writeRichExternalSyncMeta, true)
    tr.setMeta('addToHistory', false)
    this.editor.view.dispatch(tr)

    this.active = true
    this.editor.setEditable(false)
    this.callbacks.onStateChange(true)
    this.callbacks.onChunksChange(chunks.length)
    return true
  }

  resolve(id: string, action: 'accept' | 'reject'): void {
    if (!this.active) return
    const state = writeReviewPluginKey.getState(this.editor.state)
    const chunk = state?.chunks.find((item) => item.id === id)
    if (!chunk) return

    const tr = this.editor.state.tr
    if (action === 'reject') {
      if (chunk.kind === 'added') {
        tr.delete(chunk.from, chunk.to)
      } else if (chunk.kind === 'removed') {
        tr.insert(chunk.from, Fragment.from(chunk.original))
      } else {
        tr.replaceWith(chunk.from, chunk.to, chunk.original)
      }
    }
    tr.setMeta(writeReviewPluginKey, { type: 'resolve', id })
    tr.setMeta(writeRichExternalSyncMeta, true)
    tr.setMeta('addToHistory', false)
    this.editor.view.dispatch(tr)
    this.afterResolve()
  }

  resolveAll(action: 'accept' | 'reject'): void {
    if (!this.active) return
    if (action === 'reject' && this.preReviewDoc) {
      // Rejecting everything restores the pre-review document verbatim —
      // chunk-level position bookkeeping is unnecessary.
      this.swapToTopNodes(topNodes(this.preReviewDoc))
    }
    const tr = this.editor.state.tr
    tr.setMeta(writeReviewPluginKey, { type: 'start', chunks: [] })
    tr.setMeta(writeRichExternalSyncMeta, true)
    tr.setMeta('addToHistory', false)
    this.editor.view.dispatch(tr)
    this.afterResolve()
  }

  /** Position of chunk `index` for prev/next navigation. */
  chunkPos(index: number): number | null {
    const chunks = writeReviewPluginKey.getState(this.editor.state)?.chunks ?? []
    const chunk = chunks[index]
    return chunk ? chunk.from : null
  }

  scrollToChunk(index: number): void {
    const pos = this.chunkPos(index)
    if (pos === null) return
    const dom = this.editor.view.nodeDOM(Math.min(pos, this.editor.state.doc.content.size))
    const element = dom instanceof HTMLElement ? dom : dom?.parentElement
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  private afterResolve(): void {
    const remaining = this.chunkCount()
    this.callbacks.onChunksChange(remaining)
    if (remaining === 0) this.finish()
  }

  private parseSide(markdown: string): ParsedSide {
    const parsed = parseWorkDocument(markdown)
    const rawById = new Map(parsed.blocks.map((block) => [block.blockId, block.raw]))
    const nodes: PMNode[] = []
    const keys: string[] = []
    for (const child of parsed.doc.content ?? []) {
      const blockId = typeof child.attrs?.blockId === 'string' ? child.attrs.blockId : ''
      const raw = blockId ? rawById.get(blockId) ?? '' : ''
      let node: PMNode
      try {
        node = this.editor.schema.nodeFromJSON(child)
      } catch {
        continue
      }
      // The codec inserts a placeholder paragraph into empty documents; it
      // has no block identity and must not count as a review block.
      if (!blockId && isEmptyParagraph(node)) continue
      nodes.push(node)
      keys.push(raw.trimEnd())
    }
    return {
      pmDoc: this.editor.schema.topNodeType.create(null, Fragment.from(nodes)),
      nodes,
      keys,
      ctx: parsed.ctx
    }
  }

  private buildChunks(
    aligned: ReviewChunk[],
    prev: ParsedSide,
    next: ParsedSide
  ): ReviewChunkState[] {
    const nextDoc = next.pmDoc
    const chunks: ReviewChunkState[] = []
    for (const chunk of aligned) {
      if (chunk.kind === 'added') {
        for (const index of chunk.next) {
          const from = nextBlockPos(nextDoc, index)
          const to = from + nextDoc.child(index).nodeSize
          chunks.push({ id: `r${++chunkCounter}`, kind: 'added', from, to, original: [] })
        }
      } else if (chunk.kind === 'removed') {
        const original = chunk.prev.map((index) => prev.nodes[index]).filter(Boolean)
        const pos = nextBlockPos(nextDoc, chunk.anchorNext)
        chunks.push({ id: `r${++chunkCounter}`, kind: 'removed', from: pos, to: pos, original })
      } else {
        const from = nextBlockPos(nextDoc, chunk.next)
        const to = from + nextDoc.child(chunk.next).nodeSize
        const original = [prev.nodes[chunk.prev]].filter(Boolean)
        chunks.push({ id: `r${++chunkCounter}`, kind: 'modified', from, to, original })
      }
    }
    return chunks
  }

  private swapToTopNodes(nodes: PMNode[]): void {
    const tr = this.editor.state.tr
    tr.replaceWith(0, this.editor.state.doc.content.size, nodes)
    tr.setMeta(writeRichExternalSyncMeta, true)
    tr.setMeta('addToHistory', false)
    this.editor.view.dispatch(tr)
  }

  private finish(): void {
    if (!this.active) return
    const editor = this.editor
    const finalDoc = editor.state.doc
    const finalNodes = topNodes(finalDoc)
    const preReview = this.preReviewDoc

    this.active = false
    this.preReviewDoc = null
    this.preReviewCtx = null

    if (preReview) {
      // Step 1 (history-less): restore the pre-review document so the next
      // step can be a single undoable original → final transaction.
      const restore = editor.state.tr
      restore.replaceWith(0, finalDoc.content.size, topNodes(preReview))
      restore.setMeta(writeRichExternalSyncMeta, true)
      restore.setMeta('addToHistory', false)
      editor.view.dispatch(restore)

      // Step 2 (undoable): swap to the final resolved content.
      const apply = editor.state.tr
      apply.replaceWith(0, editor.state.doc.content.size, finalNodes)
      editor.view.dispatch(apply)
    }

    const clear = editor.state.tr
    clear.setMeta(writeReviewPluginKey, { type: 'finish' })
    clear.setMeta(writeRichExternalSyncMeta, true)
    clear.setMeta('addToHistory', false)
    editor.view.dispatch(clear)

    editor.setEditable(true)
    // When every change was rejected the document equals the pre-review
    // doc; emit the baseline verbatim so a full reject is byte-exact.
    const markdown = preReview && editor.state.doc.eq(preReview)
      ? this.baseline
      : serializeWorkDocument(editor.state.doc.toJSON(), this.getCtx())
    this.callbacks.onFinish(markdown)
    this.callbacks.onStateChange(false)
  }
}

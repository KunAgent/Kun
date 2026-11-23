// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSchema, type Editor } from '@tiptap/core'
import { EditorState } from '@tiptap/pm/state'
import type { DocModel } from '@extend-ai/react-docx'
import { workAnnotationAnchorSchema } from '@shared/work-annotation-anchor'
import { parseWorkDocument } from '../markdown/document-codec'
import { buildWriteRichExtensions } from '../tiptap/markdown-manager'
import { replaceRichAnnotation } from './rich-replacement'
import { markdownAnchor, resolveMarkdownAnnotation } from './markdown-anchor'
import { richAnnotationSource } from './rich-anchor'
import { captureAnnotationAnchor, locateAnnotation } from './document-anchors'
import { registerWordAnchorViewer, wordAnnotation } from './word-anchor'

const schema = getSchema(buildWriteRichExtensions())
const root = document.createElement('div')
beforeEach(() => root.replaceChildren())

describe('Markdown source anchors', () => {
  it('moves with surrounding edits and computes the insertion boundary past the closing fence', () => {
    const source = '# Notes\r\n\r\n$$\r\nx + y\r\n$$\r\n\r\nTail'
    const from = source.indexOf('x + y')
    const anchor = markdownAnchor(source, from, from + 1, 'x')!
    const moved = 'New paragraph\r\n\r\n' + source
    expect(resolveMarkdownAnnotation(moved, anchor)).toEqual({ from: moved.indexOf('x'), to: moved.indexOf('x') + 1,
      blockEnd: moved.lastIndexOf('$$') + 2 })
    expect(resolveMarkdownAnnotation(moved.replace('x', 'z'), anchor)).toBeNull()
  })
  it('does not bind identical contextual matches to an arbitrary occurrence', () => {
    const source = 'a'.repeat(140) + 'target' + 'b'.repeat(140)
    const anchor = markdownAnchor(source, 140, 146, 'target')!
    expect(resolveMarkdownAnnotation(source + '\n' + source, anchor)).toBeNull()
  })
  it('maps literal marked text and a formula subrange in the second of two identical paragraphs', () => {
    const paragraph = 'Ask **here** about $x + y$.'
    const source = '---\ntitle: here\n---\n\n' + paragraph + '\n\n' + paragraph
    const state = EditorState.create({ schema, doc: schema.nodeFromJSON(parseWorkDocument(source).doc) })
    const editor = { state } as Editor
    let textAt = -1, mathAt = -1
    state.doc.descendants((n, pos) => {
      if (n.text === 'here') textAt = pos
      if (n.type.name === 'inlineMath') mathAt = pos
    })
    const from = source.lastIndexOf('here')
    expect(richAnnotationSource(editor, source, { from: textAt, to: textAt + 4 })).toEqual({ from, to: from + 4 })
    const y = source.lastIndexOf('y')
    expect(richAnnotationSource(editor, source, { from: mathAt, to: mathAt + 1, latexRange: { from: 4, to: 5 } }))
      .toEqual({ from: y, to: y + 1 })
  })
  it('maps Markdown escapes and named entities without selecting partial syntax', () => {
    const source = 'A \\* sign &amp; more'
    const state = EditorState.create({ schema, doc: schema.nodeFromJSON(parseWorkDocument(source).doc) })
    const actual = state.doc.firstChild!.textContent
    const from = actual.indexOf('*') + 1, to = actual.indexOf('&') + 2
    const range = richAnnotationSource({ state } as Editor, source, { from, to })!
    expect(source.slice(range.from, range.to)).toBe('\\* sign &amp;')
  })

  it('does not attach a deleted repeated phrase to the remaining copy', () => {
    const before = 'First apple; ' + 'x'.repeat(200) + ' second apple; end'
    const from = before.lastIndexOf('apple')
    const anchor = markdownAnchor(before, from, from + 5, 'apple')!
    expect(resolveMarkdownAnnotation(before.slice(0, from - 8) + '; end', anchor)).toBeNull()
  })

  it('keeps marks balanced when replacing only part of a rich-text span', () => {
    const source = 'Start **bold** finish.'
    const to = source.indexOf('bold') + 2
    const next = replaceRichAnnotation(source, { from: 0, to }, 'New ')
    expect(next).toContain('**ld**')
    expect(next).toMatch(/^New /)
    expect(next).toContain(' finish.')
  })
  it('captures source-mode selections using raw CRLF coordinates', () => {
    const markdown = 'header\r\nline one\r\nline two'
    const state = { text: 'one\nline', charCount: 8, ranges: [{
      from: 12, to: 20, text: 'one\nline', charCount: 8, startLine: 2, startColumn: 6, endLine: 3, endColumn: 4
    }] }
    expect(captureAnnotationAnchor({ root, markdown, version: '' }, 'markdown', state))
      .toMatchObject({ source: 'one\r\nline', from: 13 })
  })
})

describe('read-only view anchors', () => {
  it('normalizes PDF bars independently by page and restores them at a different scale', () => {
    let scale = 1
    for (const number of [1, 2]) {
      const el = document.createElement('div')
      el.dataset.writePdfPage = String(number)
      Object.assign(el.style, { width: '100px', height: '200px' })
      el.getBoundingClientRect = () => new DOMRect(10, 200 * number, 100 * scale, 200 * scale)
      root.append(el)
    }
    const view = { root, markdown: '', version: 'a' }
    const anchor = captureAnnotationAnchor(view, 'pdf', { text: 'pages', ranges: [], charCount: 5,
      rects: [1, 2].map((page) => ({ page, x: 25, y: 50, width: 40, height: 10 })) })!
    expect(workAnnotationAnchorSchema.safeParse(anchor).success).toBe(true)
    scale = 2
    expect(locateAnnotation(view, anchor).rects.map((r) => [r.x, r.y, r.width, r.height]))
      .toEqual([[60, 300, 80, 20], [60, 500, 80, 20]])
    expect(locateAnnotation({ ...view, version: 'b' }, anchor).status).toBe('detached')
  })
  it('binds a Word selection across paragraphs to offsets in the full document model', () => {
    root.className = 'kun-docx-surface'
    root.innerHTML = '<div data-docx-page-index="2"><p data-docx-paragraph-host data-docx-source-id="a">Begin here</p></div>' +
      '<div data-docx-page-index="3"><p data-docx-paragraph-host data-docx-source-id="b">and end</p></div>'
    const model = { nodes: ['Begin here', 'and end'].map((text, i) => ({ type: 'paragraph', blockId: i ? 'b' : 'a',
      children: [{ type: 'text', text }] })) } as DocModel
    const resolve = vi.fn(() => ({ fragments: [], issues: [], unresolvedSourceIds: [], scope: 'mounted_pages' as const, status: 'not_mounted' as const }))
    const release = registerWordAnchorViewer(root, 'v1', () => model, resolve, vi.fn())
    const [a, b] = root.querySelectorAll('p'), range = document.createRange()
    range.setStart(a.firstChild!, 6)
    range.setEnd(b.firstChild!, 3)
    expect(wordAnnotation(root, range, 'newer-bytes', 'here and')).toBeNull()
    const anchor = wordAnnotation(root, range, 'v1', 'here and')!
    expect(anchor).toMatchObject({ kind: 'word', quote: 'here\nand', start: { offset: 6, page: 3 }, end: { offset: 3, page: 4 } })
    expect(workAnnotationAnchorSchema.safeParse(anchor).success).toBe(true)
    locateAnnotation({ root, markdown: '', version: 'v1' }, anchor)
    expect(resolve.mock.calls[0]).toMatchObject([root, [{ nodeId: 'a', start: 6, end: 10 }, { nodeId: 'b', start: 0, end: 3 }]])
    release()
  })
  it('reattaches a unique Word passage after a nearby paragraph is inserted without guessing for ambiguous records', () => {
    root.className = 'kun-docx-surface'
    root.innerHTML = '<div data-docx-page-index="0"><p data-docx-paragraph-host data-docx-source-id="1">Target</p></div>'
    const model = (lines: string[]): DocModel => ({ nodes: lines.map((text, i) => ({
      type: 'paragraph', blockId: String(i), children: [{ type: 'text', text }]
    })) }) as DocModel
    const resolve = vi.fn(() => ({ fragments: [], issues: [], unresolvedSourceIds: [], scope: 'mounted_pages' as const, status: 'not_mounted' as const }))
    const release = registerWordAnchorViewer(root, 'before', () => model(['Start', 'Target', 'End']), resolve, vi.fn())
    const range = document.createRange()
    range.selectNodeContents(root.querySelector('p')!.firstChild!)
    const anchor = wordAnnotation(root, range, 'before', 'Target')!
    expect(anchor.unique).toBe(true)
    release()
    const next = registerWordAnchorViewer(root, 'after', () => model(['Start', 'Inserted', 'Target', 'End']), resolve, vi.fn())
    const view = { root, markdown: '', version: 'after' }
    expect(locateAnnotation(view, anchor).status).toBe('unmounted')
    expect(resolve.mock.calls[0]).toMatchObject([root, [{ nodeId: '2', start: 0, end: 6 }]])
    expect(locateAnnotation(view, { ...anchor, unique: undefined }).status).toBe('detached')
    next()
    const duplicated = registerWordAnchorViewer(root, 'after', () => model(['Start', 'Target', 'End', 'Start', 'Target', 'End']), resolve, vi.fn())
    expect(locateAnnotation(view, anchor).status).toBe('detached')
    duplicated()
  })
})

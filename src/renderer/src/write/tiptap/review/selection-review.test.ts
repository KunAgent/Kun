import { describe, expect, it } from 'vitest'
import { getSchema, type Editor } from '@tiptap/core'
import { EditorState, type Transaction } from '@tiptap/pm/state'
import { history, undo } from '@tiptap/pm/history'
import { buildWriteRichExtensions } from '../markdown-manager'
import { parseWorkDocument, serializeWorkDocument } from '../../markdown/document-codec'
import { buildWriteRichMarkdownProjection } from '../markdown-projection'
import { writeReviewPlugin, writeReviewPluginKey } from './review-plugin'
import { WriteReviewSession } from './review-session'
import { beginRichSelectionReview } from './selection-review'
const schema = getSchema(buildWriteRichExtensions())
function harness(markdown: string) {
  const parsed = parseWorkDocument(markdown)
  let ctx = parsed.ctx
  let state = EditorState.create({ schema, doc: schema.nodeFromJSON(parsed.doc), plugins: [history(), writeReviewPlugin] })
  const emitted: string[] = []
  const dispatch = (tr: Transaction): void => { state = state.apply(tr) }
  const editor = { schema, get state() { return state }, view: { dispatch }, setEditable: () => {} } as unknown as Editor
  const session = new WriteReviewSession(editor, { onFinish: (md) => emitted.push(md), onStateChange: () => {}, onChunksChange: () => {} }, () => ctx, (next) => { ctx = next })
  return { editor, session, emitted, dispatch, get ctx() { return ctx }, serialize: () => serializeWorkDocument(state.doc.toJSON(), ctx) }
}
const target = 'Rewrite this ordinary paragraph carefully.'
const fixtures = [
  '---\ntitle: "A title"\n---\n\n',
  '| Name | Value |\n| :--- | ---: |\n| A | 1 |\n\n',
  '$$\nx^2 + y^2 = z^2\n$$\n\n',
  '<section class="example">\nKeep HTML verbatim.\n</section>\n\n',
  '> [!NOTE]\n> Keep this callout.\n\n',
  '* [ ] unchecked\n* [x] checked\n\n',
  'Footnote[^note].\n\n[^note]: Keep definition.\n\n',
  '[A reference][link]\n\n[link]: https://example.com "Title"\n\n'
]
function begin(h: ReturnType<typeof harness>, baseline: string, original = target, replacement = 'Rewrite this ordinary paragraph clearly.') {
  const projection = buildWriteRichMarkdownProjection(h.editor.state.doc).text
  const from = projection.indexOf(original)
  return beginRichSelectionReview({ editor: h.editor, session: h.session, ctx: h.ctx, baseline, readOnly: false,
    range: { from, to: from + original.length }, original, replacement, instruction: 'Polish' })
}
describe('rich selection review fidelity', () => {
  for (const prefix of fixtures) for (const eol of ['\n', '\r\n']) {
    it(`keeps untouched ${prefix.slice(0, 24)} blocks byte-exact (${JSON.stringify(eol)})`, () => {
      const baseline = `${prefix}${target}\n\nUnchanged **strong** and [link](https://example.com).`.replace(/\n/g, eol)
      const h = harness(baseline)
      expect(begin(h, baseline)).not.toBeNull()
      expect(h.emitted).toEqual([])
      expect(writeReviewPluginKey.getState(h.editor.state)?.origin).toBe('selection')
      expect(h.session.chunkCount()).toBe(1)
      h.session.resolveAll('accept')
      expect(h.emitted.at(-1)).toBe(baseline.replace(target, 'Rewrite this ordinary paragraph clearly.'))
      expect(undo(h.editor.state, h.dispatch)).toBe(true)
      expect(h.serialize()).toBe(baseline)
    })
  }
  it('rejects the whole proposal without emitting changed content', () => {
    const baseline = `# Heading\n\n${target}\n`
    const h = harness(baseline)
    expect(begin(h, baseline)).not.toBeNull()
    h.session.resolveAll('reject')
    expect(h.emitted).toEqual([baseline])
    expect(h.serialize()).toBe(baseline)
  })
  it('supports a cross-block selection and isolates undo from immediately preceding typing', () => {
    const h = harness('Header\n\nFirst paragraph.\n\nSecond paragraph.\n\nTail')
    h.dispatch(h.editor.state.tr.insertText('!', 7))
    const baseline = h.serialize()
    const selected = 'First paragraph.\n\nSecond paragraph.'
    expect(begin(h, baseline, selected, 'Combined paragraph.')).not.toBeNull()
    h.session.resolveAll('accept')
    expect(undo(h.editor.state, h.dispatch)).toBe(true)
    expect(h.serialize()).toBe(baseline)
  })
  it('refuses stale selections, read-only documents and concurrent reviews', () => {
    const h = harness(target)
    const params = { editor: h.editor, session: h.session, ctx: h.ctx, baseline: target,
      range: { from: 0, to: target.length }, original: target, replacement: 'Edited.', instruction: 'Polish' }
    expect(beginRichSelectionReview({ ...params, readOnly: true })).toBeNull()
    expect(beginRichSelectionReview({ ...params, readOnly: false, original: 'wrong' })).toBeNull()
    expect(beginRichSelectionReview({ ...params, readOnly: false })).not.toBeNull()
    expect(beginRichSelectionReview({ ...params, readOnly: false })).toBeNull()
  })
})

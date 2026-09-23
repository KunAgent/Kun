/**
 * S5 block-level interaction tests (implementation §9): block targeting,
 * move-up/down transactions, block→markdown copy, heading anchor links,
 * slash-menu filtering, and markdown-aware paste detection. Runs on the
 * view-less editor harness like review-session.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { EditorState } from '@tiptap/pm/state'
import { buildWriteRichExtensions } from '../markdown-manager'
import { parseWorkDocument } from '../../markdown/document-codec'
import {
  blockLinkForNode,
  blockTargetAtPos,
  blocksToMarkdown,
  blockToMarkdown,
  moveBlockTransaction,
  selectedBlocks
} from './block-target'
import { filterSlashItems } from './slash-menu'
import { hasRichHtml, MARKDOWN_LIKE_RE } from './write-paste'

const schema = getSchema(buildWriteRichExtensions())

function stateFor(markdown: string) {
  const parsed = parseWorkDocument(markdown)
  return {
    ctx: parsed.ctx,
    state: EditorState.create({ schema, doc: schema.nodeFromJSON(parsed.doc) })
  }
}

describe('blockTargetAtPos', () => {
  it('resolves the paragraph containing a text position', () => {
    const { state } = stateFor('alpha\n\nbeta\n')
    const target = blockTargetAtPos(state, 1)
    expect(target?.node.type.name).toBe('paragraph')
    expect(target?.node.textContent).toBe('alpha')
  })

  it('resolves headings and code blocks at depth 1', () => {
    const { state } = stateFor('# Title\n\n```ts\ncode\n```\n')
    const heading = blockTargetAtPos(state, 1)
    expect(heading?.node.type.name).toBe('heading')
    const code = blockTargetAtPos(state, heading!.pos + heading!.node.nodeSize + 1)
    expect(code?.node.type.name).toBe('codeBlock')
  })

  it('resolves individual list items instead of the whole list', () => {
    const { state } = stateFor('- one\n- two\n- three\n')
    // Inside the second item's text.
    const second = blockTargetAtPos(state, 10)
    expect(second?.node.type.name).toBe('listItem')
    expect(second?.node.textContent).toBe('two')
  })
})

describe('moveBlockTransaction', () => {
  it('moves a block down past its next sibling', () => {
    const { state } = stateFor('first\n\nsecond\n\nthird\n')
    const first = blockTargetAtPos(state, 1)!
    const tr = moveBlockTransaction(state, first, 1)!
    expect(tr.doc.textContent).toBe('secondfirstthird')
    expect(tr.doc.child(0).textContent).toBe('second')
    expect(tr.doc.child(1).textContent).toBe('first')
  })

  it('moves a block up and returns null at the boundary', () => {
    const { state } = stateFor('first\n\nsecond\n')
    const second = blockTargetAtPos(state, 8)!
    const tr = moveBlockTransaction(state, second, -1)!
    expect(tr.doc.child(0).textContent).toBe('second')
    const first = blockTargetAtPos(state, 1)!
    expect(moveBlockTransaction(state, first, -1)).toBeNull()
  })
})

describe('block markdown copy', () => {
  it('serializes a single block through the work codec', () => {
    const { state, ctx } = stateFor('# Hello\n\nbody text\n')
    const heading = blockTargetAtPos(state, 1)!
    expect(blockToMarkdown(heading.node, ctx)).toBe('# Hello')
  })

  it('serializes a text-selection block via blocksToMarkdown', () => {
    const { state, ctx } = stateFor('alpha\n\n- item one\n- item two\n')
    expect(blocksToMarkdown(state, ctx)).toBe('alpha')
  })

  it('returns the block under a collapsed selection', () => {
    const { state } = stateFor('one\n\ntwo\n')
    const blocks = selectedBlocks(state)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].node.textContent).toBe('one')
  })
})

describe('blockLinkForNode', () => {
  it('builds a relative-path slug link for headings', () => {
    const { state } = stateFor('# My Section\n')
    const heading = blockTargetAtPos(state, 1)!
    const link = blockLinkForNode(heading.node, 'notes/todo.md', '')
    expect(link).toBe('notes/todo.md#my-section')
  })

  it('returns null for non-heading blocks', () => {
    const { state } = stateFor('plain\n')
    const paragraph = blockTargetAtPos(state, 1)!
    expect(blockLinkForNode(paragraph.node, 'a.md', '')).toBeNull()
  })
})

describe('filterSlashItems', () => {
  it('returns all items for an empty query', () => {
    expect(filterSlashItems('').length).toBeGreaterThan(10)
  })

  it('matches by id and keyword, including zh keywords', () => {
    expect(filterSlashItems('mermaid').map((item) => item.id)).toContain('mermaid')
    expect(filterSlashItems('todo').map((item) => item.id)).toContain('taskList')
    expect(filterSlashItems('表格').map((item) => item.id)).toContain('table')
    expect(filterSlashItems('xyz-nothing')).toHaveLength(0)
  })
})

describe('markdown-aware paste detection', () => {
  it('flags markdown-looking plain text', () => {
    expect(MARKDOWN_LIKE_RE.test('# heading')).toBe(true)
    expect(MARKDOWN_LIKE_RE.test('- item\n- item2')).toBe(true)
    expect(MARKDOWN_LIKE_RE.test('| a | b |')).toBe(true)
    expect(MARKDOWN_LIKE_RE.test('[[wikilink]]')).toBe(true)
    expect(MARKDOWN_LIKE_RE.test('just a sentence.')).toBe(false)
  })

  it('requires structural tags for html to count as rich', () => {
    expect(hasRichHtml('<ul><li>a</li></ul>')).toBe(true)
    expect(hasRichHtml('<table><tr><td>x</td></tr></table>')).toBe(true)
    expect(hasRichHtml('<span>plain</span>')).toBe(false)
    expect(hasRichHtml('')).toBe(false)
  })
})

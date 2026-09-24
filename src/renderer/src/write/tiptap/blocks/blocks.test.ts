/**
 * S5 block-level interaction tests (implementation §9): block targeting,
 * move-up/down transactions, block→markdown copy, heading anchor links,
 * slash-menu filtering, and markdown-aware paste detection. Runs on the
 * view-less editor harness like review-session.test.ts.
 */
import { describe, expect, it, vi } from 'vitest'
import { getSchema, type Editor } from '@tiptap/core'
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { buildWriteRichExtensions } from '../markdown-manager'
import { parseWorkDocument, type WorkDocContext } from '../../markdown/document-codec'
import { blockMenuLayout, runClipboard, type BlockMenuDeps } from './block-menu'
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

function posOfText(state: EditorState, text: string): number {
  let found = -1
  state.doc.descendants((node, pos) => {
    if (found >= 0) return false
    if (node.isText && node.text === text) {
      found = pos + 1
      return false
    }
    return true
  })
  return found
}

function stateWithCaretAt(state: EditorState, text: string): EditorState {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, posOfText(state, text))))
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
    expect(blockToMarkdown(heading, ctx)).toBe('# Hello')
  })

  it('keeps the bullet marker when copying a list item', () => {
    const { state, ctx } = stateFor('- one\n- two\n- three\n')
    expect(blocksToMarkdown(stateWithCaretAt(state, 'two'), ctx)).toBe('- two')
  })

  it('keeps the item number when copying an ordered list item', () => {
    const { state, ctx } = stateFor('1. one\n2. two\n3. three\n')
    expect(blocksToMarkdown(stateWithCaretAt(state, 'two'), ctx)).toBe('2. two')
  })

  it('keeps the checkbox when copying a task item', () => {
    const { state, ctx } = stateFor('- [x] done\n- [ ] todo\n')
    expect(blocksToMarkdown(stateWithCaretAt(state, 'done'), ctx)).toBe('- [x] done')
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

describe('blockMenuLayout', () => {
  it('orders the top level as copy, cut, duplicate | convert, more | delete', () => {
    const layout = blockMenuLayout({ readOnly: false, multiple: false, hasLink: true })
    const ids = layout.map((item) => (item === 'separator' ? '|' : item.id))
    expect(ids).toEqual(['copy', 'cut', 'duplicate', '|', 'convert', 'more', '|', 'delete'])
  })

  it('marks delete as dangerous', () => {
    const layout = blockMenuLayout({ readOnly: false, multiple: false, hasLink: false })
    const del = layout.find((item) => item !== 'separator' && item.id === 'delete')
    expect(del && del !== 'separator' && del.danger).toBe(true)
  })

  it('disables cut when read-only', () => {
    const layout = blockMenuLayout({ readOnly: true, multiple: false, hasLink: false })
    const cut = layout.find((item) => item !== 'separator' && item.id === 'cut')
    expect(cut && cut !== 'separator' && cut.disabled).toBe(true)
  })

  it('omits copyLink from the more submenu for non-heading blocks', () => {
    const layout = blockMenuLayout({ readOnly: false, multiple: false, hasLink: false })
    const more = layout.find((item) => item !== 'separator' && item.id === 'more')
    expect(more && more !== 'separator' ? more.submenu : []).not.toContain('copyLink')
    const withLink = blockMenuLayout({ readOnly: false, multiple: false, hasLink: true })
    const moreLink = withLink.find((item) => item !== 'separator' && item.id === 'more')
    expect(moreLink && moreLink !== 'separator' ? moreLink.submenu : []).toContain('copyLink')
  })
})

describe('runClipboard', () => {
  function fakeDeps(markdown: string) {
    const { ctx, state } = stateFor(markdown)
    let current = state
    const view = {
      get state() {
        return current
      },
      dispatch(tr: Transaction) {
        current = current.apply(tr)
      },
      focus: vi.fn()
    } as unknown as EditorView
    const deps: BlockMenuDeps = {
      editor: { view } as unknown as Editor,
      getCtx: () => ctx as WorkDocContext,
      getFilePath: () => 'a.md',
      getWorkspaceRoot: () => '',
      isReadOnly: () => false
    }
    return { deps, view, state: () => current }
  }

  it('falls back to clipboard.writeText when execCommand is unavailable', () => {
    const writeText = vi.fn()
    const execCommand = vi.fn(() => false)
    vi.stubGlobal('document', { execCommand })
    vi.stubGlobal('navigator', { clipboard: { writeText }, platform: 'MacIntel' })
    try {
      const { deps, view } = fakeDeps('alpha\n\nbeta\n')
      const target = blockTargetAtPos(view.state, 1)!
      runClipboard(deps, target, 'copy')
      expect(execCommand).toHaveBeenCalledWith('copy')
      expect(writeText).toHaveBeenCalledWith('alpha')
      expect(view.state.doc.textContent).toContain('alpha')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('deletes the block on cut fallback', () => {
    const writeText = vi.fn()
    vi.stubGlobal('document', { execCommand: () => false })
    vi.stubGlobal('navigator', { clipboard: { writeText }, platform: 'MacIntel' })
    try {
      const { deps, view } = fakeDeps('alpha\n\nbeta\n')
      const target = blockTargetAtPos(view.state, 1)!
      runClipboard(deps, target, 'cut')
      expect(writeText).toHaveBeenCalledWith('alpha')
      expect(view.state.doc.textContent).not.toContain('alpha')
      expect(view.state.doc.textContent).toContain('beta')
    } finally {
      vi.unstubAllGlobals()
    }
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

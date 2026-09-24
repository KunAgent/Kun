/**
 * Regression tests for the corrective pass over the Work markdown codec:
 * inline math escapes, blank-line blocks, signature-fallback source reuse
 * (undo / paste-back / review-reject), separator safety for inserted
 * blocks, CRLF preservation, BOM frontmatter, HTML wrapper merging, and
 * schema-constraint handling.
 */
import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { parseWorkDocument, serializeWorkDocument } from './document-codec'
import { pmBlockToMdast } from './pm-to-mdast'

function roundTrip(markdown: string): string {
  const { doc, ctx } = parseWorkDocument(markdown)
  return serializeWorkDocument(doc, ctx)
}

function blockTypes(doc: JSONContent): string[] {
  return (doc.content ?? []).map((node) => node.type ?? '')
}

describe('inline math via remark-math', () => {
  it('keeps LaTeX escapes verbatim', () => {
    expect(roundTrip('inline $\\{a\\}$ end\n')).toBe('inline $\\{a\\}$ end\n')
    expect(roundTrip('$x\\,y$\n')).toBe('$x\\,y$\n')
  })

  it('demotes currency-style false positives back to text', () => {
    const { doc } = parseWorkDocument('costs $5 and $6 total\n')
    const para = doc.content![0]
    expect(para.content?.every((node) => node.type === 'text')).toBe(true)
    expect(para.content?.map((node) => node.text).join('')).toBe('costs $5 and $6 total')
  })

  it('demotes math padded with inner whitespace', () => {
    const { doc } = parseWorkDocument('a $ b$ and $c $ d\n')
    const para = doc.content![0]
    expect(para.content?.some((node) => node.type === 'inlineMath')).toBe(false)
    expect(roundTrip('a $ b$ and $c $ d\n')).toBe('a $ b$ and $c $ d\n')
  })

  it('does not let emphasis split two formulas', () => {
    const { doc } = parseWorkDocument('$a*b$ c $d*e$\n')
    const types = doc.content![0].content!.map((node) => node.type)
    expect(types.filter((t) => t === 'inlineMath')).toHaveLength(2)
    expect(roundTrip('$a*b$ c $d*e$\n')).toBe('$a*b$ c $d*e$\n')
  })
})

describe('wikiLink verbatim raw', () => {
  it('keeps escapes inside brackets', () => {
    const md = 'a [[x\\_y]] b\n'
    const { doc } = parseWorkDocument(md)
    const wiki = doc.content![0].content!.find((n) => n.type === 'wikiLink')
    expect(wiki?.attrs?.raw).toBe('[[x\\_y]]')
    expect(roundTrip(md)).toBe(md)
  })
})

describe('blank lines model empty paragraphs', () => {
  it('every extra blank line becomes its own empty block', () => {
    const { doc } = parseWorkDocument('a\n\n\n\nb\n')
    expect(blockTypes(doc)).toEqual(['paragraph', 'paragraph', 'paragraph', 'paragraph'])
    expect(roundTrip('a\n\n\n\nb\n')).toBe('a\n\n\n\nb\n')
  })

  it('three newlines produce one empty paragraph', () => {
    const { doc } = parseWorkDocument('a\n\n\nb\n')
    expect(blockTypes(doc)).toEqual(['paragraph', 'paragraph', 'paragraph'])
    expect(roundTrip('a\n\n\nb\n')).toBe('a\n\n\nb\n')
  })

  it('a single trailing newline stays trailing, not a block', () => {
    const { doc } = parseWorkDocument('a\n')
    expect(blockTypes(doc)).toEqual(['paragraph'])
    expect(roundTrip('a\n')).toBe('a\n')
  })

  it('docs ending in a list + auto trailing paragraph round-trip', () => {
    const { doc, ctx } = parseWorkDocument('a\n\n- x\n')
    const content = [...(doc.content ?? []), { type: 'paragraph' }]
    expect(serializeWorkDocument({ type: 'doc', content }, ctx)).toBe('a\n\n- x\n')
  })

  it('a whitespace-only body serializes back byte-exactly', () => {
    expect(roundTrip('\n')).toBe('\n')
    expect(roundTrip('\n\n\n')).toBe('\n\n\n')
    expect(roundTrip('')).toBe('')
  })
})

describe('signature-fallback source reuse', () => {
  it('a content-equal block with a fresh blockId emits the original source', () => {
    const { doc, ctx } = parseWorkDocument('first\n\nse_\\_cond *em*\n\nthird\n')
    const clone = JSON.parse(JSON.stringify(doc)) as JSONContent
    // Undo produces a new node identity: content identical, blockId new.
    clone.content![1].attrs = { blockId: 'brand-new-id' }
    expect(serializeWorkDocument(clone, ctx)).toBe('first\n\nse_\\_cond *em*\n\nthird\n')
  })

  it('a pasted-back copy of a deleted block reuses its source', () => {
    const { doc, ctx } = parseWorkDocument('keep\n\ndropped_\\_x\n\nend\n')
    const clone = JSON.parse(JSON.stringify(doc)) as JSONContent
    clone.content!.splice(1, 1)
    const without = serializeWorkDocument(clone, ctx)
    expect(without).toBe('keep\n\nend\n')
    // Paste the same text back as a fresh block (new id / no id).
    const pasted = JSON.parse(JSON.stringify(without ? clone : clone)) as JSONContent
    pasted.content!.splice(1, 0, {
      type: 'paragraph',
      content: [{ type: 'text', text: 'dropped__x' }]
    })
    const out = serializeWorkDocument(pasted, ctx)
    expect(out).toContain('dropped_\\_x')
  })
})

describe('separator safety for inserted blocks', () => {
  it('a new block after a tight-adjacent block still parses separately', () => {
    const { doc, ctx } = parseWorkDocument('b\n- x\n')
    const content = [...(doc.content ?? [])]
    content.splice(1, 0, { type: 'paragraph', content: [{ type: 'text', text: 'c' }] })
    const out = serializeWorkDocument({ type: 'doc', content }, ctx)
    expect(out).toBe('b\n\nc\n\n- x\n')
    // And it re-parses as three distinct blocks.
    const again = parseWorkDocument(out)
    expect(blockTypes(again.doc)).toEqual(['paragraph', 'paragraph', 'bulletList'])
  })

  it('unchanged tight-adjacent pairs keep their original separator', () => {
    expect(roundTrip('b\n- x\n')).toBe('b\n- x\n')
  })
})

describe('CRLF handling', () => {
  it('round-trips CRLF documents byte-identically', () => {
    const md = 'one\r\n\r\ntwo\r\n'
    expect(roundTrip(md)).toBe(md)
  })

  it('newly inserted blocks emit CRLF inside CRLF documents', () => {
    const { doc, ctx } = parseWorkDocument('a\r\n\r\nb\r\n')
    const content = [...(doc.content ?? [])]
    content.splice(1, 0, { type: 'paragraph', content: [{ type: 'text', text: 'mid' }] })
    const out = serializeWorkDocument({ type: 'doc', content }, ctx)
    expect(out).toBe('a\r\n\r\nmid\r\n\r\nb\r\n')
    expect(out).not.toContain('mid\n')
  })

  it('CRLF frontmatter survives', () => {
    const md = '---\r\ntitle: x\r\n---\r\n\r\nbody\r\n'
    expect(roundTrip(md)).toBe(md)
  })
})

describe('file edge whitespace survives edits', () => {
  it('editing a block keeps the trailing newline', () => {
    const { doc, ctx } = parseWorkDocument('# Title\n\nBody text.\n')
    const edited = JSON.parse(JSON.stringify(doc)) as JSONContent
    edited.content![1].content = [{ type: 'text', text: 'Body text!' }]
    expect(serializeWorkDocument(edited, ctx)).toBe('# Title\n\nBody text!\n')
  })

  it('a file without a trailing newline stays without one', () => {
    const { doc, ctx } = parseWorkDocument('a\n\nb')
    const edited = JSON.parse(JSON.stringify(doc)) as JSONContent
    edited.content![1].content = [{ type: 'text', text: 'b2' }]
    expect(serializeWorkDocument(edited, ctx)).toBe('a\n\nb2')
  })

  it('editing a CRLF file keeps CRLF everywhere, including the end', () => {
    const { doc, ctx } = parseWorkDocument('line one\r\nline two\r\n\r\n- a\r\n')
    const edited = JSON.parse(JSON.stringify(doc)) as JSONContent
    edited.content![0].content = [{ type: 'text', text: 'line 1' }]
    const out = serializeWorkDocument(edited, ctx)
    expect(out).toBe('line 1\r\n\r\n- a\r\n')
    expect(out).not.toMatch(/(?<!\r)\n/)
  })

  it('deleting the last block still preserves the file ending', () => {
    const { doc, ctx } = parseWorkDocument('keep\n\ngone\n')
    const edited = JSON.parse(JSON.stringify(doc)) as JSONContent
    edited.content!.pop()
    expect(serializeWorkDocument(edited, ctx)).toBe('keep\n')
  })
})

describe('frontmatter BOM', () => {
  it('BOM + frontmatter is recognized and reattached verbatim', () => {
    const md = '\uFEFF---\ntitle: x\n---\nbody\n'
    const { ctx } = parseWorkDocument(md)
    expect(ctx.frontmatter.startsWith('\uFEFF---')).toBe(true)
    expect(roundTrip(md)).toBe(md)
  })
})

describe('HTML wrapper blocks', () => {
  it('div wrapper + inner blocks + close tag merge into one raw block', () => {
    const md = '<div align="center">\n\n![x](y.png)\n\n</div>\n'
    const { doc } = parseWorkDocument(md)
    expect(blockTypes(doc)).toEqual(['rawMarkdownBlock'])
    expect(doc.content![0].attrs?.raw).toBe(md.trimEnd())
    expect(roundTrip(md)).toBe(md)
  })

  it('an unclosed open tag stays a plain html raw block', () => {
    const { doc } = parseWorkDocument('<div class="x">\n\npara\n')
    expect(blockTypes(doc)).toEqual(['rawMarkdownBlock', 'paragraph'])
  })
})

describe('schema constraints', () => {
  it('listItem starting with a non-paragraph gets a workAuto paragraph', () => {
    const md = '- ```js\n  code\n  ```\n'
    const { doc } = parseWorkDocument(md)
    const list = doc.content![0]
    const item = list.content![0]
    expect(item.type).toBe('listItem')
    expect(item.content![0].type).toBe('paragraph')
    expect(item.content![0].attrs?.workAuto).toBe(true)
    // And it drops back out on serialize so the source round-trips.
    const { ctx } = parseWorkDocument(md)
    expect(serializeWorkDocument(doc, ctx)).toBe(md)
  })

  it('a mid-paragraph image parses into inline image content', () => {
    const { doc } = parseWorkDocument('a ![x](y.png) b\n')
    const para = doc.content![0]
    expect(para.type).toBe('paragraph')
    expect(para.content?.some((n) => n.type === 'image')).toBe(true)
  })
})

describe('table cells', () => {
  it('multi-paragraph cells join with <br>', () => {
    const cell: JSONContent = {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableHeader',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'h' }] },
                { type: 'paragraph', content: [{ type: 'text', text: 'h2' }] }
              ]
            }
          ]
        },
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'v' }] }]
            }
          ]
        }
      ]
    }
    const mdast = pmBlockToMdast(cell)
    const headerCell = (mdast as { children: { children: { children: { type: string; value?: string }[] }[] }[] })
      .children[0].children[0]
    expect(headerCell.children.some((n) => n.type === 'html' && n.value === '<br>')).toBe(true)
  })

  it('a hardBreak inside a cell becomes <br>', () => {
    const cell: JSONContent = {
      type: 'table',
      content: [
        { type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'h' }] }] }] },
        {
          type: 'tableRow',
          content: [{
            type: 'tableCell',
            content: [{
              type: 'paragraph',
              content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }]
            }]
          }]
        }
      ]
    }
    const mdast = pmBlockToMdast(cell)
    const bodyCell = (mdast as { children: { children: { children: { type: string; value?: string }[] }[] }[] })
      .children[1].children[0]
    expect(bodyCell.children).toContainEqual({ type: 'html', value: '<br>' })
  })
})

describe('reference links', () => {
  it('clearing identifier turns the mark into a plain inline link', () => {
    const para: JSONContent = {
      type: 'paragraph',
      content: [{
        type: 'text',
        text: 'click',
        marks: [{ type: 'link', attrs: { href: 'https://new.example', identifier: null, label: null, reference: null } }]
      }]
    }
    const mdast = pmBlockToMdast(para)
    expect(mdast.type).toBe('paragraph')
    const link = (mdast as { children: { type: string }[] }).children[0]
    expect(link.type).toBe('link')
  })
})

import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import {
  parseWorkDocument,
  serializeWorkDocument,
  serializeWorkDocumentStandalone,
  createWorkDocContext
} from './document-codec'
import { semanticSignature, classifyBlock, nodeSource } from './block-fidelity'
import { parseMarkdownToMdast } from './remark-pipeline'

function roundTrip(markdown: string): string {
  const { doc, ctx } = parseWorkDocument(markdown)
  return serializeWorkDocument(doc, ctx)
}

function replaceBlockText(doc: JSONContent, index: number, text: string): JSONContent {
  const clone = JSON.parse(JSON.stringify(doc)) as JSONContent
  const block = clone.content?.[index]
  if (!block) throw new Error('no block')
  block.content = [{ type: 'text', text }]
  return clone
}

describe('document-codec lossless round-trip', () => {
  const corpus: [string, string][] = [
    ['simple', '# Title\n\nHello *world* and **friends**.\n\n- a\n- b\n\n1. one\n2. two\n'],
    ['paragraph styles', 'para with `code` and ~~strike~~ and ==none==.\n\n> quoted\n> text\n\n---\n'],
    ['star bullets', '* one\n* two\n  * nested\n\nnext para\n'],
    ['ordered paren', '1) first\n2) second\n'],
    ['task list', '- [x] done\n- [ ] todo\n\nend\n'],
    ['loose list', '- one\n\n- two\n\n- three\n'],
    ['tilde fence', '~~~js\nconst x = 1\n~~~\n'],
    ['fence meta', '```python title=app.py\nprint(1)\n```\n'],
    ['long fence', '````\nhas ``` inside\n````\n'],
    ['setext heading', 'Heading One\n===========\n\nHeading Two\n-----------\n'],
    ['block math', '$$\nx^2 + y^2 = z^2\n$$\n\ntext\n'],
    ['inline math', 'Euler $e^{i\\pi} + 1 = 0$ works.\n\nBut $5 and $6 stay text.\n'],
    ['callout', '> [!warning] Watch out\n> body line one\n> body line two\n'],
    ['callout no title', '> [!note]\n> just a note\n'],
    ['wiki links', 'See [[Note One]] and [[other#head|alias]] and ![[embed.png]].\n'],
    ['footnotes', 'Text with a note[^a] and another[^long-id].\n\n[^a]: first note\n[^long-id]: second note\n'],
    ['html block', '<div align="center">\n  <b>bold</b>\n</div>\n\nafter\n'],
    ['inline html', 'Press <kbd>Ctrl</kbd>+<kbd>C</kbd> now.<br>line\n'],
    ['reference link', '[click here][ref] and [shortcut].\n\n[ref]: https://example.com\n[shortcut]: /local\n'],
    ['table align', '| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n'],
    ['frontmatter', '---\ntitle: Doc\ntags:\n  - a\n  - b\n---\n\nBody text.\n'],
    ['frontmatter + callout', '---\nkey: v\n---\n> [!tip] hint\n> body\n'],
    ['escapes', 'literal \\* not emphasis and \\$ not math.\n'],
    ['hard break', 'line one  \nline two\n'],
    ['image', '![alt](/img/pic.png "title")\n\n![ref][img1]\n\n[img1]: /x.png\n'],
    ['nested blockquote', '> outer\n>\n> > inner\n'],
    ['multi blank', 'a\n\n\n\nb\n'],
    ['trailing spaces', 'para one   \n\npara two\n'],
    ['definition only', '[a]: /b\n\n[c]: /d\n'],
    ['html comment', '<!-- comment -->\n\ntext\n'],
    ['crlf', 'one\r\n\r\ntwo\r\n']
  ]

  it.each(corpus)('round-trips %s byte-identically', (_name, markdown) => {
    expect(roundTrip(markdown)).toBe(markdown)
  })

  it('frontmatter is reattached verbatim', () => {
    const md = '---\na: 1\nb: [x, y]\n---\n\nbody\n'
    const { ctx } = parseWorkDocument(md)
    expect(ctx.frontmatter).toBe('---\na: 1\nb: [x, y]\n---\n')
  })

  it('one-block edit only changes that block', () => {
    const md = '# Head\n\nfirst para\n\n- item a\n- item b\n\nlast para\n'
    const { doc, ctx } = parseWorkDocument(md)
    const edited = replaceBlockText(doc, 1, 'first para edited')
    const out = serializeWorkDocument(edited, ctx)
    expect(out).toBe('# Head\n\nfirst para edited\n\n- item a\n- item b\n\nlast para\n')
  })

  it('edited list keeps its bullet marker', () => {
    const md = '* a\n* b\n'
    const { doc, ctx } = parseWorkDocument(md)
    const clone = JSON.parse(JSON.stringify(doc)) as JSONContent
    clone.content![0].content![0].content![0].content![0].text = 'a2'
    const out = serializeWorkDocument(clone, ctx)
    expect(out).toBe('* a2\n* b\n')
  })

  it('raw blocks survive edits elsewhere', () => {
    const md = 'before\n\n<div class="x">\n  keep <em>me</em>\n</div>\n\nafter\n'
    const { doc, ctx } = parseWorkDocument(md)
    const edited = replaceBlockText(doc, 0, 'before!')
    const out = serializeWorkDocument(edited, ctx)
    expect(out).toContain('<div class="x">\n  keep <em>me</em>\n</div>')
    expect(out.startsWith('before!')).toBe(true)
  })

  it('footnote definitions become raw blocks', () => {
    const { doc } = parseWorkDocument('t[^x]\n\n[^x]: note\n')
    const last = doc.content![doc.content!.length - 1]
    expect(last.type).toBe('rawMarkdownBlock')
    expect(last.attrs?.reason).toBe('footnote-definition')
  })

  it('inline math uses pandoc rule: currency stays text', () => {
    const { doc } = parseWorkDocument('costs $5 and $6 total\n')
    const para = doc.content![0]
    expect(para.content?.every((n) => n.type === 'text')).toBe(true)
    expect(para.content?.map((n) => n.text).join('')).toBe('costs $5 and $6 total')
  })

  it('inline math $x$ becomes inlineMath node', () => {
    const { doc } = parseWorkDocument('value $x+y$ end\n')
    const types = doc.content![0].content!.map((n) => n.type)
    expect(types).toContain('inlineMath')
  })

  it('wikiLink keeps raw form', () => {
    const { doc } = parseWorkDocument('a [[t#h|al]] b\n')
    const wiki = doc.content![0].content!.find((n) => n.type === 'wikiLink')
    expect(wiki?.attrs?.raw).toBe('[[t#h|al]]')
    expect(wiki?.attrs?.heading).toBe('h')
    expect(wiki?.attrs?.alias).toBe('al')
  })

  it('callout becomes rich callout node', () => {
    const { doc } = parseWorkDocument('> [!warning] T\n> body\n')
    const node = doc.content![0]
    expect(node.type).toBe('callout')
    expect(node.attrs?.calloutType).toBe('warning')
    expect(node.attrs?.title).toBe('T')
  })

  it('standalone serialize normalizes but preserves content', () => {
    const md = '# T\n\npara *em*\n'
    const { doc } = parseWorkDocument(md)
    const out = serializeWorkDocumentStandalone(doc)
    expect(out).toBe('# T\n\npara *em*\n')
  })
})

describe('block-fidelity', () => {
  it('signature ignores position', () => {
    const a = parseMarkdownToMdast('para **b**\n')
    const b = parseMarkdownToMdast('\n\n\npara **b**\n')
    const nodeA = a.children.find((n) => n.type === 'paragraph')!
    const nodeB = b.children.find((n) => n.type === 'paragraph')!
    expect(semanticSignature(nodeA)).toBe(semanticSignature(nodeB))
  })

  it('classifyBlock: html/definition raw, paragraph rich', () => {
    const root = parseMarkdownToMdast('p\n\n<div>x</div>\n\n[a]: /b\n')
    const types = root.children.map((c) => c.type)
    expect(types).toEqual(['paragraph', 'html', 'definition'])
    expect(root.children.map(classifyBlock)).toEqual(['rich', 'raw', 'raw'])
  })

  it('nodeSource slices verbatim fragment', () => {
    const body = 'a\n\n*b* c\n\nz\n'
    const root = parseMarkdownToMdast(body)
    const para = root.children[1]
    expect(nodeSource(body, para)).toBe('*b* c')
  })
})

describe('context-free compat', () => {
  it('empty doc produces single paragraph', () => {
    const { doc } = parseWorkDocument('')
    expect(doc.content).toEqual([{ type: 'paragraph' }])
  })

  it('fresh ctx serializes fully normalized', () => {
    const { doc } = parseWorkDocument('* a\n* b\n')
    // No preserved source/style in a fresh context → normalized output.
    const out = serializeWorkDocument(doc, createWorkDocContext())
    expect(out).toBe('- a\n- b\n')
  })
})

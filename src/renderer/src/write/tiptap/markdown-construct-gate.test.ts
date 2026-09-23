import { describe, expect, it } from 'vitest'
import { auditWriteMarkdownFidelity } from './markdown-manager'
import { findUnsupportedConstructs } from './markdown-construct-gate'

const SAMPLES: Array<{ name: string; markdown: string; expected: string[] }> = [
  {
    name: 'frontmatter',
    markdown: '---\ntitle: Hello\ntags: [a, b]\n---\n\nBody\n',
    expected: ['frontmatter']
  },
  {
    name: 'blockMath',
    markdown: 'Before\n\n$$\n\\int_0^1 x\\,dx\n$$\n\nAfter\n',
    expected: ['block-math']
  },
  {
    name: 'inlineMath stays text',
    markdown: 'Energy $E=mc^2$ inline\n',
    expected: []
  },
  {
    name: 'mermaid fenced block',
    markdown: '```mermaid\ngraph TD\n  A-->B\n```\n',
    expected: []
  },
  {
    name: 'callout',
    markdown: '> [!NOTE] Title\n> Body text\n',
    expected: ['callout']
  },
  {
    name: 'wikilink',
    markdown: 'See [[Other Note]] and ![[embed.png]]\n',
    expected: ['wikilink']
  },
  {
    name: 'htmlBlock',
    markdown: '<div align="center">\n  text\n</div>\n',
    expected: ['html']
  },
  {
    name: 'htmlInline',
    markdown: 'Press <kbd>Ctrl</kbd>+C\n',
    expected: ['html']
  },
  {
    name: 'footnote',
    markdown: 'Claim[^1]\n\n[^1]: Note text\n',
    expected: ['footnote', 'reference-definition']
  },
  {
    name: 'refLink',
    markdown: 'See [docs][d].\n\n[d]: https://x.y\n',
    expected: ['reference-definition']
  },
  {
    name: 'html comment',
    markdown: 'Text\n\n<!-- hidden -->\n\nMore\n',
    expected: ['html']
  },
  {
    name: 'escapes',
    markdown: 'Price \\$5 and a_b_c\n',
    expected: ['escaped-dollar']
  },
  {
    name: 'tableAlign',
    markdown: '| A | B |\n| :- | -: |\n| 1 | 2 |\n',
    expected: []
  },
  {
    name: 'underscoreEm',
    markdown: 'a _b_ c\n',
    expected: []
  },
  {
    name: 'starBullets',
    markdown: '* one\n* two\n',
    expected: []
  },
  {
    name: 'setext',
    markdown: 'Title\n=====\n',
    expected: []
  },
  {
    name: 'lessThan is not html',
    markdown: 'significance p<0.05 here\n',
    expected: []
  },
  {
    name: 'orderedStart',
    markdown: '3. third\n4. fourth\n',
    expected: []
  },
  {
    name: 'nestedList',
    markdown: '- a\n  - b\n    - c\n',
    expected: []
  },
  {
    name: 'blankLines',
    markdown: 'a\n\n\n\nb\n',
    expected: []
  },
  {
    name: 'highlight',
    markdown: 'this is ==marked== text\n',
    expected: []
  },
  {
    name: 'imageTitle',
    markdown: '![alt](img.png "title")\n',
    expected: []
  },
  {
    name: 'llmTypical',
    markdown: [
      '# 需求草稿',
      '',
      '这是一段包含 **加粗** 和 *斜体* 的中文说明。',
      '',
      '- 列表项一',
      '- [x] 已完成事项',
      '',
      '| 字段 | 说明 |',
      '| --- | --- |',
      '| `id` | 主键 |',
      '',
      '```ts',
      'const a = 1',
      '```',
      ''
    ].join('\n'),
    expected: []
  },
  {
    name: 'hard-wrapped list continuation',
    markdown: '1. Add protocol fields in `kun/src/contracts/`.\n2. Add agent behavior in `kun/src/loop/`, or a\n   new port/adapter under `kun/src/ports/`.\n',
    expected: []
  }
]

describe('findUnsupportedConstructs', () => {
  for (const sample of SAMPLES) {
    it(`classifies ${sample.name}`, () => {
      expect(findUnsupportedConstructs(sample.markdown)).toEqual(sample.expected)
    })
  }

  it('ignores constructs inside fenced code blocks', () => {
    const markdown = [
      '```',
      '$$',
      'x < y',
      '$$',
      '<div align="center">',
      '> [!NOTE]',
      '[[link]]',
      '[^1]',
      '[d]: https://x.y',
      '\\$5',
      '```',
      ''
    ].join('\n')
    expect(findUnsupportedConstructs(markdown)).toEqual([])
  })

  it('ignores constructs inside tilde fences', () => {
    const markdown = '~~~\n$$\n<div>\n~~~\n'
    expect(findUnsupportedConstructs(markdown)).toEqual([])
  })

  it('ignores constructs inside inline code spans', () => {
    expect(findUnsupportedConstructs('use `$$x$$`, `<div>` and `\\$` literally\n')).toEqual([])
  })

  it('still flags an unclosed fence that swallows later constructs as code', () => {
    const markdown = '```\n$$\n<div>\n'
    expect(findUnsupportedConstructs(markdown)).toEqual([])
  })
})

describe('auditWriteMarkdownFidelity construct gate', () => {
  it('rejects a block-math document before parsing', () => {
    const fidelity = auditWriteMarkdownFidelity('$$\n\\int_0^1 x\\,dx\n$$\n')
    expect(fidelity).toMatchObject({
      eligible: false,
      reason: 'unsupported-construct',
      detail: 'block-math'
    })
  })

  it('reports multiple construct codes', () => {
    const fidelity = auditWriteMarkdownFidelity('> [!NOTE] n\n\n[[a]]\n')
    expect(fidelity).toMatchObject({ eligible: false, reason: 'unsupported-construct' })
    if (!fidelity.eligible) {
      expect(fidelity.detail?.split(',')).toEqual(['wikilink', 'callout'])
    }
  })
})

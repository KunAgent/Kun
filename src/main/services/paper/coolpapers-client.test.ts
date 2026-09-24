import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test' } }))

import {
  buildCoolNotesBlock,
  decodeEntities,
  fetchCoolNotesMarkdown,
  isKimiWebCtaQuestion,
  kimiHtmlToMarkdown,
  parseCoolPageMeta,
  parseSearchHits,
  resolveCoolNotesByTitle,
  resolveCoolNotesRef,
  searchQuery,
  squeezeBlankLines,
  stripTags,
  titleKey,
  titlesCompatible
} from './coolpapers-client'

describe('titleKey', () => {
  it('ignores punctuation and case', () => {
    expect(titleKey('LoRA: Low-Rank Adaptation of LLMs')).toBe(titleKey('lora low rank adaptation of llms'))
    expect(titleKey('Segment Anything')).not.toBe(titleKey('Segment Anything 2'))
  })
})

describe('searchQuery', () => {
  it('keeps alphanumeric runs', () => {
    expect(searchQuery('LoRA: Low-Rank Adaptation!')).toBe('LoRA Low Rank Adaptation')
  })
})

describe('parseSearchHits', () => {
  it('parses id and title from list rows', () => {
    const html = `
      <a id="title-36984@AAAI" class="title-link notranslate" href="/venue/36984@AAAI" target="_blank">Learning from Long-Term Engagement</a>
      <a id="title-2608.13558" class="title-link" href="/arxiv/2608.13558">OmniScientist: An Omni-Modal AI Scientist</a>
    `
    const hits = parseSearchHits(html)
    expect(hits).toEqual([
      { id: '36984@AAAI', title: 'Learning from Long-Term Engagement' },
      { id: '2608.13558', title: 'OmniScientist: An Omni-Modal AI Scientist' }
    ])
  })
})

describe('decodeEntities', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeEntities('students&#039; work &amp; play')).toBe("students' work & play")
    expect(decodeEntities('a &lt;b&gt; c')).toBe('a <b> c')
    expect(decodeEntities('Q&A')).toBe('Q&A')
    // `&` + CJK must not slice mid-codepoint.
    expect(decodeEntities('R&D返回首页')).toBe('R&D返回首页')
    expect(decodeEntities('A&测试&amp;B')).toBe('A&测试&B')
    expect(decodeEntities('&#x4E2D;&#25991;')).toBe('中文')
  })
})

describe('kimiHtmlToMarkdown', () => {
  it('converts the faq hybrid to markdown', () => {
    const raw =
      '<p class="faq-q"><strong>Q1</strong>: 试图解决什么问题？</p>\n\n<div class="faq-a">\n\n答案正文 $x^2$ 保留。\n\n### 小节标题\n\n</div>\n'
    const md = kimiHtmlToMarkdown(raw)
    expect(md.startsWith('## Q1: 试图解决什么问题？')).toBe(true)
    expect(md).toContain('答案正文 $x^2$ 保留。')
    expect(md).toContain('### 小节标题')
    expect(md).not.toContain('faq-a')
    expect(md).not.toContain('</div>')
  })

  it('drops the kimi web cta faq', () => {
    const raw = `<p class="faq-q"><strong>Q6</strong>: 总结一下论文的主要内容</p>
<div class="faq-a">

正文摘要。

</div>

<p class="faq-q"><strong>Q7</strong>: 想要进一步了解论文</p>

<div class="faq-a">

以上只是了解一篇论文的几个基本FAQ。如果你还想与Kimi进一步讨论该论文，请点击 <a href="http://kimi.com/_prefill_chat?x=1" target="_blank"><strong>这里 <i class="fa fa-external-link"></i></strong></a> 为你跳转Kimi AI网页版，并启动一个与该论文相关的新会话。

</div>
`
    const md = kimiHtmlToMarkdown(raw)
    expect(md).toContain('## Q6: 总结一下论文的主要内容')
    expect(md).toContain('正文摘要。')
    expect(md).not.toContain('Q7')
    expect(md).not.toContain('想要进一步了解')
    expect(md).not.toContain('Kimi AI网页版')
    expect(md).not.toContain('fa-external-link')
    expect(md).not.toContain('kimi.com')
  })

  it('empty body yields empty markdown', () => {
    expect(kimiHtmlToMarkdown('')).toBe('')
    expect(kimiHtmlToMarkdown('<div class="faq-a">\n</div>')).toBe('')
  })
})

describe('resolveCoolNotesRef', () => {
  it('prefers sourceUrl then venue id', () => {
    const hit = resolveCoolNotesRef({
      coolId: '38818@AAAI',
      sourceUrl: 'https://papers.cool/venue/38818@AAAI',
      arxivId: '2608.13558'
    })
    expect(hit).toEqual({ branch: 'venue', id: '38818@AAAI', matchedBy: 'sourceUrl' })

    const second = resolveCoolNotesRef({ coolId: '38818@AAAI', arxivId: '2608.13558' })
    expect(second).toEqual({ branch: 'venue', id: '38818@AAAI', matchedBy: 'coolId' })

    const third = resolveCoolNotesRef({ arxivId: '2608.13558v2' })
    expect(third).toEqual({ branch: 'arxiv', id: '2608.13558', matchedBy: 'arxivId' })

    expect(resolveCoolNotesRef({})).toBeNull()
  })
})

describe('titlesCompatible', () => {
  it('allows truncated search hits', () => {
    const full =
      'TripLe: Revisiting Pretrained Model Reuse and Progressive Learning for Efficient Vision Transformer Scaling and Searching'
    const clipped =
      'TripLe: Revisiting Pretrained Model Reuse and Progressive Learning for Efficient Vision Transformer Scaling and Searchin'
    expect(titlesCompatible(full, clipped)).toBe(true)
    expect(titlesCompatible(full, full)).toBe(true)
    expect(titlesCompatible(full, 'TripLe')).toBe(false)
    expect(titlesCompatible('Segment Anything', 'Segment Anything 2')).toBe(false)
  })
})

describe('resolveCoolNotesByTitle', () => {
  const listing = (branch: string) =>
    branch === 'arxiv'
      ? '<a id="title-2608.13558" class="title-link" href="/arxiv/2608.13558">OmniScientist: An Omni-Modal AI Scientist</a>'
      : '<a id="title-36984@AAAI" class="title-link" href="/venue/36984@AAAI">Learning from Long-Term Engagement</a>'

  it('finds an exact normalized title across branches', async () => {
    const seen: string[] = []
    const fetchText = async (url: string) => {
      seen.push(url)
      return listing(url.includes('/arxiv/search') ? 'arxiv' : 'venue')
    }
    const hit = await resolveCoolNotesByTitle('OmniScientist: An Omni-Modal AI Scientist', fetchText)
    expect(hit).toEqual({ branch: 'arxiv', id: '2608.13558', matchedBy: 'title' })
    expect(seen[0]).toContain('/arxiv/search?query=')
  })

  it('accepts a unique truncated prefix hit', async () => {
    const clipped =
      'TripLe: Revisiting Pretrained Model Reuse and Progressive Learning for Efficient Vision Transformer Scaling and Searchin'
    const fetchText = async (url: string) =>
      url.includes('/venue/search')
        ? `<a id="title-38818@AAAI" class="title-link" href="/venue/38818@AAAI">${clipped}</a>`
        : ''
    const hit = await resolveCoolNotesByTitle(
      'TripLe: Revisiting Pretrained Model Reuse and Progressive Learning for Efficient Vision Transformer Scaling and Searching',
      fetchText
    )
    expect(hit).toEqual({ branch: 'venue', id: '38818@AAAI', matchedBy: 'title' })
  })

  it('returns null when no branch matches', async () => {
    const fetchText = async () => '<a id="title-1" class="title-link" href="/arxiv/1">Other paper</a>'
    expect(await resolveCoolNotesByTitle('Completely Different Title Here', fetchText)).toBeNull()
  })
})

describe('fetchCoolNotesMarkdown', () => {
  it('resolves and converts the kimi page', async () => {
    const calls: string[] = []
    const fetchText = async (url: string) => {
      calls.push(url)
      return '<p class="faq-q"><strong>Q1</strong>: 论文解决什么问题？</p>\n<div class="faq-a">\n\n答案。\n\n</div>\n'
    }
    const outcome = await fetchCoolNotesMarkdown(
      { arxivId: '1706.03762' },
      { fetchText }
    )
    expect(outcome.found).toBe(true)
    if (outcome.found) {
      expect(outcome.markdown).toContain('## Q1: 论文解决什么问题？')
      expect(outcome.pageUrl).toBe('https://papers.cool/arxiv/1706.03762')
      expect(outcome.matchedBy).toBe('arxivId')
    }
    expect(calls).toEqual(['https://papers.cool/arxiv/kimi?paper=1706.03762'])
  })

  it('an empty kimi body means not found', async () => {
    const outcome = await fetchCoolNotesMarkdown(
      { arxivId: '9999.99999' },
      { fetchText: async () => '' }
    )
    expect(outcome.found).toBe(false)
  })

  it('serializes concurrent fetches', async () => {
    let active = 0
    let maxActive = 0
    const order: string[] = []
    const fetchText = async (url: string) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      order.push(url)
      return 'x'
    }
    await Promise.all([
      fetchCoolNotesMarkdown({ arxivId: '0000.00001' }, { fetchText }),
      fetchCoolNotesMarkdown({ arxivId: '0000.00002' }, { fetchText })
    ])
    expect(maxActive).toBe(1)
    expect(order).toEqual([
      'https://papers.cool/arxiv/kimi?paper=0000.00001',
      'https://papers.cool/arxiv/kimi?paper=0000.00002'
    ])
  })
})

describe('parseCoolPageMeta', () => {
  const PAGE = `<!DOCTYPE html><html><head>
<meta name="citation_title" content="Learning Structurally Stabilized Representations">
<meta name="citation_authors" content="Zhiang Cao; Yulong Li; Hao He">
<meta name="citation_abstract" content="Storing data in DNA requires students&#039; care &amp; rigor.">
<meta name="citation_pdf_url" content="https://ojs.aaai.org/index.php/AAAI/article/download/36962/40924">
<meta name="citation_public_url" content="https://papers.cool/venue/36962@AAAI">
<meta name="citation_publisher" content="AAAI.2026 - Application Domains">
<meta name="citation_year" content="2026">
</head><body id="venue"></body></html>`

  it('parses highwire metadata', () => {
    const meta = parseCoolPageMeta(PAGE)
    expect(meta.title).toBe('Learning Structurally Stabilized Representations')
    expect(meta.authors).toEqual(['Zhiang Cao', 'Yulong Li', 'Hao He'])
    expect(meta.abstractText).toBe("Storing data in DNA requires students' care & rigor.")
    expect(meta.date).toBe('2026')
    expect(meta.publisher).toBe('AAAI.2026 - Application Domains')
    expect(meta.pdfUrl?.endsWith('36962/40924')).toBe(true)
  })

  it('prefers citation_date over citation_year', () => {
    const html = '<meta name="citation_date" content="2017-06-12"><meta name="citation_year" content="2017">'
    expect(parseCoolPageMeta(html).date).toBe('2017-06-12')
  })

  it('missing metadata yields empty title', () => {
    expect(parseCoolPageMeta('<html><head></head></html>').title).toBe('')
  })
})

describe('misc helpers', () => {
  it('stripTags removes markup', () => {
    expect(stripTags('<b>bold</b> text')).toBe('bold text')
  })

  it('squeezeBlankLines collapses 3+ newlines', () => {
    expect(squeezeBlankLines('a\n\n\n\nb')).toBe('a\n\nb')
  })

  it('isKimiWebCtaQuestion matches the promo question', () => {
    expect(isKimiWebCtaQuestion('想要进一步了解论文')).toBe(true)
    expect(isKimiWebCtaQuestion('论文的贡献是什么')).toBe(false)
  })

  it('buildCoolNotesBlock carries the source link', () => {
    const block = buildCoolNotesBlock('## Q1: x', 'https://papers.cool/arxiv/1706.03762')
    expect(block).toContain('**Cool Papers · Kimi 解析**')
    expect(block).toContain('> 来源：[https://papers.cool/arxiv/1706.03762](https://papers.cool/arxiv/1706.03762)')
    expect(block).toContain('## Q1: x')
  })
})

import { describe, expect, it, vi } from 'vitest'
import {
  isExplicitWriteResourceUrl,
  resolveWriteMarkdownResource,
  resolveWriteMarkdownResourcePath,
  writePathToFileUrl
} from '@shared/write-markdown-resource'
import type { WriteRetrievalContext } from '@shared/write-retrieval'
import {
  WRITE_QUOTE_ORIGINAL_END,
  WRITE_QUOTE_ORIGINAL_START,
  WRITE_OFFICE_CONTEXT_END,
  WRITE_RETRIEVAL_END,
  MAX_WRITE_QUOTED_SELECTION_CHARS,
  MAX_WRITE_QUOTED_SELECTION_COUNT,
  composeWritePrompt,
  formatWriteOfficeDocumentContextForPrompt,
  formatWriteQuotedSelectionForPrompt,
  formatWriteRetrievalContextForPrompt,
  normalizeWriteQuotedSelections,
  parseWritePromptForDisplay,
  quotedSelectionFromEditor
} from './quoted-selection'

describe('write quoted selections', () => {
  it('formats selected text with file and line context', () => {
    const quote = {
      id: 'quote-1',
      text: 'Selected paragraph',
      sourceTitle: 'notes/draft.md',
      sourceFilePath: '/tmp/workspace/notes/draft.md',
      lineStart: 3,
      lineEnd: 5,
      charCount: 18,
      createdAt: '2026-05-24T00:00:00.000Z'
    }

    expect(formatWriteQuotedSelectionForPrompt(quote)).toContain('第3-5行')
    expect(formatWriteQuotedSelectionForPrompt(quote)).toContain(WRITE_QUOTE_ORIGINAL_START)
    expect(formatWriteQuotedSelectionForPrompt(quote)).toContain(WRITE_QUOTE_ORIGINAL_END)
  })

  it('formats PDF selections with page context', () => {
    const quote = {
      id: 'quote-pdf-1',
      text: 'The method improves retrieval quality.',
      sourceKind: 'pdf' as const,
      sourceTitle: 'papers/study.pdf',
      sourceFilePath: '/tmp/workspace/papers/study.pdf',
      pageStart: 3,
      pageEnd: 4,
      charCount: 38,
      createdAt: '2026-05-24T00:00:00.000Z'
    }

    const prompt = formatWriteQuotedSelectionForPrompt(quote)

    expect(prompt).toContain('第3-4页')
    expect(prompt).toContain('papers/study.pdf')
    expect(prompt).toContain(WRITE_QUOTE_ORIGINAL_START)
    expect(prompt).toContain(WRITE_QUOTE_ORIGINAL_END)
  })

  it('keeps PDF selection rects on quoted selections', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.2)
    const quote = quotedSelectionFromEditor({
      text: 'Feature driven development',
      ranges: [{
        from: 0,
        to: 26,
        startLine: 2,
        startColumn: 1,
        endLine: 2,
        endColumn: 27,
        text: 'Feature driven development',
        charCount: 26,
        page: 2
      }],
      charCount: 26,
      sourceKind: 'pdf',
      pageStart: 2,
      pageEnd: 2,
      rects: [{ page: 2, x: 12, y: 48, width: 220, height: 18 }]
    }, '/tmp/workspace/paper.pdf', '/tmp/workspace', Date.parse('2026-05-24T00:00:00.000Z'))

    expect(quote).toMatchObject({
      sourceKind: 'pdf',
      pageStart: 2,
      pageEnd: 2,
      rects: [{ page: 2, x: 12, y: 48, width: 220, height: 18 }]
    })
    vi.restoreAllMocks()
  })

  it('serializes and parses Word, slide, and spreadsheet locations', () => {
    const base = {
      id: 'office-quote',
      sourceFilePath: '/tmp/workspace/source',
      charCount: 8,
      createdAt: '2026-08-12T00:00:00.000Z'
    }
    const quotes = [
      {
        ...base,
        text: 'Word text',
        sourceKind: 'word' as const,
        sourceFormat: 'docx' as const,
        sourceTitle: 'report.docx',
        pageStart: 2,
        pageEnd: 3
      },
      {
        ...base,
        id: 'slide-quote',
        text: 'Slide text',
        sourceKind: 'presentation' as const,
        sourceFormat: 'pptx' as const,
        sourceTitle: 'deck.pptx',
        slide: 4
      },
      {
        ...base,
        id: 'sheet-quote',
        text: 'A\tB\n1\t2',
        sourceKind: 'spreadsheet' as const,
        sourceFormat: 'xlsx' as const,
        sourceTitle: 'budget.xlsx',
        sheetName: '预算',
        cellRange: 'A1:B2',
        formulas: ['B2: =SUM(B1:B1)']
      }
    ]

    const parsed = parseWritePromptForDisplay([
      '[写作上下文]\n旧版本上下文',
      quotes.map(formatWriteQuotedSelectionForPrompt).join('\n\n'),
      '解释这些内容'
    ].join('\n\n'))

    expect(parsed?.quotes).toMatchObject([
      { sourceKind: 'word', sourceFormat: 'docx', pageStart: 2, pageEnd: 3 },
      { sourceKind: 'presentation', sourceFormat: 'pptx', slide: 4 },
      { sourceKind: 'spreadsheet', sourceFormat: 'xlsx', sheetName: '预算', cellRange: 'A1:B2' }
    ])
    expect(parsed?.quotes[2]?.text).toContain('[公式注释]')
    expect(parsed?.quotes[2]?.text).toContain('B2: =SUM(B1:B1)')
  })

  it('does not create a quote for empty selections', () => {
    expect(quotedSelectionFromEditor({
      text: '   ',
      ranges: [],
      charCount: 0
    }, '/tmp/workspace/notes.md', '/tmp/workspace')).toBeNull()
  })

  it('caps, deduplicates, and prefers recent quoted selections', () => {
    const selections = Array.from({ length: 7 }, (_, index) => ({
      id: `quote-${index}`,
      text: index === 6 ? 'x'.repeat(3_000) : `selection ${index}`,
      sourceTitle: 'notes.md',
      sourceFilePath: '/tmp/workspace/notes.md',
      lineStart: index + 1,
      lineEnd: index + 1,
      charCount: index === 6 ? 3_000 : 11,
      createdAt: `2026-08-13T00:00:0${index}.000Z`
    }))
    selections.push({ ...selections[6]!, id: 'duplicate' })

    const normalized = normalizeWriteQuotedSelections(selections)

    expect(normalized).toHaveLength(MAX_WRITE_QUOTED_SELECTION_COUNT)
    expect(normalized.at(-1)?.id).toBe('duplicate')
    expect(normalized.at(-1)?.text).toHaveLength(MAX_WRITE_QUOTED_SELECTION_CHARS)
    expect(normalized.some((selection) => selection.id === 'quote-6')).toBe(false)
  })

  it('composes prompt with committed quote context first', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1)
    const quote = quotedSelectionFromEditor({
      text: 'A useful quote',
      ranges: [{
        from: 0,
        to: 14,
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 14,
        text: 'A useful quote',
        charCount: 14
      }],
      charCount: 14
    }, '/tmp/workspace/a.md', '/tmp/workspace', Date.parse('2026-05-24T00:00:00.000Z'))

    expect(quote).not.toBeNull()
    const prompt = composeWritePrompt('Please revise it.', {
      workspaceRoot: '/tmp/workspace',
      activeFilePath: '/tmp/workspace/a.md'
    })
    expect(prompt.startsWith('[写作上下文]')).toBe(true)
    expect(prompt).toContain('仅当当前激活的专用工作流明确要求结构化确认')
    expect(prompt).toContain('PPT 视觉评审')
    expect(prompt).not.toContain('A useful quote')
    expect(prompt).not.toContain('[引用片段]')
    expect(prompt.endsWith('Please revise it.')).toBe(true)
    vi.restoreAllMocks()
  })

  it('parses write prompt metadata for compact timeline display', () => {
    const quote = {
        id: 'quote-1',
        text: "Hi, I'm zxy. Glad to meet you.",
        sourceTitle: 'welcome.md',
        sourceFilePath: '/tmp/workspace/welcome.md',
        lineStart: 10,
        lineEnd: 10,
        charCount: 31,
        createdAt: '2026-05-24T00:00:00.000Z'
    }
    const prompt = [
      '[写作上下文]\n工作空间: /tmp/workspace\n当前文件: welcome.md',
      formatWriteQuotedSelectionForPrompt(quote),
      '帮我改成中文'
    ].join('\n\n')

    const parsed = parseWritePromptForDisplay(prompt)

    expect(parsed?.userInput).toBe('帮我改成中文')
    expect(parsed?.context?.workspaceRoot).toBe('/tmp/workspace')
    expect(parsed?.context?.activeFile).toBe('welcome.md')
    expect(parsed?.context?.lines).toContain('当前文件: welcome.md')
    expect(parsed?.quotes).toHaveLength(1)
    expect(parsed?.quotes[0]).toMatchObject({
      sourceTitle: 'welcome.md',
      sourceFilePath: '/tmp/workspace/welcome.md',
      lineStart: 10,
      lineEnd: 10,
      charCount: 31,
      text: "Hi, I'm zxy. Glad to meet you."
    })
  })

  it('adds retrieval snippets with PDF page locations to assistant prompts', () => {
    const retrieval: WriteRetrievalContext = {
          source: 'bm25-keyword',
          query: 'retrieval quality',
          keywords: ['retrieval', 'quality'],
          indexedFiles: 2,
          indexedChunks: 4,
          snippets: [{
            path: 'papers/study.pdf',
            title: 'Page 3',
            text: 'The method improves retrieval quality with focused context.',
            score: 1.25,
            keywords: ['retrieval', 'quality'],
            location: {
              kind: 'pdf',
              pageStart: 3,
              pageEnd: 3
            },
            pageStart: 3,
            pageEnd: 3
          }]
    }
    const prompt = formatWriteRetrievalContextForPrompt(retrieval)

    expect(prompt).toContain('[相关文献上下文]')
    expect(prompt).toContain('papers/study.pdf 第3页')
    expect(prompt).toContain('The method improves retrieval quality')
    expect(prompt).toContain(WRITE_RETRIEVAL_END)
    expect(formatWriteRetrievalContextForPrompt(null)).toBe('')
  })

  it('collapses retrieval context out of the displayed user input', () => {
    const retrieval: WriteRetrievalContext = {
          source: 'bm25-keyword',
          query: 'feature development',
          keywords: ['feature', 'development'],
          indexedFiles: 2,
          indexedChunks: 4,
          snippets: [
            {
              path: 'notes/code-graph.md',
              title: '节点内容的处理',
              text: '每个节点都保留了原始的代码内容和行号范围。\n\n<p align="center">\n  <img src="./pic/1.png" alt="代码图构建" width="800">\n</p>',
              score: 2.5,
              keywords: ['内容'],
              location: { kind: 'text', lineStart: 12, lineEnd: 30 }
            },
            {
              path: 'papers/study.pdf',
              title: '',
              text: 'SWE-Dev provides runnable environments with developer-authored tests.',
              score: 1.5,
              keywords: ['feature'],
              location: { kind: 'pdf', pageStart: 1, pageEnd: 2 }
            }
          ]
    }
    const prompt = [
      '[写作上下文]\n工作空间: /tmp/workspace\n当前文件: papers/study.pdf',
      formatWriteRetrievalContextForPrompt(retrieval),
      '帮我看看这篇文章讲什么内容\n\n再总结三条要点'
    ].join('\n\n')

    const parsed = parseWritePromptForDisplay(prompt)

    expect(parsed?.userInput).toBe('帮我看看这篇文章讲什么内容\n\n再总结三条要点')
    expect(parsed?.retrieval?.source).toBe('bm25-keyword')
    expect(parsed?.retrieval?.keywords).toBe('feature, development')
    expect(parsed?.retrieval?.snippets).toHaveLength(2)
    expect(parsed?.retrieval?.snippets[0]).toMatchObject({
      location: 'notes/code-graph.md:12-30',
      title: '节点内容的处理',
      keywords: '内容'
    })
    expect(parsed?.retrieval?.snippets[0]?.text).toContain('代码图构建')
    expect(parsed?.retrieval?.snippets[1]).toMatchObject({
      location: 'papers/study.pdf 第1-2页',
      text: 'SWE-Dev provides runnable environments with developer-authored tests.'
    })
  })

  it('collapses whole Office semantics into a source card and adds a read-only contract', () => {
    const officeDocument = {
      sourceTitle: 'report.docx',
      sourceFilePath: '/tmp/workspace/report.docx',
      sourceFormat: 'docx' as const,
      sourceSha256: 'a'.repeat(64),
      text: '很长的文档语义正文',
      truncated: true
    }
    const currentPrompt = composeWritePrompt('总结三点', {
      workspaceRoot: '/tmp/workspace',
      activeFilePath: '/tmp/workspace/report.docx',
      officeReadOnly: true
    })
    expect(currentPrompt).toContain('禁止调用 edit、write 或 office_edit')
    expect(currentPrompt).not.toContain('很长的文档语义正文')
    const legacyPrompt = [
      '[写作上下文]\n旧版本上下文',
      formatWriteOfficeDocumentContextForPrompt(officeDocument),
      '总结三点'
    ].join('\n\n')
    expect(legacyPrompt).toContain(WRITE_OFFICE_CONTEXT_END)
    const parsed = parseWritePromptForDisplay(legacyPrompt)
    expect(parsed?.userInput).toBe('总结三点')
    expect(parsed?.userInput).not.toContain('很长的文档语义正文')
    expect(parsed?.officeDocument).toMatchObject({
      sourceTitle: 'report.docx',
      sourceFormat: 'docx',
      sourceSha256: 'a'.repeat(64),
      charCount: 9,
      truncated: true
    })
  })
})

describe('write markdown preview resources', () => {
  it('resolves relative image paths from the current markdown file', () => {
    const resolved = resolveWriteMarkdownResource('../assets/hero image.png', '/tmp/workspace/docs/draft.md')
    expect(resolved).toBe('file:///tmp/workspace/assets/hero%20image.png')
    expect(resolveWriteMarkdownResourcePath('../assets/hero image.png', '/tmp/workspace/docs/draft.md')).toBe(
      '/tmp/workspace/assets/hero image.png'
    )
  })

  it('resolves Windows local image paths without treating drive letters as URL protocols', () => {
    expect(isExplicitWriteResourceUrl('C:\\Users\\me\\assets\\hero image.png')).toBe(false)
    expect(resolveWriteMarkdownResource('..\\assets\\hero image.png', 'C:\\Users\\me\\docs\\draft.md')).toBe(
      'file:///C:/Users/me/assets/hero%20image.png'
    )
    expect(resolveWriteMarkdownResourcePath('C:\\Users\\me\\assets\\hero image.png', 'C:\\Users\\me\\docs\\draft.md')).toBe(
      'C:/Users/me/assets/hero image.png'
    )
    expect(writePathToFileUrl('\\\\server\\share\\hero image.png')).toBe(
      'file://server/share/hero%20image.png'
    )
  })

  it('keeps explicit external URLs unchanged', () => {
    expect(resolveWriteMarkdownResource('https://example.com/a.png', '/tmp/workspace/docs/draft.md')).toBe('https://example.com/a.png')
    expect(resolveWriteMarkdownResourcePath('https://example.com/a.png', '/tmp/workspace/docs/draft.md')).toBeUndefined()
  })

  it('does not pass through explicit file URLs from markdown content', () => {
    expect(resolveWriteMarkdownResource('file:///tmp/secret.png', '/tmp/workspace/docs/draft.md')).toBeUndefined()
    expect(writePathToFileUrl('/tmp/workspace/assets/hero image.png')).toBe('file:///tmp/workspace/assets/hero%20image.png')
  })
})

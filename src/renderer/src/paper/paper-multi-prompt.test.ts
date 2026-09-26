import { describe, expect, it } from 'vitest'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'
import { buildPaperMultiPrompt, paperMultiOutputPath } from './paper-multi-prompt'

function entry(unitDir: string, title: string, extra: Partial<PaperLibraryEntry['meta']> = {}): PaperLibraryEntry {
  return {
    unitDir,
    meta: {
      version: 2,
      slug: unitDir.split('/').at(-1)!,
      title,
      authors: ['Ashish Vaswani', 'Noam Shazeer'],
      year: '2017',
      pdfFile: 'p.pdf',
      importedAt: '2026-09-25T00:00:00Z',
      ...extra
    },
    hasPdf: true,
    hasNotes: true,
    interpretationCount: 0,
    group: ''
  }
}

describe('paper multi prompt', () => {
  it('names the output under notes/ with a timestamp', () => {
    expect(paperMultiOutputPath('compare', new Date(2026, 8, 25, 9, 5))).toBe('notes/对比阅读-20260925-0905.md')
    expect(paperMultiOutputPath('related-work', new Date(2026, 0, 2, 13, 40))).toBe('notes/相关工作-20260102-1340.md')
  })

  it('lists every unit with its files, cite label, and the output contract', () => {
    const prompt = buildPaperMultiPrompt({
      task: 'related-work',
      entries: [
        entry('papers/nlp/1706.03762', 'Attention Is All You Need', { citeKey: 'vaswani2017attention' }),
        entry('papers/2506.11060', 'Code Researcher')
      ],
      outputPath: 'notes/相关工作-x.md'
    })
    expect(prompt.startsWith('$paper-library')).toBe(true)
    expect(prompt).toContain('引用键：vaswani2017attention；目录：papers/nlp/1706.03762')
    expect(prompt).toContain('引用键：Vaswani 2017')
    expect(prompt).toContain('papers/2506.11060/marks/annotations.json')
    expect(prompt).toContain('输出文件（只写这个文件）：notes/相关工作-x.md')
  })
})

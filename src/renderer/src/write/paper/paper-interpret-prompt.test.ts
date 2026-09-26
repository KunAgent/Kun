import { describe, expect, it } from 'vitest'
import type { PaperUnitMetaV1 } from '@shared/paper/paper-types'
import { buildPaperInterpretPrompt } from './paper-interpret-prompt'

const meta: PaperUnitMetaV1 = {
  version: 1,
  slug: '1706.03762',
  arxivId: '1706.03762',
  title: 'Attention Is All You Need',
  authors: ['Ashish Vaswani'],
  importedAt: '2026-01-01T00:00:00.000Z',
  pdfFile: '1706.03762.pdf',
  interpretations: []
}

describe('buildPaperInterpretPrompt', () => {
  it('emits skills, paths, output file, and board naming contract', () => {
    const prompt = buildPaperInterpretPrompt({
      unitDir: 'papers/1706.03762',
      meta,
      outputPath: 'papers/1706.03762/1706.03762-解读.md'
    })
    expect(prompt).toContain('$paper-reader')
    expect(prompt).toContain('$excalidraw-diagram')
    expect(prompt).toContain('papers/1706.03762/paper.md')
    expect(prompt).toContain('papers/1706.03762/figures/index.json')
    expect(prompt).toContain('papers/1706.03762/1706.03762-解读.md')
    expect(prompt).toContain('boardId = "paper-17060376-<序号>"')
    expect(prompt).toContain('papers/1706.03762/assets/<title>.png')
    expect(prompt).toContain('简体中文')
  })

  it('appends a custom template and falls back to the default when blank', () => {
    const custom = buildPaperInterpretPrompt({
      unitDir: 'papers/x',
      meta: { ...meta, slug: 'x' },
      outputPath: 'papers/x/x-解读.md',
      template: '  重点关注实验设置。  '
    })
    expect(custom).toContain('重点关注实验设置。')
    const fallback = buildPaperInterpretPrompt({
      unitDir: 'papers/x',
      meta: { ...meta, slug: 'x' },
      outputPath: 'papers/x/x-解读.md',
      template: '   '
    })
    expect(fallback).toContain('---')
    expect(fallback.length).toBeGreaterThan(100)
  })

  it('honors language choice and adds limitation lines', () => {
    const prompt = buildPaperInterpretPrompt({
      unitDir: 'papers/x',
      meta: { ...meta, slug: 'x' },
      outputPath: 'papers/x/x-解读.md',
      language: 'en',
      visionCapable: false,
      figuresFailed: true
    })
    expect(prompt).toContain('English')
    expect(prompt).toContain('图表抽取失败')
    expect(prompt).toContain('confidence=low')
  })
})

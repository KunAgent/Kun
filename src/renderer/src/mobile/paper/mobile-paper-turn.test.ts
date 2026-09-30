import { describe, expect, it } from 'vitest'
import { buildMobilePaperQuestion } from './mobile-paper-turn'

describe('mobile paper turn context', () => {
  it('binds an ordinary question to the exact library, unit and current page', () => {
    const prompt = buildMobilePaperQuestion({ text: '比较实验', libraryRoot: '/library/B',
      unitDir: 'papers/group/unit', page: 12, quote: null })
    expect(prompt).toContain('比较实验')
    expect(prompt).toContain('[paper-reading] library=/library/B; unit=papers/group/unit; page=12')
  })
  it('keeps selection page distinct from current page', () => {
    const prompt = buildMobilePaperQuestion({ text: '解释', libraryRoot: '/A',
      unitDir: 'papers/unit', page: 12, quote: { text: 'Selected text', page: 4 } })
    expect(prompt).toContain('page=12')
    expect(prompt).toContain('引用（第 4 页）：')
  })
})

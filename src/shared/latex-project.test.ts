import { describe, expect, it } from 'vitest'
import { isLatexFilePath, normalizeLatexSettings } from './latex-project'
import { isWriteWorkspaceEntry, isWriteWorkspaceFilePath } from './write-text-file'
import { mergeWriteSettings, defaultWriteSettings } from './app-settings-write'

describe('LaTeX Work contracts', () => {
  it('opens LaTeX source families without making code files editable', () => {
    for (const ext of ['tex', 'ltx', 'bib', 'cls', 'sty', 'TEX']) {
      expect(isLatexFilePath(`/paper/main.${ext}`)).toBe(true)
      expect(isWriteWorkspaceFilePath(`/paper/main.${ext}`)).toBe(true)
      expect(isWriteWorkspaceEntry({ name: `main.${ext}`, path: `/paper/main.${ext}`, ext: `.${ext}`, type: 'file' })).toBe(true)
    }
    expect(isLatexFilePath('paper.tex/notes.md')).toBe(false)
    expect(isLatexFilePath('code.ts')).toBe(false)
  })
  it('normalizes and merges defaults while keeping build output in cache', () => {
    expect(normalizeLatexSettings()).toEqual({ engine: 'pdflatex', autoCompile: true, texPath: '', outDirPolicy: 'cache' })
    const first = mergeWriteSettings(defaultWriteSettings(), { latex: { engine: 'xelatex', texPath: ' /tex/bin ' } })
    const second = mergeWriteSettings(first, { latex: { autoCompile: false } })
    expect(second.latex).toEqual({ engine: 'xelatex', autoCompile: false, texPath: '/tex/bin', outDirPolicy: 'cache' })
  })
})

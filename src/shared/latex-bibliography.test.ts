import { describe, expect, it } from 'vitest'
import { latexCitationUses, mergeLatexBibliography } from './latex-bibliography'
import { parseBibtexEntries } from './paper/paper-bibtex'

describe('LaTeX bibliography', () => {
  it('deduplicates DOI records and preserves the existing key', () => {
    const existing = '@article{existing, title={A {Nested} title}, doi={10.1000/Example}}\n'
    const incoming = '@article{new, title={New metadata}, doi={https://doi.org/10.1000/example}}'
    expect(mergeLatexBibliography(existing, incoming)).toEqual({ content: existing, key: 'existing', added: false })
  })
  it('renames a different record with a colliding key without rewriting other entries', () => {
    const existing = '@article{paper, title={First}, doi={10.1/a}}'
    const incoming = '@article{paper, title={Second {Nested}}, doi={10.1/b}}'
    const result = mergeLatexBibliography(existing, incoming)
    expect(result.key).toBe('paper-2')
    expect(result.content.startsWith(existing)).toBe(true)
    expect(parseBibtexEntries(result.content).map((entry) => entry.citeKey)).toEqual(['paper', 'paper-2'])
    expect(mergeLatexBibliography(result.content, incoming).added).toBe(false)
  })
  it('counts citation variants across files, excluding commented citations', () => {
    const uses = latexCitationUses([{ file: 'one.tex', content: '% \\cite{ignored}\nText \\cite[p. 2]{one,two}\n\\citet{one}' },
      { file: 'two.tex', content: '\\parencite{two}' }])
    expect(uses.has('ignored')).toBe(false)
    expect(uses.get('one')).toEqual([{ file: 'one.tex', line: 2 }, { file: 'one.tex', line: 3 }])
    expect(uses.get('two')).toHaveLength(2)
  })
})

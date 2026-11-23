import { describe, expect, it } from 'vitest'
import { parseLatexLog } from './log-parse'

describe('TeX diagnostics', () => {
  it('parses source locations, command failures, missing packages and warnings', () => {
    const diagnostics = parseLatexLog('./sections/intro.tex:31: Undefined control sequence.\n! LaTeX Error: File `missing.sty\' not found.\nl.4 \\usepackage{missing}\nLaTeX Warning: Citation `paper\' on page 1 undefined on input line 20.\nOverfull \\hbox (2pt too wide) at lines 28--29', 'main.tex')
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'undefined-command', file: 'sections/intro.tex', line: 31, level: 'error' }),
      expect.objectContaining({ code: 'missing-package', line: 4 }),
      expect.objectContaining({ code: 'citation', line: 20, level: 'warning' }),
      expect.objectContaining({ code: 'overflow', line: 28, level: 'warning' })
    ]))
  })
  it('bounds repeated and unusually large logs', () => {
    expect(parseLatexLog(Array(5000).fill('main.tex:1: Undefined control sequence.').join('\n'), 'main.tex')).toHaveLength(1)
    expect(parseLatexLog(Array.from({ length: 400 }, (_, i) => `main.tex:${i + 1}: Error ${i}`).join('\n'), 'main.tex')).toHaveLength(200)
  })
})

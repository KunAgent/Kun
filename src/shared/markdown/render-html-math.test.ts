import { describe, expect, it } from 'vitest'
import katex from 'katex'
import { renderWorkMarkdownToHtml } from './render-html'

describe('patched math rendering', () => {
  it('keeps inline and display math in the supported HTML and MathML modes', () => {
    const source = 'Inline $x^2$\n\n$$\n\\frac{a}{b} + \\sqrt{x}\n$$\n'
    const html = renderWorkMarkdownToHtml(source, { math: 'html' })
    expect(html).toContain('katex-display')
    expect(html).toContain('katex-html')
    expect(html).toContain('katex-base')
    expect(html).toContain('katex-strut')
    expect(html).not.toContain('katex-error')
    expect(html).not.toContain('<math')

    const mathml = renderWorkMarkdownToHtml(source, { math: 'mathml' })
    expect(mathml).toContain('<math')
    expect(mathml).toContain('<mfrac>')
    expect(mathml).not.toContain('katex-html')

    const dual = renderWorkMarkdownToHtml(source, { math: 'mathmlDual' })
    expect(dual).toContain('katex-mathml')
    expect(dual).toContain('katex-html')
    expect(dual).toContain('aria-hidden="true"')
  })

  it('preserves the raw TeX fallback for consumers without math support', () => {
    const html = renderWorkMarkdownToHtml('Inline $x^2$ math', { math: 'latex' })
    expect(html).toMatch(/<code\b[^>]*>x\^2<\/code>/)
    expect(html).not.toContain('katex-html')
  })

  it('retains HTML sanitization before math rendering', () => {
    const html = renderWorkMarkdownToHtml([
      '<script>alert(1)</script>',
      '<img src="javascript:alert(1)" onerror="alert(1)">',
      '',
      '$x^2$'
    ].join('\n'))
    expect(html).toContain('katex-html')
    expect(html).not.toMatch(/<script|onerror=|src="javascript:/i)
  })

  it.each(['html', 'mathml', 'mathmlDual'] as const)(
    'does not let math create external resources or executable links in %s output',
    (math) => {
      const html = renderWorkMarkdownToHtml([
        '$\\href{javascript:alert(1)}{click}$',
        '',
        '$\\includegraphics{https://math-attacker.invalid/pixel.png}$'
      ].join('\n'), { math })
      expect(html).not.toMatch(/<(?:img|iframe|script)\b|href="javascript:|src="https:/i)
    }
  )

  it('ignores inherited trust options rather than enabling trusted commands', () => {
    const options = Object.assign(Object.create({ trust: true }), {
      throwOnError: false,
      output: 'html' as const
    })
    const html = katex.renderToString(
      '\\href{javascript:alert(1)}{click} + \\includegraphics{https://math-attacker.invalid/pixel.png}',
      options
    )
    expect(html).not.toMatch(/<a\b|<img\b|href=|src=/i)
  })
})

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

const MATH_LAYOUT_CSS = `

  .markdown-body .katex-display {
    max-width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 0.35em 0;
  }

  .markdown-body .katex-display > .katex {
    white-space: nowrap;
  }
`

/**
 * KaTeX stylesheet with font URLs rewritten to absolute file:// paths so
 * exported HTML/PDF render KaTeX markup even where no system math fonts
 * exist (common on Linux). Cached after first read; empty on failure —
 * the MathML output still covers fonted environments then.
 */
let katexCssCache: string | null = null

export function katexExportCss(): string {
  if (katexCssCache !== null) return katexCssCache
  try {
    const cssPath = require.resolve('katex/dist/katex.min.css')
    const fontsBase = `${pathToFileURL(dirname(cssPath)).href}/`
    katexCssCache = readFileSync(cssPath, 'utf8')
      .replace(/url\(fonts\//g, `url(${fontsBase}fonts/`) + MATH_LAYOUT_CSS
  } catch {
    katexCssCache = ''
  }
  return katexCssCache
}

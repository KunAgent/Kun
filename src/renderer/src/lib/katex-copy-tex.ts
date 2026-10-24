let loading: Promise<unknown> | null = null

/**
 * Selecting rendered formulas copies their LaTeX source (`$...$` inline,
 * `$$...$$` display), and a selection that starts or ends inside a formula
 * grows to the whole formula. KaTeX's Copy-tex extension registers one
 * document-wide copy listener; loading it after mount keeps Node imports of the
 * Markdown renderers free of DOM access.
 */
export function loadKatexCopyTex(): Promise<unknown> {
  if (typeof document === 'undefined') return Promise.resolve()
  loading ??= import('katex/contrib/copy-tex').catch(() => {
    loading = null
  })
  return loading
}

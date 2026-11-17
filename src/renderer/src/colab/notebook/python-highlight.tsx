import type { ReactNode } from 'react'

const PYTHON_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
  'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally',
  'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield'
])

const TOKEN_RE =
  /(#[^\n]*)|((?:[fFrRbBuU]{1,2})?(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?))|(@[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)|(\b(?:0[xXoObB][\da-fA-F_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?[\d_]+)?)\b)|(\b[A-Za-z_]\w*\b)(\s*\()?/g

/**
 * Lightweight Python syntax highlighter for notebook code cells. Preserves the
 * exact character stream so it aligns 1:1 beneath a transparent textarea.
 */
export function highlightPythonCode(source: string): ReactNode[] {
  if (!source) return []
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let key = 0
  TOKEN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TOKEN_RE.exec(source)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(source.slice(lastIndex, match.index))
    }
    const [full, comment, str, decorator, num, ident, callSuffix] = match
    if (comment) {
      nodes.push(<span key={key++} className="text-[#a0a1a7] dark:text-[#7f848e]">{comment}</span>)
      lastIndex = match.index + full.length
    } else if (str) {
      nodes.push(<span key={key++} className="text-[#50a14f] dark:text-[#98c379]">{str}</span>)
      lastIndex = match.index + full.length
    } else if (decorator) {
      nodes.push(<span key={key++} className="text-[#a626a4] dark:text-[#c678dd]">{decorator}</span>)
      lastIndex = match.index + full.length
    } else if (num) {
      nodes.push(<span key={key++} className="text-[#986801] dark:text-[#d19a66]">{num}</span>)
      lastIndex = match.index + full.length
    } else if (ident) {
      if (PYTHON_KEYWORDS.has(ident)) {
        nodes.push(<span key={key++} className="text-[#a626a4] dark:text-[#c678dd]">{ident}</span>)
      } else if (callSuffix) {
        nodes.push(<span key={key++} className="text-[#4078f2] dark:text-[#61afef]">{ident}</span>)
      } else {
        nodes.push(ident)
      }
      // Rewind past `(` so punctuation/arguments inside `(...)` still tokenize.
      lastIndex = match.index + ident.length
      TOKEN_RE.lastIndex = lastIndex
    } else {
      nodes.push(full)
      lastIndex = match.index + full.length
    }
  }
  if (lastIndex < source.length) {
    nodes.push(source.slice(lastIndex))
  }
  if (source.endsWith('\n')) {
    nodes.push('\u200b')
  }
  return nodes
}

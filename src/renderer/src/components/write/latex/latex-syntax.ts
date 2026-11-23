import { StreamLanguage, foldService, syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'

export const latexSyntax: Extension = [
  StreamLanguage.define({
    startState: () => ({ math: false }),
    token(stream, state) {
      if (stream.eatSpace()) return null
      if (stream.eat('%')) { stream.skipToEnd(); return 'comment' }
      if (stream.eat('\\')) {
        if (stream.match(/[A-Za-z@]+\*?/)) return 'keyword'
        stream.next(); return 'escape'
      }
      if (stream.eat('$')) { stream.eat('$'); state.math = !state.math; return 'string' }
      if (stream.match(/[{}[\]]/)) return 'bracket'
      if (stream.match(/\d+(?:\.\d+)?/)) return 'number'
      stream.next()
      return state.math ? 'string' : null
    }
  }),
  syntaxHighlighting(HighlightStyle.define([
    { tag: tags.keyword, color: 'var(--latex-command)' },
    { tag: tags.comment, color: 'var(--latex-comment)' },
    { tag: tags.string, color: 'var(--latex-math)' },
    { tag: tags.number, color: 'var(--latex-number)' },
    { tag: tags.bracket, color: 'var(--latex-bracket)' },
    { tag: tags.escape, color: 'var(--latex-command)' }
  ])),
  foldService.of((state, from, to) => {
    const begin = /\\begin\{([^}]+)\}/.exec(state.doc.sliceString(from, to))
    if (!begin) return null
    const rest = state.doc.sliceString(to)
    const end = rest.indexOf(`\\end{${begin[1]}}`)
    return end < 0 ? null : { from: to, to: to + end }
  })
]

import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { keymap } from '@codemirror/view'
import { latexCiteCandidates, stageLatexCitation } from '../../../write/latex/latex-bibliography'
import { latexSession } from '../../../write/latex/latex-project-store'

export function latexCompletion(sessionKey: string) {
  return [autocompletion({ override: [(context: CompletionContext): CompletionResult | null => {
    const cite = context.matchBefore(/\\(?:cite\w*|autocite|parencite|textcite)\*?(?:\[[^\]]*\])*\{[^}]*$/)
    if (cite) {
      const from = Math.max(cite.from + cite.text.lastIndexOf('{') + 1, cite.from + cite.text.lastIndexOf(',') + 1)
      return { from, options: latexCiteCandidates(sessionKey).map((candidate) => ({
        label: candidate.key, displayLabel: candidate.title, detail: candidate.detail, type: 'text',
        apply: (view, _completion, from, to) => {
          const key = stageLatexCitation(sessionKey, candidate)
          view.dispatch({ changes: { from, to, insert: key }, selection: { anchor: from + key.length } })
        }
      })) }
    }
    const reference = context.matchBefore(/\\(?:eqref|ref|autoref)\{[^}]*$/)
    if (reference) {
      const labels = Object.values(latexSession(sessionKey)?.buffers ?? {}).flatMap((b) => [...b.content.matchAll(/\\label\{([^}]+)\}/g)].map((match) => match[1]))
      return { from: reference.from + reference.text.lastIndexOf('{') + 1, options: [...new Set(labels)].map((label) => ({ label, type: 'variable' })) }
    }
    const command = context.matchBefore(/\\[A-Za-z]*/)
    if (!command) return null
    return { from: command.from, options: ['section{}', 'subsection{}', 'label{}', 'ref{}', 'cite{}', 'textbf{}', 'textit{}', 'emph{}', 'input{}',
      'includegraphics[width=\\linewidth]{}', 'begin{equation}\n\n\\end{equation}', 'begin{figure}\n\\centering\n\n\\caption{}\n\\label{fig:}\n\\end{figure}']
      .map((command) => ({ label: `\\${command}`, type: 'keyword' })) }
  }] }), closeBrackets(), keymap.of([...closeBracketsKeymap, ...completionKeymap])]
}

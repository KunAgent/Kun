import type { LatexDiagnostic } from '../../../shared/latex-project'

export function parseLatexLog(log: string, mainFile: string): LatexDiagnostic[] {
  const diagnostics: LatexDiagnostic[] = []
  let currentFile = mainFile
  const lines = log.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim()
    const opened = /\(\.?\/?([^()\s]+\.(?:tex|ltx|sty|cls))/.exec(text)
    if (opened) currentFile = opened[1]
    const location = /^(.*\.(?:tex|ltx|sty|cls)):(\d+):\s*(.*)/.exec(text)
    const warning = /(?:LaTeX|Package \S+) Warning:|Overfull|Underfull/.test(text)
    if (!location && !text.startsWith('!') && !warning) continue
    const message = (location?.[3] ?? text.replace(/^!\s*/, '')).slice(0, 2000)
    const nearby = lines.slice(i + 1, i + 8).join('\n')
    const line = location ? Number(location[2]) : Number(/(?:l\.|on input line |at lines? )(\d+)/.exec(text + '\n' + nearby)?.[1]) || undefined
    const code = /not found|can't find/i.test(message) ? 'missing-package'
      : /Undefined control sequence/i.test(message) ? 'undefined-command'
        : /Citation|Reference .*undefined/.test(message) ? 'citation'
          : /Overfull|Underfull/.test(message) ? 'overflow' : 'tex'
    const diagnostic: LatexDiagnostic = { level: warning ? 'warning' : 'error', message, code,
      file: (location?.[1] ?? currentFile).replace(/^\.\//, ''), line }
    if (!diagnostics.some((d) => d.message === message && d.file === diagnostic.file && d.line === line)) diagnostics.push(diagnostic)
    if (diagnostics.length >= 200) break
  }
  return diagnostics
}

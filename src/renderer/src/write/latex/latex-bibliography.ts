import { mergeLatexBibliography } from '@shared/latex-bibliography'
import { paperBibtexEntry, paperCiteKey, parseBibtexEntries } from '@shared/paper/paper-bibtex'
import { usePaperSpaceStore } from '../../paper/paper-space-store'
import { editLatexBuffer, latexSession, patchLatex } from './latex-project-store'

export type LatexCiteCandidate = { key: string; title: string; detail: string; bibtex: string; existing: boolean }

export function latexCiteCandidates(key: string): LatexCiteCandidate[] {
  const session = latexSession(key)
  if (!session) return []
  const candidates = Object.entries(session.buffers).filter(([file]) => /\.bib$/i.test(file))
    .flatMap(([, buffer]) => parseBibtexEntries(buffer.content)).map((entry) => ({
      key: entry.citeKey, title: entry.fields.title ?? entry.citeKey,
      detail: [entry.fields.author, entry.fields.year].filter(Boolean).join(' · '), bibtex: entry.raw, existing: true
    }))
  const taken = new Set(candidates.map((candidate) => candidate.key))
  const dois = new Set(Object.values(session.buffers).flatMap((buffer) => parseBibtexEntries(buffer.content)).map((entry) => entry.fields.doi?.toLowerCase()).filter(Boolean))
  for (const item of usePaperSpaceStore.getState().items) {
    const meta = item.entry.meta
    const declaredKey = paperCiteKey(meta, new Set())
    const same = candidates.find((candidate) => candidate.key === declaredKey && candidate.title.replace(/[{}]/g, '').toLowerCase() === meta.title.replace(/[{}]/g, '').toLowerCase())
    if (same || (meta.doi && dois.has(meta.doi.toLowerCase()))) continue
    const citeKey = paperCiteKey(meta, taken)
    candidates.push({ key: citeKey, title: meta.title, detail: [meta.authors?.[0], meta.year].filter(Boolean).join(' · '),
      bibtex: paperBibtexEntry(meta, citeKey).replace(/^(@\w+\s*[({]\s*)[^,\s]+/, `$1${citeKey}`), existing: false })
    taken.add(citeKey)
  }
  return candidates
}

export function stageLatexCitation(key: string, candidate: LatexCiteCandidate): string {
  const session = latexSession(key)!
  if (session.deleting || session.review.length) throw new Error('Finish the source operation or review before inserting a citation.')
  const main = session.buffers[session.project.config.mainFile]
  if (main) editLatexBuffer(key, session.project.config.mainFile, main.content.replace(/^%\s*(\\bibliographystyle\{plain\}|\\bibliography\{references\})/gm, '$1'))
  if (candidate.existing) return candidate.key
  const file = session.project.config.bibFile
  if (!session.buffers[file]) patchLatex(key, (current) => ({
    buffers: { ...current.buffers, [file]: { content: '', saved: '' } },
    project: { ...current.project, files: [...new Set([...current.project.files, file])] }
  }))
  const buffer = latexSession(key)!.buffers[file]
  const merged = mergeLatexBibliography(buffer.content, candidate.bibtex)
  editLatexBuffer(key, file, merged.content)
  return merged.key
}

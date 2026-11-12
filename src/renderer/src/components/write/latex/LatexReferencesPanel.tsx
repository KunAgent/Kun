import { useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, Plus } from 'lucide-react'
import { parseBibtexEntries } from '@shared/paper/paper-bibtex'
import { latexCitationUses } from '@shared/latex-bibliography'
import { latexCiteCandidates, stageLatexCitation } from '../../../write/latex/latex-bibliography'
import { selectLatexFile, useLatexProjectStore } from '../../../write/latex/latex-project-store'
import { usePaperSpaceStore } from '../../../paper/paper-space-store'
import { WriteRightPanelHeader } from '../WriteRightPanelHeader'

/** The focused source editor supplies insertion, so the library never guesses a cursor. */
export const latexCitationInsertions = new Map<string, (text: string) => void>()
export function LatexReferencesPanel({ sessionKey, onCollapse }: { sessionKey: string; onCollapse: () => void }): ReactElement {
  const { t } = useTranslation('common')
  const session = useLatexProjectStore((state) => state.sessions[sessionKey])
  usePaperSpaceStore((state) => state.items)
  const [query, setQuery] = useState('')
  const candidates = latexCiteCandidates(sessionKey)
  const uses = useMemo(() => latexCitationUses(Object.entries(session?.buffers ?? {}).filter(([file]) => /\.(tex|ltx)$/i.test(file)).map(([file, b]) => ({ file, content: b.content }))), [session?.buffers])
  const existing = new Set(Object.entries(session?.buffers ?? {}).filter(([file]) => /\.bib$/i.test(file)).flatMap(([, b]) => parseBibtexEntries(b.content).map((entry) => entry.citeKey)))
  const missing = [...uses.keys()].filter((key) => !existing.has(key))
  const filtered = candidates.filter((candidate) => `${candidate.key} ${candidate.title} ${candidate.detail}`.toLowerCase().includes(query.toLowerCase()))
  return (
    <div className="latex-references flex h-full min-h-0 flex-col">
      <WriteRightPanelHeader id="references" onCollapse={onCollapse} />
      <div className="latex-reference-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('latexSearchPapers')} aria-label={t('latexSearchPapers')} /></div>
      <div className="latex-reference-list">
        {missing.length > 0 ? <div className="latex-missing-cites"><strong>{t('latexMissingCites', { count: missing.length })}</strong>
          {missing.map((key) => <button type="button" key={key} onClick={() => { const first = uses.get(key)![0]; void selectLatexFile(sessionKey, first.file, first.line) }}>{key}</button>)}</div> : null}
        <p className="latex-reference-heading">{t('latexBibliography')} · {existing.size}</p>
        {!filtered.length ? <p>{t('latexNoReferences')}</p> : filtered.slice(0, 100).map((candidate) => (
          <article key={candidate.key} className="latex-reference-entry">
            <button type="button" className="latex-reference-title" onClick={() => {
              const first = uses.get(candidate.key)?.[0]
              if (first) void selectLatexFile(sessionKey, first.file, first.line)
              else setQuery(candidate.key)
            }}><code>{candidate.key}</code><strong>{candidate.title}</strong><small>{candidate.detail}</small></button>
            <div><span>{t(candidate.existing ? 'latexAlreadyInBib' : 'latexWillAddBib')}{uses.has(candidate.key) ? ` · ${t('latexCitedCount', { count: uses.get(candidate.key)!.length })}` : ''}</span>
              <button type="button" disabled={!session || !!session.review.length || session.buffers[session.activeFile]?.truncated || !/\.(tex|ltx)$/i.test(session.activeFile) || !latexCitationInsertions.has(sessionKey)} aria-label={t('latexInsertCitation')}
                onClick={() => { const key = stageLatexCitation(sessionKey, candidate); latexCitationInsertions.get(sessionKey)?.(`\\cite{${key}}`) }}><Plus size={14} /></button></div>
          </article>
        ))}
      </div>
    </div>
  )
}

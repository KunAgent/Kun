import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { X, TriangleAlert, Sparkles } from 'lucide-react'
import { selectLatexFile, type LatexSession } from '../../../write/latex/latex-project-store'

export function LatexProblems({ sessionKey, session, onClose, onFix, initialTab }: { sessionKey: string; session: LatexSession; onClose: () => void; onFix: () => void; initialTab: 'problems' | 'log' }): ReactElement {
  const { t } = useTranslation('common')
  const [log, setLog] = useState(initialTab === 'log')
  return (
    <section className="latex-problems" aria-label={t('latexProblems')}>
      <header><button type="button" className={!log ? 'is-active' : ''} onClick={() => setLog(false)}>{t('latexProblems')} · {session.build?.diagnostics.length ?? 0}</button>
        <button type="button" className={log ? 'is-active' : ''} onClick={() => setLog(true)}>{t('latexViewLog')}</button>
        <span />
        <button type="button" disabled={session.deleting || session.proposing || !!session.review.length} onClick={onFix}><Sparkles size={13} />{t(session.proposing ? 'latexProposing' : 'latexAskFix')}</button>
        <button type="button" onClick={onClose} aria-label={t('latexClose')}><X size={15} /></button></header>
      {log ? <pre tabIndex={0}>{session.log || t('latexNoLog')}</pre> : <div className="latex-diagnostics">
        {!session.build?.diagnostics.length ? <p>{t('latexNoProblems')}</p> : session.build.diagnostics.map((diagnostic, index) => (
          <button type="button" key={index} className={diagnostic.level === 'error' ? 'is-error' : ''} onClick={() => {
            const file = diagnostic.file?.replace(/^\.\//, '')
            if (file && session.project.files.includes(file)) void selectLatexFile(sessionKey, file, diagnostic.line ?? 1)
          }}>
            <TriangleAlert size={14} /><span><strong>{diagnostic.message}</strong><small>{t(`latexDiagnostic_${diagnostic.code}`)}</small></span>
            <code>{diagnostic.file}{diagnostic.line ? `:${diagnostic.line}` : ''}</code>
          </button>
        ))}
      </div>}
    </section>
  )
}

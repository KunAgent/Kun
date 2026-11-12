import { useState, type ReactElement } from 'react'
import { diffLines } from 'diff'
import { useTranslation } from 'react-i18next'
import { resolveLatexRevision } from '../../../write/latex/latex-revision'
import { selectLatexFile, useLatexProjectStore } from '../../../write/latex/latex-project-store'
import { WriteRightPanelHeader } from '../WriteRightPanelHeader'

export function LatexReviewPanel({ sessionKey, onCollapse }: { sessionKey: string; onCollapse: () => void }): ReactElement {
  const { t } = useTranslation('common')
  const session = useLatexProjectStore((state) => state.sessions[sessionKey])
  const [applying, setApplying] = useState(false)
  const resolve = (decision: 'accept' | 'reject', file?: string): void => {
    setApplying(true)
    void resolveLatexRevision(sessionKey, decision, file).finally(() => setApplying(false))
  }
  return (
    <div className="latex-review-panel flex h-full min-h-0 flex-col">
      <WriteRightPanelHeader id="review" onCollapse={onCollapse} />
      <div className="latex-review-list">
        <p>{t('latexReviewHint')}</p>
        {session?.review.map((edit) => <article key={edit.file} className="latex-review-card">
          <button type="button" className="latex-review-file" onClick={() => void selectLatexFile(sessionKey, edit.file, 1)}>{edit.file}</button>
          <pre>{diffLines(edit.before, edit.after).map((part, i) => part.added || part.removed ? <span key={i} className={part.added ? 'is-added' : 'is-removed'}>{part.added ? '+ ' : '- '}{part.value}</span> : <span key={i} className="is-context">{part.value.split('\n').slice(0, 2).join('\n')}{part.value.split('\n').length > 2 ? '\n…\n' : ''}</span>)}</pre>
          <footer><button type="button" disabled={applying} onClick={() => resolve('reject', edit.file)}>{t('workReviewReject')}</button>
            <button type="button" className="latex-primary" disabled={applying} onClick={() => resolve('accept', edit.file)}>{t('latexAcceptCompile')}</button></footer>
        </article>)}
      </div>
      {!!session?.review.length && <footer className="latex-review-footer"><button type="button" disabled={applying} onClick={() => resolve('reject')}>{t('writeDiffRejectAll')}</button>
        <button type="button" disabled={applying} className="latex-primary" onClick={() => resolve('accept')}>{t('writeDiffAcceptAll')}</button></footer>}
    </div>
  )
}

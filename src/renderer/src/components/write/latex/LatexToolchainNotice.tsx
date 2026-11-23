import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Settings2 } from 'lucide-react'
import { buildLatex } from '../../../write/latex/latex-build-controller'
import { patchLatexSession, type LatexSession } from '../../../write/latex/latex-project-store'

export function LatexToolchainNotice({ sessionKey, session, onEnvironment }: { sessionKey: string; session: LatexSession; onEnvironment: () => void }): ReactElement {
  const { t } = useTranslation('common')
  const missing = session.build?.status === 'missing-tools'
  const run = (operation: () => Promise<unknown>): void => { void operation().catch((error) => patchLatexSession(sessionKey, session.instanceId, { error: String(error) })) }
  return (
    <div className="latex-empty-pdf">
      <div className="latex-empty-icon"><FileText size={25} strokeWidth={1.3} /></div>
      <h3>{t(missing ? 'latexCannotGenerate' : 'latexPreviewTitle')}</h3>
      <p>{t(missing ? 'latexToolchainHint' : 'latexPreviewHint')}</p>
      {missing ? <>
        <dl><dt>latexmk</dt><dd>{session.tools?.latexmk ?? t('latexNotFound')}</dd>
          <dt>{session.project.config.engine}</dt><dd>{session.tools?.engine ?? t('latexNotFound')}</dd></dl>
        <small>{t('latexSearchedPaths')}: {session.tools?.searchedPaths.join(' · ')}</small>
        <div className="latex-empty-actions">
          <button type="button" className="latex-primary" disabled={session.deleting} onClick={onEnvironment}><Settings2 size={13} />{t('latexEnvironmentManage')}</button>
          <button type="button" onClick={() => run(() => buildLatex(sessionKey))}>{t('latexDetectAgain')}</button>
        </div>
      </> : <button type="button" className="latex-primary" disabled={!!session.buildId} onClick={() => run(() => buildLatex(sessionKey))}>{t(session.buildId ? 'latexBuilding' : 'latexCompile')}</button>}
    </div>
  )
}

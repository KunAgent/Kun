import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Play, Square, ChevronDown, Download, MoreHorizontal, LocateFixed, BookOpen, Save, Settings2 } from 'lucide-react'
import type { LatexEngine, LatexView } from '@shared/latex-project'
import { configureLatex, patchLatex, type LatexSession } from '../../../write/latex/latex-project-store'
import { abortLatexBuild, buildLatex, exportLatex } from '../../../write/latex/latex-build-controller'

export function LatexToolbar({ sessionKey, session, narrow, onSave, onReferences, onSync, onProblems, onLog, onEnvironment }: {
  sessionKey: string; session: LatexSession; narrow: boolean; onSave: () => void; onReferences: () => void; onSync: () => void; onProblems: () => void; onLog: () => void; onEnvironment: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const stale = session.pdfRevision !== session.revision
  const status = session.buildId ? 'latexBuilding' : session.build?.status === 'missing-tools' ? 'latexMissingTools'
    : session.build?.status === 'failed' ? 'latexBuildFailed' : session.pdf && !stale ? 'latexPdfSynced' : !session.pdf ? 'latexNotCompiled' : 'latexSourceChanged'
  const run = (operation: () => Promise<unknown>): void => { void operation().catch((error) => patchLatex(sessionKey, { error: String(error) })) }
  const configure = (patch: Partial<LatexSession['project']['config']>): void => run(() => configureLatex(sessionKey, { ...session.project.config, ...patch }))
  return (
    <div className="latex-toolbar">
      <div className="latex-view-switch" aria-label={t('latexView')}>
        {(['source', 'split', 'pdf'] as LatexView[]).filter((view) => !narrow || view !== 'split').map((view) => (
          <button type="button" key={view} aria-pressed={(narrow && session.view === 'split' ? 'source' : session.view) === view}
            onClick={() => patchLatex(sessionKey, { view })}>{t(`latexView_${view}`)}</button>
        ))}
      </div>
      <select className="latex-source-picker" aria-label={t('latexSourceFile')} value={session.activeFile} disabled={session.deleting}
        onChange={(event) => { const file = event.target.value; void import('../../../write/latex/latex-project-store').then((module) => module.selectLatexFile(sessionKey, file)) }}>
        {session.project.files.filter((file) => /\.(tex|ltx|bib|sty|cls)$/i.test(file)).map((file) => <option key={file}>{file}</option>)}
      </select>
      <button type="button" className={`latex-build-status ${session.build?.status === 'failed' ? 'is-error' : status === 'latexPdfSynced' ? 'is-success' : session.buildId ? 'is-building' : status === 'latexNotCompiled' ? '' : 'is-warning'}`} onClick={status === 'latexMissingTools' ? onEnvironment : onProblems} title={t(status)}>
        <span className={session.buildId ? 'latex-pulse' : ''} />{t(status)}
      </button>
      <select className="latex-engine" aria-label={t('latexEngine')} value={session.project.config.engine} disabled={session.deleting || !!session.buildId}
        onChange={(event) => configure({ engine: event.target.value as LatexEngine })}>
        <option value="xelatex">XeLaTeX</option><option value="pdflatex">pdfLaTeX</option><option value="lualatex">LuaLaTeX</option>
      </select>
      <button type="button" className="latex-compile" onClick={() => status === 'latexMissingTools' ? onEnvironment() : run(() => session.buildId ? abortLatexBuild(sessionKey) : buildLatex(sessionKey))}
        disabled={!session.buildId && (session.deleting || session.review.length > 0 || session.needsMainChoice)} title={t(session.buildId ? 'latexCancelBuild' : 'latexCompileShortcut')}>
        {session.buildId ? <Square size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
        <span>{t(session.buildId ? 'latexCancelBuild' : 'latexCompile')}</span>
      </button>
      <details className="latex-menu"><summary aria-label={t('latexMore')}><MoreHorizontal size={17} /></summary>
        <div className="latex-menu-content">
          <button type="button" onClick={onSave}><Save size={14} />{t('latexSaveOnly')}</button>
          <button type="button" onClick={onReferences}><BookOpen size={14} />{t('latexReferences')}</button>
          {session.tools?.synctex && session.pdf ? <button type="button" onClick={onSync}><LocateFixed size={14} />{t('latexLocateCursor')}</button> : null}
          <label><input type="checkbox" checked={session.project.config.autoBuild} disabled={session.deleting} onChange={(event) => configure({ autoBuild: event.target.checked })} />{t('latexAutoCompile')}</label>
          <label>{t('latexMainFile')}<select value={session.project.config.mainFile} disabled={session.deleting} onChange={(event) => configure({ mainFile: event.target.value })}>
            {session.project.files.filter((f) => /\.(tex|ltx)$/i.test(f)).map((file) => <option key={file}>{file}</option>)}
          </select></label>
          <button type="button" disabled={session.deleting} onClick={(event) => {
            const menu = event.currentTarget.closest('details')
            if (menu) { menu.open = false; menu.querySelector('summary')?.focus() }
            onEnvironment()
          }}><Settings2 size={14} />{t('latexEnvironmentManage')}</button>
          <button type="button" onClick={onLog}>{t('latexViewLog')}</button>
        </div>
      </details>
      <details className="latex-menu"><summary aria-label={t('latexExport')}><Download size={15} /><ChevronDown size={11} /></summary>
        <div className="latex-menu-content">
          <p>{t('latexExportHint')}</p>
          <button type="button" disabled={session.deleting || !!session.buildId || !!session.review.length} onClick={() => run(() => exportLatex(sessionKey, 'pdf'))}>{t('latexExportPdf')}</button>
          <button type="button" disabled={session.deleting || !!session.review.length} onClick={() => run(() => exportLatex(sessionKey, 'source'))}>{t('latexExportSource')}</button>
          <button type="button" onClick={() => run(() => navigator.clipboard.writeText(session.buffers[session.project.config.bibFile]?.content ?? ''))}>{t('latexCopyBibtex')}</button>
        </div>
      </details>
    </div>
  )
}

import { useEffect, useId, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Check, CheckCircle2, ChevronRight, Download, ExternalLink, FolderOpen, Loader2, RefreshCw, Settings2, X } from 'lucide-react'
import type { LatexEngine, LatexTools } from '@shared/latex-project'
import { useLatexToolchain } from './use-latex-toolchain'
import './latex-toolchain.css'

export function LatexToolchainDialog({ engine, toolDirectory, onDirectoryChange, onTools, onCompile, onClose }: {
  engine: LatexEngine
  toolDirectory: string
  onDirectoryChange: (directory: string) => void | Promise<void>
  onTools: (tools: LatexTools) => void
  onCompile?: () => void
  onClose: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const [choosing, setChoosing] = useState(false)
  const { status, state, checking, error, setError, refresh, install, cancel, busy } = useLatexToolchain(engine, toolDirectory, onTools)
  const ready = !checking && !!status?.tools.latexmk && !!status.tools.engine
  const phase = state?.phase ?? 'idle'
  const percentage = state?.totalBytes ? Math.round(state.downloadedBytes / state.totalBytes * 100) : 0
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); closeRef.current() }
      if (event.key !== 'Tab') return
      const items = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),summary,a[href]') ?? [])]
        .filter((item) => item.getClientRects().length > 0)
      if (!items.length) return
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus() }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus() }
    }
    window.addEventListener('keydown', handler, true)
    return () => { window.removeEventListener('keydown', handler, true); prior?.focus() }
  }, [])
  const run = (operation: () => Promise<unknown>): void => { void operation().catch((error) => setError(error instanceof Error ? error.message : String(error))) }
  const guide = status?.platform === 'darwin' ? 'https://www.tug.org/mactex/mactex-download.html'
    : status?.platform === 'win32' ? 'https://tug.org/texlive/windows.html' : 'https://tug.org/texlive/quickinstall.html'
  const choose = async (): Promise<void> => {
    setChoosing(true)
    try {
      const result = await window.kunGui.latexChooseToolDirectory()
      if (!result.ok) throw new Error(result.message)
      if (result.toolDirectory) await onDirectoryChange(result.toolDirectory)
    } finally { setChoosing(false) }
  }
  return createPortal(<div className="latex-toolchain-overlay ds-no-drag" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="latex-toolchain-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialog}>
      <header><div className="latex-toolchain-heading"><Settings2 size={20} strokeWidth={1.6} /><div><h2 id={titleId}>{t('latexEnvironmentTitle')}</h2><p>{t('latexEnvironmentHint')}</p></div></div>
        <button type="button" className="latex-toolchain-close" aria-label={t('latexClose')} onClick={onClose}><X size={18} /></button></header>
      <div className="latex-toolchain-body">
        <div className={`latex-toolchain-status ${ready && !busy ? 'is-ready' : ''}`} role="status" aria-live="polite">
          {busy || checking ? <Loader2 size={21} className="animate-spin" /> : ready ? <CheckCircle2 size={21} /> : <Settings2 size={21} />}
          <div><strong>{t(busy ? `latexInstallPhase_${phase === 'idle' ? 'resolving' : phase}` : checking ? 'latexEnvironmentChecking' : ready ? 'latexEnvironmentReady' : 'latexEnvironmentMissing')}</strong>
            <p>{t(busy ? 'latexInstallBackground' : ready ? 'latexEnvironmentReadyHint' : 'latexEnvironmentMissingHint')}</p></div>
        </div>
        {busy ? <div className="latex-toolchain-progress">
          <progress max="100" {...(phase === 'downloading' ? { value: percentage } : {})} aria-label={t('latexInstallProgress')} />
          <div><span>{state?.version ? `TinyTeX ${state.version}` : 'TinyTeX'}</span><span>{phase === 'downloading' ? `${percentage}% · ${(state!.downloadedBytes / 1048576).toFixed(1)} / ${(state!.totalBytes / 1048576).toFixed(1)} MB` : t('latexInstallMayTakeTime')}</span></div>
        </div> : null}
        {!ready && !busy ? <section className="latex-toolchain-recommendation">
          <div className="latex-toolchain-recommendation-title"><strong>TinyTeX</strong><span>{t('latexRecommended')}</span></div>
          <p>{t('latexInstallDescription')}</p>
          <ul>{['latexInstallBenefitLocal', 'latexInstallBenefitChinese', 'latexInstallBenefitIsolated'].map((key) => <li key={key}><Check size={13} />{t(key)}</li>)}</ul>
          {status?.supported ? <button type="button" className="latex-toolchain-primary" disabled={checking || choosing} onClick={() => void install()}><Download size={14} />{t(phase === 'failed' || phase === 'cancelled' ? 'latexInstallRetry' : 'latexInstallOneClick')}</button>
            : <p>{t(status ? 'latexInstallUnsupported' : 'latexEnvironmentChecking')}</p>}
        </section> : null}
        {(error || state?.error) ? <div className="latex-toolchain-error" role="alert"><strong>{t('latexInstallError')}</strong><p>{error || state?.error}</p></div> : null}
        {phase === 'cancelled' && !busy ? <p className="latex-toolchain-muted" role="status">{t('latexInstallCancelled')}</p> : null}
        <section className="latex-toolchain-detection"><div className="latex-toolchain-section-title"><strong>{t('latexDetectedTools')}</strong>
          <button type="button" disabled={checking || busy || choosing} onClick={() => void refresh()}><RefreshCw size={12} />{t('latexCheckEnvironment')}</button></div>
          <dl>{[['latexmk', status?.tools.latexmk], [engine, status?.tools.engine], ['SyncTeX', status?.tools.synctex]].map(([name, path]) => <div key={name}><dt>{name}</dt>
            <dd title={path ?? undefined} className={path ? 'is-found' : ''}>{path ? <CheckCircle2 size={13} /> : null}<span>{path || t(name === 'SyncTeX' ? 'latexOptionalToolMissing' : 'latexNotFound')}</span></dd></div>)}</dl>
          <button type="button" className="latex-toolchain-directory" disabled={busy || choosing || checking} onClick={() => run(choose)}><FolderOpen size={14} /><span>{t(choosing ? 'latexChoosingTools' : 'latexUseExistingTools')}</span><ChevronRight size={14} /></button>
          {toolDirectory ? <button type="button" className="latex-toolchain-reset" disabled={busy || choosing || checking} onClick={() => run(async () => { await onDirectoryChange('') })}><RefreshCw size={12} />{t('latexRestoreAutoDetection')}</button> : null}
        </section>
        <details className="latex-toolchain-details"><summary>{t('latexEnvironmentDetails')}</summary>
          <p>{t('latexTexPath')}: {toolDirectory || t('latexAutomaticDetection')}</p>
          <p>{t('latexInstallLocation')}: {status?.installRoot}</p>
          <p>{t('latexSearchedPaths')}: {status?.tools.searchedPaths.join(' · ')}</p>
        </details>
        {state?.log ? <details className="latex-toolchain-details"><summary>{t('latexInstallLog')}</summary><pre>{state.log}</pre></details> : null}
        <div className="latex-toolchain-links"><button type="button" onClick={() => run(() => window.kunGui.openExternal(guide))}>{t('latexOtherDistributions')}<ExternalLink size={11} /></button>
          <button type="button" onClick={() => run(() => window.kunGui.openExternal('https://yihui.org/tinytex/'))}>{t('latexTinyTexAbout')}<ExternalLink size={11} /></button></div>
      </div>
      <footer><span>{t('latexWritingUnaffected')}</span><div>{busy ? <button type="button" disabled={!state?.jobId} onClick={() => void cancel()}>{t('latexCancelInstall')}</button> : null}
        <button type="button" className={ready && onCompile && !busy ? '' : 'latex-toolchain-primary'} onClick={onClose}>{t(busy ? 'latexContinueWriting' : 'latexClose')}</button>
        {ready && onCompile && !busy ? <button type="button" className="latex-toolchain-primary" onClick={onCompile}>{t('latexReturnCompile')}</button> : null}</div></footer>
    </div>
  </div>, document.body)
}

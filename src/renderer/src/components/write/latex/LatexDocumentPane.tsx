import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Check, LocateFixed, Sparkles, X, BookOpen } from 'lucide-react'
import type { LatexSyncPoint } from '@shared/latex-project'
import { isLatexFilePath } from '@shared/latex-project'
import { WritePdfViewer } from '../WritePdfViewer'
import { LatexSourceEditor, type LatexSourceHandle } from './LatexSourceEditor'
import { LatexToolbar } from './LatexToolbar'
import { LatexToolchainNotice } from './LatexToolchainNotice'
import { LatexProblems } from './LatexProblems'
import { useLatexWorkspace } from './use-latex-workspace'
import { latexCitationInsertions } from './LatexReferencesPanel'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { usePaperSpaceStore, paperSpaceItems } from '../../../paper/paper-space-store'
import { buildLatex } from '../../../write/latex/latex-build-controller'
import { proposeLatexRevision } from '../../../write/latex/latex-revision'
import { configureLatex, editLatexBuffer, latexDirty, latexSession, latexSessionKey, latexTarget, loadLatexBuffer, openLatexSession, patchLatex, saveLatexSession, selectLatexFile, useLatexProjectStore } from '../../../write/latex/latex-project-store'
import type { WriteEditorSelectionState } from '../WriteMarkdownEditor'
import './latex.css'

export function LatexDocumentPane({ workspaceRoot, path, focused, onSelectionChange, onAskAssistant }: {
  workspaceRoot: string; path: string; focused: boolean
  onSelectionChange: (selection: WriteEditorSelectionState) => void; onAskAssistant: (prompt: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const key = latexSessionKey(workspaceRoot, path)
  const session = useLatexProjectStore((state) => state.sessions[key])
  const host = useRef<HTMLDivElement>(null)
  const source = useRef<LatexSourceHandle | null>(null)
  const [narrow, setNarrow] = useState(false)
  const [problems, setProblems] = useState<'problems' | 'log' | null>(null)
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [selection, setSelection] = useState<WriteEditorSelectionState | null>(null)
  const [instruction, setInstruction] = useState('')
  const [syncPoint, setSyncPoint] = useState<(LatexSyncPoint & { token: number }) | null>(null)
  const setPanel = useWriteWorkspaceStore((state) => state.openWriteRightPanel)
  const assistantProvider = useWriteWorkspaceStore((state) => state.assistantProviderId)
  const assistantModel = useWriteWorkspaceStore((state) => state.assistantModel)
  const buildStatus = session?.build?.status
  const buildId = session?.build?.buildId
  useEffect(() => { if (buildStatus === 'failed') setProblems('problems') }, [buildStatus, buildId])
  const run = useCallback((operation: () => Promise<unknown>): void => { void operation().catch((error) => patchLatex(key, { error: String(error) })) }, [key])
  const save = useCallback((compile = true): void => run(async () => {
    const current = latexSession(key)
    if (!current) return
    if (compile && current.project.config.autoBuild) await buildLatex(key)
    else await saveLatexSession(workspaceRoot, path)
  }), [key, workspaceRoot, path, run])
  useLatexWorkspace(key, session, path, focused)

  useEffect(() => {
    if (!latexSession(key)) run(() => openLatexSession(workspaceRoot, path))
  }, [workspaceRoot, path, key, run])
  const hasSession = !!session
  useEffect(() => {
    if (!host.current) return
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 760))
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [hasSession])
  const rootPath = session?.project.rootPath
  useEffect(() => {
    const current = latexSession(key)
    if (!current) return
    let cancelled = false
    void (async () => {
      for (const file of current.project.files.filter(isLatexFilePath)) {
        if (cancelled) break
        await loadLatexBuffer(key, file)
      }
    })().catch((error) => patchLatex(key, { error: String(error) }))
    return () => { cancelled = true }
  }, [key, rootPath])
  useEffect(() => {
    if (usePaperSpaceStore.getState().loaded) return
    void window.kunGui.paperWorkspaceEnsure().then(async (result) => {
      if (!result.ok) return
      const roots = result.libraries.length ? result.libraries : [result.workspaceRoot]
      const entriesByRoot = { ...usePaperSpaceStore.getState().entriesByRoot }
      for (const root of roots) {
        const entries = await window.kunGui.paperLibraryList({ workspaceRoot: root })
        if (entries.ok) entriesByRoot[root] = entries.entries
      }
      usePaperSpaceStore.setState({ entriesByRoot, items: paperSpaceItems(entriesByRoot) })
    }).catch(() => {})
  }, [])
  useEffect(() => {
    if (!focused) return
    latexCitationInsertions.set(key, (text) => source.current?.insert(text))
    return () => { latexCitationInsertions.delete(key) }
  }, [key, focused])
  useEffect(() => {
    if (!focused) return
    const handler = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key === '\\') {
        event.preventDefault()
        const current = latexSession(key)
        if (current) patchLatex(key, { view: current.view === 'pdf' ? 'source' : 'pdf' })
      } else if (event.key.toLowerCase() === 's' && !(event.target as Element)?.closest('.cm-editor')) {
        event.preventDefault(); save()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [focused, key, save])

  const fix = (prompt?: string): void => run(async () => {
    const current = latexSession(key)!
    await proposeLatexRevision(key, prompt || t('latexFixInstruction'), assistantProvider, assistantModel)
    if (latexSession(key)?.review.length) setPanel('review')
    if (current.activeFile) setInstruction('')
  })
  const sync = (direction: 'forward' | 'inverse', point?: { page: number; x: number; y: number }): void => run(async () => {
    const current = latexSession(key)!
    if (!current.pdf || current.pdfRevision !== current.revision) return
    const result = await window.kunGui.latexSync({ ...latexTarget(current), buildId: current.pdf.buildId, direction,
      file: current.activeFile, line: cursor.line, ...point })
    if (!result.ok) throw new Error(result.message)
    if (!result.point) return
    if (direction === 'forward') { setSyncPoint({ ...result.point, token: Date.now() }); if (narrow) patchLatex(key, { view: 'pdf' }) }
    else await selectLatexFile(key, result.point.file, result.point.line)
  })
  const beginResize = (event: React.PointerEvent): void => {
    event.preventDefault()
    const move = (event: PointerEvent): void => {
      const rect = host.current!.getBoundingClientRect()
      patchLatex(key, { ratio: Math.min(.7, Math.max(.3, (event.clientX - rect.left) / rect.width)) })
    }
    const end = (): void => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end)
  }
  if (!session) return <div className="flex flex-1 items-center justify-center text-ds-muted">{t('filePreviewLoading')}</div>
  const view = narrow && session.view === 'split' ? 'source' : session.view
  const stale = session.pdfRevision !== session.revision || session.build?.status === 'failed'
  const buffer = session.buffers[session.activeFile]
  const diagnostics = session.build?.diagnostics ?? []
  return (
    <div ref={host} className="latex-document" data-latex-view={view}>
      <LatexToolbar sessionKey={key} session={session} narrow={narrow} onSave={() => save(false)} onReferences={() => setPanel('references')} onSync={() => sync('forward')} onProblems={() => setProblems((value) => value === 'problems' ? null : 'problems')} onLog={() => setProblems('log')} />
      {session.needsMainChoice ? <div className="latex-notice"><span>{t('latexChooseMain')}</span><select aria-label={t('latexMainFile')} value="" onChange={(event) => run(() => configureLatex(key, { ...session.project.config, mainFile: event.target.value }))}>
        <option value="" disabled>{t('latexMainFile')}</option>{session.project.mainCandidates.map((file) => <option key={file}>{file}</option>)}</select></div> : null}
      {session.error ? <div className="latex-notice is-error" role="alert"><AlertCircle size={14} /><span>{session.error}</span><button type="button" aria-label={t('latexClose')} onClick={() => patchLatex(key, { error: null })}><X size={14} /></button></div> : null}
      {!!session.review.length && <div className="latex-notice"><span>{t('latexReviewPending', { count: session.review.length })}</span><button type="button" onClick={() => setPanel('review')}>{t('latexReviewChanges')}</button></div>}
      {buffer?.truncated ? <div className="latex-notice"><span>{t('latexLargeSource')}</span></div> : null}
      <div className="latex-split">
        <div className="latex-source" style={{ display: view === 'pdf' ? 'none' : 'flex', flex: view === 'split' ? `0 0 ${session.ratio * 100}%` : '1' }}>
          {buffer ? <LatexSourceEditor sessionKey={key} file={session.activeFile} value={buffer.content} readOnly={!!session.review.length || buffer.truncated === true} diagnostics={diagnostics} jump={session.jump}
            onChange={(content) => editLatexBuffer(key, session.activeFile, content)} onSave={() => save()} handleRef={source}
            onSelection={(selection, cursor) => { setSelection(selection); setCursor(cursor); if (focused) onSelectionChange(selection) }} /> : <p>{t('filePreviewLoading')}</p>}
          <div className="latex-source-actions"><button type="button" onClick={() => setPanel('references')}><BookOpen size={13} />{t('latexInsertCitation')}</button>
            <span />{session.tools?.synctex && session.pdf && !stale ? <button type="button" onClick={() => sync('forward')}><LocateFixed size={13} />{t('latexLocateCursor')}</button> : null}</div>
          {selection?.text ? <form className="latex-revise-selection" onSubmit={(event) => { event.preventDefault(); fix(`${instruction}\nOnly revise this selection in ${session.activeFile}, lines ${selection.ranges[0]?.startLine}-${selection.ranges.at(-1)?.endLine}:\n${selection.text}`) }}>
            <input value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder={t('latexRevisePlaceholder')} aria-label={t('latexRevisePlaceholder')} />
            <button type="submit" disabled={!instruction.trim() || session.proposing || !!session.review.length || buffer?.truncated}><Sparkles size={13} />{t('latexProposeRevision')}</button>
            <button type="button" onClick={() => onAskAssistant(`${t('latexDiscussSelection')}\n${session.project.rootPath}/${session.activeFile}:${cursor.line}\n${selection.text}`)}>{t('latexDiscuss')}</button>
          </form> : null}
        </div>
        {view === 'split' ? <div className="latex-divider" role="separator" aria-label={t('latexResize')} aria-orientation="vertical" tabIndex={0} onPointerDown={beginResize}
          onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); patchLatex(key, { ratio: Math.min(.7, Math.max(.3, session.ratio + (event.key === 'ArrowLeft' ? -.02 : .02))) }) } }} /> : null}
        <div className="latex-pdf" style={{ display: view === 'source' ? 'none' : 'flex' }}>
          {session.pdf ? <>
            {stale ? <div className="latex-pdf-stale">{t('latexOldPdf', { time: new Date(session.pdf.mtimeMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}<button type="button" onClick={() => setProblems('log')}>{t('latexViewLog')}</button></div> : null}
            <WritePdfViewer filePath={`${session.project.rootPath}/${session.project.config.mainFile.replace(/\.(tex|ltx)$/i, '.pdf')}`} workspaceRoot={workspaceRoot} dataBase64={session.pdf.dataBase64} size={session.pdf.size} mtimeMs={session.pdf.mtimeMs}
              onSelectionChange={() => {}} fitWidth compact syncPoint={syncPoint} onSourceSync={session.tools?.synctex && !stale ? (point) => sync('inverse', point) : undefined} />
          </> : <LatexToolchainNotice sessionKey={key} session={session} />}
          {!!session.buildId && <div className="latex-build-progress" />}
        </div>
      </div>
      {problems ? <LatexProblems key={problems} initialTab={problems} sessionKey={key} session={session} onClose={() => setProblems(null)} onFix={() => fix()} /> : null}
      <footer className="latex-status-bar"><button type="button" onClick={() => save(false)}>{latexDirty(session) ? <span className="latex-dirty-dot" /> : <Check size={12} />}{t(session.saving ? 'latexSaving' : latexDirty(session) ? 'latexUnsaved' : 'latexSaved')}</button>
        <span>{t('latexCharacters', { count: buffer?.content.length ?? 0 })}</span><span>{t('latexCursor', cursor)}</span><span className="latex-status-spacer" />
        <button type="button" className={diagnostics.some((d) => d.level === 'error') ? 'is-error' : ''} onClick={() => setProblems((value) => value === 'problems' ? null : 'problems')}>{diagnostics.length ? t('latexIssueCount', { count: diagnostics.length }) : t('latexNoProblems')}</button>
        <span>{session.buildId ? t('latexBuilding') : session.build ? `${new Date(session.build.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${(session.build.durationMs / 1000).toFixed(1)}s` : ''}</span></footer>
    </div>
  )
}

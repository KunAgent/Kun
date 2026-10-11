import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { writeJoinPath } from '../../write/write-workspace-store-helpers'

export function MobilePaperNotes({ workspaceRoot, unitDir, onDirty }: {
  workspaceRoot: string
  unitDir: string
  onDirty: (dirty: boolean) => void
}) {
  const { t } = useTranslation('common')
  const translateRef = useRef(t)
  translateRef.current = t
  const path = writeJoinPath(writeJoinPath(workspaceRoot, unitDir), 'NOTES.md')
  const loadedTarget = useRef({ workspaceRoot, path })
  const [text, setText] = useState('')
  const [saved, setSaved] = useState('')
  const [mtime, setMtime] = useState<number | undefined>()
  const [missing, setMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  const textRef = useRef(text)
  textRef.current = text
  const dirty = text !== saved
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty || conflict
  useEffect(() => onDirty(dirty || conflict), [dirty, conflict, onDirty])
  useEffect(() => {
    if (dirtyRef.current && (loadedTarget.current.path !== path || loadedTarget.current.workspaceRoot !== workspaceRoot)) {
      setError(translateRef.current('mobileWorkPaperNotesTargetChanged')); return
    }
    loadedTarget.current = { workspaceRoot, path }
    let live = true
    setError(''); setMissing(false); setLoading(true); setText(''); setSaved(''); setMtime(undefined)
    void window.kunGui.readWorkspaceFile({ workspaceRoot, path }).then((result) => {
      if (!live) return
      if (!result.ok) { setMissing(/ENOENT|not found/i.test(result.message)); setError(result.message); return }
      if (result.truncated) { setError(translateRef.current('mobileWorkPaperNotesLarge')); return }
      setText(result.content); setSaved(result.content); setMtime(result.mtimeMs)
    }).catch((cause: unknown) => { if (live) setError(String(cause)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [workspaceRoot, path, retry])
  const save = async (force = false): Promise<void> => {
    if (busy) return
    setBusy(true); setError('')
    const snapshot = textRef.current
    try {
      const result = await window.kunGui.writeWorkspaceFile({ workspaceRoot: loadedTarget.current.workspaceRoot,
        path: loadedTarget.current.path, content: snapshot,
        ...(force ? { force: true } : { expectedMtimeMs: mtime }) })
      if (!result.ok) { setConflict(result.code === 'modified_on_disk'); throw new Error(result.message) }
      setMtime(result.mtimeMs); setSaved(snapshot); setConflict(false)
      if (loadedTarget.current.path !== path || loadedTarget.current.workspaceRoot !== workspaceRoot) {
        setRetry((value) => value + 1)
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const createMissing = async (): Promise<void> => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const result = await window.kunGui.createWorkspaceFile({ workspaceRoot, path, content: '' })
      if (!result.ok) throw new Error(result.message)
      setRetry((value) => value + 1)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }
  if (loading) return <p role="status">{t('mobileWorkPaperNotesLoading')}</p>
  if (error && !dirty && mtime === undefined && !missing) return <div role="alert"><p>{error}</p>
    <button type="button" onClick={() => setRetry((value) => value + 1)}>{t('mobileWorkPaperNotesRetry')}</button></div>
  if (missing) return <div className="kun-mobile-paper-reader-body"><p role="alert">{t('mobileWorkPaperNotesMissing', { error })}</p>
    <button type="button" disabled={busy} onClick={() => void createMissing()}>{t('mobileWorkPaperNotesCreate')}</button></div>
  return <div className="kun-mobile-paper-reader-body">
    <label className="kun-mobile-field">NOTES.md
      <textarea rows={18} value={text} onChange={(event) => { onDirty(true); setText(event.target.value) }} spellCheck={false} /></label>
    <button type="button" className="kun-mobile-work-sheet-button" disabled={busy || !dirty} onClick={() => void save()}>
      {busy ? t('mobileWorkPaperNotesSaving') : dirty ? t('mobileWorkPaperSaveNotes') : t('mobileWorkPaperNotesSaved')}</button>
    {dirty && (loadedTarget.current.path !== path || loadedTarget.current.workspaceRoot !== workspaceRoot) ?
      <div role="alert"><p>{t('mobileWorkPaperNotesTargetChanged')}</p>
        <button type="button" onClick={() => { if (window.confirm(t('mobileWorkPaperNotesDiscardConfirm'))) {
          setText(saved); textRef.current = saved; setConflict(false); setRetry((value) => value + 1)
        } }}>{t('mobileWorkPaperNotesDiscard')}</button>
      </div> : null}
    {conflict ? <div role="alert"><p>{t('mobileWorkPaperNotesConflict')}</p>
      <button type="button" onClick={() => { if (window.confirm(t('mobileWorkPaperNotesOverwriteConfirm'))) void save(true) }}>{t('mobileWorkPaperNotesOverwrite')}</button>
      <button type="button" onClick={() => { if (window.confirm(t('mobileWorkPaperNotesDiscardConfirm'))) {
        setText(saved); textRef.current = saved; setConflict(false); setRetry((value) => value + 1)
      } }}>{t('mobileWorkPaperNotesDiscard')}</button>
    </div> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>
}

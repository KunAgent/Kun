import { useEffect, useRef, useState } from 'react'
import { writeJoinPath } from '../../write/write-workspace-store-helpers'

export function MobilePaperNotes({ workspaceRoot, unitDir, onDirty }: {
  workspaceRoot: string
  unitDir: string
  onDirty: (dirty: boolean) => void
}) {
  const path = writeJoinPath(writeJoinPath(workspaceRoot, unitDir), 'NOTES.md')
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
  useEffect(() => onDirty(dirty || conflict), [dirty, conflict, onDirty])
  useEffect(() => {
    let live = true
    setError(''); setMissing(false); setLoading(true); setText(''); setSaved(''); setMtime(undefined)
    void window.kunGui.readWorkspaceFile({ workspaceRoot, path }).then((result) => {
      if (!live) return
      if (!result.ok) { setMissing(/ENOENT|not found/i.test(result.message)); setError(result.message); return }
      if (result.truncated) { setError('笔记过大，手机暂不编辑截断内容'); return }
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
      const result = await window.kunGui.writeWorkspaceFile({ workspaceRoot, path, content: snapshot,
        ...(force ? { force: true } : { expectedMtimeMs: mtime }) })
      if (!result.ok) { setConflict(result.code === 'modified_on_disk'); throw new Error(result.message) }
      setMtime(result.mtimeMs); setSaved(snapshot); setConflict(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  if (loading) return <p role="status">正在读取笔记…</p>
  if (error && !dirty && mtime === undefined && !missing) return <div role="alert"><p>{error}</p>
    <button type="button" onClick={() => setRetry((value) => value + 1)}>重试读取笔记</button></div>
  if (missing) return <div className="kun-mobile-paper-reader-body"><p role="alert">笔记文件尚不存在：{error}</p>
    <button type="button" disabled={busy} onClick={() => {
      setBusy(true); void window.kunGui.createWorkspaceFile({ workspaceRoot, path, content: '' })
        .then((result) => { if (result.ok) setRetry((value) => value + 1); else setError(result.message) })
        .finally(() => setBusy(false)) }}>创建 NOTES.md</button></div>
  return <div className="kun-mobile-paper-reader-body">
    <label className="kun-mobile-field">NOTES.md
      <textarea rows={18} value={text} onChange={(event) => { onDirty(true); setText(event.target.value) }} spellCheck={false} /></label>
    <button type="button" className="kun-mobile-work-sheet-button" disabled={busy || !dirty} onClick={() => void save()}>
      {busy ? '保存中…' : dirty ? '保存笔记到主机' : '已保存'}</button>
    {conflict ? <div role="alert"><p>主机笔记已被修改。请决定保留哪一份。</p>
      <button type="button" onClick={() => { if (window.confirm('覆盖主机 NOTES.md？')) void save(true) }}>用手机笔记覆盖主机</button>
      <button type="button" onClick={() => { if (window.confirm('放弃手机未保存笔记？')) { setConflict(false); setRetry((value) => value + 1) } }}>放弃草稿并重新读取</button>
    </div> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>
}

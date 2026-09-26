import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { usePaperModeStore } from '../../paper/paper-mode-store'
import { filterPaperEntries, sortPaperEntries } from '../../paper/paper-library-filter'
import { MobileSheet } from '../sheets/MobileSheet'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'
import type { MobilePage } from '../navigation/mobile-page'
import { paperResourceKey } from './paper-resource-key'
import { mobilePaperLibraryRoot, setMobilePaperLibraryRoot } from './mobile-paper-library-root'
import './mobile-paper.css'

type Props = {
  navigate: (page: MobilePage) => void
  onDocuments: () => void
  onBusyChange: (busy: boolean) => void
}

export function MobilePaperHome({ navigate, onDocuments, onBusyChange }: Props) {
  const { t } = useTranslation('common')
  const { paperMode, paperReading, workspaceRoot } = useWriteWorkspaceStore(useShallow((state) => ({
    paperMode: state.paperMode, paperReading: state.paperReading, workspaceRoot: state.workspaceRoot
  })))
  const [preferredRoot, setPreferredRoot] = useState('')
  const root = preferredRoot && paperMode.libraries.includes(preferredRoot) ? preferredRoot
    : mobilePaperLibraryRoot(paperMode.libraries, paperMode.activeLibrary, workspaceRoot)
  const library = usePaperModeStore()
  const [limit, setLimit] = useState(60)
  const [importOpen, setImportOpen] = useState(false)
  const [input, setInput] = useState('')
  const [bibtex, setBibtex] = useState(false)
  const [progress, setProgress] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false) }, [busy, onBusyChange])
  const [selected, setSelected] = useState<PaperLibraryEntry | null>(null)
  const [editTags, setEditTags] = useState('')
  const [editGroup, setEditGroup] = useState('')
  const [newGroup, setNewGroup] = useState('')
  const [editStatus, setEditStatus] = useState<'unread' | 'reading' | 'read'>('unread')
  const [file, setFile] = useState<File | null>(null)
  const requestRef = useRef<string | null>(null)
  const refresh = library.entriesRefreshToken
  const setEntriesResult = library.setEntriesResult
  const setEntriesLoading = library.setEntriesLoading
  const setEntriesError = library.setEntriesError
  const refreshEntries = library.refreshEntries
  const reload = (): void => refreshEntries()
  useEffect(() => {
    if (!root) return
    let live = true
    setEntriesLoading(true)
    void window.kunGui.paperLibraryList({ workspaceRoot: root, papersDir: paperReading.papersDir })
      .then((result) => {
        if (!live) return
        if (result.ok) setEntriesResult(result)
        else setEntriesError(result.message)
      }).catch((cause: unknown) => { if (live) setEntriesError(String(cause)) })
    return () => { live = false }
  }, [root, paperReading.papersDir, refresh, setEntriesResult, setEntriesLoading, setEntriesError])
  useEffect(() => window.kunGui.onPaperProgress((event) => {
    if (event.requestId === requestRef.current) setProgress(event.message || event.stage)
  }), [])
  useEffect(() => {
    const reconcile = (): void => {
      refreshEntries()
      if (requestRef.current) setProgress('连接已恢复，正在核对导入结果；请勿重复提交。')
    }
    const offReconnect = window.kunGui.onRemoteStreamReconnected?.(reconcile)
    const offReset = window.kunGui.onRemoteSenderReset?.(reconcile)
    return () => { offReconnect?.(); offReset?.() }
  }, [refreshEntries])

  const filtered = useMemo(() => sortPaperEntries(filterPaperEntries(library.entries, library.filter), library.sort),
    [library.entries, library.filter, library.sort])
  const runImport = async (): Promise<void> => {
    if (!root || busy || (!file && !input.trim())) return
    setBusy(true); setActionError(''); setProgress('正在上传/导入…')
    const requestId = crypto.randomUUID()
    requestRef.current = requestId
    try {
      if (bibtex && !file) {
        const result = await window.kunGui.paperImportBibtex({ workspaceRoot: root, bibtex: input,
          parentDir: paperReading.papersDir, downloadPdfs: false, requestId })
        if (!result.ok) throw new Error(result.message)
      } else {
        const path = file ? await window.kunGui.uploadRemoteFile?.(file) : undefined
        if (file && !path) throw new Error('当前连接无法上传 PDF')
        const result = await window.kunGui.paperImport({ workspaceRoot: root,
          input: path || input.trim(), ...(path ? { localPdfPath: path } : {}),
          parentDir: paperReading.papersDir, requestId })
        if (!result.ok) throw new Error(result.message)
      }
      setFile(null); setInput(''); setImportOpen(false); reload()
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : String(cause)) }
    finally { requestRef.current = null; setBusy(false); setProgress('') }
  }
  const pickFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const next = event.currentTarget.files?.[0] ?? null
    if (next && (next.size > 40 * 1024 * 1024 || !/\.pdf$/i.test(next.name))) {
      setActionError('仅支持不超过 40 MB 的 PDF 文件'); setFile(null)
    } else { setActionError(''); setFile(next) }
    event.currentTarget.value = ''
  }
  const updateMeta = async (): Promise<void> => {
    if (!selected || busy) return
    setBusy(true); setActionError('')
    try {
      const result = await window.kunGui.paperUpdateMeta({ workspaceRoot: root,
        unitDir: selected.unitDir, patch: { status: editStatus,
          tags: editTags.split(',').map((tag) => tag.trim()).filter(Boolean) } })
      if (!result.ok) throw new Error(result.message)
      const group = newGroup.trim() ? (await window.kunGui.paperCreateGroup({ workspaceRoot: root, group: newGroup.trim() })) : null
      if (group && !group.ok) throw new Error(group.message)
      const targetGroup = group?.ok ? group.group : editGroup
      if (targetGroup !== selected.group) {
        const moved = await window.kunGui.paperMoveToGroup({ workspaceRoot: root,
          unitDir: selected.unitDir, group: targetGroup })
        if (!moved.ok) throw new Error(moved.message)
      }
      setSelected(null); setNewGroup(''); reload()
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  return <section className="kun-mobile-paper" aria-label="论文库">
    <header><h1>论文库</h1><button type="button" onClick={() => setImportOpen(true)}>导入</button></header>
    <nav className="kun-mobile-work-tabs" aria-label={t('workspaceModeWorkLabel')}>
      <button type="button" onClick={onDocuments}>文档</button>
      <button type="button" aria-current="page">论文</button>
    </nav>
    <div className="kun-mobile-paper-actions"><span>{root.split(/[\\/]/).filter(Boolean).at(-1) || '未设置文献库'} · {library.counts.total} 篇</span>
      <button type="button" onClick={() => navigate({ mode: 'work', kind: 'discover' })}>发现 / 研究</button></div>
    {paperMode.libraries.length > 1 ? <label className="kun-mobile-field kun-mobile-paper-library">文献库
      <select value={root} onChange={(event) => { setMobilePaperLibraryRoot(event.target.value, paperMode.libraries)
        setPreferredRoot(event.target.value); setSelected(null); setLimit(60) }}>
        {paperMode.libraries.map((value) => <option value={value} key={value}>{value.split(/[\\/]/).filter(Boolean).at(-1) || value}</option>)}
      </select></label> : null}
    <label className="kun-mobile-field kun-mobile-paper-search">搜索论文
      <input type="search" value={library.filter.query} onChange={(event) => library.setFilter({ query: event.target.value })}
        placeholder="标题、作者、关键词" /></label>
    <details className="kun-mobile-paper-filters"><summary>筛选与排序</summary><div>
      <label className="kun-mobile-field">状态 <select value={library.filter.status} onChange={(event) => library.setFilter({ status: event.target.value as typeof library.filter.status })}>
        <option value="">全部</option><option value="unread">未读</option><option value="reading">在读</option><option value="read">已读</option></select></label>
      <label className="kun-mobile-field">分组 <select value={library.filter.group} onChange={(event) => library.setFilter({ group: event.target.value })}>
        <option value="">全部</option>{library.groups.map((group) => <option key={group} value={group}>{group}</option>)}</select></label>
      <label className="kun-mobile-field">标签 <select value={library.filter.tag} onChange={(event) => library.setFilter({ tag: event.target.value })}>
        <option value="">全部</option>{library.tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select></label>
      <label className="kun-mobile-field">排序 <select value={library.sort.key} onChange={(event) => library.setSort({ key: event.target.value as typeof library.sort.key, dir: 'desc' })}>
        <option value="importedAt">导入时间</option><option value="lastOpenedAt">最近阅读</option><option value="year">年份</option><option value="title">标题</option></select></label>
    </div></details>
    <div className="kun-mobile-paper-list" aria-busy={library.entriesLoading}>
      {library.entriesError ? <p role="alert">{library.entriesError} <button type="button" onClick={reload}>重试</button></p> : null}
      {!library.entriesError && !library.entriesLoading && !filtered.length ? <p role="status">暂无匹配论文，可导入或调整筛选。</p> : null}
      <ul>{filtered.slice(0, limit).map((entry) => <li key={entry.unitDir}>
        <button type="button" className="kun-mobile-paper-open" onClick={() => navigate({ mode: 'work', kind: 'paper', paperKey: paperResourceKey(root, entry.unitDir), view: entry.hasPdf ? 'read' : 'info' })}>
          <strong>{entry.meta.title}</strong><span>{entry.meta.authors.slice(0, 3).join(', ')} · {entry.meta.year ?? '—'}</span>
          <small>{entry.meta.status ?? 'unread'} · {entry.lastPage ? `第 ${entry.lastPage} 页` : '未开始'} · {entry.hasPdf ? 'PDF' : '无 PDF'}</small></button>
        <button type="button" className="kun-mobile-paper-more" aria-label={`编辑 ${entry.meta.title}`}
          onClick={() => { setSelected(entry); setEditStatus(entry.meta.status ?? 'unread'); setEditTags(entry.meta.tags?.join(', ') ?? ''); setEditGroup(entry.group); setNewGroup(''); setActionError('') }}>···</button>
      </li>)}</ul>
      {filtered.length > limit ? <button type="button" onClick={() => setLimit((value) => value + 60)}>加载更多</button> : null}
    </div>
    <MobileSheet open={importOpen} title="导入论文" closeLabel="关闭" onClose={() => { if (!busy) setImportOpen(false) }}>
      <label className="kun-mobile-field">DOI / arXiv / URL 或 BibTeX
        <textarea value={input} onChange={(event) => setInput(event.target.value)} rows={4} /></label>
      <label><input type="checkbox" checked={bibtex} onChange={(event) => setBibtex(event.target.checked)} />BibTeX 文本</label>
      <label className="kun-mobile-field">或选取手机 PDF<input type="file" accept=".pdf,application/pdf" onChange={pickFile} /></label>
      {file ? <p>{file.name}</p> : null}
      {progress ? <p role="status">{progress}</p> : null}
      {actionError ? <p role="alert">{actionError}</p> : null}
      <button type="button" className="kun-mobile-work-sheet-button" disabled={busy || (!input.trim() && !file)} onClick={() => void runImport()}>开始导入</button>
      {busy && requestRef.current ? <button type="button" className="kun-mobile-work-sheet-button" onClick={() => { void window.kunGui.paperCancel({ requestId: requestRef.current! }) }}>取消导入</button> : null}
    </MobileSheet>
    <MobileSheet open={Boolean(selected)} title={selected?.meta.title ?? ''} closeLabel="关闭" onClose={() => { if (!busy) setSelected(null) }}>
      <label className="kun-mobile-field">阅读状态 <select value={editStatus} onChange={(event) => setEditStatus(event.target.value as typeof editStatus)}>
        <option value="unread">未读</option><option value="reading">在读</option><option value="read">已读</option></select></label>
      <label className="kun-mobile-field">标签（逗号分隔）<input value={editTags} onChange={(event) => setEditTags(event.target.value)} /></label>
      <label className="kun-mobile-field">分组 <select value={editGroup} onChange={(event) => setEditGroup(event.target.value)}>
        <option value="">未分组</option>{library.groups.map((group) => <option key={group} value={group}>{group}</option>)}
      </select></label>
      <label className="kun-mobile-field">或新建分组<input value={newGroup} onChange={(event) => setNewGroup(event.target.value)} /></label>
      {actionError ? <p role="alert">{actionError}</p> : null}
      <button type="button" className="kun-mobile-work-sheet-button" disabled={busy} onClick={() => void updateMeta()}>保存到文献库</button>
    </MobileSheet>
  </section>
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { useChatStore } from '../../store/chat-store'
import { DEFAULT_PAPER_SEARCH_SOURCES, PAPER_SEARCH_SOURCE_LABELS,
  type PaperSearchHit, type PaperSearchSource } from '@shared/paper/paper-search'
import { listResearchSessions, newResearchSessionId, readLastResearchSession,
  writeLastResearchSession } from '../../paper/paper-research-sessions'
import { MobilePaperAssistant } from './MobilePaperAssistant'
import { buildResearchPool } from '../../paper/paper-research-pool'
import { usePaperModeStore } from '../../paper/paper-mode-store'
import { mobilePaperLibraryRoot } from './mobile-paper-library-root'
import './mobile-paper.css'

type Props = { onBack: () => void; onSettings: () => void; onBusyChange: (busy: boolean) => void }

export function MobilePaperDiscover({ onBack, onSettings, onBusyChange }: Props) {
  const paperMode = useWriteWorkspaceStore((state) => state.paperMode)
  const papersDir = useWriteWorkspaceStore((state) => state.paperReading.papersDir)
  const workspaceRoot = useWriteWorkspaceStore((state) => state.workspaceRoot)
  const root = mobilePaperLibraryRoot(paperMode.libraries, paperMode.activeLibrary, workspaceRoot)
  const threads = useChatStore((state) => state.threads)
  const blocks = useChatStore((state) => state.blocks)
  const activeThreadId = useChatStore((state) => state.activeThreadId)
  const libraryEntries = usePaperModeStore((state) => state.entries)
  const sessions = useMemo(() => listResearchSessions(root, threads), [root, threads])
  const [session, setSession] = useState<string | null>(null)
  useEffect(() => { setSession(readLastResearchSession(root)) }, [root])
  const pool = useMemo(() => buildResearchPool(
    session && activeThreadId === sessions.find((item) => item.sessionId === session)?.threadId ? blocks : []
  ), [session, activeThreadId, sessions, blocks])
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<PaperSearchHit[]>([])
  const [reports, setReports] = useState<string[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [sources, setSources] = useState<PaperSearchSource[]>(
    paperMode.search.enabledSources.length ? paperMode.search.enabledSources : [...DEFAULT_PAPER_SEARCH_SOURCES])
  const [tab, setTab] = useState<'search' | 'research'>('search')
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const requestSeq = useRef(0)
  const jobRef = useRef<string | null>(null)
  const cancelBatch = useRef(false)
  useEffect(() => { onBusyChange(importing); return () => onBusyChange(false) }, [importing, onBusyChange])
  useEffect(() => window.kunGui.onPaperProgress((event) => {
    if (event.requestId === jobRef.current) setMessage(event.message || event.stage)
  }), [])
  useEffect(() => () => { if (jobRef.current) void window.kunGui.paperCancel({ requestId: jobRef.current }) }, [])
  const search = async (): Promise<void> => {
    const text = query.trim()
    if (!text || !sources.length || loading) return
    const serial = ++requestSeq.current
    setLoading(true); setError(''); setHits([]); setSelected([]); setReports([])
    try {
      const result = await window.kunGui.paperSearch({ query: text, sources, limit: 15 })
      if (serial !== requestSeq.current) return
      if (!result.ok) throw new Error(result.message)
      setHits(result.hits)
      setReports(result.sources.map((source) => `${PAPER_SEARCH_SOURCE_LABELS[source.source]}：${source.error || `${source.count} 篇${source.cached ? '（缓存）' : ''}`}`))
      if (!result.hits.length) setMessage('无结果，可更换关键词或数据源。')
    } catch (cause) { if (serial === requestSeq.current) setError(String(cause)) }
    finally { if (serial === requestSeq.current) setLoading(false) }
  }
  const importSelected = async (): Promise<void> => {
    const batch = (tab === 'research' ? pool.entries : hits)
      .filter((hit) => selected.includes(hit.key)).slice(0, 20)
    if (!batch.length || importing) return
    setImporting(true); setError('')
    cancelBatch.current = false
    const failures: string[] = []
    let imported = 0
    try {
      for (const hit of batch) {
        if (cancelBatch.current) break
        const input = hit.arxivId || hit.doi || hit.coolId || hit.pdfUrl || hit.url
        if (!input) { failures.push(`${hit.title}: 缺少可导入的标识`); continue }
        const requestId = crypto.randomUUID()
        jobRef.current = requestId
        setMessage(`正在导入 ${imported + failures.length + 1}/${batch.length}：${hit.title}`)
        try {
          const result = await window.kunGui.paperImport({ workspaceRoot: root,
            input, parentDir: papersDir, requestId,
            meta: { title: hit.title, authors: hit.authors, abstract: hit.abstract,
              year: hit.year ? String(hit.year) : undefined, venue: hit.venue,
              doi: hit.doi, arxivId: hit.arxivId, coolId: hit.coolId, pdfUrl: hit.pdfUrl } })
          if (result.ok) imported += 1
          else failures.push(`${hit.title}: ${result.message}`)
        } catch (cause) { failures.push(`${hit.title}: ${String(cause)}`) }
        jobRef.current = null
      }
      setMessage(cancelBatch.current
        ? `已取消；已导入 ${imported} 篇，失败 ${failures.length} 篇。`
        : `已导入 ${imported} 篇；失败 ${failures.length} 篇。`)
      setSelected([])
      if (failures.length) setError(failures.join('；'))
    } finally { jobRef.current = null; setImporting(false) }
  }
  const startResearch = (): void => {
    const id = newResearchSessionId()
    setSession(id); writeLastResearchSession(root, id); setTab('research')
  }
  return <section className="kun-mobile-paper">
    <header><button type="button" onClick={onBack}>‹ 返回论文库</button><h1>发现 / 研究</h1>
      <button type="button" onClick={startResearch}>新研究</button></header>
    <nav className="kun-mobile-work-tabs" aria-label="研究模式">
      <button type="button" aria-current={tab === 'search' ? 'page' : undefined}
        onClick={() => { setSelected([]); setTab('search') }}>检索发现</button>
      <button type="button" aria-current={tab === 'research' ? 'page' : undefined}
        onClick={() => { setSelected([]); setTab('research') }}>Agent 研究</button>
    </nav>
    {tab === 'search' ? <>
      <form className="kun-mobile-paper-search kun-mobile-field" onSubmit={(event) => { event.preventDefault(); void search() }}>
        <label>检索词<input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="题目、作者、主题" /></label>
        <button type="submit" disabled={loading || !query.trim() || !sources.length}>{loading ? '检索中…' : '搜索'}</button>
      </form>
      <details className="kun-mobile-paper-filters"><summary>数据源（{sources.length} 个）</summary><div>
        {Object.entries(PAPER_SEARCH_SOURCE_LABELS).map(([source, title]) =>
          <label key={source}><input type="checkbox" checked={sources.includes(source as PaperSearchSource)}
            onChange={(event) => setSources((current) => event.target.checked
              ? [...current, source as PaperSearchSource] : current.filter((item) => item !== source))} />{title}</label>)}
      </div></details>
      {reports.length ? <details className="kun-mobile-paper-filters"><summary>数据源状态</summary><ul>
        {reports.map((item) => <li key={item}>{item}</li>)}</ul></details> : null}
      {selected.length ? <div className="kun-mobile-paper-actions"><span>已选 {selected.length} 篇</span>
        <button type="button" disabled={importing} onClick={() => void importSelected()}>导入选中论文</button>
        {importing ? <button type="button" onClick={() => { cancelBatch.current = true
          if (jobRef.current) void window.kunGui.paperCancel({ requestId: jobRef.current }) }}>取消批量导入</button> : null}
      </div> : null}
      {message ? <p role="status" className="kun-mobile-paper-actions">{message}</p> : null}
      {error ? <p role="alert" className="kun-mobile-paper-actions">{error}</p> : null}
      <div className="kun-mobile-paper-list"><ul>{hits.map((hit) => <li key={hit.key}>
        <label className="kun-mobile-paper-open"><input type="checkbox" checked={selected.includes(hit.key)}
          onChange={(event) => setSelected((old) => event.target.checked ? [...old, hit.key]
            : old.filter((key) => key !== hit.key))} />
          <strong>{hit.title}</strong><small>{hit.authors.slice(0, 3).join(', ')} · {hit.year || '—'}</small>
          <small>{hit.sources.map((source) => PAPER_SEARCH_SOURCE_LABELS[source]).join(' · ')}</small>
          {hit.abstract ? <span className="kun-mobile-paper-abstract">{hit.abstract}</span> : null}
        </label></li>)}</ul></div>
    </> : <>
      <div className="kun-mobile-paper-actions"><label>研究会话 <select value={session ?? ''} onChange={(event) => {
        setSession(event.target.value || null); writeLastResearchSession(root, event.target.value || null)
      }}><option value="">新会话</option>{sessions.map((item) => <option key={item.sessionId} value={item.sessionId}>{item.title}</option>)}</select></label>
        <button type="button" onClick={startResearch}>开始研究</button></div>
      <div className="kun-mobile-paper-research">
      {session ? <MobilePaperAssistant key={session} root={root} unitDir="" page={0} quote={null}
        researchSessionId={session} onSettings={onSettings} onClearQuote={() => undefined} />
        : <p>创建独立研究会话，使用当前文献库做综述和问题探索。</p>}
      {session ? <div className="kun-mobile-paper-pool">
        <h2>研究候选池 · {pool.stats.candidates} 篇</h2>
        <p>{pool.stats.searches} 次检索 · {pool.stats.recommended} 篇推荐</p>
        {pool.stats.failedSources.length ? <p role="status">失败来源：{pool.stats.failedSources.join('、')}</p> : null}
        {pool.entries.length ? <><ul>{pool.entries.slice(0, 80).map((item) => {
          const inLibrary = libraryEntries.some((entry) => entry.meta.doi && entry.meta.doi === item.doi ||
            entry.meta.arxivId && entry.meta.arxivId === item.arxivId)
          return <li key={item.key}><label><input type="checkbox" checked={selected.includes(item.key)}
            onChange={(event) => setSelected((current) => event.target.checked
              ? [...current, item.key] : current.filter((key) => key !== item.key))} />
            <strong>{item.title}</strong> · {item.hits} 次命中 {inLibrary ? '· 已入库' : ''}
            {item.recommended ? <small> · {item.recommended.priority || '推荐'}：{item.recommended.reason}</small> : null}
          </label></li>
        })}</ul>{selected.length ? <button type="button" disabled={importing} onClick={() => void importSelected()}>导入选中候选</button> : null}</>
          : <p>研究结果会在会话检索后显示在这里。</p>}
        {message ? <p role="status">{message}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
      </div> : null}
      </div>
    </>}
  </section>
}

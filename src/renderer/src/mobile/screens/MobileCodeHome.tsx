import { useMemo, useState } from 'react'
import { ChevronRight, Folder, Plus, Search, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useChatStore } from '../../store/chat-store'
import { workspaceRootIdentityKey } from '../../lib/workspace-path'
import { MobileHome } from './MobileHome'
import './mobile-projects.css'

function projectName(root: string): string {
  return root.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) || root
}

function projectContext(root: string, label: string): string {
  const parts = root.replace(/\\/g, '/').split('/').filter(Boolean)
  const parent = parts.length >= 2 ? parts[parts.length - 2] ?? '' : ''
  return parent && parent.toLowerCase() !== label.toLowerCase() ? parent : ''
}

export function MobileCodeHome({ onOpen }: { onOpen: (threadId: string) => void }) {
  const { t } = useTranslation('common')
  const [project, setProject] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState('')
  const chat = useChatStore(useShallow((s) => ({
    roots: s.codeWorkspaceRoots, root: s.workspaceRoot, threads: s.threads,
    cursors: s.threadListCursorByWorkspace, status: s.threadListStatus,
    error: s.threadListError, select: s.selectWorkspaceRoot, choose: s.chooseWorkspace,
    refresh: s.refreshThreads, more: s.loadMoreThreads, create: s.createConversation,
    settings: s.openSettings, selectThread: s.selectThread
  })))
  const projects = useMemo(() => [...new Map([...chat.roots, chat.root].filter(Boolean)
    .map((root) => [workspaceRootIdentityKey(root), root])).values()], [chat.roots, chat.root])
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return projects
    return projects.filter((root) =>
      root.toLowerCase().includes(query) || projectName(root).toLowerCase().includes(query))
  }, [projects, search])
  const enter = async (root: string) => {
    if (switching) return
    setSwitching(true)
    setError('')
    try {
      const selected = await chat.select(root)
      if (selected) { setProject(selected); setSearch('') }
      else setError(useChatStore.getState().error || t('unknownError'))
    } catch (cause) { setError(String(cause)) }
    finally { setSwitching(false) }
  }
  const addProject = () => {
    void chat.choose({ createThreadAfter: false, selectThreadAfter: false }).then((root) => {
      if (root) { setProject(root); setSearch('') }
      else setError(useChatStore.getState().error || '')
    }).catch((cause) => setError(String(cause)))
  }
  const threads = chat.threads.filter((thread) =>
    (!thread.agentSurface || thread.agentSurface === 'code')
    && workspaceRootIdentityKey(thread.workspace) === workspaceRootIdentityKey(project ?? '')
    && (!search.trim() || `${thread.title} ${thread.summary || thread.preview || ''}`.toLowerCase().includes(search.trim().toLowerCase())))
  const loading = switching || chat.status === 'loading' || chat.status === 'refreshing'
  if (project) return <MobileHome
    labels={{ title: projectName(project), workspace: t('mobileCodeProjects'), search: t('search'),
      newConversation: t('newChat'), settings: t('settings'), more: t('more'), loadMore: t('loadMore'),
      retry: t('retry'), empty: t('noSessions'), loading: t('loading'), back: t('back') }}
    threads={threads} search={search} loading={loading} error={error || chat.error || null}
    hasMore={chat.cursors[workspaceRootIdentityKey(project)]?.hasMore === true}
    onSearch={setSearch} onThreadMenu={null} onWorkspace={() => { setProject(null); setSearch('') }}
    onOpenThread={(id) => { void chat.selectThread(id).then(() => onOpen(id)).catch((cause) => setError(String(cause))) }}
    onSettings={chat.settings} onLoadMore={() => { void chat.more(project) }}
    onRetry={() => { void chat.refresh() }} onNewConversation={() => {
      void (async () => {
        setSwitching(true)
        try {
          if (workspaceRootIdentityKey(useChatStore.getState().workspaceRoot) !== workspaceRootIdentityKey(project)
            && !await chat.select(project)) return
          await chat.create()
          const id = useChatStore.getState().activeThreadId
          if (id) onOpen(id)
        } catch (cause) { setError(String(cause)) }
        finally { setSwitching(false) }
      })()
    }} />
  return <section className="kun-mobile-projects" aria-label={t('mobileCodeProjects')}>
    <header>
      <h1>{t('mobileCodeProjects')}</h1>
      <div>
        <button type="button" className="kun-mobile-project-icon" aria-label={t('selectWorkspace')}
          disabled={switching} onClick={addProject}><Plus size={22} aria-hidden /></button>
        <button type="button" className="kun-mobile-project-icon" aria-label={t('settings')}
          onClick={() => chat.settings()}><Settings size={20} aria-hidden /></button>
      </div>
    </header>
    <label className="kun-mobile-project-search"><Search size={18} aria-hidden />
      <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
        placeholder={t('search')} aria-label={t('search')} />
    </label>
    <div className="kun-mobile-project-list" aria-busy={switching}>
      {error ? <p role="alert">{error}</p> : null}
      {visible.map((root) => {
        const label = projectName(root)
        const context = projectContext(root, label)
        return <button type="button" className="kun-mobile-project-row" key={root} disabled={switching}
          title={root} onClick={() => { void enter(root) }}>
          <Folder size={20} aria-hidden />
          <span><strong>{label}</strong>{context ? <small>{context}</small> : null}</span>
          <ChevronRight size={18} aria-hidden />
        </button>
      })}
      {!visible.length ? <div className="kun-mobile-project-empty">
        <p>{projects.length ? t('composerWorkspaceNoMatch') : t('mobileCodeChooseProject')}</p>
        {!projects.length ? <button type="button" className="kun-mobile-project-add" disabled={switching}
          onClick={addProject}><Plus size={18} aria-hidden />{t('selectWorkspace')}</button> : null}
      </div> : null}
    </div>
  </section>
}

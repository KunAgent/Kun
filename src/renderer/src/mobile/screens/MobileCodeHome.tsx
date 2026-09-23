import { useMemo, useState } from 'react'
import { ChevronRight, Folder, Plus, Search, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useChatStore } from '../../store/chat-store'
import { normalizeWorkspaceRoot, workspaceRootIdentityKey } from '../../lib/workspace-path'
import { removedWorkspaceIdentityKeys } from '../../lib/removed-code-workspaces'
import { useThreadClassificationRegistries } from '../../lib/thread-classification-registries'
import { selectCodeProjectRoots } from '../../components/chat/sidebar-project-selectors'
import { MobileHome } from './MobileHome'
import { useMobileProjectThreads } from './use-mobile-project-threads'
import { MobileCodeSettings } from '../chat/MobileCodeSettings'
import './mobile-projects.css'

function projectName(root: string): string {
  return root.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) || root
}

function projectContext(root: string, label: string): string {
  const parts = root.replace(/\\/g, '/').split('/').filter(Boolean)
  const parent = parts.length >= 2 ? parts[parts.length - 2] ?? '' : ''
  return parent && parent.toLowerCase() !== label.toLowerCase() ? parent : ''
}

function MobileProjectHome({ project, onBack, onOpen, onOpenSettings }: {
  project: string
  onBack: () => void
  onOpen: (threadId: string) => void
  onOpenSettings: () => void
}) {
  const { t } = useTranslation('common')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const chat = useChatStore(useShallow((s) => ({
    status: s.threadListStatus, error: s.threadListError,
    selectThread: s.selectThread, createThread: s.createThread
  })))
  const list = useMobileProjectThreads(project, search)
  const loading = busy || chat.status === 'loading' || chat.status === 'refreshing' || list.loading
  return <MobileHome
    labels={{ title: projectName(project), workspace: t('mobileCodeProjects'),
      search: t('mobileSearch'),
      newConversation: t('newChat'), settings: t('settings'), more: t('mobileMore'),
      loadMore: t('sidebarWorkspaceLoadMore'),
      retry: t('mobileRetry'), empty: t('sidebarEmptyTitle'), loading: t('loading'),
      back: t('back') }}
    threads={list.threads} search={search} loading={loading}
    error={error || chat.error || (list.loadFailed ? t('mobileThreadsLoadFailed') : null)}
    hasMore={list.hasMore}
    onSearch={setSearch} onThreadMenu={null} onWorkspace={onBack}
    onOpenThread={(id) => { void chat.selectThread(id).then(() => onOpen(id)).catch((cause) => setError(String(cause))) }}
    onSettings={onOpenSettings} onLoadMore={list.loadMore}
    onRetry={list.reload} onNewConversation={() => {
      void (async () => {
        setBusy(true)
        setError('')
        try {
          const id = await chat.createThread({
            workspaceRoot: project,
            forceNew: true,
            agentSurface: 'code'
          })
          if (id) onOpen(id)
          else setError(useChatStore.getState().error || t('appErrorTitle'))
        } catch (cause) { setError(String(cause)) }
        finally { setBusy(false) }
      })()
    }} />
}

export function MobileCodeHome({ onOpen }: { onOpen: (threadId: string) => void }) {
  const { t } = useTranslation('common')
  const [project, setProject] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const chat = useChatStore(useShallow((s) => ({
    roots: s.codeWorkspaceRoots, root: s.workspaceRoot, threads: s.threads,
    conversationRoot: s.conversationWorkspaceRoot, removed: s.removedCodeWorkspaces,
    clawChannels: s.clawChannels,
    select: s.selectWorkspaceRoot, choose: s.chooseWorkspace
  })))
  // Registries live in profile storage; re-check them when the thread
  // inventory changes so a fresh worktree thread joins its project promptly.
  // The shared reader keeps the parsed values identity-stable while the
  // stored strings are unchanged, so list churn skips the recompute below.
  const classification = useThreadClassificationRegistries(chat.threads)
  // Project roots only depend on a thread's id/workspace/surface/archive
  // flag — status or title churn must not re-run project classification.
  const projectSignature = useMemo(() => chat.threads.map((thread) =>
    [thread.id, thread.workspace, thread.agentSurface ?? '', thread.archived ? '1' : '0']
      .join(' ')
  ).join(' '), [chat.threads])
  const projects = useMemo(() => selectCodeProjectRoots({
    threads: useChatStore.getState().threads,
    workspaceRoot: chat.root,
    workspaceRoots: chat.roots,
    conversationRoot: chat.conversationRoot,
    threadWorktrees: classification.threadWorktrees,
    removedProjectKeys: removedWorkspaceIdentityKeys(chat.removed),
    clawChannels: chat.clawChannels,
    writeRegistry: classification.writeRegistry,
    designRegistry: classification.designRegistry,
    sddRegistry: classification.sddRegistry
    // chat.threads is read through the signature above — a plain dep would
    // re-classify on every unrelated thread field update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [chat.clawChannels, chat.conversationRoot, chat.removed, chat.root, chat.roots, classification, projectSignature])
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
      // persist: false — browsing a project on Remote must not rewrite the
      // desktop host's current workspaceRoot setting.
      const selected = await chat.select(root, { persist: false })
      if (selected) { setProject(selected); setSearch('') }
      else setError(useChatStore.getState().error || t('appErrorTitle'))
    } catch (cause) { setError(String(cause)) }
    finally { setSwitching(false) }
  }
  const addProject = () => {
    void chat.choose({ createThreadAfter: false, selectThreadAfter: false, persist: false }).then((root) => {
      if (root) { setProject(normalizeWorkspaceRoot(root) || root); setSearch('') }
      else setError(useChatStore.getState().error || '')
    }).catch((cause) => setError(String(cause)))
  }
  if (project) {
    return <>
      <MobileProjectHome project={project} onBack={() => { setProject(null); setSearch(''); setError('') }}
        onOpen={onOpen} onOpenSettings={() => setSettingsOpen(true)} />
      <MobileCodeSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  }
  return <section className="kun-mobile-projects" aria-label={t('mobileCodeProjects')}>
    <header>
      <h1>{t('mobileCodeProjects')}</h1>
      <div>
        <button type="button" className="kun-mobile-project-icon" aria-label={t('selectWorkspace')}
          disabled={switching} onClick={addProject}><Plus size={22} aria-hidden /></button>
        <button type="button" className="kun-mobile-project-icon" aria-label={t('settings')}
          onClick={() => setSettingsOpen(true)}><Settings size={20} aria-hidden /></button>
      </div>
    </header>
    <label className="kun-mobile-project-search"><Search size={18} aria-hidden />
      <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
        placeholder={t('mobileSearch')} aria-label={t('mobileSearch')} />
    </label>
    <div className="kun-mobile-project-list" aria-busy={switching}>
      {error ? <p role="alert">{error}</p> : null}
      {visible.map((root) => {
        const label = projectName(root)
        const context = projectContext(root, label)
        return <button type="button" className="kun-mobile-project-row" key={workspaceRootIdentityKey(root) || root} disabled={switching}
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
    <MobileCodeSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
  </section>
}

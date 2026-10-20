import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpDown, LayoutGrid, List, Loader2, RefreshCw, Search, X } from 'lucide-react'
import { SidebarTitlebarToggleButton } from '../components/sidebar/SidebarPrimitives'
import { useChatStore } from '../store/chat-store'
import { closeArtifactsPage, useArtifactLibraryStore } from './artifact-library-store'
import { NEW_ARTIFACT_KINDS, sourceThreadFor, startNewArtifact } from './artifact-actions'
import { LIBRARY_ARTIFACT_KIND_STYLE, LIBRARY_ARTIFACT_KINDS, type LibraryArtifact, type LibraryArtifactKind } from './artifact-types'
import {
  ARTIFACT_KIND_LABEL_KEYS,
  countByKind,
  filterArtifacts,
  projectOptions,
  type ArtifactKindFilter,
  type ArtifactSort
} from './artifact-view-model'
import { ARTIFACT_KIND_ICONS, ArtifactCard, ArtifactListRow } from './ArtifactCard'
import { ArtifactViewer } from './ArtifactViewer'

const RESCAN_THROTTLE_MS = 4_000

const NEW_HINT_KEYS: Record<LibraryArtifactKind, string> = {
  design: 'artifactsNewDesignHint', doc: 'artifactsNewDocHint', slides: 'artifactsNewSlidesHint',
  board: 'artifactsNewBoardHint', sheet: 'artifactsNewDocHint', image: 'artifactsNewDesignHint'
}
const NEW_PROMPT_KEYS: Record<LibraryArtifactKind, string> = {
  design: 'artifactsNewDesignPrompt', doc: 'artifactsNewDocPrompt', slides: 'artifactsNewSlidesPrompt',
  board: 'artifactsNewBoardPrompt', sheet: 'artifactsNewDocPrompt', image: 'artifactsNewDesignPrompt'
}

export function ArtifactsPage({ leftSidebarCollapsed, onToggleLeftSidebar }: {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const items = useArtifactLibraryStore((state) => state.items)
  const status = useArtifactLibraryStore((state) => state.status)
  const openId = useArtifactLibraryStore((state) => state.openId)
  const refresh = useArtifactLibraryStore((state) => state.refresh)
  const openArtifact = useArtifactLibraryStore((state) => state.openArtifact)
  const threads = useChatStore((state) => state.threads)
  const [kind, setKind] = useState<ArtifactKindFilter>('all')
  const [project, setProject] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ArtifactSort>('recent')
  const [view, setView] = useState<'grid' | 'list'>('grid')

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    // Turns keep producing files while the library is open; rescan when one
    // finishes and when the window comes back, at most every few seconds.
    let last = Date.now()
    const rescan = (): void => {
      if (Date.now() - last < RESCAN_THROTTLE_MS) return
      last = Date.now()
      void refresh()
    }
    const unsubscribe = useChatStore.subscribe((state, previous) => {
      if (previous.busy && !state.busy) rescan()
    })
    window.addEventListener('focus', rescan)
    return () => {
      unsubscribe()
      window.removeEventListener('focus', rescan)
    }
  }, [refresh])

  const projects = useMemo(() => projectOptions(items), [items])
  const scoped = useMemo(() => filterArtifacts(items, { kind: 'all', project, query: '', sort }), [items, project, sort])
  const counts = useMemo(() => countByKind(scoped), [scoped])
  const visible = useMemo(() => filterArtifacts(items, { kind, project, query, sort }), [items, kind, project, query, sort])
  const sourceTitle = (artifact: LibraryArtifact): string | undefined => sourceThreadFor(artifact, threads)?.title
  const open = (artifact: LibraryArtifact): void => openArtifact(artifact.id)
  const openItem = openId ? items.find((item) => item.id === openId) ?? null : null

  if (openItem) {
    return <ArtifactViewer artifact={openItem} leftSidebarCollapsed={leftSidebarCollapsed} onToggleLeftSidebar={onToggleLeftSidebar} />
  }

  const tabs: ArtifactKindFilter[] = ['all', ...LIBRARY_ARTIFACT_KINDS]
  const empty = status === 'ready' && items.length === 0
  return (
    <div className="ds-drag flex h-full min-h-0 flex-col bg-ds-main" data-artifacts-page>
      <div className="ds-stage-inset shrink-0">
        <header className="ds-topbar-surface relative z-10 mt-3 flex min-h-[46px] w-full items-center justify-between gap-3 rounded-[24px] px-3">
          <div className={`flex min-w-0 items-center gap-2 ${leftSidebarCollapsed ? 'ds-window-controls-collapsed-titlebar-inset' : ''}`}>
            <SidebarTitlebarToggleButton
              onClick={onToggleLeftSidebar}
              title={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
              ariaLabel={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
            />
            <h1 className="truncate text-[15px] font-semibold text-ds-ink">{t('artifactsTitle')}</h1>
          </div>
          <div className="ds-no-drag flex items-center gap-1">
            <button type="button" onClick={() => void refresh()} aria-label={t('artifactsRefresh')} title={t('artifactsRefresh')}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ds-muted hover:bg-ds-hover hover:text-ds-ink">
              <RefreshCw className={`h-4 w-4 ${status === 'loading' ? 'animate-spin' : ''}`} aria-hidden />
            </button>
            <button type="button" onClick={closeArtifactsPage} aria-label={t('artifactsClose')} title={t('artifactsClose')}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ds-muted hover:bg-ds-hover hover:text-ds-ink">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </header>
      </div>
      <div className="ds-no-drag min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-7 px-6 pb-14 pt-8 sm:px-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1.5">
              <h2 className="text-[28px] font-bold leading-tight text-ds-ink">{t('artifactsTitle')}</h2>
              <p className="text-[14px] text-ds-muted">{t('artifactsSubtitle')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex h-9 w-[220px] items-center gap-2 rounded-xl border border-ds-border bg-ds-card px-3">
                <Search className="h-4 w-4 shrink-0 text-ds-muted" aria-hidden />
                <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t('artifactsSearch')}
                  placeholder={t('artifactsSearch')} className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ds-ink outline-none placeholder:text-ds-faint" />
              </label>
              <select value={project} onChange={(event) => setProject(event.target.value)} aria-label={t('artifactsAllProjects')}
                className="h-9 rounded-xl border border-ds-border bg-ds-card px-3 text-[13.5px] text-ds-ink">
                <option value="">{t('artifactsAllProjects')}</option>
                {projects.map((option) => <option key={option.root} value={option.root}>{option.name}</option>)}
              </select>
              <button type="button" onClick={() => setSort(sort === 'recent' ? 'name' : 'recent')}
                className="flex h-9 items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 text-[13.5px] text-ds-ink hover:bg-ds-hover">
                <ArrowUpDown className="h-4 w-4 text-ds-muted" aria-hidden />
                {t(sort === 'recent' ? 'artifactsSortRecent' : 'artifactsSortName')}
              </button>
              <div role="group" aria-label={t('artifactsViewMode')} className="flex h-9 overflow-hidden rounded-xl border border-ds-border">
                <button type="button" aria-pressed={view === 'grid'} aria-label={t('artifactsGridView')} onClick={() => setView('grid')}
                  className={`flex w-10 items-center justify-center ${view === 'grid' ? 'bg-ds-hover text-ds-ink' : 'bg-ds-card text-ds-muted'}`}>
                  <LayoutGrid className="h-4 w-4" aria-hidden />
                </button>
                <button type="button" aria-pressed={view === 'list'} aria-label={t('artifactsListView')} onClick={() => setView('list')}
                  className={`flex w-10 items-center justify-center ${view === 'list' ? 'bg-ds-hover text-ds-ink' : 'bg-ds-card text-ds-muted'}`}>
                  <List className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
          </div>

          <section aria-label={t('artifactsNew')} className="flex flex-col gap-3">
            <span className="text-[13px] font-semibold text-ds-muted">{t('artifactsNew')}</span>
            <div className="grid max-w-[780px] grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">
              {NEW_ARTIFACT_KINDS.map((newKind) => {
                const Icon = ARTIFACT_KIND_ICONS[newKind]
                return (
                  <button key={newKind} type="button" data-artifact-new={newKind} onClick={() => startNewArtifact(t(NEW_PROMPT_KEYS[newKind]))}
                    className="flex items-center gap-3 rounded-2xl border border-ds-border bg-ds-card p-3 text-left transition hover:border-ds-border-strong">
                    <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${LIBRARY_ARTIFACT_KIND_STYLE[newKind].tile}`}>
                      <Icon className="h-[18px] w-[18px]" aria-hidden />
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-[14px] font-semibold text-ds-ink">{t(ARTIFACT_KIND_LABEL_KEYS[newKind])}</span>
                      <span className="truncate text-[12px] text-ds-muted">{t(NEW_HINT_KEYS[newKind])}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          <div role="tablist" aria-label={t('artifactsKinds')} className="flex flex-wrap gap-1.5 border-b border-ds-border pb-3">
            {tabs.map((tab) => (
              <button key={tab} type="button" role="tab" aria-selected={kind === tab} onClick={() => setKind(tab)}
                className={`h-8 rounded-full border px-3.5 text-[13.5px] ${kind === tab ? 'border-accent bg-ds-card font-semibold text-ds-ink' : 'border-transparent text-ds-muted hover:text-ds-ink'}`}>
                {tab === 'all' ? t('artifactsAll') : t(ARTIFACT_KIND_LABEL_KEYS[tab])}
                <span className="ml-1.5 text-[12px] text-ds-faint">{counts[tab]}</span>
              </button>
            ))}
          </div>

          {status === 'loading' && items.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-24 text-[13.5px] text-ds-muted">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />{t('artifactsLoading')}
            </div>
          ) : status === 'error' ? (
            <p className="py-24 text-center text-[13.5px] text-ds-muted">{t('artifactsError')}</p>
          ) : empty ? (
            <div className="flex flex-col items-center gap-3 py-20 text-center" data-artifacts-empty>
              <h3 className="text-[20px] font-bold text-ds-ink">{t('artifactsEmptyTitle')}</h3>
              <p className="max-w-[520px] text-[14px] leading-relaxed text-ds-muted">{t('artifactsEmptyBody')}</p>
            </div>
          ) : visible.length === 0 ? (
            <p className="py-20 text-center text-[13.5px] text-ds-muted">{t('artifactsEmptyFiltered')}</p>
          ) : view === 'grid' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6">
              {visible.map((artifact) => (
                <ArtifactCard key={artifact.id} artifact={artifact} sourceTitle={sourceTitle(artifact)} onOpen={open} />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-ds-border bg-ds-card">
              <table className="w-full min-w-[820px] border-collapse">
                <thead>
                  <tr className="text-left text-[12.5px] text-ds-muted">
                    <th scope="col" className="px-4 py-3 font-semibold">{t('artifactsColumnName')}</th>
                    <th scope="col" className="px-4 py-3 font-semibold">{t('artifactsColumnType')}</th>
                    <th scope="col" className="px-4 py-3 font-semibold">{t('artifactsFieldProject')}</th>
                    <th scope="col" className="px-4 py-3 font-semibold">{t('artifactsFieldSource')}</th>
                    <th scope="col" className="px-4 py-3 font-semibold">{t('artifactsFieldSize')}</th>
                    <th scope="col" className="px-4 py-3 font-semibold">{t('artifactsFieldUpdated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((artifact) => (
                    <ArtifactListRow key={artifact.id} artifact={artifact} sourceTitle={sourceTitle(artifact)} onOpen={open} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

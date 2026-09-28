import { useEffect, useState } from 'react'
import type { WorkspaceEntry } from '@shared/workspace-file'
import { useTranslation } from 'react-i18next'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { MobileSheet } from '../sheets/MobileSheet'
import { MobileWorkHome, type MobileWorkResource } from './MobileWorkHome'
import { mobileWorkResources, resolveMobileWorkEntry } from './mobile-work-resources'
import { searchMobileWorkEntries } from './mobile-work-search'
import { writeDirnameFromPath } from '../../write/write-workspace-store-helpers'
import { workFileResourceKey, workWhiteboardResourceKey } from './work-resource-key'
import { setMobileDocumentsWorkspaceRoot } from './mobile-documents-workspace'
import { rememberMobileWorkRoute } from './mobile-work-resource-route'
import type { MobilePage } from '../navigation/mobile-page'

type Props = {
  page: Extract<MobilePage, { mode: 'work'; kind: 'folder' }> | Extract<MobilePage, { kind: 'home' }>
  navigate: (page: MobilePage) => void
  onPapers: () => void
  canLeave: () => Promise<boolean>
}

export function MobileDocumentsHome({ page, navigate, onPapers, canLeave }: Props) {
  const { t } = useTranslation('common')
  const work = useWriteWorkspaceStore()
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<{ query: string; entries: WorkspaceEntry[];
    truncated: boolean; skipped: number } | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searchRetry, setSearchRetry] = useState(0)
  const [limit, setLimit] = useState(60)
  const [sheet, setSheet] = useState<'workspace' | 'create' | 'menu' | null>(null)
  const [selected, setSelected] = useState<MobileWorkResource | null>(null)
  const [kind, setKind] = useState<'document' | 'directory' | 'whiteboard'>('document')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const folder = page.kind === 'folder' ? resolveMobileWorkEntry(work, page.folderKey) : undefined
  const directory = folder?.type === 'directory' ? folder.path : work.rootDirectory
  const query = search.trim()
  const matchingSearch = searchResults?.query === query ? searchResults : null
  const searchState = query ? { ...work, entriesByDir: { [work.rootDirectory]: matchingSearch?.entries ?? [] } } : work
  const { resources, recent } = mobileWorkResources(searchState, query ? work.rootDirectory : directory, search)
  useEffect(() => {
    if (!query || !work.workspaceRoot) { setSearchResults(null); setSearchLoading(false); return }
    let canceled = false
    setSearchLoading(true); setSearchError('')
    const timer = window.setTimeout(() => {
      void searchMobileWorkEntries(work.workspaceRoot, query,
        (path) => window.kunGui.listWorkspaceDirectory({ workspaceRoot: work.workspaceRoot, path }),
        () => canceled
      ).then((result) => { if (!canceled) setSearchResults({ query, ...result }) })
        .catch((cause: unknown) => { if (!canceled) setSearchError(String(cause)) })
        .finally(() => { if (!canceled) setSearchLoading(false) })
    }, 250)
    return () => { canceled = true; window.clearTimeout(timer) }
  }, [query, work.workspaceRoot, searchRetry])
  useEffect(() => setLimit(60), [directory, search])
  const { entriesByDir, loadingDirs, treeError, loadDirectory, workspaceRoot } = work
  useEffect(() => {
    if (folder?.type === 'directory' && !entriesByDir[folder.path] &&
      !loadingDirs[folder.path] && !treeError) {
      void loadDirectory(workspaceRoot, folder.path)
    }
  }, [folder?.path, folder?.type, entriesByDir, loadingDirs, treeError, loadDirectory, workspaceRoot])

  const closeSheet = (): void => { setSheet(null); setSelected(null); setError(''); setName('') }
  const chooseWorkspace = async (root: string): Promise<void> => {
    if (working || !await canLeave()) return
    setWorking(true); setError('')
    try {
      await work.initializeWorkspace(root)
      const current = useWriteWorkspaceStore.getState()
      if (current.workspaceRoot !== root || !current.rootDirectory) {
        throw new Error(current.treeError ?? t('mobileWorkDocWorkspaceOpenFailed'))
      }
      setMobileDocumentsWorkspaceRoot(root, current.workspaceRoots)
      closeSheet(); navigate({ mode: 'work', kind: 'home' })
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setWorking(false) }
  }
  const getEntry = (key: string): WorkspaceEntry | undefined => resolveMobileWorkEntry(work, key)
    ?? matchingSearch?.entries.find((entry) => workFileResourceKey(work.workspaceRoot, entry.path) === key)
  const openResource = async (resource: MobileWorkResource): Promise<void> => {
    const entry = getEntry(resource.key)
    try {
      if (entry && !resolveMobileWorkEntry(work, resource.key)) {
        await work.loadDirectory(work.workspaceRoot, writeDirnameFromPath(entry.path))
        if (!resolveMobileWorkEntry(useWriteWorkspaceStore.getState(), resource.key)) {
          throw new Error(t('mobileWorkDocResourceLoadFailed'))
        }
      }
      if (resource.kind === 'directory' && entry) {
        navigate({ mode: 'work', kind: 'folder', folderKey: resource.key })
        return
      }
      const board = Object.values(work.whiteboards).find((item) => workWhiteboardResourceKey(item.id) === resource.key)
      if (board) work.openWhiteboard(board.id)
      else if (entry?.type === 'file') {
        await work.openFile(work.workspaceRoot, entry.path)
        if (!useWriteWorkspaceStore.getState().documentsByPath[entry.path]) {
          throw new Error(useWriteWorkspaceStore.getState().fileError ?? t('mobileWorkDocOpenFailed'))
        }
      } else return
      if (board) rememberMobileWorkRoute({ key: resource.key, root: work.workspaceRoot,
        path: board.id, kind: 'whiteboard' })
      else if (entry) rememberMobileWorkRoute({ key: resource.key, root: work.workspaceRoot,
        path: entry.path, kind: 'document' })
      navigate({ mode: 'work', kind: 'resource', resourceKey: resource.key,
        view: board ? 'whiteboard' : 'read' })
    } catch (cause) {
      setSelected(resource); setName(resource.title)
      setError(cause instanceof Error ? cause.message : String(cause)); setSheet('menu')
    }
  }
  const create = async (): Promise<void> => {
    if (!work.workspaceRoot || !name.trim() || working) return
    setWorking(true); setError('')
    const target = [directory, name.trim()].filter(Boolean).join('/')
    try {
      if (kind === 'whiteboard') {
        const board = await work.createWhiteboard(work.workspaceRoot, { title: name.trim() })
        if (!board) throw new Error(t('mobileWorkDocBoardCreateFailed'))
        closeSheet()
        work.openWhiteboard(board.id)
        rememberMobileWorkRoute({ key: workWhiteboardResourceKey(board.id), root: work.workspaceRoot,
          path: board.id, kind: 'whiteboard' })
        navigate({ mode: 'work', kind: 'resource', resourceKey: workWhiteboardResourceKey(board.id), view: 'whiteboard' })
      } else if (kind === 'directory') {
        const created = await work.createDirectory(work.workspaceRoot, target)
        if (!created) throw new Error(useWriteWorkspaceStore.getState().fileError ?? t('mobileWorkDocFolderCreateFailed'))
        closeSheet()
        await work.loadDirectory(work.workspaceRoot, directory)
      } else {
        const created = await work.createFile(work.workspaceRoot, target)
        if (!created) throw new Error(useWriteWorkspaceStore.getState().fileError ?? t('mobileWorkDocCreateFailed'))
        await work.loadDirectory(work.workspaceRoot, directory)
        closeSheet()
        rememberMobileWorkRoute({ key: workFileResourceKey(work.workspaceRoot, created), root: work.workspaceRoot,
          path: created, kind: 'document' })
        navigate({ mode: 'work', kind: 'resource', resourceKey: workFileResourceKey(work.workspaceRoot, created), view: 'edit' })
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setWorking(false) }
  }
  const actOnSelected = async (action: 'rename' | 'delete' | 'download'): Promise<void> => {
    if (!selected || working) return
    if (action === 'delete' && !await canLeave()) return
    const entry = getEntry(selected.key)
    const board = Object.values(work.whiteboards).find((item) => workWhiteboardResourceKey(item.id) === selected.key)
    setWorking(true); setError('')
    try {
      if (action === 'download') {
        if (entry?.type !== 'file') throw new Error(t('mobileWorkDocCannotDownload'))
        const result = await window.kunGui.saveWorkspaceFileAs({ workspaceRoot: work.workspaceRoot,
          sourcePath: entry.path, suggestedName: entry.name })
        if (!result.ok) throw new Error(result.message)
      } else if (action === 'rename') {
        if (!name.trim()) throw new Error(t('mobileWorkDocNameRequired'))
        const ok = board ? await work.renameWhiteboard(board.id, name.trim())
          : entry ? await work.renameEntry(work.workspaceRoot, entry.path, name.trim()) : null
        if (!ok) throw new Error(useWriteWorkspaceStore.getState().fileError ?? t('mobileWorkDocRenameFailed'))
      } else {
        const ok = board ? await work.deleteWhiteboard(board.id)
          : entry ? await work.deleteEntry(work.workspaceRoot, entry.path) : false
        if (!ok) throw new Error(useWriteWorkspaceStore.getState().fileError ?? t('mobileWorkDocDeleteFailed'))
      }
      if (query) setSearchRetry((value) => value + 1)
      closeSheet()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setWorking(false) }
  }

  return <><MobileWorkHome workspaceLabel={directory && directory !== work.rootDirectory
      ? `${work.workspaceRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? ''} / ${folder?.name ?? ''}`
      : work.workspaceRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? t('writeWorkspace')}
    resources={resources.slice(0, limit)} recent={recent} hasMore={resources.length > limit}
    onLoadMore={() => setLimit((value) => value + 60)} search={search} onSearch={setSearch}
    loading={work.settingsLoading || Boolean(work.loadingDirs[directory]) || searchLoading}
    error={work.settingsError ?? work.treeError ?? searchError ?? ''}
    labels={{ title: t('workspaceModeWorkLabel'), search: t('mobileSearch'), create: t('mobileWorkDocCreate'),
      more: t('mobileMore'), empty: t('writeEmptyTitle'), loading: t('loading'), retry: t('mobileRetry'),
      documents: t('mobileWorkDocDocuments'), papers: t('mobileWorkDocPapers'),
      backFolder: t('mobileWorkDocBackFolder'), recent: t('mobileWorkDocRecent'),
      filesBoards: t('mobileWorkDocFilesBoards'), loadMore: t('mobileWorkDocLoadMore'),
      status: { saved: t('mobileWorkDocSaved'), dirty: t('mobileWorkDocDirty'),
        saving: t('mobileWorkDocSaving'), error: t('mobileWorkDocError'), review: t('mobileWorkDocReview') } }}
    mode="documents" onMode={(mode) => { if (mode === 'papers') void canLeave().then((ok) => { if (ok) onPapers() }) }}
    onBackFolder={page.kind === 'folder' ? () => navigate({ mode: 'work', kind: 'home' }) : undefined}
    onWorkspace={() => setSheet('workspace')} onCreate={() => setSheet('create')}
    onOpen={openResource}
    onMenu={(resource) => { setSelected(resource); setName(resource.title); setSheet('menu') }}
    onRetry={() => { if (query) setSearchRetry((value) => value + 1)
      else void work.initializeWorkspace(work.workspaceRoot, { force: true }) }} />
    {matchingSearch?.truncated ? <p role="status">{t('mobileWorkDocTruncated')}</p> : null}
    {matchingSearch?.skipped ? <p role="status">{t('mobileWorkDocSkipped', { count: matchingSearch.skipped })}</p> : null}
    <MobileSheet open={sheet === 'workspace'} title={t('mobileWorkDocChooseWorkspace')} closeLabel={t('close')} onClose={() => { if (!working) closeSheet() }}>
      <p>{t('mobileWorkDocWorkspaceHint')}</p>
      {work.workspaceRoots.map((root) => <button className="kun-mobile-work-sheet-button" type="button" key={root}
        disabled={working} onClick={() => void chooseWorkspace(root)}>
        {root}</button>)}
      {error ? <p role="alert">{error}</p> : null}
    </MobileSheet>
    <MobileSheet open={sheet === 'create'} title={t('mobileWorkDocCreateResource')} closeLabel={t('close')} onClose={closeSheet}>
      <label>{t('mobileWorkDocType')} <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
        <option value="document">{t('mobileWorkDocDocument')}</option><option value="directory">{t('mobileWorkDocFolder')}</option><option value="whiteboard">{t('mobileWorkDocWhiteboard')}</option>
      </select></label>
      <label>{t('mobileWorkDocName')} <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('mobileWorkDocNameExample')} /></label>
      {error ? <p role="alert">{error}</p> : null}
      <button className="kun-mobile-work-sheet-button" type="button" disabled={working || !name.trim()}
        onClick={() => void create()}>{t('mobileWorkDocCreateOpen')}</button>
    </MobileSheet>
    <MobileSheet open={sheet === 'menu'} title={selected?.title ?? ''} closeLabel={t('close')} onClose={closeSheet}>
      {selected?.kind === 'document' ? <button className="kun-mobile-work-sheet-button" type="button"
        onClick={() => void actOnSelected('download')}>{t('mobileWorkDocDownloadPhone')}</button> : null}
      <label>{t('mobileWorkDocNewName')} <input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <button className="kun-mobile-work-sheet-button" type="button" disabled={working || !name.trim()}
        onClick={() => void actOnSelected('rename')}>{t('mobileWorkDocRename')}</button>
      <button className="kun-mobile-work-sheet-button" type="button" disabled={working}
        onClick={() => { if (window.confirm(t('mobileWorkDocDeleteConfirm', { name: selected?.title ?? '' }))) void actOnSelected('delete') }}>{t('mobileWorkDocDelete')}</button>
      {error ? <p role="alert">{error}</p> : null}
    </MobileSheet>
  </>
}

/** Offline preload fixture around production components, actions, stores and layout persistence.
 * Does not replace the backend disk/IPC suites or constitute a full-app smoke. */
import { useEffect, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { normalizeAppSettings, mergeWriteSettings } from '../../src/shared/app-settings'
import { PaperLibraryView } from '../../src/renderer/src/components/paper/PaperLibraryView'
import { PaperLibraryOnboarding } from '../../src/renderer/src/components/paper/PaperLibraryOnboarding'
import { PaperWorkspacesSection } from '../../src/renderer/src/components/paper/sidebar/PaperWorkspacesSection'
import { PaperSidebarNav } from '../../src/renderer/src/components/paper/sidebar/PaperSidebarNav'
import { PaperModeToggle } from '../../src/renderer/src/components/paper/PaperModeToggle'
import { PaperWorkspaceFixtureResearch } from './paper-workspace-assistant'
import { useChatStore } from '../../src/renderer/src/store/chat-store'
import { PaperNoticeToast } from '../../src/renderer/src/components/paper/PaperNoticeToast'
import { useWriteWorkspaceStore } from '../../src/renderer/src/write/write-workspace-store'
import { markWriteThread, readWriteThreadRegistry, saveWriteThreadRegistry, writeThreadIdsForFile } from '../../src/renderer/src/write/write-thread-registry'
import { activePaperViewId } from '../../src/renderer/src/write/write-editor-layout'
import { usePaperModeStore } from '../../src/renderer/src/paper/paper-mode-store'
import { usePaperWorkspaceBootstrapStore } from '../../src/renderer/src/paper/paper-workspace-bootstrap'
import { enterPaperMode, exitPaperMode, switchPaperLibrary } from '../../src/renderer/src/paper/paper-mode-actions'
import i18n from '../../src/renderer/src/i18n'
import '../../src/renderer/src/index.css'
import '../../src/renderer/src/styles/base-shell.css'

const DOCS = '/fixture/Documents'
const DEFAULT = '/fixture/Kun/Papers'
const CUSTOM = '/fixture/Research/Long-running collaboration/Literature and evaluation experiments/Library'
const KEY = 'paper-workspace-offline-settings'
let settings = normalizeAppSettings(JSON.parse(localStorage.getItem(KEY) || 'null') || {
  write: { defaultWorkspaceRoot: DOCS, activeWorkspaceRoot: DOCS, workspaces: [DOCS],
    paperMode: { enabled: false, libraries: [], activeLibrary: '', workspaceInitialized: false } }
})
const calls = { ensure: 0, picker: 0, settings: 0, runtime: 0, writes: [] as string[] }
let picker = { canceled: true, path: undefined as string | undefined }
let pickerDelay = 0
let ensureFailure: string | null = null
const faults: Record<string, string> = {}
const documents: Record<string, string> = {
  [DOCS + '/notes.md']: '# Documents stay here\nThis note must not become a paper tab.',
  [DEFAULT + '/papers/shared/NOTES.md']: '# Default library note',
  [CUSTOM + '/papers/shared/NOTES.md']: '# Custom library note'
}
const counts = { total: 0, unread: 0, reading: 0, read: 0, missingPdf: 0 }
const persist = () => localStorage.setItem(KEY, JSON.stringify(settings))
const clone = <T,>(value: T): T => structuredClone(value)
const failed = (root: string) => ({ ok: false as const, message: faults[root] || 'Permission denied (offline fixture)', code: 'permission-denied' })

Object.assign(window, { kunGui: {
  platform: 'fixture',
  getSettings: async () => clone(settings),
  setSettings: async (patch: { write?: Parameters<typeof mergeWriteSettings>[1] }) => {
    calls.settings++
    if (patch.write) settings = { ...settings, write: mergeWriteSettings(settings.write, patch.write) }
    persist()
    return clone(settings)
  },
  paperWorkspaceEnsure: async () => {
    calls.ensure++
    if (ensureFailure) return { ok: false, code: ensureFailure, message: ensureFailure === 'missing-root'
      ? 'Paper workspace is missing. Choose an existing folder.' : 'Permission denied. Choose a writable folder.', defaultWorkspaceRoot: DEFAULT }
    const mode = settings.write.paperMode
    let root = mode.activeLibrary || mode.libraries[0]
    if (root && faults[root]) return { ...failed(root), workspaceRoot: root, defaultWorkspaceRoot: DEFAULT }
    if (!root && mode.workspaceInitialized) return { ok: false, code: 'unconfigured', message: 'Choose a paper workspace.', defaultWorkspaceRoot: DEFAULT }
    const created = !root
    root ||= DEFAULT
    settings = { ...settings, write: mergeWriteSettings(settings.write, { paperMode: {
      workspaceInitialized: true, activeLibrary: root, libraries: [...new Set([root, ...mode.libraries])]
    } }) }
    persist()
    return { ok: true, workspaceRoot: root, defaultWorkspaceRoot: DEFAULT, created,
      libraries: clone(settings.write.paperMode.libraries), activeLibrary: root }
  },
  pickWorkspaceDirectory: async () => {
    calls.picker++
    if (pickerDelay) await new Promise(resolve => setTimeout(resolve, pickerDelay))
    return clone(picker)
  },
  listWorkspaceDirectory: async ({ workspaceRoot, path }: { workspaceRoot: string; path?: string }) =>
    faults[workspaceRoot] ? failed(workspaceRoot) : { ok: true, root: path || workspaceRoot, entries: [] },
  readWorkspaceFile: async ({ workspaceRoot, path }: { workspaceRoot: string; path: string }) => {
    const absolute = path.startsWith('/') ? path : workspaceRoot + '/' + path
    return absolute in documents ? { ok: true, path: absolute, content: documents[absolute], size: documents[absolute].length, mtimeMs: 1 }
      : { ok: false, message: 'File not found (offline fixture)' }
  },
  writeWorkspaceFile: async ({ workspaceRoot, path, content }: { workspaceRoot: string; path: string; content: string }) => {
    const absolute = path.startsWith('/') ? path : workspaceRoot + '/' + path
    calls.writes.push(absolute)
    documents[absolute] = content
    return { ok: true, path: absolute }
  },
  paperLibraryList: async ({ workspaceRoot }: { workspaceRoot: string }) => faults[workspaceRoot]
    ? failed(workspaceRoot) : { ok: true, entries: [], counts, tags: [], groups: [] },
  paperReadingActivity: async () => ({ ok: true, activity: {} }),
  paperDetectLibraries: async () => ({ ok: true, candidates: [] }),
  runtimeRequest: async () => { calls.runtime++; throw Error('Unexpected runtime/model request in offline workspace fixture') }
} })

function App(): ReactElement {
  const surface = useWriteWorkspaceStore(s => s.workSurface)
  const root = useWriteWorkspaceStore(s => s.workspaceRoot)
  const activeLibrary = useWriteWorkspaceStore(s => s.paperMode.activeLibrary)
  const loading = useWriteWorkspaceStore(s => s.settingsLoading)
  const file = useWriteWorkspaceStore(s => s.activeFilePath)
  const content = useWriteWorkspaceStore(s => s.fileContent)
  const layout = useWriteWorkspaceStore(s => s.editorLayout)
  const refresh = usePaperModeStore(s => s.entriesRefreshToken)
  const bootstrap = usePaperWorkspaceBootstrapStore(s => s.status)
  useEffect(() => {
    if (surface !== 'papers' || !root) return
    let canceled = false
    usePaperModeStore.getState().setEntriesLoading(true)
    window.kunGui.paperLibraryList({ workspaceRoot: root, papersDir: 'papers' }).then(result => {
      if (canceled) return
      if (result.ok) usePaperModeStore.getState().setEntriesResult(result)
      else usePaperModeStore.getState().setEntriesError(result.message)
    })
    return () => { canceled = true }
  }, [surface, root, refresh])
  return <div className="fixture-shell">
    <small className="fixture-evidence-label">OFFLINE IPC FIXTURE · PRODUCTION PAPER COMPONENTS</small>
    <div className="fixture-workbench">
      <aside className="fixture-sidebar">
        <div className="fixture-work-title">Work</div>
        <PaperModeToggle />
        {surface === 'papers' ? <><PaperSidebarNav activeView={activePaperViewId(layout)} total={0} /><PaperWorkspacesSection /></> : null}
      </aside>
      <main className="fixture-main">
        {surface !== 'papers' ? <section data-testid="fixture-documents" className="p-8"><h1>Documents</h1><p>{file || 'No open document'}</p><pre>{content}</pre></section>
          : !activeLibrary || bootstrap === 'error' || loading ? <PaperLibraryOnboarding /> : activePaperViewId(layout) === 'discover:search' ? <PaperWorkspaceFixtureResearch /> : <PaperLibraryView />}
      </main>
    </div>
    <PaperNoticeToast />
  </div>
}

async function initialize(): Promise<void> {
await i18n.changeLanguage('en')
document.documentElement.dataset.theme = 'light'
useChatStore.setState({ route: 'write', threads: [] })
let registry = readWriteThreadRegistry()
for (const [root, id] of [[DOCS, 'docs-thread'], [DEFAULT, 'default-paper-thread'], [CUSTOM, 'custom-paper-thread']]) {
  registry = markWriteThread(root, id, registry, root + '/papers/shared')
}
saveWriteThreadRegistry(registry)
createRoot(document.getElementById('root')!).render(<App />)
await useWriteWorkspaceStore.getState().loadWriteSettings()
if (useWriteWorkspaceStore.getState().workSurface === 'docs') {
  await useWriteWorkspaceStore.getState().openFile(DOCS, DOCS + '/notes.md')
}
Object.assign(window, { paperWorkspaceFixture: {
  ready: true, roots: { docs: DOCS, default: DEFAULT, custom: CUSTOM }, calls,
  snapshot: () => {
    const state = useWriteWorkspaceStore.getState()
    return { root: state.workspaceRoot, surface: state.workSurface, activeLibrary: state.paperMode.activeLibrary,
      libraries: state.paperMode.libraries, activeFile: state.activeFilePath, layout: clone(state.editorLayout),
      settings: clone(settings), bootstrap: clone(usePaperWorkspaceBootstrapStore.getState()),
      selection: [...usePaperModeStore.getState().selection], view: activePaperViewId(state.editorLayout),
      importOpen: usePaperModeStore.getState().importDialogOpen, documents: clone(documents),
      threadScopes: Object.fromEntries([DOCS, DEFAULT, CUSTOM].map(root => [root, writeThreadIdsForFile(root, root + '/papers/shared')])) }
  },
  setTheme: (theme: string) => { document.documentElement.dataset.theme = theme },
  setPicker: (path?: string, delay = 0) => { picker = { canceled: !path, path }; pickerDelay = delay },
  setFault: (root: string, message: string | null) => { if (message) faults[root] = message; else delete faults[root] },
  setEnsureFailure: (code: string | null) => { ensureFailure = code },
  setSelection: () => usePaperModeStore.getState().setSelection(new Set(['papers/shared'])),
  closeImport: () => usePaperModeStore.getState().setImportDialogOpen(false),
  openView: (view: 'library' | 'discover:search') => useWriteWorkspaceStore.getState().openPaperViewTab(view),
  enter: enterPaperMode, exit: exitPaperMode, switch: switchPaperLibrary,
  reloadSettings: () => useWriteWorkspaceStore.getState().loadWriteSettings(),
  openNote: () => {
    const root = useWriteWorkspaceStore.getState().workspaceRoot
    return useWriteWorkspaceStore.getState().openFile(root, root + '/papers/shared/NOTES.md')
  },
  makeDirty: () => {
    settings = { ...settings, write: mergeWriteSettings(settings.write, { autoSaveEnabled: false }) }
    persist()
    useWriteWorkspaceStore.setState({ autoSaveEnabled: false })
    useWriteWorkspaceStore.getState().setFileContent('Unsaved text must stay in this workspace')
  }
} })

}
void initialize()

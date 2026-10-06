/** Native smoke fixture: real assistant/library components, deterministic offline IPC.
 * No personal files, credentials, model calls or real filesystem writes. */
import { useState, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { WorkbenchRightPanel } from '../../src/renderer/src/components/workbench/WorkbenchRightPanel'
import { WorkAssistantChromeContext } from '../../src/renderer/src/components/write/WorkAssistantChromeContext'
import { WorkAssistantNav } from '../../src/renderer/src/components/write/WorkAssistantNav'
import { PaperSidebarNav } from '../../src/renderer/src/components/paper/sidebar/PaperSidebarNav'
import { PaperTree } from '../../src/renderer/src/components/paper/sidebar/PaperTree'
import { PaperLibraryView } from '../../src/renderer/src/components/paper/PaperLibraryView'
import { PaperWorkspaceDialogs } from '../../src/renderer/src/components/paper/PaperWorkspaceDialogs'
import { useWriteWorkspaceStore } from '../../src/renderer/src/write/write-workspace-store'
import { useWorkAssistantNavigation } from '../../src/renderer/src/write/work-assistant-navigation'
import { useChatStore } from '../../src/renderer/src/store/chat-store'
import { usePaperModeStore } from '../../src/renderer/src/paper/paper-mode-store'
import { usePaperBatchStore } from '../../src/renderer/src/paper/paper-batch-store'
import { activePaperViewId } from '../../src/renderer/src/write/write-editor-layout'
import { markWriteThread, saveWriteThreadRegistry } from '../../src/renderer/src/write/write-thread-registry'
import type { WriteAssistantStageProps } from '../../src/renderer/src/components/write/WriteAssistantStageContext'
import type { PaperLibraryEntry } from '../../src/shared/paper/paper-library-types'
import i18n from '../../src/renderer/src/i18n'
import './work-assistant-styles'

const ROOT = '/offline-fixture/Research'
const titles = ['Repository-level Code Search with Neural Retrieval', 'CodeRAG-Bench: Can Retrieval Augment Code Generation?', 'CodeScout: An Effective Recipe for Reinforcement Learning', 'ContextSpiner: Long Context Retrieval and Evidence']
const entries: PaperLibraryEntry[] = titles.map((title, index) => ({
  unitDir: `papers/2609.01481/2609.0000${index}`,
  group: '2609.01481', hasPdf: true, hasNotes: false, interpretationCount: 0,
  meta: { version: 2, title, authors: ['Offline Example'], arxivId: `2609.0000${index}`,
    year: '2026', importedAt: '2026-10-06T10:00:00Z', pdfFile: 'paper.pdf', status: 'unread' }
}))
const counts = { total: entries.length, unread: entries.length, read: 0, reading: 0, missingPdf: 0 }
const calls = { model: 0, writes: 0, material: 0 }
let setSidebarCollapsed: (value: boolean) => void = () => undefined
const noop = () => undefined
const forbidden = (): never => { calls.model++; throw Error('Live model calls are forbidden in the offline fixture') }
Object.assign(window, { kunGui: {
  platform: 'fixture',
  runtimeRequest: async () => ({ ok: true, status: 200, body: JSON.stringify({ sessions: [] }) }),
  paperLibraryList: async () => ({ ok: true, entries, counts, tags: [], groups: ['2609.01481', '2025.acl-long.426-ACL'] }),
  paperReadingActivity: async () => ({ ok: true, activity: {} }),
  paperEvidenceMaterial: async ({ unitDir }: { unitDir: string }) => {
    calls.material++
    const entry = entries.find(item => item.unitDir === unitDir)!
    return { ok: true, sourceText: 'Abstract: Deterministic evidence fixture for source review. No live research is performed.', abstractOnly: true, textPartial: false,
      paperVersion: { canonicalId: entry.meta.arxivId, pdfSha256: 'a'.repeat(64), metadataSha256: 'b'.repeat(64) } }
  },
  createWorkspaceFile: forbidden,
  writeWorkspaceFile: forbidden,
  listWorkspaceDirectory: async () => ({ ok: true, root: ROOT, entries: [] }),
  getSettings: async () => ({ providers: [], write: {} }),
  onRuntimeEvent: () => noop
} })
useWriteWorkspaceStore.setState({
  workspaceRoot: ROOT, rootDirectory: ROOT, defaultWorkspaceRoot: ROOT, workspaceRoots: [ROOT],
  workSurface: 'papers', settingsLoading: false, activeFilePath: null,
  paperMode: { ...useWriteWorkspaceStore.getState().paperMode, enabled: true, libraries: [ROOT], activeLibrary: ROOT },
  entriesByDir: { [ROOT]: [] },
  loadWriteSettings: async () => undefined
})
useWriteWorkspaceStore.getState().openPaperViewTab('library')
usePaperModeStore.getState().setEntriesResult({ entries, counts, tags: [], groups: ['2609.01481', '2025.acl-long.426-ACL'] })
useChatStore.setState({ route: 'write', runtimeConnection: 'ready', busy: false, activeThreadId: 'offline-work-session',
  threads: [{ id: 'offline-work-session', title: 'Paper explanation plan', workspace: ROOT, agentSurface: 'write', updatedAt: '2026-10-06T10:00:00Z' }] })
saveWriteThreadRegistry(markWriteThread(ROOT, 'offline-work-session'))

function App() {
  const [sidebarCollapsed, setCollapsed] = useState(false)
  setSidebarCollapsed = setCollapsed
  const surface = useWorkAssistantNavigation(state => state.surface)
  const layout = useWriteWorkspaceStore(state => state.editorLayout)
  const assistantOpen = useWriteWorkspaceStore(state => state.assistantOpen)
  const [input, setInput] = useState('')
  const [model, setModel] = useState('offline-model')
  const [mode, setMode] = useState<'agent' | 'plan' | 'auto'>('agent')
  const [effort, setEffort] = useState<WriteAssistantStageProps['composerReasoningEffort']>('medium')
  const [fast, setFast] = useState(false)
  const blocks = useChatStore(state => state.blocks)
  const busy = useChatStore(state => state.busy)
  const assistant: WriteAssistantStageProps = {
    input, setInput, mode, setMode, busy, runtimeConnection: 'ready',
    activeThreadId: 'offline-work-session', blocks, liveReasoning: '', liveAssistant: '',
    composerModel: model, composerProviderId: 'offline-provider', composerPickList: ['offline-model', 'offline-model-large'],
    composerModelGroups: [], skillCommands: [], disabledSkillIds: [],
    composerReasoningEffort: effort, composerFastMode: fast, setComposerModel: setModel,
    setComposerReasoningEffort: setEffort, setComposerFastMode: setFast,
    queuedMessages: [], removeQueuedMessage: noop, guideQueuedMessage: noop,
    attachments: [], attachmentUploadEnabled: true, onPickAttachments: noop, onRemoveAttachment: noop,
    onSend: forbidden, onInterrupt: noop, onRetryConnection: noop, onOpenSettings: noop,
    onNewConversation: forbidden, onPickWorkspace: noop, onCollapse: () => useWriteWorkspaceStore.getState().setAssistantOpen(false)
  }
  const panel = { route: 'write', visible: assistantOpen, width: 390, rightPanelMode: null,
    onBeginResize: noop, design: { panelMode: 'hidden' }, writeAssistantOpen: assistantOpen,
    write: assistant, mcpSkills: { onOpenSettings: noop }, onCollapse: assistant.onCollapse
  } as ComponentProps<typeof WorkbenchRightPanel>
  return <WorkAssistantChromeContext.Provider value={{ leftSidebarCollapsed: sidebarCollapsed, onToggleLeftSidebar: () => setCollapsed(value => !value) }}><div className="fixture-shell">
    <small className="fixture-evidence-label">OFFLINE FIXTURE · REAL WORK ASSISTANT / LIBRARY UI · NO MODEL CALLS</small>
    <div className="fixture-workbench">
      <aside className="fixture-sidebar" style={sidebarCollapsed ? { display: 'none' } : undefined}>
        <strong className="px-3 py-4">Work</strong>
        <WorkAssistantNav />
        <PaperSidebarNav activeView={surface === 'assistant' ? null : activePaperViewId(layout)} total={entries.length} />
        <p className="px-3 pb-2 pt-6 text-xs text-ds-faint">Research workspace</p>
        <PaperTree libraryRoot={ROOT} entries={entries} groups={['2609.01481', '2025.acl-long.426-ACL']} />
      </aside>
      <main className="fixture-main">
        <div className={surface === 'assistant' ? 'hidden' : 'flex min-w-0 flex-1 flex-col'}><PaperLibraryView /></div>
        <WorkbenchRightPanel {...panel} />
        <PaperWorkspaceDialogs />
      </main>
    </div>
  </div></WorkAssistantChromeContext.Provider>
}
async function initialize() {
  await i18n.changeLanguage('en')
  document.documentElement.dataset.theme = 'light'
  createRoot(document.getElementById('root')!).render(<App />)
  Object.assign(window, { workAssistantFixture: {
    ready: true, calls, setSidebarCollapsed: (value: boolean) => setSidebarCollapsed(value),
    snapshot: () => ({ surface: useWorkAssistantNavigation.getState().surface,
      thread: useChatStore.getState().activeThreadId, blocks: useChatStore.getState().blocks, batch: usePaperBatchStore.getState().batch,
      activeFile: useWriteWorkspaceStore.getState().activeFilePath, calls }),
    setTheme: (theme: string) => { document.documentElement.dataset.theme = theme },
    setLanguage: (language: string) => i18n.changeLanguage(language),
    showConversation: () => useChatStore.setState({ blocks: [
      { kind: 'user', id: 'question', text: 'Explain these papers and compare the retrieval approach.' },
      { kind: 'assistant', id: 'answer', text: '## Explanation plan\n\nI will review the selected source material and produce one explanation per paper.\n\n- Research question and contribution\n- Method and supporting evidence\n- Limitations and practical use\n\nYou can review the model, source scope and destination before starting.' }
    ] }),
    showLiteral: () => useChatStore.setState({ blocks: [{ kind: 'assistant', id: 'literal-policy-sentinel', renderMode: 'plain-text', text: '# Literal\n\n![private](https://fixture.invalid/pixel)' }] }),
    setBusy: (value: boolean) => useChatStore.setState({ busy: value }),
    openLibrary: () => useWorkAssistantNavigation.getState().openWorkspace(),
    openAssistant: () => useWorkAssistantNavigation.getState().openAssistant()
  } })
}
void initialize()

import { createElement, type ComponentProps } from 'react'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WriteAssistantPanel } from '../../write/WriteAssistantPanel'
import { usePaperReadingRequest } from '../../../paper/paper-reading-request'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { useChatStore } from '../../../store/chat-store'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { usePaperStore } from '../../../write/paper/paper-store'
import { entry, render } from './paper-evidence-test-support'

vi.mock('react-i18next', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }))
vi.mock('../../chat/FloatingComposer', () => ({ FloatingComposer: ({ onSend }: { onSend: () => void }) =>
  createElement('button', { 'data-testid': 'composer-submit', onClick: onSend }, 'Send') }))
vi.mock('../../chat/LazyMessageTimeline', () => ({ LazyMessageTimeline: () => null }))
vi.mock('../../chat/message-timeline-empty', () => ({ SubagentReturnBar: () => null }))
vi.mock('../../write/WritePaperAssistantActions', () => ({ WritePaperAssistantActions: () => null }))
vi.mock('../../write/WriteResourceConversationHistoryPopover', () => ({ WriteResourceConversationHistoryPopover: () => null }))
vi.mock('../../write/useWriteResourceConversationHistory', () => ({ useWriteResourceConversationHistory: () => null }))
vi.mock('../../write/useChildThreadViewer', () => ({ useChildThreadViewer: () => ({
  childThreadId: null, childBlocks: [], childStatus: undefined, childLoading: false, childError: null,
  viewingChildThread: false, openChildThread: vi.fn(), closeChildThread: vi.fn()
}) }))

let tree: ReactTestRenderer | undefined
function props(onSend = vi.fn()): ComponentProps<typeof WriteAssistantPanel> {
  return {
    input: 'Does this paper support the claimed gain?', setInput: vi.fn(), mode: 'agent', setMode: vi.fn(),
    busy: false, runtimeConnection: 'ready', activeThreadId: null, blocks: [], liveReasoning: '', liveAssistant: '',
    composerModel: 'selected-model', composerProviderId: 'configured-provider', composerPickList: [],
    composerReasoningEffort: 'max', composerFastMode: false, setComposerModel: vi.fn(),
    setComposerReasoningEffort: vi.fn(), setComposerFastMode: vi.fn(), queuedMessages: [],
    removeQueuedMessage: vi.fn(), guideQueuedMessage: vi.fn(), onSend, onInterrupt: vi.fn(),
    onRetryConnection: vi.fn(), onOpenSettings: vi.fn(), onNewConversation: vi.fn(), onPickWorkspace: vi.fn(), onCollapse: vi.fn()
  }
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  usePaperReadingRequest.setState({ request: null })
  usePaperModeStore.setState({ entries: [entry], readerPage: null })
  usePaperStore.setState({ unitsByDir: {} })
  useWriteWorkspaceStore.setState({ workspaceRoot: '/library', activeFilePath: '/library/papers/a/paper.pdf', workSurface: 'papers' })
  useChatStore.setState({ activeThreadId: null, writeAssistantVisibleThreadId: null })
})
afterEach(async () => { await act(async () => tree?.unmount()); tree = undefined; vi.unstubAllGlobals() })

describe('existing paper assistant Q&A routing', () => {
  it('opens the bounded reading dialog for an active library paper instead of calling generic send', async () => {
    const config = props()
    tree = await render(createElement(WriteAssistantPanel, config))
    await act(async () => tree!.root.findByProps({ 'data-testid': 'composer-submit' }).props.onClick())
    expect(config.onSend).not.toHaveBeenCalled()
    expect(usePaperReadingRequest.getState().request).toEqual({ workspaceRoot: '/library', unitDir: entry.unitDir,
      meta: entry.meta, question: config.input })
  })

  it('keeps ordinary writing Q&A on its existing path', async () => {
    useWriteWorkspaceStore.setState({ workSurface: 'docs', activeFilePath: '/library/notes.md' })
    const config = props()
    tree = await render(createElement(WriteAssistantPanel, config))
    await act(async () => tree!.root.findByProps({ 'data-testid': 'composer-submit' }).props.onClick())
    expect(config.onSend).toHaveBeenCalledTimes(1)
    expect(usePaperReadingRequest.getState().request).toBeNull()
  })

  it.each([true, false])('never falls through to unscoped send for a recognized paper missing library metadata (loading=%s)', async (entriesLoading) => {
    usePaperModeStore.setState({ entries: [], entriesLoading })
    usePaperStore.setState({ unitsByDir: { [entry.unitDir]: { ...entry.meta, version: 1, pdfFile: 'paper.pdf' } } })
    const config = props()
    tree = await render(createElement(WriteAssistantPanel, config))
    await act(async () => tree!.root.findByProps({ 'data-testid': 'composer-submit' }).props.onClick())
    expect(config.onSend).not.toHaveBeenCalled()
  })

  it('recovers the recognized paper metadata locally before opening its bounded request', async () => {
    const paperReadUnit = vi.fn(async () => ({ ok: true, unitDir: entry.unitDir, meta: entry.meta, figures: null }))
    vi.stubGlobal('window', { kunGui: { paperReadUnit } })
    usePaperModeStore.setState({ entries: [], entriesLoading: true })
    usePaperStore.setState({ unitsByDir: { [entry.unitDir]: { ...entry.meta, version: 1, pdfFile: 'paper.pdf' } } })
    const config = props()
    tree = await render(createElement(WriteAssistantPanel, config))
    await act(async () => tree!.root.findByProps({ 'data-testid': 'composer-submit' }).props.onClick())
    expect(config.onSend).not.toHaveBeenCalled()
    expect(paperReadUnit).toHaveBeenCalledWith({ workspaceRoot: '/library', unitDir: entry.unitDir })
    expect(usePaperReadingRequest.getState().request).toEqual({ workspaceRoot: '/library', unitDir: entry.unitDir,
      meta: entry.meta, question: config.input })
  })
})

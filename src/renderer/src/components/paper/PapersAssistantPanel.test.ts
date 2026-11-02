/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { createElement } from 'react'
import { useChatStore } from '../../store/chat-store'
import { paperSpaceItemKey } from '../../paper/paper-space-store'
import { patchPaperAssistant, usePaperAssistantStore } from '../../paper/paper-space-assistant-state'
import { PapersAssistantPanel } from './PapersAssistantPanel'

const calls = vi.hoisted(() => ({ send: vi.fn(async () => null), select: vi.fn(async () => undefined), navigate: vi.fn() }))
vi.mock('react-i18next', async (original) => ({ ...await original<typeof import('react-i18next')>(), useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../agent/kun-runtime-shared-default', () => ({ sharedDefaultModelSelection: vi.fn(async () => ({ registryAvailable: false })) }))
vi.mock('../../paper/paper-space-assistant', () => ({ openPaperSpaceAssistant: calls.send, selectPaperSpaceAssistant: calls.select }))
vi.mock('../../lib/knowledge-source-navigation', () => ({ requestKnowledgeSourceNavigation: calls.navigate }))
vi.mock('../chat/LazyMessageTimeline', async () => {
  const { createElement } = await import('react')
  const { useTimelineFilePreviewWorkspaceRoot, useTimelineFilePreviewThreadId } = await import('../chat/timeline-file-preview-workspace')
  return { LazyMessageTimeline: (props: object) => createElement('div', { ...props, 'data-probe': 'timeline', 'data-workspace': useTimelineFilePreviewWorkspaceRoot(), 'data-thread': useTimelineFilePreviewThreadId() }) }
})
vi.mock('../chat/FloatingComposer', async () => {
  const { createElement } = await import('react')
  return { FloatingComposer: (props: object) => createElement('div', { ...props, 'data-probe': 'composer' }) }
})
const props = { workspaceRoot: '/source', unitDir: 'papers/a', title: 'Paper A', onCollapse: vi.fn(), expanded: false, pdfPath: '/source/papers/a/paper.pdf' }
const a = paperSpaceItemKey(props.workspaceRoot, props.unitDir)
const b = paperSpaceItemKey('/legacy', 'papers/a')
let tree: ReactTestRenderer
const composer = () => tree.root.findByProps({ 'data-probe': 'composer' }).props
const timelines = () => tree.root.findAllByProps({ 'data-probe': 'timeline' })
beforeEach(() => {
  vi.clearAllMocks()
  usePaperAssistantStore.setState({ sessions: {} })
  useChatStore.setState(useChatStore.getInitialState(), true)
  useChatStore.setState({ route: 'papers', activeThreadId: 'work', runtimeConnection: 'ready',
    liveAssistant: 'Work text must not leak', liveReasoning: 'Work reasoning' })
})
afterEach(() => { if (tree) act(() => tree.unmount()) })

function mount(): void { act(() => { tree = create(createElement(PapersAssistantPanel, props)) }) }

describe('paper assistant rail', () => {
  it('never exposes the previous Work projection or approvals in a new paper', () => {
    mount()
    expect(timelines()).toHaveLength(0)
    expect(composer()).toMatchObject({ activeThreadIdOverride: null, userInputBlocksOverride: [], queuedMessages: [], input: '', workspaceRootOverride: '/source' })
    const setModel = vi.fn()
    act(() => useChatStore.setState({ setComposerModel: setModel }))
    act(() => composer().onComposerModelChange('paper-model', 'paper-provider'))
    expect(setModel).not.toHaveBeenCalled()
    expect(composer().composerModel).toBe('paper-model')
    expect(useChatStore.getState().activeThreadId).toBe('work')
  })

  it('reuses the shared streaming timeline and input only for the bound thread', () => {
    patchPaperAssistant(a, { threadId: 'paper-a', input: 'A draft' })
    useChatStore.setState({ activeThreadId: 'paper-a', liveAssistant: 'A response', liveReasoning: 'A reasoning' })
    mount()
    expect(timelines()[0].props).toMatchObject({ activeThreadId: 'paper-a', live: 'A response', liveReasoning: 'A reasoning', compactCards: true, 'data-workspace': '/source', 'data-thread': 'paper-a' })
    expect(composer().userInputBlocksOverride).toBeUndefined()
    act(() => { tree.update(createElement(PapersAssistantPanel, { ...props, workspaceRoot: '/legacy' })) })
    expect(timelines()).toHaveLength(0)
    expect(composer().input).toBe('')
    act(() => composer().setInput('B draft'))
    act(() => { tree.update(createElement(PapersAssistantPanel, props)) })
    expect(composer().input).toBe('A draft')
    expect(usePaperAssistantStore.getState().sessions[b].input).toBe('B draft')
    act(() => useChatStore.setState({ activeThreadId: 'another-thread' }))
    expect(timelines()).toHaveLength(0)
    expect(composer().activeThreadIdOverride).toBeNull()
  })

  it('sends and removes staged images without modifying another paper draft', () => {
    const image = { name: 'crop.png', dataBase64: 'AQ==' }
    patchPaperAssistant(a, { input: 'Explain this', images: [image] })
    patchPaperAssistant(b, { input: 'B draft', images: [image] })
    mount()
    act(() => composer().onSend())
    expect(calls.send).toHaveBeenCalledWith(expect.objectContaining({ workspaceRoot: '/source', unitDir: 'papers/a', prompt: 'Explain this', images: [image], consumeDraft: true }))
    act(() => tree.root.findByProps({ 'aria-label': 'removeAttachment' }).props.onClick())
    expect(usePaperAssistantStore.getState().sessions[a].images).toEqual([])
    expect(usePaperAssistantStore.getState().sessions[b].images).toEqual([image])
  })

  it('keeps failed sends visible with the draft and offers collapse without deleting it', () => {
    patchPaperAssistant(a, { input: 'Keep me', error: 'Upload failed' })
    mount()
    expect(tree.root.findByProps({ role: 'alert' }).children).toContain('Upload failed')
    act(() => tree.root.findByProps({ 'aria-label': 'paperAssistantCollapse' }).props.onClick())
    expect(props.onCollapse).toHaveBeenCalled()
    expect(composer().input).toBe('Keep me')
  })

  it('navigates current-PDF citations within the reader and leaves other links alone', () => {
    mount()
    const anchor = document.createElement('a'), child = document.createElement('span')
    anchor.append(child)
    anchor.setAttribute('href', 'papers/a/paper.pdf#page=4')
    const event = { target: child, preventDefault: vi.fn(), stopPropagation: vi.fn() }
    tree.root.findByProps({ className: 'papers-assistant-timeline' }).props.onClickCapture(event)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalled()
    expect(calls.navigate).toHaveBeenCalledWith({ filePath: props.pdfPath, location: { kind: 'pdf', pageStart: 4, pageEnd: 4 } })
    expect(useChatStore.getState().route).toBe('papers')
    calls.navigate.mockClear()
    anchor.setAttribute('href', 'https://example.com/paper.pdf#page=4')
    tree.root.findByProps({ className: 'papers-assistant-timeline' }).props.onClickCapture(event)
    expect(calls.navigate).not.toHaveBeenCalled()
  })
})

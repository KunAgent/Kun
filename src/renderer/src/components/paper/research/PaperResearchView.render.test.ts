/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock, NormalizedThread } from '../../../agent/types'
import { useChatStore } from '../../../store/chat-store'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { markWriteThread, readWriteThreadRegistry, saveWriteThreadRegistry } from '../../../write/write-thread-registry'
import { researchResourcePath } from '../../../paper/paper-research-sessions'
import { WriteAssistantStageContext, type WriteAssistantStageProps } from '../../write/WriteAssistantStageContext'
import { PaperResearchView } from './PaperResearchView'

vi.mock('../../chat/LazyMessageTimeline', () => ({
  LazyMessageTimeline: (props: { blocks: ChatBlock[] }) =>
    createElement('div', { 'data-testid': 'timeline' }, `blocks:${props.blocks.length}`)
}))
vi.mock('../../chat/FloatingComposerModelPicker', () => ({
  FloatingComposerModelPicker: () => createElement('div', { 'data-testid': 'model-picker' })
}))
vi.mock('../../chat/FloatingComposer', () => ({
  FloatingComposer: () => createElement('div', { 'data-testid': 'composer' })
}))

const ROOT = '/Users/me/papers-lib'
const SESSION = 'rs-test-000001'

function searchBlock(): ChatBlock {
  return {
    kind: 'tool',
    id: 'tool-1',
    summary: 'paper_search',
    status: 'success',
    meta: {
      toolName: 'paper_search',
      paperSearch: {
        version: 1,
        query: 'agents',
        total: 1,
        papers: [{ id: '2401.00001', title: 'Pool Paper About Agents', authors: ['A'], sources: ['arxiv'], arxivId: '2401.00001' }],
        sources: [{ source: 'arxiv', count: 1, ms: 5 }]
      }
    }
  }
}

function assistant(overrides: Partial<WriteAssistantStageProps> = {}): WriteAssistantStageProps {
  return {
    blocks: [],
    liveReasoning: '',
    liveAssistant: '',
    activeThreadId: null,
    runtimeConnection: 'ready',
    busy: false,
    input: '',
    setInput: () => undefined,
    onInterrupt: () => undefined,
    onRetryConnection: () => undefined,
    onOpenSettings: () => undefined,
    ...overrides
  } as unknown as WriteAssistantStageProps
}

let root: Root
let host: HTMLElement

async function render(props: WriteAssistantStageProps): Promise<void> {
  await act(async () => {
    root.render(createElement(
      WriteAssistantStageContext.Provider,
      { value: props },
      createElement(PaperResearchView, { onShowDirect: () => undefined })
    ))
  })
}

describe('PaperResearchView', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const data = new Map<string, string>()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => { data.set(key, String(value)) },
        removeItem: (key: string) => { data.delete(key) },
        clear: () => data.clear(),
        key: (index: number) => [...data.keys()][index] ?? null,
        get length() { return data.size }
      }
    })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    useWriteWorkspaceStore.setState({ workspaceRoot: ROOT, paperResearch: { agentTab: true, sessionId: null } })
    useChatStore.setState({ threads: [] })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('shows the single search box and scope pill when no session is selected', async () => {
    await render(assistant())
    expect(host.querySelector('textarea')).not.toBeNull()
    expect(host.querySelector('[data-paper-scope-trigger]')).not.toBeNull()
    expect(host.querySelector('[data-testid="model-picker"]')).not.toBeNull()
    expect(host.textContent).toContain('What should we research today?')
    expect(host.textContent).toContain('Standard')
    expect(host.querySelector('[data-testid="timeline"]')).toBeNull()
    // The old history rail and per-source chip row are gone.
    expect(host.textContent).not.toContain('Search history')
  })

  it('opens the scope settings from the pill', async () => {
    await render(assistant())
    const trigger = host.querySelector<HTMLButtonElement>('[data-paper-scope-trigger]')!
    await act(async () => trigger.click())
    const menu = host.querySelector('[data-paper-scope-menu]')
    expect(menu).not.toBeNull()
    expect(menu?.textContent).toContain('Depth')
    expect(menu?.textContent).toContain('arXiv')
  })

  it('renders the session conversation and its paper pool once the thread is bound', async () => {
    saveWriteThreadRegistry(markWriteThread(ROOT, 'thread-1', readWriteThreadRegistry(), researchResourcePath(ROOT, SESSION)))
    useChatStore.setState({
      threads: [{ id: 'thread-1', title: 'Agents question', updatedAt: '2026-09-26T00:00:00Z', model: 'm', mode: 'agent', workspace: ROOT, agentSurface: 'write' } as NormalizedThread]
    })
    useWriteWorkspaceStore.setState({ paperResearch: { agentTab: true, sessionId: SESSION } })
    await render(assistant({ activeThreadId: 'thread-1', blocks: [searchBlock()] }))
    expect(host.querySelector('[data-testid="timeline"]')?.textContent).toBe('blocks:1')
    expect(host.querySelector('[data-testid="composer"]')).not.toBeNull()
    expect(host.textContent).toContain('Agents question')
    expect(host.textContent).toContain('Pool Paper About Agents')
  })

  it('waits instead of showing another thread while the session is selecting', async () => {
    saveWriteThreadRegistry(markWriteThread(ROOT, 'thread-1', readWriteThreadRegistry(), researchResourcePath(ROOT, SESSION)))
    useChatStore.setState({
      threads: [{ id: 'thread-1', title: 'Agents question', updatedAt: '2026-09-26T00:00:00Z', model: 'm', mode: 'agent', workspace: ROOT, agentSurface: 'write' } as NormalizedThread]
    })
    useWriteWorkspaceStore.setState({ paperResearch: { agentTab: true, sessionId: SESSION } })
    await render(assistant({ activeThreadId: 'library-thread', blocks: [searchBlock()] }))
    expect(host.querySelector('[data-testid="timeline"]')).toBeNull()
    expect(host.textContent).toContain('Opening research session')
  })
})

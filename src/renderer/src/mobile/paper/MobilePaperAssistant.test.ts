// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { useChatStore } from '../../store/chat-store'
import { paperResourceKey } from './paper-resource-key'
import { writeLastResearchSession } from '../../paper/paper-research-sessions'
import { readPendingResearchSessions, rememberPendingResearchSession } from './mobile-paper-research-pending'

vi.mock('../../components/chat/LazyMessageTimeline', () => ({ LazyMessageTimeline: () => null }))
vi.mock('../chat/MobilePendingActions', () => ({ MobilePendingActions: () => null }))
import { MobilePaperAssistant } from './MobilePaperAssistant'

let host: HTMLDivElement
let root: Root
const priorWrite = useWriteWorkspaceStore.getState()
const priorChat = useChatStore.getState()
const sendMessage = vi.fn()
const readFile = vi.fn()
const library = '/library/B'
const unitDir = 'papers/group/paper'
const localItems = new Map<string, string>()
const originalLocalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage')
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => localItems.get(key) ?? null,
    setItem: (key: string, value: string) => { localItems.set(key, value) },
    removeItem: (key: string) => { localItems.delete(key) },
    clear: () => localItems.clear()
  } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  window.sessionStorage.clear()
  window.history.replaceState(null, '', `/?mode=work&mobile=paper&paper=${paperResourceKey(library, unitDir)}&view=assistant`)
  readFile.mockResolvedValue({ ok: true, content: '{}' })
  ;(window as unknown as { kunGui: unknown }).kunGui = { readWorkspaceFile: readFile }
  sendMessage.mockResolvedValue(true)
  useWriteWorkspaceStore.setState({ paperMode: { ...priorWrite.paperMode,
    libraries: [library], activeLibrary: library }, assistantModel: '', assistantProviderId: '' })
  useChatStore.setState({ activeThreadId: 'paper-thread', runtimeConnection: 'ready', blocks: [],
    ensureWriteThreadForWorkspace: vi.fn(async () => 'paper-thread'),
    selectWriteThread: vi.fn(async () => undefined), sendMessage })
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); window.sessionStorage.clear()
  window.localStorage.removeItem('kun.paper.research.lastSession')
  if (originalLocalStorage) Object.defineProperty(window, 'localStorage', originalLocalStorage)
  useWriteWorkspaceStore.setState(priorWrite); useChatStore.setState(priorChat)
  readFile.mockReset(); sendMessage.mockReset()
})
const render = async (page: number) => act(async () => root.render(createElement(MobilePaperAssistant, {
  root: library, unitDir, page, quote: null, onSettings: vi.fn(), onClearQuote: vi.fn()
})))
const type = async (text: string) => act(async () => {
  const input = host.querySelector('textarea') as HTMLTextAreaElement
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
const send = async () => act(async () => {
  ;(host.querySelector('.kun-mobile-composer-send') as HTMLButtonElement).click()
})

describe('mobile paper assistant admission', () => {
  it('includes library, paper unit, page and existing references in the submitted turn', async () => {
    await render(12); await type('比较实验'); await send()
    expect(sendMessage).toHaveBeenCalledWith(
      expect.stringContaining(`[paper-reading] library=${library}; unit=${unitDir}; page=12`),
      'agent', expect.objectContaining({ expectedThreadId: 'paper-thread', agentSurface: 'write',
        fileReferences: expect.arrayContaining([expect.objectContaining({ path: expect.stringContaining('paper.json') })]) })
    )
  })

  it('keeps a draft instead of submitting if the page changes while references load', async () => {
    let finish!: (result: { ok: boolean; content: string }) => void
    readFile.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    await render(12); await type('解释结果'); await send()
    await render(13)
    await act(async () => finish({ ok: true, content: '{}' }))
    expect(sendMessage).not.toHaveBeenCalled()
    expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toContain('解释结果')
  })

  it('uses the selected research depth, sources and years only for the first turn', async () => {
    window.history.replaceState(null, '', '/?mode=work&mobile=discover')
    writeLastResearchSession(library, 'rs-research-1')
    rememberPendingResearchSession(library, 'rs-research-1')
    await act(async () => root.render(createElement(MobilePaperAssistant, {
      root: library, unitDir: '', page: 0, quote: null, researchSessionId: 'rs-research-1',
      researchRequest: { depth: 'deep', sources: ['arxiv'], yearFrom: 2022, yearTo: 2025 },
      onSettings: vi.fn(), onClearQuote: vi.fn()
    })))
    await type('研究问题'); await send()
    expect(sendMessage.mock.calls[0]?.[0]).toContain('[paper-research] depth=deep; sources=arxiv; years=2022-2025')
    expect(readPendingResearchSessions(library)).toEqual([])
    sendMessage.mockClear()
    await act(async () => useChatStore.setState({ blocks: [{ id: 'u1', kind: 'user', text: '研究问题' }] as never }))
    await type('续问'); await send()
    expect(sendMessage.mock.calls[0]?.[0]).toBe('续问')
  })
})

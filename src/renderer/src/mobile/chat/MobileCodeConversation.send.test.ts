// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueuedUserMessage } from '../../store/chat-store-types'
import { MobileCodeConversation } from './MobileCodeConversation'
import { mergeRestoredDraft } from './mobile-draft-restore'

const state = vi.hoisted(() => ({
  activeThreadId: 't-1' as string | null,
  threads: [{ id: 't-1', title: 'Alpha', workspace: '/projects/alpha' }],
  blocks: [], liveReasoning: '', liveAssistant: '',
  runtimeConnection: 'ready', runtimeErrorDetail: null, error: null,
  busy: false, composerMode: 'agent', composerModel: 'deepseek-v4-pro', composerProviderId: '',
  composerPickList: [], composerModelGroups: [], composerReasoningEffort: '', workspaceRoot: '/projects/alpha',
  setComposerModel: vi.fn(), setComposerMode: vi.fn(), setComposerReasoningEffort: vi.fn(),
  selectThread: vi.fn(async () => undefined),
  sendMessage: vi.fn<(text: string) => Promise<boolean>>(),
  interrupt: vi.fn(), probeRuntime: vi.fn(), resolveApproval: vi.fn(), resolveUserInput: vi.fn(),
  watchTurnCompletion: {}, unreadThreadIds: {}, scheduledThreadActivities: {}, awaitingUserInputThreadIds: {},
  queuedMessages: [] as QueuedUserMessage[],
  removeQueuedMessage: vi.fn()
}))
vi.mock('../../store/chat-store', () => ({
  useChatStore: (selector: (s: typeof state) => unknown) => selector(state)
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => undefined }
}))
vi.mock('../../components/chat/LazyMessageTimeline', () => ({ LazyMessageTimeline: () => null }))
vi.mock('../../components/chat/FloatingComposerAttachments', () => ({ FloatingComposerAttachments: () => null }))
vi.mock('../../components/chat/user-input-panel-logic', () => ({ selectLivePendingUserInput: () => null }))
vi.mock('../../components/chat/sidebar-project-selectors', () => ({ sidebarThreadActivity: () => 'read' }))
vi.mock('./MobileCodeOptions', () => ({ MobileCodeOptions: () => null }))
vi.mock('./MobileCodeThreadDetails', () => ({ MobileCodeThreadDetails: () => null }))
vi.mock('./MobileMessageActionsSheet', () => ({ MobileMessageActionsSheet: () => null }))
vi.mock('./MobilePendingActions', () => ({ MobilePendingActions: () => null }))
vi.mock('./use-mobile-code-attachments', () => ({
  useMobileCodeAttachments: () => ({
    attachments: [], busy: false, error: null, enabled: false,
    pick: vi.fn(), remove: vi.fn(), clear: vi.fn(), restore: vi.fn()
  })
}))

let root: Root
let host: HTMLDivElement
let stored: Map<string, string>
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  stored = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key)
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  vi.clearAllMocks()
  state.queuedMessages = []
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

function render(): void {
  act(() => root.render(createElement(MobileCodeConversation, {
    threadId: 't-1', onBack: vi.fn(), onOpenSettings: vi.fn()
  })))
}
const textarea = (): HTMLTextAreaElement => host.querySelector('textarea')!
function type(value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    setter.call(textarea(), value)
    textarea().dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function clickSend(): void {
  act(() => { host.querySelector<HTMLButtonElement>('button[aria-label="send"]')!.click() })
}

describe('mobile Code composer submission', () => {
  it('clears the draft as soon as the message is submitted, not when the turn ends', () => {
    state.sendMessage.mockReturnValue(new Promise(() => undefined))
    render()
    type('hello')
    clickSend()
    expect(state.sendMessage).toHaveBeenCalledWith('hello', 'agent', expect.objectContaining({ expectedThreadId: 't-1' }))
    expect(textarea().value).toBe('')
    expect(stored.get('kun.mobile.code.draft.t-1')).toBe('')
  })

  it('puts a rejected message back ahead of text typed since', async () => {
    let settle!: (sent: boolean) => void
    state.sendMessage.mockReturnValue(new Promise((resolve) => { settle = resolve }))
    render()
    type('hello')
    clickSend()
    type('next')
    await act(async () => settle(false))
    expect(textarea().value).toBe('hello\n\nnext')
  })

  it('shows queued follow-ups with a working remove action', () => {
    state.queuedMessages = [
      { id: 'q-1', text: 'follow up', clientRequestId: 'c-1', deliveryState: 'in_flight' },
      { id: 'q-2', text: 'starting one', clientRequestId: 'c-2', deliveryState: 'starting' }
    ] as QueuedUserMessage[]
    render()
    const items = [...host.querySelectorAll('.kun-mobile-queued li')]
    expect(items.map((item) => item.querySelector('.kun-mobile-queued-text')?.textContent))
      .toEqual(['follow up', 'starting one'])
    expect(items[0]!.querySelector('.kun-mobile-queued-status')?.textContent).toBe('queuedMessageInFlight')
    const [remove, removeStarting] = items.map((item) => item.querySelector('button')!)
    expect(removeStarting!.disabled).toBe(true)
    act(() => remove!.click())
    expect(state.removeQueuedMessage).toHaveBeenCalledWith('q-1')
  })
})

describe('mergeRestoredDraft', () => {
  it('restores into an empty composer and never duplicates the same text', () => {
    expect(mergeRestoredDraft('  hello ', '')).toBe('hello')
    expect(mergeRestoredDraft('hello', 'hello')).toBe('hello')
    expect(mergeRestoredDraft('hello', 'hello\n\nmore')).toBe('hello\n\nmore')
    expect(mergeRestoredDraft('hello', 'other')).toBe('hello\n\nother')
    expect(mergeRestoredDraft('   ', 'other')).toBe('other')
  })
})

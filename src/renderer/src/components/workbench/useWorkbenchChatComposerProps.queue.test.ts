import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatState, QueuedUserMessage } from '../../store/chat-store-types'
import { useWorkbenchChatComposerProps } from './useWorkbenchChatComposerProps'

const mock = vi.hoisted(() => ({ state: {} as ChatState }))
vi.mock('react', () => ({
  useMemo: (factory: () => unknown) => factory(),
  useRef: (value: unknown) => ({ current: value }),
  useEffect: (effect: () => unknown) => { effect() }
}))
vi.mock('../../store/chat-store', () => ({
  useChatStore: Object.assign((selector: (state: ChatState) => unknown) => selector(mock.state), {
    getState: () => mock.state
  })
}))

type Input = Parameters<typeof useWorkbenchChatComposerProps>[0]
function ComposerHarness(message: QueuedUserMessage) {
  let draft = 'initial'
  const setInput = vi.fn((update: Parameters<Input['setInput']>[0]) => {
    draft = typeof update === 'function' ? update(draft) : update
  })
  const restoreAttachments = vi.fn(async () => undefined)
  const setComposerModel = vi.fn()
  const setComposerFastMode = vi.fn()
  mock.state = {
    composerModelGroups: [{ providerId: 'provider', label: 'Provider', modelIds: ['model'], accountId: 'account:provider' }],
    activeThreadId: 'thread', route: 'chat', blocks: [],
    restoreQueuedMessage: async (_id: string, accept?: (message: QueuedUserMessage) => boolean | Promise<boolean>) => {
      draft = 'typed while cancelling'
      return await accept?.(message) ? message : null
    }
  } as unknown as ChatState
  const props = useWorkbenchChatComposerProps({
    input: 'initial', setInput, queuedMessages: [message], route: 'chat', activeThreadId: 'thread',
    taskSurface: 'code', taskSurfaceLocked: false, taskSurfaceTransitioning: false,
    composerMode: 'agent', composerModelGroups: [], composerPickList: [], codeAgentPresets: [],
    restoreComposerAttachments: restoreAttachments, setComposerModel, setComposerFastMode,
    setComposerMode: vi.fn(), setComposerReasoningEffort: vi.fn(), updateComposerExecutionSettings: vi.fn(),
    removeQueuedMessage: vi.fn(), guideQueuedMessage: vi.fn()
  } as unknown as Input)
  return { props, setInput, restoreAttachments, setComposerModel, setComposerFastMode, draft: () => draft }
}

describe('queue composer asynchronous restore', () => {
  beforeEach(() => vi.clearAllMocks())
  it('merges current typing and restores the frozen provider/service tier', async () => {
    const h = ComposerHarness({ id: 'q', text: 'original', providerId: 'provider', model: 'model', accountId: 'account:provider', serviceTier: 'priority' })
    expect(h.props.queuedMessages[0].composerRestoreEligible).toBe(true)
    await expect(h.props.onRestoreQueuedMessageToComposer!('q')).resolves.toBe(true)
    expect(h.draft()).toBe('typed while cancelling\noriginal')
    expect(h.setComposerModel).toHaveBeenCalledWith('model', 'provider')
    expect(h.setComposerFastMode).toHaveBeenCalledWith(true)
  })
  it('does not inject text or settings into a thread selected during attachment restoration', async () => {
    const h = ComposerHarness({ id: 'q', text: 'original', attachments: [{ id: 'image', kind: 'image', name: 'image.png' }] })
    h.restoreAttachments.mockImplementation(async () => { mock.state.activeThreadId = 'other' })
    await expect(h.props.onRestoreQueuedMessageToComposer!('q')).resolves.toBe(false)
    expect(h.setInput).not.toHaveBeenCalled()
    expect(h.setComposerModel).not.toHaveBeenCalled()
  })
  it('does not confirm attachment failures and preserves the existing draft', async () => {
    const h = ComposerHarness({ id: 'q', text: 'original', attachments: [{ id: 'image', kind: 'image', name: 'image.png' }] })
    h.restoreAttachments.mockRejectedValue(new Error('attachment unavailable'))
    await expect(h.props.onRestoreQueuedMessageToComposer!('q')).rejects.toThrow('attachment unavailable')
    expect(h.setInput).not.toHaveBeenCalled()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import type { PetActivitySnapshot, PetFollowUpRequest } from '@shared/pets'
import type { ActivityRow } from '@shared/activity-row'
import { parsePetActivitySnapshot } from '@shared/pets-payload'
import { useChatStore } from '../store/chat-store'
import { useActivityStore } from '../store/activity-store'
import { startPetActivityPublisher, stopPetActivityPublisher } from './pet-publisher'
import { visiblePetNotifications } from './pet-activity'

vi.mock('../store/chat-store', async () => {
  const { create } = await import('zustand')
  return { useChatStore: create(() => ({})) }
})
vi.mock('../components/rooms/workbench-flash', () => ({ showWorkbenchFlash: vi.fn() }))
vi.mock('./pet-conversation-threads', () => ({
  loadPetConversationThreads: async () => [], petConversationSupplements: () => []
}))
vi.mock('../i18n', () => ({ default: { t: (key: string) => key } }))

const started = '2026-11-04T09:00:00.000Z'
let overlayOpen = true
let delivered: PetActivitySnapshot[]
let publish: ReturnType<typeof vi.fn>
let followUp: (request: PetFollowUpRequest) => void
let completeFollowUp: ReturnType<typeof vi.fn>

function thread(id = 'drawing', overrides: Partial<NormalizedThread> = {}): NormalizedThread {
  return { id, title: 'Drawing', updatedAt: started, model: 'model', mode: 'agent', status: 'idle', ...overrides }
}

function latest() {
  const snapshot = delivered.at(-1)
  expect(snapshot).toBeDefined()
  return snapshot!
}

async function flush() {
  for (let index = 0; index < 15; index++) await Promise.resolve()
}

beforeEach(() => {
  overlayOpen = true
  delivered = []
  publish = vi.fn((snapshot: PetActivitySnapshot) => {
    // Exercise the real Main IPC validator: an invalid snapshot never reaches the overlay.
    const parsed = parsePetActivitySnapshot(snapshot)
    if (parsed.ok) delivered.push(parsed.value)
  })
  completeFollowUp = vi.fn()
  const pets = {
    getPetSettings: async () => ({ overlayOpen }),
    updatePetActivity: publish,
    onPetCatalogChanged: () => () => undefined,
    onPetNavigationRequested: () => () => undefined,
    takePendingNavigation: async () => null,
    onFollowUpRequested: (handler: typeof followUp) => { followUp = handler; return () => undefined },
    completeFollowUp,
    onChatRequested: () => () => undefined
  }
  vi.stubGlobal('window', Object.assign(new EventTarget(), {
    kunGui: { pets, appEnvironment: { profilePath: '/profile' } }
  }))
  useActivityStore.setState({ rows: {}, cursor: null, status: 'idle' })
  useChatStore.setState({
    route: 'chat', unreadThreadIds: {}, sideConversations: {},
    sidePanel: { open: false, activeSideId: null }, writeAssistantVisibleThreadId: null,
    threads: [thread()], activeThreadId: 'drawing', busy: true, busyUnconfirmed: false,
    currentTurnId: 'drawing-turn', currentTurnStartedAtMs: Date.parse(started), currentTurnUserId: 'user',
    turnStartedAtByUserId: { user: Date.parse(started) }, awaitingUserInputThreadIds: {},
    blocks: [], liveAssistant: '', liveAssistantTurnId: undefined, liveReasoning: '', liveReasoningTurnId: undefined
  })
})

afterEach(() => {
  stopPetActivityPublisher()
  vi.unstubAllGlobals()
})

describe('pet activity delivery for ordinary conversations', () => {
  it('preserves follow-up request and target identity through the publisher bridge', async () => {
    const sendMessage = vi.fn(async () => true)
    const selectThread = vi.fn(async (threadId: string) => {
      useChatStore.setState({ activeThreadId: threadId })
    })
    useChatStore.setState({ busy: false, selectThread, sendMessage })
    startPetActivityPublisher()
    followUp({ requestId: 'pet-request', threadId: 'drawing', prompt: ' Continue ' })
    await flush()
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith('Continue', 'agent', {
      expectedThreadId: 'drawing', clientRequestId: 'pet-request', submissionGuard: expect.any(Function)
    })
    expect(completeFollowUp).toHaveBeenCalledExactlyOnceWith('pet-request', { ok: true })
  })

  it.each(['code', 'design'] as const)('shows confirmed %s work before the thread list catches up', async (agentSurface) => {
    useChatStore.setState({ threads: [thread('drawing', {
      agentSurface, latestTurnId: 'previous-turn', latestTurnStatus: 'completed'
    })], blocks: [{ kind: 'tool', id: 'image', turnId: 'drawing-turn', summary: 'Generate image',
      status: 'running', meta: { toolName: 'generate_image' } }] })
    startPetActivityPublisher()
    await flush()
    expect(visiblePetNotifications(latest(), new Set(), Date.now())).toMatchObject([
      { threadId: 'drawing', turnId: 'drawing-turn', status: 'running', bubbleAllowed: true }
    ])
    const key = latest().items[0].key
    useChatStore.setState({ liveAssistant: 'Drawing the requested mascot.', liveAssistantTurnId: 'drawing-turn',
      liveAssistantCreatedAt: '2026-11-04T09:00:02.000Z', blocks: [] })
    await flush()
    expect(latest().items).toMatchObject([{ key, subtitle: 'Drawing the requested mascot.' }])
    useChatStore.setState({ busy: false, unreadThreadIds: { drawing: 'completed' }, threads: [thread('drawing', {
      latestTurnId: 'drawing-turn', latestTurnStatus: 'completed', preview: 'The image is ready.'
    })] })
    await flush()
    expect(latest().items).toMatchObject([{ status: 'review', subtitle: 'The image is ready.' }])
  })

  it('publishes a live task even before its thread appears in the sidebar', async () => {
    useChatStore.setState({ threads: [] })
    startPetActivityPublisher()
    await flush()
    expect(latest().items).toMatchObject([{ threadId: 'drawing', status: 'running' }])
  })

  it('switches an earlier text preview back to tool work and thinking, then accepts a shorter fresh reply', async () => {
    useChatStore.setState({ liveAssistant: 'An earlier assistant paragraph that is still cached.',
      liveAssistantTurnId: 'drawing-turn', liveAssistantCreatedAt: '2026-11-04T09:00:01.000Z' })
    startPetActivityPublisher()
    await flush()
    expect(latest().items[0].subtitle).toContain('earlier assistant')
    expect(latest().items[0].liveSinceMs).toBe(Date.parse(started))
    useChatStore.setState({ blocks: [{ kind: 'tool', id: 'read', turnId: 'drawing-turn', status: 'running',
      createdAt: '2026-11-04T09:00:02.000Z', summary: 'Read source', meta: { toolName: 'read_file' } }] })
    await flush()
    expect(latest().items[0].subtitle).toBe('workingToolAction')
    useChatStore.setState({ blocks: [], liveReasoning: 'Think again', liveReasoningTurnId: 'drawing-turn',
      liveReasoningCreatedAt: '2026-11-04T09:00:03.000Z' })
    await flush()
    expect(latest().items[0].subtitle).toBe('thinkingNow')
    useChatStore.setState({ liveAssistant: 'Done.', liveAssistantCreatedAt: '2026-11-04T09:00:04.000Z' })
    await flush()
    expect(latest().items[0].subtitle).toBe('Done.')
  })

  it('does not invent live work from an unconfirmed restored conversation', async () => {
    useChatStore.setState({ busyUnconfirmed: true })
    startPetActivityPublisher()
    await flush()
    expect(latest().items).toEqual([])
  })

  it('keeps an archived conversation silent even while its local state is busy', async () => {
    useChatStore.setState({ threads: [thread('drawing', { archived: true })] })
    startPetActivityPublisher()
    await flush()
    expect(latest().items).toEqual([])
  })

  it('drops the previous turn row while preserving the current task and pending approvals', async () => {
    useActivityStore.setState({ rows: { previous: {
      unitId: 'previous', kind: 'thread', threadId: 'drawing', harnessId: 'kun', title: 'Previous drawing',
      workspace: { path: '/workspace', kind: 'local' }, state: 'working', mainState: 'working',
      children: { working: 0, waiting: 0, done: 0, failed: 0 }, turnId: 'previous-turn',
      stateSince: started, updatedAt: started, provenance: 'runtime', restoredUnconfirmed: false,
      stalled: false, visibility: 'active', residency: 'live', pinned: false
    } satisfies ActivityRow } })
    startPetActivityPublisher()
    await flush()
    expect(latest().items).toMatchObject([{ turnId: 'drawing-turn', status: 'running' }])
    useChatStore.setState({ blocks: [{ kind: 'approval', id: 'approval', approvalId: 'approve-image',
      turnId: 'drawing-turn', summary: 'Generate image?', status: 'pending' }] })
    await flush()
    expect(latest().items).toMatchObject([{ turnId: 'drawing-turn', status: 'waiting' }])
  })

  it('keeps the live task deliverable when more than 64 old completions are listed', async () => {
    const old = Array.from({ length: 90 }, (_, index) => thread(`old-${index}`, {
      latestTurnId: `old-turn-${index}`, latestTurnStatus: 'completed'
    }))
    useChatStore.setState({ threads: [...old, thread('drawing', {
      latestTurnId: 'drawing-turn', latestTurnStatus: 'running'
    })] })
    startPetActivityPublisher()
    await flush()
    expect(latest().items.length).toBeLessThanOrEqual(64)
    expect(latest().items).toContainEqual(expect.objectContaining({ threadId: 'drawing', status: 'running' }))
    expect(visiblePetNotifications(latest(), new Set(), Date.now())[0].threadId).toBe('drawing')
    expect(publish.mock.calls.every(([snapshot]) => parsePetActivitySnapshot(snapshot).ok)).toBe(true)
  })

  it('replays unchanged activity after hiding and waking the pet', async () => {
    useChatStore.setState({ threads: [thread('drawing', { latestTurnStatus: 'running', latestTurnId: 'drawing-turn' })] })
    startPetActivityPublisher()
    await flush()
    const before = delivered.length
    overlayOpen = false
    window.dispatchEvent(new Event('kun-pet-settings-changed'))
    await flush()
    overlayOpen = true
    window.dispatchEvent(new Event('kun-pet-settings-changed'))
    await flush()
    expect(delivered.length).toBeGreaterThan(before)
    expect(latest().items).toContainEqual(expect.objectContaining({ threadId: 'drawing', status: 'running' }))
  })

  it('replays activity after the workbench publisher remounts', async () => {
    useChatStore.setState({ threads: [thread('drawing', { latestTurnStatus: 'running', latestTurnId: 'drawing-turn' })] })
    startPetActivityPublisher()
    await flush()
    const before = delivered.length
    stopPetActivityPublisher()
    startPetActivityPublisher()
    await flush()
    expect(delivered.length).toBeGreaterThan(before)
  })

  it.each(['completed', 'failed'] as const)('shows %s results only while the conversation is unread', async (outcome) => {
    useChatStore.setState({ busy: false, activeThreadId: null, threads: [thread('drawing', {
      latestTurnId: 'drawing-turn', latestTurnStatus: outcome
    })] })
    startPetActivityPublisher()
    await flush()
    expect(visiblePetNotifications(latest(), new Set(), Date.now())).toHaveLength(0)
    useChatStore.setState({ unreadThreadIds: { drawing: outcome } })
    await flush()
    expect(visiblePetNotifications(latest(), new Set(), Date.now())).toHaveLength(1)
    useChatStore.setState({ unreadThreadIds: {} })
    await flush()
    expect(visiblePetNotifications(latest(), new Set(), Date.now())).toHaveLength(0)
    // Metadata refreshes must not recreate an already-read notification under a new key.
    useChatStore.setState({ threads: [thread('drawing', {
      latestTurnId: 'drawing-turn', latestTurnStatus: outcome, updatedAt: '2026-11-04T09:01:00.000Z'
    })] })
    await flush()
    expect(visiblePetNotifications(latest(), new Set(), Date.now())).toHaveLength(0)
    expect(latest().items).toHaveLength(1)
  })

  it('hides the focused conversation result before the central unread clear is delivered', async () => {
    let focused = false
    vi.stubGlobal('document', { visibilityState: 'visible', hasFocus: () => focused })
    useChatStore.setState({ busy: false, unreadThreadIds: { drawing: 'failed' }, threads: [thread('drawing', {
      latestTurnId: 'drawing-turn', latestTurnStatus: 'failed'
    })] })
    startPetActivityPublisher()
    await flush()
    expect(visiblePetNotifications(latest(), new Set(), Date.now())).toHaveLength(1)
    focused = true
    window.dispatchEvent(new Event('focus'))
    await flush()
    expect(visiblePetNotifications(latest(), new Set(), Date.now())).toHaveLength(0)
  })

  it('updates cached activity on mark-as-read even while the pet is hidden', async () => {
    useChatStore.setState({ busy: false, activeThreadId: null, unreadThreadIds: { drawing: 'completed' },
      threads: [thread('drawing', { latestTurnId: 'drawing-turn', latestTurnStatus: 'completed' })] })
    startPetActivityPublisher()
    await flush()
    expect(visiblePetNotifications(latest(), new Set(), Date.now())).toHaveLength(1)
    overlayOpen = false
    window.dispatchEvent(new Event('kun-pet-settings-changed'))
    await flush()
    const before = delivered.length
    useChatStore.setState({ unreadThreadIds: {} })
    await flush()
    expect(delivered.length).toBeGreaterThan(before)
    expect(visiblePetNotifications(latest(), new Set(), Date.now())).toHaveLength(0)
    overlayOpen = true
    window.dispatchEvent(new Event('kun-pet-settings-changed'))
    await flush()
    expect(visiblePetNotifications(latest(), new Set(), Date.now())).toHaveLength(0)
  })

  it('allows a later unread turn to notify again and keeps live work and pending replies visible', async () => {
    useChatStore.setState({ busy: false, activeThreadId: null, threads: [thread('drawing', {
      latestTurnId: 'old', latestTurnStatus: 'completed'
    })] })
    startPetActivityPublisher()
    await flush()
    expect(visiblePetNotifications(latest(), new Set(), Date.now())).toHaveLength(0)
    useChatStore.setState({ unreadThreadIds: { drawing: 'failed' }, threads: [thread('drawing', {
      latestTurnId: 'next', latestTurnStatus: 'failed'
    })] })
    await flush()
    expect(visiblePetNotifications(latest(), new Set(), Date.now())).toMatchObject([{ turnId: 'next', status: 'failed' }])
    useChatStore.setState({ unreadThreadIds: {}, threads: [thread('drawing', {
      latestTurnId: 'later', latestTurnStatus: 'running'
    })] })
    await flush()
    expect(visiblePetNotifications(latest(), new Set(), Date.now())).toMatchObject([{ turnId: 'later', status: 'running' }])
    useChatStore.setState({ threads: [thread('drawing', { latestTurnId: 'later', latestTurnStatus: 'waiting' })] })
    await flush()
    expect(visiblePetNotifications(latest(), new Set(), Date.now())).toMatchObject([{ turnId: 'later', status: 'waiting' }])
  })
})

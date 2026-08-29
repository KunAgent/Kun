import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { drawingHistoryMutationMatches } from '../../design/design-drawing-history'
import {
  canClearDesignHistory,
  DesignAIRail,
  designHistoryInteractionsLocked,
  designHistoryMenuEntries,
  designRailHeaderTitle,
  designThreadTitleLooksDefault,
  hasClearableDesignHistory
} from './DesignAIRail'
import { DesignTargetToggle } from './DesignTargetToggle'

type DesignAIRailProps = ComponentProps<typeof DesignAIRail>

function props(overrides: Partial<DesignAIRailProps> = {}): DesignAIRailProps {
  return {
    input: '',
    setInput: () => {},
    mode: 'agent',
    setMode: () => {},
    busy: false,
    runtimeConnection: 'ready',
    activeThreadId: null,
    blocks: [],
    liveReasoning: '',
    liveAssistant: '',
    composerModel: 'deepseek-chat',
    composerPickList: ['deepseek-chat'],
    composerReasoningEffort: 'auto',
    composerFastMode: false,
    setComposerModel: () => {},
    setComposerReasoningEffort: () => {},
    setComposerFastMode: () => {},
    queuedMessages: [],
    removeQueuedMessage: () => {},
    guideQueuedMessage: () => {},
    onSend: () => {},
    onInterrupt: () => {},
    onRetryConnection: () => {},
    onOpenSettings: () => {},
    drawingTitle: 'Untitled drawing',
    onClearHistory: () => {},
    hasRegisteredHistory: false,
    designThreads: [],
    designHistoryThreadIds: [],
    onSwitchThread: () => {},
    onCollapse: () => {},
    ...overrides
  }
}

beforeEach(() => {
  useDesignWorkspaceStore.setState({
    workspaceRoot: '/tmp/kun-design',
    documents: [],
    activeDocumentId: null,
    artifacts: [],
    activeArtifactId: null,
    designContext: { designTarget: 'web' },
    pagesRun: null,
    drawingHistoryMutation: null,
    drawingCreationSubmitting: false,
    multiPageMode: false
  })
})

describe('DesignAIRail target toggle', () => {
  it('echoes the first user input immediately while the drawing is being prepared', () => {
    const html = renderToStaticMarkup(createElement(DesignAIRail, props({
      input: 'Build an IKUN community homepage',
      drawingCreationSubmitting: true
    })))

    expect(html).toContain('data-design-pending-user-echo="true"')
    expect(html).toContain('Build an IKUN community homepage')
    expect(html).toContain('Preparing the drawing and starting the agent')
  })

  it('shows separate provider/model, reasoning, and Fast controls in the side composer', () => {
    const html = renderToStaticMarkup(createElement(DesignAIRail, props({
      composerModel: 'gpt-5.6-luna',
      composerProviderId: 'codex',
      composerPickList: ['gpt-5.6-luna'],
      composerModelGroups: [{
        providerId: 'codex',
        label: 'Codex',
        modelIds: ['gpt-5.6-luna'],
        modelProfiles: {
          'gpt-5.6-luna': {
            inputModalities: ['text'],
            outputModalities: ['text'],
            supportsToolCalling: true,
            messageParts: ['text'],
            serviceTiers: ['priority']
          }
        }
      }],
      composerReasoningEffort: 'high',
      composerFastMode: true
    })))

    expect(html).toContain('Codex · gpt-5.6-luna')
    expect(html).toContain('aria-label="Reasoning: High"')
    expect(html).toContain('aria-label="Fast mode on"')
    expect(html).toContain('aria-pressed="true"')
  })

  it('exposes queued plain-text messages from the collapsed queue', () => {
    const html = renderToStaticMarkup(createElement(DesignAIRail, props({
      busy: true,
      activeThreadId: 'thread-current-document',
      queuedMessages: [{
        id: 'q-guide',
        text: 'Expanded internal Design prompt with canvas state',
        displayText: 'Use a smaller title',
        guiDesignCanvas: true,
        guiDesignMode: true,
        agentSurface: 'design'
      }],
      designThreads: [{
        id: 'thread-current-document',
        title: 'Settings',
        workspace: '/tmp/kun-design',
        model: 'deepseek-chat',
        mode: 'agent',
        updatedAt: '2026-07-03T00:00:00.000Z'
      }]
    })))

    expect(html).toContain('aria-label="1 queued"')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Clear history"/)
  })

  it('identifies placeholder titles in legacy history entries', () => {
    expect(designThreadTitleLooksDefault('Design Assistant', '设计助手')).toBe(true)
    expect(designThreadTitleLooksDefault('设计助手', '设计助手')).toBe(true)
    expect(designThreadTitleLooksDefault('Kun mobile settings')).toBe(false)
  })

  it('uses the drawing title as the header and hides history switching for one thread', () => {
    const html = renderToStaticMarkup(createElement(DesignAIRail, props({
      drawingTitle: 'Kun thread list',
      activeThreadId: 'thread-current-document',
      blocks: [{ kind: 'user', id: 'user-1', text: 'Design a thread list' }],
      designThreads: [{
        id: 'thread-current-document',
        title: 'Design Assistant',
        workspace: '/tmp/kun-design',
        model: 'deepseek-chat',
        mode: 'agent',
        updatedAt: '2026-07-03T00:00:00.000Z'
      }]
    })))

    expect(html).toContain('Kun thread list')
    expect(html).not.toContain('aria-label="Switch conversation"')
    expect(html).toContain('aria-label="Clear history"')
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Clear history"/)
    expect(html).not.toContain('aria-label="New conversation"')
  })

  it('keeps the drawing title in the rail header while viewing a child history', () => {
    expect(designRailHeaderTitle({
      drawingTitle: 'Kun thread list',
      fallbackTitle: 'Design Assistant',
      viewingChildThread: true
    })).toBe('Kun thread list')
  })

  it('allows clearing a stale registered history even when it is absent from the visible list', () => {
    const html = renderToStaticMarkup(createElement(DesignAIRail, props({
      hasRegisteredHistory: true
    })))

    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Clear history"/)
    expect(html).not.toContain('aria-label="Switch conversation"')
  })

  it('treats a visible empty replacement thread as having no clearable history', () => {
    expect(hasClearableDesignHistory({
      hasRegisteredHistory: true,
      designThreads: [{
        id: 'thread-empty',
        title: 'Design Assistant',
        workspace: '/tmp/kun-design',
        model: 'deepseek-chat',
        mode: 'agent',
        updatedAt: '2026-07-03T00:00:00.000Z'
      }],
      showingDocumentThread: true,
      blocks: [],
      liveReasoning: '',
      liveAssistant: ''
    })).toBe(false)

    const html = renderToStaticMarkup(createElement(DesignAIRail, props({
      activeThreadId: 'thread-empty',
      hasRegisteredHistory: true,
      designThreads: [{
        id: 'thread-empty',
        title: 'Design Assistant',
        workspace: '/tmp/kun-design',
        model: 'deepseek-chat',
        mode: 'agent',
        updatedAt: '2026-07-03T00:00:00.000Z'
      }]
    })))
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Clear history"/)
  })

  it('matches a destructive history lock only to its owning drawing', () => {
    const mutation = {
        workspaceRoot: '/tmp/kun-design',
        documentId: 'doc-delete',
        kind: 'delete' as const
    }
    expect(drawingHistoryMutationMatches(
      mutation,
      '/tmp/kun-design/',
      'doc-delete'
    )).toBe(true)
    expect(drawingHistoryMutationMatches(
      mutation,
      '/tmp/kun-design',
      'another-doc'
    )).toBe(false)
  })

  it('shows the compatibility history switcher only for multiple legacy threads', () => {
    const html = renderToStaticMarkup(createElement(DesignAIRail, props({
      drawingTitle: 'Kun settings',
      activeThreadId: 'thread-new',
      designThreads: [
        {
          id: 'thread-new',
          title: 'Newer history',
          workspace: '/tmp/kun-design',
          model: 'deepseek-chat',
          mode: 'agent',
          updatedAt: '2026-07-03T00:00:00.000Z'
        },
        {
          id: 'thread-old',
          title: 'Older history',
          workspace: '/tmp/kun-design',
          model: 'deepseek-chat',
          mode: 'agent',
          updatedAt: '2026-07-02T00:00:00.000Z'
        }
      ]
    })))

    expect(html).toContain('Kun settings')
    expect(html).toContain('aria-label="Switch conversation"')
    expect(html).not.toContain('aria-label="New conversation"')
  })

  it('locks compatibility history interactions during a destructive mutation', () => {
    expect(designHistoryInteractionsLocked({
      historyClearing: false,
      historyMutationPending: true
    })).toBe(true)
    expect(designHistoryInteractionsLocked({
      historyClearing: false,
      historyMutationPending: false
    })).toBe(false)
  })

  it('renders every registered legacy history with a fallback for an unloaded thread', () => {
    const entries = designHistoryMenuEntries({
      registeredThreadIds: ['thread-loaded', 'thread-not-loaded'],
      designThreads: [{
        id: 'thread-loaded',
        title: 'Loaded history',
        workspace: '/tmp/kun-design',
        model: 'deepseek-chat',
        mode: 'agent',
        updatedAt: '2026-07-03T00:00:00.000Z'
      }],
      localizedDefaultTitle: 'Design Assistant',
      fallbackTitle: (index) => `History ${index + 1}`
    })

    expect(entries).toEqual([
      {
        id: 'thread-loaded',
        title: 'Loaded history',
        updatedAt: '2026-07-03T00:00:00.000Z'
      },
      {
        id: 'thread-not-loaded',
        title: 'History 2',
        updatedAt: null
      }
    ])
  })

  it.each([
    { field: 'status', patch: { status: 'running' } },
    { field: 'latestTurnStatus', patch: { latestTurnStatus: 'in_progress' } }
  ])('disables history clearing when any design thread has a running $field', ({ patch }) => {
    const html = renderToStaticMarkup(createElement(DesignAIRail, props({
      drawingTitle: 'Kun settings',
      activeThreadId: 'thread-current',
      designThreads: [
        {
          id: 'thread-current',
          title: 'Current history',
          workspace: '/tmp/kun-design',
          model: 'deepseek-chat',
          mode: 'agent',
          status: 'idle',
          latestTurnStatus: 'completed',
          updatedAt: '2026-07-03T00:00:00.000Z'
        },
        {
          id: 'thread-background',
          title: 'Background history',
          workspace: '/tmp/kun-design',
          model: 'deepseek-chat',
          mode: 'agent',
          updatedAt: '2026-07-02T00:00:00.000Z',
          ...patch
        }
      ]
    })))

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Clear history"/)
  })

  it('locks history clearing while offline, busy, in a child thread, or without history', () => {
    expect(canClearDesignHistory({
      runtimeConnection: 'ready',
      busy: false,
      viewingChildThread: false,
      hasHistory: true
    })).toBe(true)
    expect(canClearDesignHistory({
      runtimeConnection: 'offline',
      busy: false,
      viewingChildThread: false,
      hasHistory: true
    })).toBe(false)
    expect(canClearDesignHistory({
      runtimeConnection: 'ready',
      busy: true,
      viewingChildThread: false,
      hasHistory: true
    })).toBe(false)
    expect(canClearDesignHistory({
      runtimeConnection: 'ready',
      busy: false,
      viewingChildThread: true,
      hasHistory: true
    })).toBe(false)
    expect(canClearDesignHistory({
      runtimeConnection: 'ready',
      busy: false,
      viewingChildThread: false,
      hasHistory: false
    })).toBe(false)
  })

  it('does not render blocks from a thread outside the active design document', () => {
    const html = renderToStaticMarkup(
      createElement(DesignAIRail, props({
        activeThreadId: 'thread-old-document',
        blocks: [
          { kind: 'user', id: 'u1', text: 'old document request' },
          { kind: 'assistant', id: 'a1', text: 'old document answer' }
        ],
        liveReasoning: 'old live reasoning',
        liveAssistant: 'old live answer',
        designThreads: []
      }))
    )

    expect(html).not.toContain('old document request')
    expect(html).not.toContain('old document answer')
    expect(html).not.toContain('old live reasoning')
    expect(html).not.toContain('old live answer')
    expect(html).toContain('Describe the UI you want to design. The assistant will generate it for you.')
  })

  it('shows the design target toggle with Web selected by default', () => {
    const html = renderToStaticMarkup(createElement(DesignAIRail, props()))

    expect(html).toContain('Choose whether the design agent defaults to web pages or mobile app screens')
    expect(html).toContain('aria-label="Web: Default 1280 x 800 web frame"')
    expect(html).toContain('aria-label="App: Default 390 x 844 app frame"')
    expect(html).toContain('Agent context')
    expect(html).toContain('aria-label="Agent context: Web - Default 1280 x 800 web frame"')
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>[\s\S]*?Web<\/button>/)
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>[\s\S]*?App<\/button>/)
    expect(html).toContain('dark:bg-[#343c4a]')
    expect(html).toContain('dark:ring-white/15')
    expect(html).not.toContain('dark:bg-white/14')
  })

  it('reflects the selected App target and locks switching while busy', () => {
    const html = renderToStaticMarkup(
      createElement(DesignTargetToggle, {
        designTarget: 'app',
        disabled: true,
        disabledReason: 'Design target switching is locked while the design agent is working',
        onChange: () => {}
      })
    )

    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*disabled=""[^>]*>[\s\S]*?Web<\/button>/)
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*disabled=""[^>]*>[\s\S]*?App<\/button>/)
    expect(html).toContain('aria-label="Design target switching is locked while the design agent is working"')
    expect(html).toContain(
      'aria-label="App: Default 390 x 844 app frame. Design target switching is locked while the design agent is working"'
    )
    expect(html).toContain(
      'title="Default 390 x 844 app frame. Design target switching is locked while the design agent is working"'
    )
  })

  it('explains why the rail target switch is disabled while the agent is busy', () => {
    const html = renderToStaticMarkup(createElement(DesignAIRail, props({
      activeThreadId: 'thread-current-document',
      busy: true,
      designThreads: [{
        id: 'thread-current-document',
        title: 'Design Assistant',
        workspace: '/tmp/kun-design',
        model: 'deepseek-chat',
        mode: 'agent',
        updatedAt: '2026-07-03T00:00:00.000Z'
      }]
    })))

    expect(html).toContain('Design target switching is locked while the design agent is working')
    expect(html).toContain(
      'aria-label="Web: Default 1280 x 800 web frame. Design target switching is locked while the design agent is working"'
    )
  })
})

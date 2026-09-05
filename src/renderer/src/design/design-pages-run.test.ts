import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../store/chat-store'
import { useDesignWorkspaceStore } from './design-workspace-store'
import { interruptDesignPagesRun, isDesignPagesRunActive, runDesignPages } from './design-pages-run'
import { beginDesignPagesRun, finishDesignPagesRun } from './design-pages-run/orchestration-support'
import type { ChatBlock } from '../agent/types'
import type { DesignArtifact, DesignDocument } from './design-types'
import type { SendMessageOverrides } from '../store/chat-store-types'

const createdAt = '2026-06-28T00:00:00.000Z'

const board: DesignArtifact = {
  id: 'board',
  kind: 'canvas',
  title: 'Board',
  relativePath: '.kun-design/doc/board/canvas.json',
  createdAt,
  updatedAt: createdAt,
  versions: []
}

function pushRuntimeTurn(prompt: string, assistantBlocks: ChatBlock[]): void {
  const user: ChatBlock = {
    kind: 'user',
    id: `user_${Math.random().toString(36).slice(2)}`,
    text: prompt,
    createdAt
  }
  useChatStore.setState((state) => ({
    blocks: [...state.blocks, user],
    currentTurnId: `turn_${Math.random().toString(36).slice(2)}`,
    liveAssistant: ''
  }))
  setTimeout(() => {
    useChatStore.setState((state) => ({
      blocks: [...state.blocks, ...assistantBlocks],
      currentTurnId: null,
      liveAssistant: ''
    }))
  }, 0)
}

function pageLabels(prompt: string): string[] {
  return [...prompt.matchAll(/page:([a-zA-Z0-9_-]+)/g)]
    .map((match) => match[1])
    .filter((value, index, all) => value && all.indexOf(value) === index)
}

describe('runDesignPages parallel fanout', () => {
  const writeWorkspaceFile = vi.fn(async (_payload: { path?: string }) => ({ ok: true as const }))

  beforeEach(() => {
    vi.stubGlobal('window', { kunGui: { writeWorkspaceFile } })
    writeWorkspaceFile.mockClear()
    useChatStore.setState({
      activeThreadId: 'thr_design',
      blocks: [],
      busy: false,
      currentTurnId: null,
      liveAssistant: '',
      liveReasoning: ''
    })
    const doc: DesignDocument = {
      id: 'doc',
      title: 'Doc',
      createdAt,
      updatedAt: createdAt,
      order: 0,
      artifacts: [board],
      activeArtifactId: board.id
    }
    useDesignWorkspaceStore.setState({
      workspaceRoot: '/workspace',
      documents: [doc],
      activeDocumentId: 'doc',
      artifacts: [board],
      activeArtifactId: board.id,
      pagesRun: null,
      parallelPageStates: {},
      fileError: null
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('cancels the local orchestration before interrupting the runtime turn', () => {
    const signal = { cancelled: false }
    expect(beginDesignPagesRun(signal)).toBe(true)
    const order: string[] = []
    try {
      interruptDesignPagesRun(() => {
        order.push('runtime-interrupt')
        expect(signal.cancelled).toBe(true)
      })
      expect(order).toEqual(['runtime-interrupt'])
      expect(signal.cancelled).toBe(true)
    } finally {
      finishDesignPagesRun(signal)
    }
  })

  it('stops a live fanout without scheduling another design turn', async () => {
    let fanoutStarted!: () => void
    const fanoutReady = new Promise<void>((resolve) => {
      fanoutStarted = resolve
    })
    const sendMessage = vi.fn(async (prompt: string) => {
      if (prompt.includes('PLAN a multi-page')) {
        pushRuntimeTurn(prompt, [{
          kind: 'assistant',
          id: 'assistant_cancel_plan',
          text: '```pages\n[{"title":"Home","brief":"Home page"},{"title":"Settings","brief":"Settings page"}]\n```',
          createdAt
        }])
        return true
      }
      fanoutStarted()
      useChatStore.setState({ currentTurnId: 'turn_fanout', busy: true })
      return true
    })

    const runPromise = runDesignPages({
      brief: 'Cancelable project',
      workspaceRoot: '/workspace',
      sendMessage,
      foundation: false,
      expectedThreadId: 'thr_design'
    })
    await fanoutReady
    expect(isDesignPagesRunActive()).toBe(true)

    interruptDesignPagesRun(() => {
      useChatStore.setState({ currentTurnId: null, busy: false })
    })
    await runPromise

    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(isDesignPagesRunActive()).toBe(false)
    expect(useDesignWorkspaceStore.getState().pagesRun).toBeNull()
    expect(writeWorkspaceFile.mock.calls.some((call) => (
      call[0] as { path?: string } | undefined
    )?.path === '.kun-design/HANDOFF.md')).toBe(false)
  })

  it('pre-creates all pages and sends one fanout turn for page generation', async () => {
    const onFirstSendSettled = vi.fn()
    const sendMessage = vi.fn(async (
      prompt: string,
      _mode?: string,
      _overrides?: SendMessageOverrides
    ) => {
      if (prompt.includes('PLAN a multi-page')) {
        pushRuntimeTurn(prompt, [
          {
            kind: 'assistant',
            id: 'assistant_plan',
            text: '```pages\n[{"title":"Landing","brief":"Landing page","userGoal":"Decide whether to join the IKUN community","dataExamples":["8,421 active members","June watch party","VIP tier $12"],"states":["loading featured posts","empty events"],"primaryAction":"Join community","linksTo":["Community"]},{"title":"Community","brief":"Community feed","userGoal":"Browse member stories and post an update","dataExamples":["Mina Chen","3 new replies","Shanghai fan club"],"states":["empty feed","posting disabled"],"primaryAction":"Post update","linksTo":["Landing"]}]\n```',
            createdAt
          }
        ])
        return true
      }
      const labels = pageLabels(prompt)
      pushRuntimeTurn(
        prompt,
        labels.map((artifactId, index) => ({
          kind: 'tool' as const,
          id: `tool_${artifactId}`,
          summary: 'delegate_task',
          status: 'success' as const,
          detail: JSON.stringify({
            label: `page:${artifactId}`,
            childId: `child_${index + 1}`,
            status: 'completed',
            summary: `Finished ${artifactId}`
          }),
          meta: { toolName: 'delegate_task' }
        }))
      )
      return true
    })

    await runDesignPages({
      brief: 'IKUN community',
      workspaceRoot: '/workspace',
      sendMessage,
      foundation: false,
      serviceTier: 'priority',
      expectedThreadId: 'thr_design',
      onFirstSendSettled
    })

    expect(onFirstSendSettled).toHaveBeenCalledTimes(1)
    expect(onFirstSendSettled).toHaveBeenCalledWith(true)
    expect(sendMessage).toHaveBeenCalledTimes(2)
    for (const call of sendMessage.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({
        agentSurface: 'design',
        serviceTier: 'priority',
        expectedThreadId: 'thr_design'
      }))
    }
    const fanoutPrompt = String(sendMessage.mock.calls[1]?.[0] ?? '')
    expect(fanoutPrompt).toContain('fan out a multi-page design build')
    expect(fanoutPrompt).toContain('delegate_task')
    expect(fanoutPrompt).toContain('User goal for this page: Decide whether to join the IKUN community')
    expect(fanoutPrompt).toContain('Required realistic content/data to visibly include:')
    expect(fanoutPrompt).toContain('8,421 active members')
    expect(fanoutPrompt).toContain('Key UI states to represent or document in the screen:')
    expect(fanoutPrompt).toContain('loading featured posts')
    expect(fanoutPrompt).toContain('Primary prototype action for this page: Join community')
    expect(fanoutPrompt).toContain('Planned outgoing prototype links from this page:')
    expect(fanoutPrompt).toContain('Use these exact href values')
    expect(fanoutPrompt).toContain('Job 2: Community')
    expect(fanoutPrompt).toContain('Community feed')
    expect(fanoutPrompt).toMatch(/\\?"Community\\?" -> href `\.\.\/[a-z0-9_-]+\/v1\.html`/)
    expect(fanoutPrompt).toContain('prototype href: ../')
    const artifacts = useDesignWorkspaceStore.getState().artifacts
      .filter((artifact) => artifact.kind === 'html')
    expect(artifacts).toHaveLength(2)
    expect(new Set(artifacts.map((artifact) => artifact.direction?.id))).toHaveLength(1)
    expect(artifacts.every((artifact) => artifact.direction?.name === 'IKUN community')).toBe(true)
    expect(useDesignWorkspaceStore.getState().pagesRun).toBeNull()
    expect(Object.values(useDesignWorkspaceStore.getState().parallelPageStates)).toHaveLength(2)
    expect(Object.values(useDesignWorkspaceStore.getState().parallelPageStates).every((state) => state.status === 'done')).toBe(true)
    const htmlWrites = writeWorkspaceFile.mock.calls.filter((call) => {
      const payload = call[0] as { path?: string } | undefined
      return String(payload?.path ?? '').endsWith('/v1.html')
    })
    expect(htmlWrites).toHaveLength(2)
    const projectDesignMdWrite = writeWorkspaceFile.mock.calls.find((call) => {
      const payload = call[0] as { path?: string; content?: string } | undefined
      return payload?.path === '.kun-design/HANDOFF.md'
    })?.[0] as { content?: string } | undefined
    expect(projectDesignMdWrite?.content).toContain('# DESIGN.md: Doc')
    expect(projectDesignMdWrite?.content).toContain('IKUN community')
    expect(projectDesignMdWrite?.content).toContain('Join community')
    expect(projectDesignMdWrite?.content).toContain('../')
  })

  it('reports a rejected first runtime send exactly once and stops before creating pages', async () => {
    const onFirstSendSettled = vi.fn()
    const sendMessage = vi.fn(async () => false)

    await runDesignPages({
      brief: 'IKUN community',
      workspaceRoot: '/workspace',
      sendMessage,
      foundation: false,
      onFirstSendSettled
    })

    expect(onFirstSendSettled).toHaveBeenCalledTimes(1)
    expect(onFirstSendSettled).toHaveBeenCalledWith(false)
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(useDesignWorkspaceStore.getState().artifacts).toEqual([board])
    expect(useDesignWorkspaceStore.getState().fileError).toBe(
      'Could not start the multi-page planning turn.'
    )
  })

  it('does not queue a multi-page step behind an unrelated active turn', async () => {
    useChatStore.setState({ busy: true, currentTurnId: 'turn_existing' })
    const onFirstSendSettled = vi.fn()
    const sendMessage = vi.fn(async () => true)

    await runDesignPages({
      brief: 'Queued project',
      workspaceRoot: '/workspace',
      sendMessage,
      foundation: false,
      expectedThreadId: 'thr_design',
      designDocumentTarget: { documentId: 'doc', boardArtifactId: 'board' },
      onFirstSendSettled
    })

    expect(sendMessage).not.toHaveBeenCalled()
    expect(onFirstSendSettled).toHaveBeenCalledTimes(1)
    expect(onFirstSendSettled).toHaveBeenCalledWith(false)
    expect(useDesignWorkspaceStore.getState().artifacts).toEqual([board])
  })

  it('pre-creates app-target page drafts with mobile preview proportions and prototype links', async () => {
    const sendMessage = vi.fn(async (
      prompt: string,
      _mode?: string,
      _overrides?: SendMessageOverrides
    ) => {
      if (prompt.includes('PLAN a multi-page')) {
        pushRuntimeTurn(prompt, [
          {
            kind: 'assistant',
            id: 'assistant_plan_app',
            text: '```pages\n[{"title":"Today","brief":"Mobile today screen with bottom tabs and a primary check-in action","primaryAction":"Check in","linksTo":["Stats"]},{"title":"Stats","brief":"Mobile stats screen with weekly trend and back navigation","primaryAction":"Review week","linksTo":["Today"]}]\n```',
            createdAt
          }
        ])
        return true
      }
      const labels = pageLabels(prompt)
      pushRuntimeTurn(
        prompt,
        labels.map((artifactId, index) => ({
          kind: 'tool' as const,
          id: `tool_app_${artifactId}`,
          summary: 'delegate_task',
          status: 'success' as const,
          detail: JSON.stringify({
            label: `page:${artifactId}`,
            childId: `child_app_${index + 1}`,
            status: 'completed',
            summary: `Finished ${artifactId}`
          }),
          meta: { toolName: 'delegate_task' }
        }))
      )
      return true
    })

    await runDesignPages({
      brief: 'Habit tracker app',
      workspaceRoot: '/workspace',
      sendMessage,
      foundation: false,
      designContext: { designTarget: 'app' }
    })

    const planPrompt = String(sendMessage.mock.calls[0]?.[0] ?? '')
    const fanoutPrompt = String(sendMessage.mock.calls[1]?.[0] ?? '')
    expect(planPrompt).toContain('multi-page mobile app prototype')
    expect(planPrompt).toContain('390x844 phone frame')
    expect(fanoutPrompt).toContain('Design target: App')
    expect(fanoutPrompt).toContain('390x844 phone portrait')

    const artifacts = useDesignWorkspaceStore.getState().artifacts
      .filter((artifact) => artifact.kind === 'html')
    expect(artifacts).toHaveLength(2)
    expect(artifacts.every((artifact) => artifact.node?.width === 300 && artifact.node.height === 640)).toBe(true)
    expect(artifacts.every((artifact) => artifact.prototypeLinks?.length === 1)).toBe(true)
    expect(artifacts.map((artifact) => artifact.prototypeLinks?.[0]?.href)).toEqual(
      expect.arrayContaining([expect.stringMatching(/\.\.\/.+\/v1\.html/)])
    )
  })

  it('fails closed when the user switches tasks during fanout without writing or completing the new drawing', async () => {
    const boardB: DesignArtifact = {
      ...board,
      id: 'board_b',
      relativePath: '.kun-design/doc_b/board_b/canvas.json'
    }
    const docB: DesignDocument = {
      id: 'doc_b',
      title: 'Other drawing',
      createdAt,
      updatedAt: createdAt,
      order: 1,
      artifacts: [boardB],
      activeArtifactId: boardB.id
    }
    const sendMessage = vi.fn(async (
      prompt: string,
      _mode?: string,
      _overrides?: SendMessageOverrides
    ) => {
      if (prompt.includes('PLAN a multi-page')) {
        pushRuntimeTurn(prompt, [{
          kind: 'assistant',
          id: 'assistant_switch_plan',
          text: '```pages\n[{"title":"A Home","brief":"Home page"},{"title":"A Shop","brief":"Shop page"}]\n```',
          createdAt
        }])
        return true
      }
      const state = useDesignWorkspaceStore.getState()
      useDesignWorkspaceStore.setState({
        documents: [...state.documents, docB],
        activeDocumentId: docB.id,
        artifacts: docB.artifacts,
        activeArtifactId: docB.activeArtifactId
      })
      useChatStore.setState({
        activeThreadId: 'thr_other',
        blocks: [],
        currentTurnId: null,
        liveAssistant: '',
        liveReasoning: ''
      })
      return true
    })

    await runDesignPages({
      brief: 'Pinned project A',
      workspaceRoot: '/workspace',
      sendMessage,
      foundation: false,
      expectedThreadId: 'thr_design',
      designDocumentTarget: { documentId: 'doc', boardArtifactId: 'board' }
    })

    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(sendMessage.mock.calls[0]?.[2]).not.toHaveProperty('messageSource')
    expect(sendMessage.mock.calls[1]?.[2]).toEqual(expect.objectContaining({
      expectedThreadId: 'thr_design',
      designDocumentTarget: { documentId: 'doc', boardArtifactId: 'board' },
      messageSource: 'design_continuation'
    }))
    const state = useDesignWorkspaceStore.getState()
    const source = state.documents.find((document) => document.id === 'doc')
    const other = state.documents.find((document) => document.id === 'doc_b')
    expect(source?.artifacts.filter((artifact) => artifact.kind === 'html')).toHaveLength(2)
    expect(other?.artifacts).toEqual([boardB])
    expect(Object.values(state.parallelPageStates).every((page) => page.status === 'queued')).toBe(true)
    expect(state.pagesRun).toBeNull()
    expect(writeWorkspaceFile.mock.calls.some((call) => (
      call[0] as { path?: string } | undefined
    )?.path === '.kun-design/HANDOFF.md')).toBe(false)
  })
})

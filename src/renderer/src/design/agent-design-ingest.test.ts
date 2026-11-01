import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesignOpenRequestMetadata } from '../agent/design-open-request'
import type { ChatBlock } from '../agent/types'
import type { DesignArtifact } from './design-types'
import { agentDesignArtifacts, openAgentDesignCanvas } from './agent-design-ingest'
import { useDesignWorkspaceStore } from './design-workspace-store'
import { useCodeCanvasDesignSurface } from './code-canvas-design-surface'
import { takeLiveDesignRequests } from '../components/workbench/useAgentDesignAutoOpen'

const NOW = '2026-10-24T08:00:00.000Z'
const initialDesignState = useDesignWorkspaceStore.getState()
const initialSurfaceState = useCodeCanvasDesignSurface.getState()
afterEach(() => {
  useDesignWorkspaceStore.setState(initialDesignState, true)
  useCodeCanvasDesignSurface.setState(initialSurfaceState, true)
  vi.unstubAllGlobals()
})

function request(screens: { id: string; name: string; width?: number; height?: number; section?: string }[]): DesignOpenRequestMetadata {
  return {
    status: 'ready',
    title: 'Tray',
    requestId: 'design_0123456789abcdef',
    documentId: '0a1b2c3d',
    screenCount: screens.length,
    screens: screens.map((screen) => ({
      artifactId: screen.id,
      name: screen.name,
      relativePath: `.kun-design/0a1b2c3d/${screen.id}/v1.html`,
      width: screen.width ?? 1280,
      height: screen.height ?? 800,
      ...(screen.section ? { section: screen.section } : {})
    }))
  }
}

function existing(id: string, x: number, width: number, extra: Partial<DesignArtifact> = {}): DesignArtifact {
  return {
    id,
    kind: 'html',
    title: 'Old',
    relativePath: `.kun-design/0a1b2c3d/${id}/v1.html`,
    createdAt: '2026-10-23T00:00:00.000Z',
    updatedAt: '2026-10-23T00:00:00.000Z',
    versions: [],
    node: { x, y: 0, width, height: 800 },
    ...extra
  }
}

describe('agent design ingest', () => {
  it.each(['selection', 'workspace'] as const)('does not reveal or mutate a stale design after %s changes during loading', async (change) => {
    let finish!: () => void
    let current = true
    const createDocument = vi.fn()
    const upsertArtifact = vi.fn()
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { dispatchEvent })
    useDesignWorkspaceStore.setState({
      workspaceRoot: '/repo', settingsLoaded: false, documents: [], activeDocumentId: null,
      createDocument, upsertArtifact,
      loadDesignSettings: () => new Promise<void>((resolve) => { finish = resolve })
    })
    const opening = openAgentDesignCanvas({
      threadId: 'thread-a', workspaceRoot: '/repo',
      request: request([{ id: '11111111', name: 'Overview' }]), isCurrent: () => current
    })
    if (change === 'selection') current = false
    else useDesignWorkspaceStore.setState({ workspaceRoot: '/other' })
    finish()
    expect(await opening).toBe(false)
    expect(createDocument).not.toHaveBeenCalled()
    expect(upsertArtifact).not.toHaveBeenCalled()
    expect(useCodeCanvasDesignSurface.getState().surface).toBe(initialSurfaceState.surface)
    expect(dispatchEvent).not.toHaveBeenCalled()
  })

  it('reveals a valid design with the originating conversation on its open event', async () => {
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { dispatchEvent })
    useDesignWorkspaceStore.setState({
      workspaceRoot: '/repo', settingsLoaded: true, documents: [], activeDocumentId: '0a1b2c3d',
      createDocument: vi.fn(), upsertArtifact: vi.fn(), setActiveArtifact: vi.fn()
    })
    expect(await openAgentDesignCanvas({
      threadId: 'thread-a', workspaceRoot: '/repo', request: request([{ id: '11111111', name: 'Overview' }])
    })).toBe(true)
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ detail: { target: 'code', threadId: 'thread-a' } }))
  })

  it('lays new screens out in one row after the existing ones', () => {
    const appended = agentDesignArtifacts(
      request([{ id: '33333333', name: 'Next' }]),
      [existing('aaaaaaaa', 0, 1280), existing('bbbbbbbb', 1440, 390)],
      NOW
    )
    expect(appended[0].node).toMatchObject({ x: 1990, y: 0 })

    const artifacts = agentDesignArtifacts(
      request([{ id: '11111111', name: 'Tray' }, { id: '22222222', name: 'Open', width: 390 }]),
      [],
      NOW
    )
    expect(artifacts.map((artifact) => [artifact.id, artifact.node?.x, artifact.node?.width])).toEqual([
      ['11111111', 0, 1280],
      ['22222222', 1440, 390]
    ])
    expect(artifacts[0]).toMatchObject({
      kind: 'html',
      title: 'Tray',
      relativePath: '.kun-design/0a1b2c3d/11111111/v1.html',
      designMdPath: '.kun-design/0a1b2c3d/11111111/DESIGN.md',
      previewStatus: 'pending',
      node: { sizeMode: 'manual-width-auto-height', viewMode: 'preview' }
    })
  })

  it('gives every section its own row, stacked in the order sections appear', () => {
    const first = agentDesignArtifacts(request([
      { id: '11111111', name: 'Overview', section: '01 Flow' },
      { id: '22222222', name: 'Detail', section: '01 Flow', width: 390, height: 1200 },
      { id: '33333333', name: 'Light', section: '02 Themes' },
      { id: '44444444', name: 'Dark', section: '02 Themes' }
    ]), [], NOW)
    expect(first.map((artifact) => [artifact.boardSection, artifact.node?.x, artifact.node?.y])).toEqual([
      ['01 Flow', 0, 0],
      ['01 Flow', 1440, 0],
      ['02 Themes', 0, 1600],
      ['02 Themes', 1440, 1600]
    ])
    // A later call continues a known section's row and opens new sections below everything.
    const later = agentDesignArtifacts(request([
      { id: '55555555', name: 'Error', section: ' 01  flow ' },
      { id: '66666666', name: 'Tokens', section: 'Components' }
    ]), first, NOW)
    expect(later.map((artifact) => [artifact.node?.x, artifact.node?.y])).toEqual([[1990, 0], [0, 2800]])
  })

  it('keeps a known screen where the user put it and only refreshes it', () => {
    const moved = existing('11111111', 900, 640)
    const [refreshed] = agentDesignArtifacts(request([{ id: '11111111', name: 'Tray v2' }]), [moved], NOW)
    expect(refreshed).toEqual({ ...moved, title: 'Tray v2', updatedAt: NOW })
  })

  it('opens only designs that arrived in this window', () => {
    const designBlock = (id: string, status: string, turnId: string): ChatBlock => ({
      kind: 'tool',
      id,
      turnId,
      summary: 'design_open',
      status: status === 'pending' ? 'running' : 'success',
      toolKind: 'file_change',
      meta: {
        toolName: 'design_open',
        designOpenRequest: status === 'pending'
          ? { status: 'pending', title: 'Tray', screenCount: 1 }
          : { ...request([{ id: '11111111', name: 'Tray' }]), requestId: `design_${id.padEnd(16, '0')}` }
      }
    } as unknown as ChatBlock)
    const seen = new Set<string>()
    const handled = new Set<string>()

    // History replay: a finished design from an earlier turn is not reopened.
    expect(takeLiveDesignRequests([designBlock('aaaa', 'ready', 'turn-old')], { busy: false, currentTurnId: null }, seen, handled))
      .toEqual([])
    // A call seen streaming, then finished, opens once.
    takeLiveDesignRequests([designBlock('bbbb', 'pending', 'turn-new')], { busy: true, currentTurnId: 'turn-new' }, seen, handled)
    const live = takeLiveDesignRequests([designBlock('bbbb', 'ready', 'turn-new')], { busy: false, currentTurnId: null }, seen, handled)
    expect(live.map((item) => item.blockId)).toEqual(['bbbb'])
    expect(takeLiveDesignRequests([designBlock('bbbb', 'ready', 'turn-new')], { busy: false, currentTurnId: null }, seen, handled))
      .toEqual([])
    // A result that lands while its turn is still running also opens.
    expect(takeLiveDesignRequests([designBlock('cccc', 'ready', 'turn-run')], { busy: true, currentTurnId: 'turn-run' }, seen, handled)
      .map((item) => item.blockId)).toEqual(['cccc'])
    // A pending item replayed from a settled or different turn is not live.
    takeLiveDesignRequests([designBlock('dddd', 'pending', 'turn-old')], { busy: false, currentTurnId: null }, seen, handled)
    expect(takeLiveDesignRequests([designBlock('dddd', 'ready', 'turn-old')], { busy: false, currentTurnId: null }, seen, handled)).toEqual([])
    takeLiveDesignRequests([designBlock('eeee', 'pending', 'turn-old')], { busy: true, currentTurnId: 'turn-new' }, seen, handled)
    expect(takeLiveDesignRequests([designBlock('eeee', 'ready', 'turn-old')], { busy: false, currentTurnId: null }, seen, handled)).toEqual([])
  })
})

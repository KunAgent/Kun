import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import {
  FloatingComposerGraphPreview,
  GraphPlanningCorrectionSheet,
  GraphProgressSegment,
  GraphProgressSheet
} from './FloatingComposerGraphProgress'
import { GRAPH_INSPECT_HOVER_DELAY_MS, graphInspectorLivenessLabel } from './FloatingComposerGraphPreview'
import {
  COMPOSER_GRAPH_MIN_SCALE,
  getComposerGraphProgress,
  layoutComposerGraph,
  selectComposerGraphRun
} from './composer-graph-preview'
import {
  graphTestCorrection,
  graphTestRun,
  graphTestRunWithChild
} from './composer-tray/graph-tray-test-fixtures'

function nodeButton(renderer: ReactTestRenderer, nodeId: string): ReactTestInstance {
  return renderer.root.find((instance) =>
    instance.type === 'button' && instance.props['data-graph-preview-node'] === nodeId)
}

function textOf(instance: ReactTestInstance): string {
  return instance.children
    .map((child) => (typeof child === 'string' ? child : textOf(child)))
    .join('')
}

describe('composer Graph progress projection', () => {
  it('selects only active runs for the composer progress surface', () => {
    const failed = graphTestRun({ id: 'failed', status: 'failed' })
    const active = graphTestRun({ id: 'active' })

    expect(selectComposerGraphRun([failed, active], 'failed')?.id).toBe('active')
    expect(selectComposerGraphRun([failed], 'failed')).toBeNull()
    expect(selectComposerGraphRun([], null)).toBeNull()
  })

  it('projects progress, ordered phases, assigned subagents, and directed edges', () => {
    const run = graphTestRun()
    expect(getComposerGraphProgress(run)).toEqual({
      completed: 1,
      total: 3,
      fraction: 1 / 3,
      activeAgents: ['Builder'],
      activeCount: 1,
      activeNodeIds: ['implement'],
      activeNodeTitles: ['Node implement'],
      currentNodeTitle: 'Node implement',
      currentNodeId: 'implement',
      currentStatus: 'running',
      currentAgent: 'Builder',
      attemptNumber: null,
      childThreadId: null,
      childRuntime: null
    })

    const layout = layoutComposerGraph(run)
    expect(layout.phases.map((phase) => phase.id)).toEqual(['discover', 'build', 'verify'])
    expect(layout.nodes.map((node) => node.id)).toEqual(['audit', 'implement', 'review'])
    expect(layout.nodes.find((node) => node.id === 'implement')?.agentName).toBe('Builder')
    expect(layout.edges).toHaveLength(2)
    expect(layout.edges[0]?.path).toMatch(/^M .+ C .+/)
    expect(layout.edges.map((edge) => [edge.id, edge.flowing])).toEqual([
      ['edge_audit_build', true],
      ['edge_build_review', false]
    ])
  })

  it.each(['submitted', 'reviewing'] as const)(
    'keeps edges into a %s node static while no Lead lease exists',
    (status) => {
      const run = graphTestRun()
      run.nodes.implement!.status = status

      expect(layoutComposerGraph(run).edges.map((edge) => [edge.id, edge.flowing])).toEqual([
        ['edge_audit_build', false],
        ['edge_build_review', false]
      ])
      expect(getComposerGraphProgress(run).activeCount).toBe(0)
    }
  )

  it('flows into a review node only while the Lead holds active review work', () => {
    const run = graphTestRun()
    run.nodes.implement!.status = 'reviewing'
    run.supervision = {
      version: 1,
      runId: run.id,
      lastEventSeq: run.lastEventSeq,
      leadActive: true,
      liveness: 'active_review',
      pendingActions: [{
        obligationId: 'obligation_review',
        pendingAction: 'review_required',
        nodeIds: ['implement'],
        liveness: 'active_review',
        retryCount: 0,
        noProgressCount: 0,
        canWake: false
      }],
      canWake: false,
      updatedAt: run.updatedAt
    }

    expect(layoutComposerGraph(run).edges.map((edge) => [edge.id, edge.flowing])).toEqual([
      ['edge_audit_build', true],
      ['edge_build_review', false]
    ])
    expect(getComposerGraphProgress(run).activeCount).toBe(1)
  })

  it('continues showing retry preparation as processing work', () => {
    const run = graphTestRun()
    run.nodes.implement!.status = 'repair_required'

    expect(layoutComposerGraph(run).edges[0]?.flowing).toBe(true)
  })

  it('separates zero accepted completion from an actively running node', () => {
    const run = graphTestRun()
    run.nodes.audit!.status = 'blocked'

    expect(getComposerGraphProgress(run)).toMatchObject({
      completed: 0,
      total: 3,
      fraction: 0,
      activeCount: 1,
      currentNodeId: 'implement',
      currentStatus: 'running',
      activeAgents: ['Builder']
    })
  })

  it('does not count skipped or superseded nodes as accepted progress', () => {
    const run = graphTestRun({ status: 'failed' })
    run.nodes.implement!.status = 'skipped'
    run.nodes.review!.status = 'superseded'

    expect(getComposerGraphProgress(run)).toMatchObject({
      completed: 1,
      total: 3,
      fraction: 1 / 3,
      activeCount: 0
    })
  })
})

describe('Graph tray node map and sheet', () => {
  beforeAll(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await i18n.changeLanguage('en')
  })

  afterAll(() => {
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('draws node cards with board states, neutral edges and a bounded canvas', () => {
    const html = renderToStaticMarkup(createElement(FloatingComposerGraphPreview, {
      run: graphTestRun(),
      onOpenGraph: vi.fn()
    }))
    const layout = layoutComposerGraph(graphTestRun())

    expect(html).toContain('Directed Graph preview with 3 phases and 3 nodes')
    expect(html).toMatch(/data-graph-preview-node="audit" data-state="done"/)
    expect(html).toMatch(/data-graph-preview-node="implement" data-state="running"/)
    expect(html).toMatch(/data-graph-preview-node="review" data-state="pending"/)
    expect(html).toContain('Explorer · accepted')
    expect(html).toContain('Builder · Working')
    expect(html).toContain('Waiting for upstream node')
    expect(html).toContain('data-graph-preview-edge="edge_audit_build"')
    expect(html).toContain('data-flowing="true"')
    expect(html).toContain('vector-effect="non-scaling-stroke"')
    expect(html).not.toContain('marker-end')
    expect(html).toContain(`max-width:${layout.width}px`)
    expect(html).toContain(`min-width:${Math.ceil(layout.width * COMPOSER_GRAPH_MIN_SCALE)}px`)
    // Inspector starts on the running node, which is the map's only Tab stop.
    expect(html).toContain('data-graph-preview-inspector="implement"')
    expect(html.match(/tabindex="0"/g)).toHaveLength(1)
    expect(html).toMatch(/data-graph-preview-node="implement"[^>]*tabindex="0"/)
    expect(html).toMatch(/data-graph-preview-node="audit"[^>]*tabindex="-1"/)
    expect(html).toContain('Assigned to Builder')
  })

  it('does not surface stale child activity for a terminal run', () => {
    const { run, childRuns } = graphTestRunWithChild(new Date().toISOString())
    run.status = 'cancelled'
    childRuns.child_implement = {
      ...childRuns.child_implement!,
      activity: {
        phase: 'responding',
        label: 'Writing response',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    }
    const html = renderToStaticMarkup(createElement(FloatingComposerGraphPreview, {
      run,
      childRuns,
      onOpenGraph: vi.fn()
    }))

    expect(getComposerGraphProgress(run, childRuns)).toMatchObject({ activeCount: 0 })
    expect(html).not.toContain('data-state="running"')
    expect(html).not.toContain('data-flowing')
    expect(html).not.toContain('Writing response')
    expect(html).toContain('cancelled')
  })

  it('opens a clicked node in the full Graph and inspects hovered nodes', async () => {
    vi.useFakeTimers()
    const onOpenGraph = vi.fn()
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(FloatingComposerGraphPreview, { run: graphTestRun(), onOpenGraph }))
    })
    const inspected = (): unknown => renderer!.root.find((instance) =>
      instance.type === 'div' && instance.props['data-graph-preview-inspector'] !== undefined
    ).props['data-graph-preview-inspector']

    act(() => nodeButton(renderer!, 'implement').props.onClick())
    expect(onOpenGraph).toHaveBeenCalledWith('run_1', 'implement')
    // Crossing a card on the way to the inspector does not switch it.
    act(() => nodeButton(renderer!, 'review').props.onPointerEnter())
    act(() => { vi.advanceTimersByTime(GRAPH_INSPECT_HOVER_DELAY_MS - 60) })
    act(() => nodeButton(renderer!, 'review').props.onPointerLeave())
    act(() => { vi.advanceTimersByTime(GRAPH_INSPECT_HOVER_DELAY_MS) })
    expect(inspected()).toBe('implement')
    // Resting on a card inspects it, and it stays after the pointer leaves.
    act(() => nodeButton(renderer!, 'audit').props.onPointerEnter())
    act(() => { vi.advanceTimersByTime(GRAPH_INSPECT_HOVER_DELAY_MS) })
    act(() => nodeButton(renderer!, 'audit').props.onPointerLeave())
    expect(inspected()).toBe('audit')
    const inspector = renderer!.root.find((instance) => instance.props['data-graph-preview-inspector'] === 'audit')
    expect(textOf(inspector)).toContain('Node audit')
    expect(textOf(inspector)).toContain('accepted')
    expect(nodeButton(renderer!, 'audit').props['data-inspected']).toBe('true')
    expect(nodeButton(renderer!, 'audit').props['aria-label'])
      .toBe('Node audit, accepted, assigned to Explorer. Open node details.')
    act(() => renderer!.unmount())
  })

  it('shows liveness, retries and the live-work action for the inspected child', async () => {
    const now = Date.now()
    const { run, childRuns } = graphTestRunWithChild(new Date(now - 4_000).toISOString(), { attemptNumber: 3 })
    const onOpenChild = vi.fn()
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(FloatingComposerGraphPreview, {
        run,
        childRuns,
        initialNodeId: 'implement',
        onOpenGraph: vi.fn(),
        onOpenChild
      }))
    })

    expect(textOf(nodeButton(renderer!, 'implement'))).toContain('Builder · Retry 2')
    const inspector = renderer!.root.find((instance) => instance.props['data-graph-preview-inspector'] === 'implement')
    expect(textOf(inspector)).toMatch(/Last activity [45]s ago/)
    const liveWork = renderer!.root.find((instance) =>
      instance.type === 'button' && instance.props['data-graph-view-live-work'] === true)
    act(() => liveWork.props.onClick())
    expect(onOpenChild).toHaveBeenCalledWith('run_1', 'implement', 'attempt_implement', 'child_implement')
    act(() => renderer!.unmount())
  })

  it('marks a silent running node and its inspector line as waiting', () => {
    const { run, childRuns } = graphTestRunWithChild(new Date(Date.now() - 95_000).toISOString())
    const html = renderToStaticMarkup(createElement(FloatingComposerGraphPreview, {
      run,
      childRuns,
      onOpenGraph: vi.fn()
    }))

    expect(html).toMatch(/data-graph-preview-node="implement" data-state="attention"/)
    expect(html).toContain('Still waiting for a model or tool response')
    expect(html).toContain('Last activity 1 min ago')
    expect(html).toMatch(/class="ds-graph-tray-inspector-liveness" data-tone="waiting"/)
  })

  it('names a non-working phase before the last activity in the inspector', () => {
    const t = i18n.getFixedT('en', 'common')
    const live = { elapsedMs: 0, quiet: false, lastActivityAgeMs: 12_000 }
    const label = (kind: 'working' | 'active_review', extra: Record<string, string> = {}): string =>
      graphInspectorLivenessLabel({
        run: { status: 'running' },
        node: { status: 'running' },
        liveness: { kind, ...live, ...extra },
        t
      })

    expect(label('working')).toBe('Last activity 12s ago')
    expect(label('working', { activityLabel: 'Running npm test' })).toBe('Running npm test · Last activity 12s ago')
    expect(label('active_review')).toBe('Lead reviewing · Last activity 12s ago')
    expect(graphInspectorLivenessLabel({
      run: { status: 'completed' },
      node: { status: 'running' },
      liveness: null,
      t
    })).toBe('completed')
  })

  it('renders the segment with an accepted-work track and a tabular count', () => {
    const html = renderToStaticMarkup(createElement(GraphProgressSegment, {
      label: 'Graph · Node implement',
      accepted: 1,
      total: 3,
      fraction: 1 / 3
    }))

    expect(html).toContain('Graph · Node implement')
    expect(html).toContain('style="width:33%"')
    expect(html).toContain('>1/3<')
    const compact = renderToStaticMarkup(createElement(GraphProgressSegment, {
      label: 'Graph · Node implement',
      accepted: 1,
      total: 3,
      fraction: 1 / 3,
      waiting: true,
      compact: true
    }))
    expect(compact).not.toContain('Node implement')
    expect(compact).not.toContain('ds-graph-tray-track')
    expect(compact).toContain('>1/3<')
  })

  it('folds the sheet before leaving for the full Graph or a child session', async () => {
    const run = graphTestRun()
    const onOpenGraph = vi.fn()
    const onClose = vi.fn()
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(GraphProgressSheet, {
        run,
        progress: getComposerGraphProgress(run),
        childRuns: {},
        onOpenGraph,
        onClose
      }))
    })

    const header = textOf(renderer!.root.find((instance) => instance.props['data-graph-tray-sheet'] === 'run_1'))
    expect(header).toContain('Graph run')
    expect(header).toContain('1 of 3 nodes accepted · 1 running')
    act(() => renderer!.root.find((instance) =>
      instance.type === 'button' && instance.props['data-graph-open-full'] === true).props.onClick())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onOpenGraph).toHaveBeenCalledWith('run_1', undefined)
    act(() => nodeButton(renderer!, 'review').props.onClick())
    expect(onOpenGraph).toHaveBeenLastCalledWith('run_1', 'review')
    act(() => renderer!.root.findByProps({ 'aria-label': 'Collapse' }).props.onClick())
    expect(onClose).toHaveBeenCalledTimes(3)
    act(() => renderer!.unmount())
  })

  it('lists correction issues and runs one correction action at a time', async () => {
    let resolveResume: () => void = () => undefined
    const onResume = vi.fn(() => new Promise<void>((resolve) => { resolveResume = resolve }))
    const onCancel = vi.fn()
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(GraphPlanningCorrectionSheet, {
        correction: graphTestCorrection(5),
        onResume,
        onCancel,
        onClose: vi.fn()
      }))
    })

    const sheet = renderer!.root.find((instance) =>
      instance.props['data-graph-planning-correction-sheet'] === 'draft_correction')
    expect(textOf(sheet)).toContain('Expected string, received undefined')
    expect(textOf(sheet)).toContain('plan.tasks.0.title')
    expect(textOf(sheet)).toContain('Restore the task title.')
    expect(textOf(sheet)).toContain('2 more issues')
    // The note sits under the issues, so it must not point "below".
    expect(textOf(sheet)).toContain('The draft is saved. Add guidance in chat, then continue planning.')
    expect(textOf(sheet)).not.toContain('below')
    const resume = (): ReactTestInstance => renderer!.root.find((instance) =>
      instance.type === 'button' && instance.props['data-graph-planning-resume'] === true)
    const cancel = (): ReactTestInstance => renderer!.root.find((instance) =>
      instance.type === 'button' && instance.props['data-graph-planning-cancel'] === true)
    await act(async () => resume().props.onClick())
    expect(onResume).toHaveBeenCalledWith('draft_correction')
    expect(resume().props.disabled).toBe(true)
    expect(cancel().props.disabled).toBe(true)
    await act(async () => resolveResume())
    expect(cancel().props.disabled).toBe(false)
    await act(async () => cancel().props.onClick())
    expect(onCancel).toHaveBeenCalledWith('draft_correction')
    act(() => renderer!.unmount())
  })

  it('speaks Chinese on the sheet header and node map', async () => {
    await i18n.loadLanguages('zh')
    await i18n.changeLanguage('zh')
    const run = graphTestRun()
    const html = renderToStaticMarkup(createElement(GraphProgressSheet, {
      run,
      progress: getComposerGraphProgress(run),
      childRuns: {},
      onOpenGraph: vi.fn(),
      onClose: vi.fn()
    }))
    await i18n.changeLanguage('en')

    expect(html).toContain('Graph 编排')
    expect(html).toContain('已验收 1 / 3 个节点 · 1 个运行中')
    expect(html).toContain('打开完整 Graph')
    expect(html).toContain('等待上游节点')
    expect(html).toContain('派发给 Builder')
  })
})

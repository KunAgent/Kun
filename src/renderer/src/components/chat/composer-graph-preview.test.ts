import { describe, expect, it } from 'vitest'
import type {
  GraphNodeProjection,
  GraphPlanNode,
  GraphRun
} from '../../graph/graph-types'
import { GRAPH_ACTIVITY_QUIET_MS, graphNodeLiveness } from '../../graph/graph-liveness'
import {
  COMPOSER_GRAPH_NODE_HEIGHT,
  COMPOSER_GRAPH_NODE_WIDTH,
  composerGraphAttention,
  composerGraphNavigationTarget,
  composerGraphNodeState,
  composerGraphQuietDeadline,
  composerGraphSegmentTitles,
  getComposerGraphProgress,
  graphAgentAvatarColor,
  graphAgentInitials,
  graphRunOwnsThreadProgress,
  layoutComposerGraph,
  selectThreadComposerGraphRun
} from './composer-graph-preview'
import {
  graphTestAttempt,
  graphTestChild,
  graphTestNode,
  graphTestRun,
  graphTestRunWithChild
} from './composer-tray/graph-tray-test-fixtures'

function graphRun(node: GraphNodeProjection): GraphRun {
  const run = graphTestRun()
  run.plans[0]!.phases = [{ id: 'phase_1', title: 'Phase', order: 1 }]
  run.plans[0]!.nodes = [node.node]
  run.plans[0]!.edges = []
  run.plans[0]!.completionNodeIds = [node.node.id]
  run.nodes = { [node.node.id]: node }
  return run
}

function readyNode(): GraphNodeProjection {
  const node: GraphPlanNode = { ...graphTestNode('node_1', 'phase_1'), title: 'Inspect runtime' }
  return { node, status: 'ready', attempts: [graphTestAttempt()], loopIteration: 0 }
}

function graphRunWithIncomingEdge(target: GraphNodeProjection): GraphRun {
  const run = graphRun(target)
  const upstream: GraphPlanNode = { ...target.node, id: 'node_upstream', title: 'Prepare input' }
  run.plans[0]!.nodes.unshift(upstream)
  run.plans[0]!.edges.push({
    id: 'edge_upstream_target',
    kind: 'control',
    from: upstream.id,
    to: target.node.id
  })
  run.nodes[upstream.id] = { node: upstream, status: 'accepted', attempts: [], loopIteration: 0 }
  return run
}

describe('composer Graph progress', () => {
  it('counts a correlated running child while the durable node is still ready', () => {
    const progress = getComposerGraphProgress(
      graphRun(readyNode()),
      { child_1: graphTestChild('running') }
    )

    expect(progress).toMatchObject({
      completed: 0,
      activeCount: 1,
      activeNodeIds: ['node_1'],
      activeNodeTitles: ['Inspect runtime'],
      currentNodeId: 'node_1',
      childThreadId: 'child_1'
    })
    expect(progress.activeAgents).toEqual(['Runtime Inspector'])
  })

  it('does not count a terminal child as active for a ready node', () => {
    const progress = getComposerGraphProgress(
      graphRun(readyNode()),
      { child_1: graphTestChild('completed') }
    )

    expect(progress.activeCount).toBe(0)
    expect(progress.activeNodeTitles).toEqual([])
  })

  it('treats terminal run state as authoritative over stale running child state', () => {
    const run = graphRun(readyNode())
    run.status = 'cancelled'
    const progress = getComposerGraphProgress(run, { child_1: graphTestChild('running') })

    expect(progress.activeCount).toBe(0)
    expect(progress.activeAgents).toEqual([])
  })

  it('flows incoming edges when a correlated child runs before durable node status catches up', () => {
    const run = graphRunWithIncomingEdge(readyNode())
    const layout = layoutComposerGraph(run, { child_1: graphTestChild('running') })

    expect(layout.nodes.find((node) => node.id === 'node_1')?.processing).toBe(true)
    expect(layout.edges).toEqual([
      expect.objectContaining({ id: 'edge_upstream_target', flowing: true })
    ])
  })

  it('keeps incoming edges static for waiting and terminal runs', () => {
    const waitingRun = graphRunWithIncomingEdge(readyNode())
    expect(layoutComposerGraph(waitingRun, { child_1: graphTestChild('completed') }).edges[0]?.flowing)
      .toBe(false)

    waitingRun.status = 'completed'
    expect(layoutComposerGraph(waitingRun, { child_1: graphTestChild('running') }).edges[0]?.flowing)
      .toBe(false)
  })
})

describe('graphRunOwnsThreadProgress (#1202)', () => {
  it('hands progress authority to a live Graph run on the same thread', () => {
    expect(graphRunOwnsThreadProgress([graphRun(readyNode())], 'thread_1')).toBe(true)
    expect(selectThreadComposerGraphRun([graphRun(readyNode())], 'thread_1')?.id).toBe('run_1')
  })

  it('leaves authority with the plan checklist once every run is terminal', () => {
    const run = graphRun(readyNode())
    run.status = 'completed'

    expect(graphRunOwnsThreadProgress([run], 'thread_1')).toBe(false)
  })

  it('ignores live runs that belong to another thread', () => {
    expect(graphRunOwnsThreadProgress([graphRun(readyNode())], 'thread_2')).toBe(false)
    expect(graphRunOwnsThreadProgress([graphRun(readyNode())], null)).toBe(false)
    expect(graphRunOwnsThreadProgress([], 'thread_1')).toBe(false)
  })
})

describe('composer Graph node map layout', () => {
  it('places phase columns 30px apart and centers each column vertically', () => {
    const run = graphTestRun()
    const parallel = { ...graphTestNode('implement_api', 'build', 'Codex') }
    run.plans[0]!.nodes.push(parallel)
    run.nodes.implement_api = { node: parallel, status: 'running', attempts: [], loopIteration: 0 }
    const layout = layoutComposerGraph(run)
    const byId = Object.fromEntries(layout.nodes.map((node) => [node.id, node]))

    expect(layout.phases.map((phase) => phase.id)).toEqual(['discover', 'build', 'verify'])
    expect(layout.width).toBe(28 * 2 + 3 * COMPOSER_GRAPH_NODE_WIDTH + 2 * 30)
    expect(layout.height).toBe(150)
    expect(byId.audit).toMatchObject({ x: 28, y: 49, width: 132, height: COMPOSER_GRAPH_NODE_HEIGHT })
    expect(byId.implement).toMatchObject({ x: 190, y: 12 })
    expect(byId.implement_api).toMatchObject({ x: 190, y: 86 })
    expect(byId.review).toMatchObject({ x: 352, y: 49 })
    // Forward edges bend at the middle of the column gap.
    expect(layout.edges[0]?.path).toBe('M 160 75 C 175 75 175 38 190 38')
  })

  it('packs tall columns tighter, skips empty phases and keeps nodes of unknown phases', () => {
    const run = graphTestRun()
    run.plans[0]!.phases.push({ id: 'empty', title: 'Empty', order: 4 })
    for (const id of ['b2', 'b3']) {
      const node = graphTestNode(id, 'build')
      run.plans[0]!.nodes.push(node)
      run.nodes[id] = { node, status: 'pending', attempts: [], loopIteration: 0 }
    }
    const stray = graphTestNode('stray', 'missing_phase')
    run.plans[0]!.nodes.push(stray)
    run.nodes.stray = { node: stray, status: 'pending', attempts: [], loopIteration: 0 }
    const layout = layoutComposerGraph(run)

    expect(layout.phases.map((phase) => phase.id)).toEqual(['discover', 'build', 'verify', 'missing_phase'])
    expect(layout.height).toBe(12 * 2 + 3 * 52 + 2 * 12)
    expect(layout.nodes.filter((node) => node.phaseId === 'build').map((node) => node.y))
      .toEqual([12, 76, 140])
    expect(layout.nodes.find((node) => node.id === 'stray')?.x).toBe(28 + 3 * 162)
  })

  it('bows same-column edges out past the right edge', () => {
    const run = graphTestRun()
    const follow = graphTestNode('implement_tests', 'build')
    run.plans[0]!.nodes.push(follow)
    run.plans[0]!.edges.push({ id: 'edge_same', kind: 'message', from: 'implement', to: 'implement_tests' })
    run.nodes.implement_tests = { node: follow, status: 'pending', attempts: [], loopIteration: 0 }
    const edge = layoutComposerGraph(run).edges.find((candidate) => candidate.id === 'edge_same')

    expect(edge?.path).toBe('M 322 38 C 344 38 344 112 322 112')
    expect(edge?.kind).toBe('message')
  })

  it('maps node status and liveness to a card state', () => {
    const base = { processing: false, livenessKind: 'idle' as const, quiet: false }
    expect(composerGraphNodeState({ ...base, status: 'accepted' }, false)).toBe('done')
    expect(composerGraphNodeState({ ...base, status: 'failed' }, false)).toBe('failed')
    expect(composerGraphNodeState({ ...base, status: 'blocked' }, false)).toBe('pending')
    expect(composerGraphNodeState({ ...base, status: 'superseded' }, false)).toBe('pending')
    expect(composerGraphNodeState({ ...base, status: 'running', processing: true, livenessKind: 'working' }, false))
      .toBe('running')
    expect(composerGraphNodeState({ ...base, status: 'running', processing: true, quiet: true }, false))
      .toBe('attention')
    expect(composerGraphNodeState({ ...base, status: 'running', livenessKind: 'waiting_human' }, false))
      .toBe('attention')
    expect(composerGraphNodeState({ ...base, status: 'running', processing: true }, true)).toBe('idle')
    expect(composerGraphNodeState({ ...base, status: 'ready' }, false)).toBe('idle')
  })
})

describe('composer Graph segment helpers', () => {
  it('labels the segment with the working nodes, else the current node', () => {
    expect(composerGraphSegmentTitles({
      activeNodeTitles: ['Front  end form', 'API', 'Docs', 'Extra'],
      currentNodeTitle: 'Front end form'
    })).toEqual(['Front end form', 'API', 'Docs'])
    expect(composerGraphSegmentTitles({ activeNodeTitles: [], currentNodeTitle: 'Review' }))
      .toEqual(['Review'])
    expect(composerGraphSegmentTitles({ activeNodeTitles: [], currentNodeTitle: null })).toEqual([])
  })

  it('schedules the quiet transition of a running child once', () => {
    const nowMs = Date.parse('2026-07-28T00:00:12.000Z')
    const { run, childRuns } = graphTestRunWithChild('2026-07-28T00:00:02.000Z')
    const projection = run.nodes.implement!
    const fresh = graphNodeLiveness(projection, childRuns, nowMs)

    expect(composerGraphQuietDeadline(fresh, nowMs)).toBe(nowMs + GRAPH_ACTIVITY_QUIET_MS - 10_000)
    const quiet = graphNodeLiveness(projection, childRuns, nowMs + GRAPH_ACTIVITY_QUIET_MS)
    expect(quiet.quiet).toBe(true)
    expect(composerGraphQuietDeadline(quiet, nowMs + GRAPH_ACTIVITY_QUIET_MS)).toBeNull()
    expect(composerGraphQuietDeadline(
      graphNodeLiveness(projection, { child_implement: graphTestChild('completed') }, nowMs),
      nowMs
    )).toBeNull()
    expect(composerGraphQuietDeadline(null, nowMs)).toBeNull()
  })

  it('flags a live run whose running node went quiet', () => {
    const nowMs = Date.parse('2026-07-28T00:00:12.000Z')
    const { run, childRuns } = graphTestRunWithChild('2026-07-28T00:00:02.000Z')

    expect(composerGraphAttention(run, childRuns, nowMs)).toEqual({
      attention: false,
      reason: null,
      quietDeadline: nowMs + GRAPH_ACTIVITY_QUIET_MS - 10_000
    })
    expect(composerGraphAttention(run, childRuns, nowMs + GRAPH_ACTIVITY_QUIET_MS)).toEqual({
      attention: true,
      reason: 'quiet',
      quietDeadline: null
    })
    run.status = 'completed'
    expect(composerGraphAttention(run, childRuns, nowMs + GRAPH_ACTIVITY_QUIET_MS)).toEqual({
      attention: false,
      reason: null,
      quietDeadline: null
    })
  })

  it('names the most actionable attention reason', () => {
    const nowMs = Date.parse('2026-07-28T00:00:12.000Z')
    const { run, childRuns } = graphTestRunWithChild('2026-07-28T00:00:09.000Z')
    const asking = {
      child_implement: {
        ...childRuns.child_implement!,
        activity: {
          phase: 'waiting' as const,
          label: 'Waiting for your answer',
          startedAt: '2026-07-28T00:00:05.000Z',
          updatedAt: '2026-07-28T00:00:09.000Z'
        }
      }
    }
    // A child asking is not a silent node, even long after its last update.
    expect(composerGraphAttention(run, asking, nowMs)).toMatchObject({ attention: true, reason: 'asking' })
    expect(composerGraphAttention(run, asking, nowMs + GRAPH_ACTIVITY_QUIET_MS * 2))
      .toMatchObject({ reason: 'asking' })

    // Supervision flags a node under review.
    run.nodes.implement!.status = 'reviewing'
    run.supervision = {
      pendingActions: [{ nodeIds: ['implement'], liveness: 'needs_attention' }]
    } as unknown as GraphRun['supervision']
    expect(composerGraphAttention(run, childRuns, nowMs)).toMatchObject({ attention: true, reason: 'flagged' })
  })

  it('moves roving focus through the node map by column', () => {
    // Two columns: a (top) / b (bottom), then c centered between them.
    const nodes = [
      { id: 'a', x: 28, y: 12 },
      { id: 'b', x: 28, y: 86 },
      { id: 'c', x: 190, y: 49 }
    ]
    expect(composerGraphNavigationTarget(nodes, 'a', 'ArrowDown')).toBe('b')
    expect(composerGraphNavigationTarget(nodes, 'b', 'ArrowDown')).toBe('c')
    expect(composerGraphNavigationTarget(nodes, 'c', 'ArrowDown')).toBeNull()
    expect(composerGraphNavigationTarget(nodes, 'a', 'ArrowUp')).toBeNull()
    expect(composerGraphNavigationTarget(nodes, 'b', 'ArrowRight')).toBe('c')
    expect(composerGraphNavigationTarget(nodes, 'c', 'ArrowLeft')).toBe('a')
    expect(composerGraphNavigationTarget(nodes, 'a', 'ArrowLeft')).toBeNull()
    expect(composerGraphNavigationTarget(nodes, 'b', 'Home')).toBe('a')
    expect(composerGraphNavigationTarget(nodes, 'a', 'End')).toBe('c')
    expect(composerGraphNavigationTarget(nodes, 'c', 'End')).toBeNull()
    expect(composerGraphNavigationTarget(nodes, 'gone', 'ArrowRight')).toBe('a')
    expect(composerGraphNavigationTarget(nodes, 'a', 'Enter')).toBeNull()
    expect(composerGraphNavigationTarget([], 'a', 'ArrowDown')).toBeNull()
  })

  it('derives stable agent initials and avatar colors', () => {
    expect(graphAgentInitials('Claude Code')).toBe('CC')
    expect(graphAgentInitials('codex')).toBe('C')
    expect(graphAgentInitials('runtime-inspector')).toBe('RI')
    expect(graphAgentInitials('测试代理')).toBe('测')
    expect(graphAgentInitials('  ')).toBe('K')
    expect(graphAgentAvatarColor('Claude Code')).toBe(graphAgentAvatarColor(' claude code '))
    expect(graphAgentAvatarColor('Codex')).toMatch(/^#[0-9a-f]{6}$/)
  })
})

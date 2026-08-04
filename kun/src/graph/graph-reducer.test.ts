import { describe, expect, it } from 'vitest'
import {
  GRAPH_CONTRACT_VERSION,
  GraphNodeAttemptV1Schema,
  type GraphDomainEventV1
} from '../contracts/graph.js'
import { applyGraphEvent, GraphReducerError, replayGraphEvents } from './graph-reducer.js'
import {
  TEST_GRAPH_NOW,
  testAssignmentSnapshot,
  testGraphEnvelope,
  testGraphPlan
} from './graph-test-fixtures.test-support.js'

function created(): GraphDomainEventV1 {
  return {
    type: 'run_created',
    payload: {
      plan: testGraphPlan(),
      projectId: 'project_1',
      sourceTurnId: 'turn_1'
    }
  }
}

describe('GraphRun deterministic reducer', () => {
  it('creates and replays the same projection deterministically', () => {
    const events = [
      testGraphEnvelope(1, created()),
      testGraphEnvelope(2, {
        type: 'run_status_changed',
        payload: { from: 'draft', to: 'validating' }
      }),
      testGraphEnvelope(3, {
        type: 'run_status_changed',
        payload: { from: 'validating', to: 'ready' }
      })
    ]
    expect(replayGraphEvents(events)).toEqual(
      events.reduce<ReturnType<typeof replayGraphEvents> | undefined>(
        (state, event) => applyGraphEvent(state, event),
        undefined
      )
    )
    expect(replayGraphEvents(events)).toMatchObject({
      id: 'run_1',
      status: 'ready',
      lastEventSeq: 3
    })
  })

  it('ignores already-applied events and rejects gaps and illegal transitions', () => {
    const state = applyGraphEvent(undefined, testGraphEnvelope(1, created()))
    expect(applyGraphEvent(state, testGraphEnvelope(1, created()))).toBe(state)
    expect(() => applyGraphEvent(state, testGraphEnvelope(3, {
      type: 'run_status_changed',
      payload: { from: 'draft', to: 'validating' }
    }))).toThrow(/sequence gap/)
    expect(() => applyGraphEvent(state, testGraphEnvelope(2, {
      type: 'node_status_changed',
      payload: { nodeId: 'research', from: 'pending', to: 'accepted' }
    }))).toThrow(GraphReducerError)
  })

  it('records immutable attempt snapshots, progress, results, and reviews', () => {
    const attempt = GraphNodeAttemptV1Schema.parse({
      version: GRAPH_CONTRACT_VERSION,
      id: 'attempt_1',
      runId: 'run_1',
      nodeId: 'research',
      revision: 1,
      attemptNumber: 1,
      iteration: 0,
      commandId: 'command_dispatch_1',
      idempotencyKey: 'dispatch_1',
      status: 'queued',
      assignment: testAssignmentSnapshot(),
      queuedAt: TEST_GRAPH_NOW,
      tokenUsage: 0,
      elapsedMs: 0
    })
    const events = [
      testGraphEnvelope(1, created()),
      testGraphEnvelope(2, {
        type: 'node_status_changed',
        payload: {
          nodeId: 'research',
          from: 'pending',
          to: 'ready',
          reason: 'Dependencies accepted.'
        }
      }),
      testGraphEnvelope(3, { type: 'attempt_created', payload: { attempt } }),
      testGraphEnvelope(4, {
        type: 'attempt_status_changed',
        payload: {
          nodeId: 'research',
          attemptId: 'attempt_1',
          from: 'queued',
          to: 'running',
          childThreadId: 'child_1'
        }
      }),
      testGraphEnvelope(5, {
        type: 'progress_reported',
        payload: {
          progress: {
            version: GRAPH_CONTRACT_VERSION,
            nodeId: 'research',
            attemptId: 'attempt_1',
            percent: 50,
            summary: 'Halfway',
            createdAt: TEST_GRAPH_NOW
          }
        }
      }),
      testGraphEnvelope(6, {
        type: 'result_submitted',
        payload: {
          nodeId: 'research',
          attemptId: 'attempt_1',
          result: {
            version: GRAPH_CONTRACT_VERSION,
            summary: 'Found the relevant code.',
            artifactRefs: [],
            changedFiles: [],
            checks: [],
            evidence: ['src/example.ts'],
            risks: [],
            suggestedMessages: []
          },
          validation: {
            version: GRAPH_CONTRACT_VERSION,
            valid: true,
            issues: [],
            normalizedNodeCount: 1,
            normalizedEdgeCount: 0
          },
          tokenUsage: 0,
          elapsedMs: 0
        }
      })
    ]
    const state = replayGraphEvents(events)
    expect(state.nodes.research.attempts[0]).toMatchObject({
      childThreadId: 'child_1',
      assignment: { profileId: 'profile_1' },
      result: { summary: 'Found the relevant code.' }
    })
    expect(state.nodes.research.lastProgress?.percent).toBe(50)
    expect(state.nodes.research.lastTransitionReason).toBeUndefined()
    expect(state.nodes.research.status).toBe('queued')
    expect(state.budget.attempts).toBe(1)
  })

  it('preserves accepted history and rejects revision rewrites', () => {
    const attempt = GraphNodeAttemptV1Schema.parse({
      version: GRAPH_CONTRACT_VERSION,
      id: 'attempt_accepted',
      runId: 'run_1',
      nodeId: 'research',
      revision: 1,
      attemptNumber: 1,
      iteration: 0,
      commandId: 'command_attempt_accepted',
      idempotencyKey: 'attempt_accepted',
      status: 'queued',
      assignment: testAssignmentSnapshot(),
      queuedAt: TEST_GRAPH_NOW,
      tokenUsage: 0,
      elapsedMs: 0
    })
    const accepted = replayGraphEvents([
      testGraphEnvelope(1, created()),
      testGraphEnvelope(2, {
        type: 'node_status_changed',
        payload: { nodeId: 'research', from: 'pending', to: 'ready' }
      }),
      testGraphEnvelope(3, {
        type: 'attempt_created',
        payload: { attempt }
      }),
      testGraphEnvelope(4, {
        type: 'attempt_status_changed',
        payload: {
          nodeId: 'research',
          attemptId: attempt.id,
          from: 'queued',
          to: 'running'
        }
      }),
      testGraphEnvelope(5, {
        type: 'node_status_changed',
        payload: { nodeId: 'research', from: 'queued', to: 'running' }
      }),
      testGraphEnvelope(6, {
        type: 'attempt_status_changed',
        payload: {
          nodeId: 'research',
          attemptId: attempt.id,
          from: 'running',
          to: 'submitted'
        }
      }),
      testGraphEnvelope(7, {
        type: 'node_status_changed',
        payload: { nodeId: 'research', from: 'running', to: 'submitted' }
      }),
      testGraphEnvelope(8, {
        type: 'attempt_status_changed',
        payload: {
          nodeId: 'research',
          attemptId: attempt.id,
          from: 'submitted',
          to: 'accepted'
        }
      }),
      testGraphEnvelope(9, {
        type: 'node_status_changed',
        payload: { nodeId: 'research', from: 'submitted', to: 'accepted' }
      })
    ])
    const revisedPlan = testGraphPlan({
      revision: 2,
      nodes: testGraphPlan().nodes.map((node) =>
        node.id === 'research' ? { ...node, objective: 'Rewrite accepted facts' } : node)
    })
    expect(accepted.nodes.research.acceptedAttemptId).toBe(attempt.id)
    expect(() => applyGraphEvent(accepted, testGraphEnvelope(10, {
      type: 'plan_revised',
      payload: {
        patch: {
          version: GRAPH_CONTRACT_VERSION,
          patchId: 'patch_1',
          commandId: 'command_patch_1',
          runId: 'run_1',
          baseRevision: 1,
          requester: { kind: 'lead', id: 'lead_1' },
          reason: 'Change accepted work',
          operations: [{
            op: 'replace_node',
            nodeId: 'research',
            replacement: revisedPlan.nodes[0]!,
            supersedesAcceptedWork: false
          }],
          createdAt: TEST_GRAPH_NOW
        },
        plan: revisedPlan,
        supersededNodeIds: []
      }
    }, { graphRevision: 2 }))).toThrow(/cannot rewrite accepted node/)
  })

  it('tracks steering acknowledgement with validated monotonic status changes', () => {
    const recorded = replayGraphEvents([
      testGraphEnvelope(1, created()),
      testGraphEnvelope(2, {
        type: 'steering_recorded',
        payload: {
          steering: {
            version: GRAPH_CONTRACT_VERSION,
            steeringId: 'steering_1',
            runId: 'run_1',
            target: { kind: 'node', nodeId: 'research' },
            text: 'Prioritize the cancellation edge case.',
            status: 'persisted',
            createdAt: TEST_GRAPH_NOW
          }
        }
      }),
      testGraphEnvelope(3, {
        type: 'steering_status_changed',
        payload: {
          steeringId: 'steering_1',
          from: 'persisted',
          to: 'delivered'
        }
      }),
      testGraphEnvelope(4, {
        type: 'steering_status_changed',
        payload: {
          steeringId: 'steering_1',
          from: 'delivered',
          to: 'handled'
        }
      })
    ])
    expect(recorded.steering[0]?.status).toBe('handled')
    expect(() => applyGraphEvent(recorded, testGraphEnvelope(5, {
      type: 'steering_status_changed',
      payload: {
        steeringId: 'steering_1',
        from: 'persisted',
        to: 'delivered'
      }
    }))).toThrow(/steering transition expected/)
  })

  it('replays historical duplicate supervision_obligation_resolved without rewriting first resolve (#1082)', () => {
    // Pre-fix journals may contain multiple resolved events for one obligation.
    // The reducer must not throw, must keep the first resolvedAt/updatedAt, and
    // must still advance lastEventSeq so replay/hydration stays consistent.
    const obligationBase = {
      version: GRAPH_CONTRACT_VERSION,
      id: 'graph_obligation_hist_dup',
      kind: 'help' as const,
      reason: 'help' as const,
      graphRevision: 1,
      nodeIds: [] as string[],
      attemptIds: [] as string[],
      digest: 'historical duplicate resolve subject',
      deliveryAttempts: 1,
      noProgressCount: 0,
      lastProgressSeq: 1,
      createdAt: TEST_GRAPH_NOW
    }
    const firstResolvedAt = '2026-07-26T00:00:02.000Z'
    const secondResolvedAt = '2026-07-26T00:00:09.000Z'
    const otherObligation = {
      version: GRAPH_CONTRACT_VERSION,
      id: 'graph_obligation_other',
      kind: 'conflict' as const,
      reason: 'conflict' as const,
      graphRevision: 1,
      nodeIds: [] as string[],
      attemptIds: [] as string[],
      digest: 'unrelated obligation must stay pending',
      state: 'pending' as const,
      deliveryAttempts: 0,
      noProgressCount: 0,
      lastProgressSeq: 1,
      createdAt: TEST_GRAPH_NOW,
      updatedAt: TEST_GRAPH_NOW
    }

    let state = applyGraphEvent(undefined, testGraphEnvelope(1, created()))
    state = applyGraphEvent(state, testGraphEnvelope(2, {
      type: 'supervision_obligation_opened',
      payload: {
        obligation: {
          ...obligationBase,
          state: 'pending',
          updatedAt: TEST_GRAPH_NOW
        }
      }
    }))
    state = applyGraphEvent(state, testGraphEnvelope(3, {
      type: 'supervision_obligation_opened',
      payload: { obligation: otherObligation }
    }))
    state = applyGraphEvent(state, testGraphEnvelope(4, {
      type: 'supervision_obligation_resolved',
      payload: {
        obligation: {
          ...obligationBase,
          state: 'resolved',
          updatedAt: firstResolvedAt,
          resolvedAt: firstResolvedAt
        }
      }
    }, {
      eventId: 'graph_event_resolved_first',
      timestamp: firstResolvedAt
    }))
    expect(state.supervisionObligations.find((entry) => entry.id === obligationBase.id)).toMatchObject({
      state: 'resolved',
      resolvedAt: firstResolvedAt,
      updatedAt: firstResolvedAt
    })
    expect(state.lastEventSeq).toBe(4)

    // Second historical resolved with different eventId / graphSeq / timestamp.
    state = applyGraphEvent(state, testGraphEnvelope(5, {
      type: 'supervision_obligation_resolved',
      payload: {
        obligation: {
          ...obligationBase,
          state: 'resolved',
          updatedAt: secondResolvedAt,
          resolvedAt: secondResolvedAt,
          deliveryAttempts: 99
        }
      }
    }, {
      eventId: 'graph_event_resolved_duplicate',
      timestamp: secondResolvedAt
    }))

    const primary = state.supervisionObligations.find((entry) => entry.id === obligationBase.id)!
    const secondary = state.supervisionObligations.find((entry) => entry.id === otherObligation.id)!
    expect(primary).toMatchObject({
      state: 'resolved',
      resolvedAt: firstResolvedAt,
      updatedAt: firstResolvedAt,
      deliveryAttempts: 1
    })
    expect(secondary).toMatchObject({
      id: otherObligation.id,
      state: 'pending'
    })
    expect(state.lastEventSeq).toBe(5)
    expect(state.updatedAt).toBe(secondResolvedAt)
  })
})

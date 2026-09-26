import type { GraphNodeAttemptV1, GraphRunV1 } from '../contracts/graph.js'
import type { GraphSchedulerOptions } from './graph-scheduler-types.js'

/**
 * Mission-control registration (docs/ade/06 §4, impl P1-25): binds the worker
 * child session and opens the `graph-attempt` activity row before execution
 * starts so `event.child` projections land on the attempt row.
 */
export function bindGraphAttemptSession(
  options: Pick<GraphSchedulerOptions, 'workerSessions' | 'activity'>,
  initialRun: GraphRunV1,
  nodeId: string,
  attempt: GraphNodeAttemptV1,
  childId: string
): void {
  options.workerSessions.bind(childId, {
    runId: initialRun.id,
    nodeId,
    attemptId: attempt.id
  })
  try {
    options.activity?.register({
      unitId: attempt.id,
      kind: 'graph-attempt',
      threadId: childId,
      parentThreadId: initialRun.threadId,
      harnessId: attempt.assignment.harnessId ?? 'kun',
      title: initialRun.nodes[nodeId].node.title.slice(0, 200),
      workspace: {
        path: attempt.assignment.workspaceRoot,
        kind: attempt.assignment.workspaceRoot ===
            initialRun.plans.at(-1)?.workspaceRoot
          ? 'local'
          : 'worktree'
      },
      mainState: 'initializing'
    })
  } catch (error) {
    console.warn(
      `[kun] graph-attempt activity register failed for ${attempt.id}: ` +
      (error instanceof Error ? error.message : String(error))
    )
  }
}

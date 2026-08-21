import { useEffect, useState } from 'react'
import { useGraphStore } from '../../graph/graph-store'
import type { GraphViewState } from '../../graph/graph-store-types'
import { useGraphParentObserver } from '../../graph/use-graph-parent-observer'

/** Keeps graph-child return state and its elapsed-time clock out of Workbench. */
export function useWorkbenchGraphRuntimeState(activeThreadId: string | null): {
  graphChildReturnTarget: GraphViewState['childReturnTarget']
  graphRuns: GraphViewState['runs']
  graphChildRuns: GraphViewState['childRuns']
  graphChildNow: number
} {
  useGraphParentObserver(activeThreadId)
  const graphChildReturnTarget = useGraphStore((state) => state.childReturnTarget)
  const graphRuns = useGraphStore((state) => state.runs)
  const graphChildRuns = useGraphStore((state) => state.childRuns)
  const [graphChildNow, setGraphChildNow] = useState(() => Date.now())

  useEffect(() => {
    if (!graphChildReturnTarget || activeThreadId !== graphChildReturnTarget.childThreadId) return
    const id = globalThis.setInterval(() => setGraphChildNow(Date.now()), 1_000)
    return () => globalThis.clearInterval(id)
  }, [activeThreadId, graphChildReturnTarget])

  useEffect(() => {
    if (
      !graphChildReturnTarget ||
      !activeThreadId ||
      activeThreadId === graphChildReturnTarget.parentThreadId ||
      activeThreadId === graphChildReturnTarget.childThreadId
    ) return
    useGraphStore.getState().clearChildReturnTarget()
  }, [activeThreadId, graphChildReturnTarget])

  return { graphChildReturnTarget, graphRuns, graphChildRuns, graphChildNow }
}

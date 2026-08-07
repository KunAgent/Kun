import { create } from 'zustand'
import type { RuntimeChildEventPayload } from '../agent/types'
import { graphRuntimeClient } from './graph-runtime-client'
import { steerGraphSourceTurn } from './graph-source-turn-steering'
import type { GraphViewState } from './graph-store-types'
import {
  createGraphLeadWakeAction,
  mergeGraphRunSnapshots
} from './graph-supervision-store'
import {
  graphChildRuntimeFromEvent,
  mergeGraphChildDiagnostics,
  mergeGraphChildRuntime
} from './graph-child-runtime'
import type {
  GraphAgentProfile,
  GraphEventEnvelope,
  GraphPlanningDraftView,
  GraphPlanningLifecycleEvent,
  GraphRun
} from './graph-types'

export { selectGraphPlanningCorrectionDraft } from './graph-planning-selection'
export type { GraphThreadSyncStatus } from './graph-thread-observer'

type ThreadRefreshGate = {
  inFlight: Promise<void> | null
  pending: boolean
  /** Pending refresh is silent only when every coalesced request asked for silent. */
  pendingSilent: boolean
}

/** One in-flight HTTP snapshot per thread; later requests mark pending. */
const threadRefreshGates = new Map<string, ThreadRefreshGate>()

function refreshGateFor(threadId: string): ThreadRefreshGate {
  const existing = threadRefreshGates.get(threadId)
  if (existing) return existing
  const created: ThreadRefreshGate = {
    inFlight: null,
    pending: false,
    pendingSilent: true
  }
  threadRefreshGates.set(threadId, created)
  return created
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function applyThreadSnapshot(
  get: () => GraphViewState,
  set: (
    partial:
      | Partial<GraphViewState>
      | ((state: GraphViewState) => Partial<GraphViewState>)
  ) => void,
  threadId: string,
  silent: boolean
): Promise<void> {
  if (!silent) set({ loading: true, error: null })
  try {
    const [runs, drafts, diagnostics] = await Promise.all([
      graphRuntimeClient.listRuns(threadId),
      graphRuntimeClient.listDrafts(threadId),
      graphRuntimeClient.delegationDiagnostics(threadId).catch(() => null)
    ])
    if (get().threadId !== threadId) return
    const current = get()
    const mergedRuns = mergeGraphRunSnapshots(current.runs, runs)
    const previousRunId = current.selectedRunId
    const previousNodeId = current.selectedNodeId
    const selectedRunId = mergedRuns.some((run) => run.id === previousRunId)
      ? previousRunId
      : mergedRuns[0]?.id ?? null
    const selectedRun = mergedRuns.find((run) => run.id === selectedRunId)
    const selectedNodeId = previousNodeId && selectedRun?.nodes[previousNodeId]
      ? previousNodeId
      : null
    set({
      runs: mergedRuns,
      drafts,
      childRuns: mergeGraphChildDiagnostics(current.childRuns, diagnostics, threadId),
      selectedRunId,
      selectedNodeId,
      artifactPage: null,
      artifactContent: '',
      artifactLoading: false,
      // Always clear loading after a successful snapshot so a silent follow-up
      // cannot leave the panel stuck after bindGraphThread set loading=true.
      loading: false,
      ...(silent ? {} : { error: null })
    })
  } catch (error) {
    if (get().threadId !== threadId) return
    if (!silent) set({ loading: false, error: message(error) })
    else if (get().loading) set({ loading: false })
  }
}

export const useGraphStore = create<GraphViewState>((set, get) => ({
  threadId: null,
  workspace: '',
  runs: [],
  drafts: [],
  childRuns: {},
  childReturnTarget: null,
  selectedRunId: null,
  selectedNodeId: null,
  identity: null,
  profiles: [],
  evidence: [],
  scores: [],
  audit: [],
  candidates: [],
  jobs: [],
  exportedProfile: null,
  artifactPage: null,
  artifactContent: '',
  artifactLoading: false,
  wakingObligationId: null,
  loading: false,
  error: null,
  syncStatus: 'idle',
  threadEventSeq: 0,

  bindGraphThread: (nextThreadId) => {
    const current = get()
    if (nextThreadId === null) {
      if (current.threadId === null && current.runs.length === 0) {
        return { switched: false }
      }
      set({
        threadId: null,
        runs: [],
        drafts: [],
        childRuns: {},
        selectedRunId: null,
        selectedNodeId: null,
        artifactPage: null,
        artifactContent: '',
        artifactLoading: false,
        loading: false,
        error: null,
        syncStatus: 'idle',
        threadEventSeq: 0
      })
      return { switched: true }
    }
    if (current.threadId === nextThreadId) {
      return { switched: false }
    }
    // Different thread: never show the previous thread's Graph projection.
    set({
      threadId: nextThreadId,
      runs: [],
      drafts: [],
      childRuns: {},
      selectedRunId: null,
      selectedNodeId: null,
      artifactPage: null,
      artifactContent: '',
      artifactLoading: false,
      loading: true,
      error: null,
      syncStatus: 'connecting',
      threadEventSeq: 0
    })
    return { switched: true }
  },

  refreshThread: async (threadId, options) => {
    const silent = options?.silent === true
    if (!threadId) {
      get().bindGraphThread(null)
      return
    }

    // Atomic ownership transition — does not depend on React effect order.
    const { switched } = get().bindGraphThread(threadId)
    if (!switched && !silent) {
      set({ loading: true, error: null })
    } else if (!switched && silent) {
      // same thread silent reconcile: leave projection untouched until apply
    }

    const gate = refreshGateFor(threadId)
    if (gate.inFlight) {
      gate.pending = true
      gate.pendingSilent = gate.pendingSilent && silent
      await gate.inFlight
      return
    }

    gate.pending = true
    gate.pendingSilent = silent
    const run = (async () => {
      try {
        while (gate.pending && get().threadId === threadId) {
          const useSilent = gate.pendingSilent
          gate.pending = false
          gate.pendingSilent = true
          await applyThreadSnapshot(get, set, threadId, useSilent)
        }
      } finally {
        gate.inFlight = null
        // A request may have marked pending after the while-check but before
        // inFlight was cleared; start a follow-up leader without dropping it.
        if (gate.pending && get().threadId === threadId) {
          void get().refreshThread(threadId, { silent: gate.pendingSilent })
        }
      }
    })()
    gate.inFlight = run
    await run
  },

  refreshProject: async (workspace) => {
    const trimmed = workspace.trim()
    set({ workspace: trimmed })
    if (!trimmed) {
      set({
        identity: null,
        profiles: [],
        evidence: [],
        scores: [],
        audit: [],
        candidates: [],
        jobs: [],
        exportedProfile: null
      })
      return
    }
    try {
      const identity = await graphRuntimeClient.identity(trimmed)
      const [profiles, evidence, scores, audit, candidates, jobs] = await Promise.all([
        graphRuntimeClient.listProfiles(identity.projectId),
        graphRuntimeClient.listEvidence(identity.projectId),
        graphRuntimeClient.listScores(identity.projectId),
        graphRuntimeClient.listAudit(identity.projectId),
        graphRuntimeClient.listCandidates(identity.projectId),
        graphRuntimeClient.listJobs(identity.projectId)
      ])
      if (get().workspace !== trimmed) return
      set({ identity, profiles, evidence, scores, audit, candidates, jobs, error: null })
    } catch (error) {
      if (get().workspace === trimmed) set({ error: message(error) })
    }
  },

  refreshSelectedRun: async () => {
    const runId = get().selectedRunId
    if (!runId) return
    try {
      const run = await graphRuntimeClient.getRun(runId)
      set((state) => ({
        runs: state.runs.some((item) => item.id === run.id)
          ? state.runs.map((item) => item.id === run.id ? run : item)
          : [run, ...state.runs],
        error: null
      }))
    } catch (error) {
      set({ error: message(error) })
    }
  },

  selectRun: (selectedRunId) => set({
    selectedRunId,
    selectedNodeId: null,
    artifactPage: null,
    artifactContent: '',
    artifactLoading: false
  }),
  selectNode: (selectedNodeId) => set({
    selectedNodeId,
    artifactPage: null,
    artifactContent: '',
    artifactLoading: false
  }),
  setChildReturnTarget: (childReturnTarget) => set({
    childReturnTarget,
    selectedRunId: childReturnTarget.runId,
    selectedNodeId: childReturnTarget.nodeId
  }),
  updateChildObserver: (observerStatus, cursor) => set((state) => {
    if (!state.childReturnTarget) return {}
    return {
      childReturnTarget: {
        ...state.childReturnTarget,
        observerStatus,
        parentEventSeq: cursor === undefined
          ? state.childReturnTarget.parentEventSeq
          : Math.max(state.childReturnTarget.parentEventSeq, cursor)
      }
    }
  }),
  updateChildSessionStatus: (childSessionStatus) => set((state) => {
    if (!state.childReturnTarget) return {}
    return {
      childReturnTarget: {
        ...state.childReturnTarget,
        childSessionStatus
      }
    }
  }),
  clearChildReturnTarget: () => set({ childReturnTarget: null }),

  setSyncStatus: (syncStatus, ownerThreadId) => set((state) => {
    if (ownerThreadId !== undefined && state.threadId !== ownerThreadId) return {}
    return { syncStatus }
  }),

  advanceThreadEventSeq: (seq, ownerThreadId) => set((state) => {
    if (ownerThreadId !== undefined && state.threadId !== ownerThreadId) return {}
    return { threadEventSeq: Math.max(state.threadEventSeq, seq) }
  }),

  receiveChildRuntimeEvent: (event) => {
    if (event.child.parentThreadId !== get().threadId) return
    const incoming = graphChildRuntimeFromEvent(event)
    set((state) => ({
      childRuns: {
        ...state.childRuns,
        [incoming.childId]: mergeGraphChildRuntime(
          state.childRuns[incoming.childId],
          incoming
        )
      }
    }))
  },

  receiveEvent: (event) => {
    if (event.threadId !== get().threadId) return
    const known = get().runs.find((run) => run.id === event.runId)
    // graphSeq is run-local; thread SSE cursor is separate. Gaps and advances
    // both converge via a coalesced silent snapshot — domain listEvents is not
    // projected because the renderer owns HTTP run snapshots, not event replay.
    if (known && event.graphSeq <= known.lastEventSeq) return
    void get().refreshThread(event.threadId, { silent: true })
  },

  receivePlanningEvent: (event) => {
    const current = get()
    const index = current.drafts.findIndex((view) => view.draft.id === event.draftId)
    if (index < 0) {
      if (current.threadId) void current.refreshThread(current.threadId)
      return
    }
    set((state) => ({
      drafts: state.drafts.map((view) =>
        view.draft.id === event.draftId && event.revision >= view.draft.revision
          ? {
              draft: {
                ...view.draft,
                revision: event.revision,
                status: event.state,
                issues: event.issues,
                ...(event.committedRunId
                  ? { committedRunId: event.committedRunId }
                  : {})
              },
              tasks: event.tasks
            }
          : view)
    }))
    if (event.state === 'committed' && current.threadId) {
      void get().refreshThread(current.threadId)
    }
  },

  command: async (action) => {
    const runId = get().selectedRunId
    if (!runId) return
    try {
      const run = await graphRuntimeClient.command(runId, action)
      set((state) => ({
        runs: state.runs.map((item) => item.id === run.id ? run : item),
        error: null
      }))
    } catch (error) {
      set({ error: message(error) })
    }
  },

  cancel: async () => {
    const runId = get().selectedRunId
    if (!runId) return
    try {
      const run = await graphRuntimeClient.cancel(runId, 'Cancelled by user from Graph panel.')
      set((state) => ({
        runs: state.runs.map((item) => item.id === run.id ? run : item),
        error: null
      }))
    } catch (error) {
      set({ error: message(error) })
    }
  },

  resumeDraft: async (draftId) => {
    const view = get().drafts.find((item) => item.draft.id === draftId)
    if (!view) return
    try {
      const next = await graphRuntimeClient.resumeDraft(
        draftId,
        view.draft.revision
      )
      set((state) => ({
        drafts: state.drafts.map((item) =>
          item.draft.id === draftId ? next : item),
        error: null
      }))
    } catch (error) {
      const actionError = message(error)
      try {
        const latest = await graphRuntimeClient.getDraft(draftId)
        set((state) => ({
          drafts: state.drafts.map((item) =>
            item.draft.id === draftId && latest.draft.revision >= item.draft.revision
              ? latest
              : item),
          error: actionError
        }))
      } catch {
        set({ error: actionError })
      }
    }
  },

  cancelDraft: async (draftId) => {
    const view = get().drafts.find((item) => item.draft.id === draftId)
    if (!view) return
    try {
      const next = await graphRuntimeClient.cancelDraft(
        draftId,
        view.draft.revision
      )
      set((state) => ({
        drafts: state.drafts.map((item) =>
          item.draft.id === draftId ? next : item),
        error: null
      }))
    } catch (error) {
      set({ error: message(error) })
    }
  },

  retryNode: async (nodeId) => {
    const runId = get().selectedRunId
    if (!runId) return
    try {
      const run = await graphRuntimeClient.retry(runId, nodeId)
      set((state) => ({
        runs: state.runs.map((item) => item.id === run.id ? run : item),
        error: null
      }))
    } catch (error) {
      set({ error: message(error) })
    }
  },

  reviewNode: async (nodeId, outcome) => {
    const run = get().runs.find((item) => item.id === get().selectedRunId)
    const attempt = run?.nodes[nodeId]?.attempts.at(-1)
    if (!run || !attempt) return
    try {
      const next = await graphRuntimeClient.review(run, nodeId, attempt.id, outcome)
      set((state) => ({
        runs: state.runs.map((item) => item.id === next.id ? next : item),
        error: null
      }))
    } catch (error) {
      set({ error: message(error) })
    }
  },

  wakeLead: createGraphLeadWakeAction({
    get: () => get(),
    update: (updater) => set((state) => updater(state))
  }),

  patch: async (operations, reason) => {
    const run = get().runs.find((item) => item.id === get().selectedRunId)
    if (!run || operations.length === 0 || !reason.trim()) return
    try {
      const next = await graphRuntimeClient.patch(run, operations, reason.trim())
      set((state) => ({
        runs: state.runs.map((item) => item.id === next.id ? next : item),
        error: null
      }))
    } catch (error) {
      set({ error: message(error) })
    }
  },

  rebindNode: async (nodeId, profileId) => {
    const trimmed = profileId.trim()
    if (!trimmed) return
    await get().patch([{
      op: 'rebind_node',
      nodeId,
      assignment: { kind: 'existing', profileId: trimmed }
    }], `User rebound node ${nodeId} to project profile ${trimmed}.`)
  },

  steer: async (text, nodeId) => {
    const runId = get().selectedRunId
    if (!runId || !text.trim()) return
    try {
      const run = await graphRuntimeClient.steer(
        runId,
        text.trim(),
        nodeId ? { kind: 'node', nodeId } : { kind: 'run' }
      )
      set((state) => ({
        runs: state.runs.map((item) => item.id === run.id ? run : item),
        error: null
      }))
    } catch (error) {
      set({ error: message(error) })
    }
  },

  steerSourceTurn: async (threadId, sourceTurnId, text) => {
    const trimmed = text.trim()
    if (!trimmed) return false
    try {
      const next = await steerGraphSourceTurn({
        threadId,
        sourceTurnId,
        text: trimmed,
        knownRuns: get().runs
      })
      if (!next) return false
      set((state) => ({
        runs: state.runs.some((item) => item.id === next.id)
          ? state.runs.map((item) => item.id === next.id ? next : item)
          : [next, ...state.runs],
        selectedRunId: next.id,
        error: null
      }))
      return true
    } catch (error) {
      set({ error: message(error) })
      throw error
    }
  },

  loadArtifact: async (artifactId) => {
    const runId = get().selectedRunId
    if (!runId) return
    set({ artifactLoading: true, error: null })
    try {
      const page = await graphRuntimeClient.readArtifact(runId, artifactId)
      if (get().selectedRunId !== runId) return
      set({
        artifactPage: page,
        artifactContent: page.content,
        artifactLoading: false,
        error: null
      })
    } catch (error) {
      set({ artifactLoading: false, error: message(error) })
    }
  },

  loadNextArtifactPage: async () => {
    const runId = get().selectedRunId
    const current = get().artifactPage
    if (!runId || !current || !current.truncated) return
    const cursor = current.nextStartLine !== undefined
      ? { startLine: current.nextStartLine }
      : { offset: current.nextOffset ?? 0 }
    set({ artifactLoading: true, error: null })
    try {
      const page = await graphRuntimeClient.readArtifact(
        runId,
        current.reference.artifactId,
        cursor
      )
      if (
        get().selectedRunId !== runId ||
        get().artifactPage?.reference.artifactId !== current.reference.artifactId
      ) return
      set({
        artifactPage: page,
        artifactContent: page.content,
        artifactLoading: false,
        error: null
      })
    } catch (error) {
      set({ artifactLoading: false, error: message(error) })
    }
  },

  clearArtifact: () => set({
    artifactPage: null,
    artifactContent: '',
    artifactLoading: false
  }),

  transitionProfile: async (profileId, lifecycle) => {
    const { identity, workspace } = get()
    if (!identity || !workspace) return
    try {
      await graphRuntimeClient.transitionProfile(
        identity.projectId,
        profileId,
        workspace,
        lifecycle,
        `User changed lifecycle to ${lifecycle} from the Graph panel.`
      )
      await get().refreshProject(workspace)
    } catch (error) {
      set({ error: message(error) })
    }
  },

  exportProfile: async (profileId) => {
    const { identity } = get()
    if (!identity) return
    try {
      const portable = await graphRuntimeClient.exportProfile(identity.projectId, profileId)
      set({ exportedProfile: JSON.stringify(portable, null, 2), error: null })
    } catch (error) {
      set({ error: message(error) })
    }
  },

  importProfile: async (portableJson) => {
    const { identity, workspace } = get()
    if (!identity || !workspace) return
    try {
      const value = JSON.parse(portableJson) as {
        format?: unknown
        formatVersion?: unknown
        profile?: unknown
      }
      if (
        value.format !== 'kun.graph-agent-profile' ||
        value.formatVersion !== 1 ||
        !value.profile ||
        typeof value.profile !== 'object'
      ) {
        throw new Error('Invalid portable Graph project-agent profile.')
      }
      await graphRuntimeClient.importProfile(
        identity.projectId,
        workspace,
        value.profile as GraphAgentProfile
      )
      await get().refreshProject(workspace)
    } catch (error) {
      set({ error: message(error) })
    }
  },

  mergeProfiles: async (sourceProfileIds, targetProfileId, name) => {
    const { identity, workspace } = get()
    if (!identity || !workspace) return
    if (sourceProfileIds.length < 2 || !targetProfileId.trim() || !name.trim()) return
    try {
      await graphRuntimeClient.mergeProfiles(
        identity.projectId,
        workspace,
        sourceProfileIds,
        targetProfileId.trim(),
        name.trim()
      )
      await get().refreshProject(workspace)
    } catch (error) {
      set({ error: message(error) })
    }
  },

  governCandidate: async (candidateId, action) => {
    const { identity, workspace } = get()
    if (!identity || !workspace) return
    try {
      await graphRuntimeClient.governCandidate(
        identity.projectId,
        candidateId,
        workspace,
        action,
        `User selected ${action} from the Graph learning panel.`
      )
      await get().refreshProject(workspace)
    } catch (error) {
      set({ error: message(error) })
    }
  },

  consolidate: async () => {
    const { identity, workspace } = get()
    if (!identity || !workspace) return
    try {
      await graphRuntimeClient.consolidate(identity.projectId, workspace)
      await get().refreshProject(workspace)
    } catch (error) {
      set({ error: message(error) })
    }
  }
}))

export function receiveGraphRuntimeEvent(value: unknown): void {
  if (!value || typeof value !== 'object') return
  const event = value as Partial<GraphEventEnvelope>
  if (
    event.version !== 1 ||
    typeof event.runId !== 'string' ||
    typeof event.threadId !== 'string' ||
    typeof event.graphSeq !== 'number' ||
    !event.event
  ) return
  useGraphStore.getState().receiveEvent(event as GraphEventEnvelope)
}

export function receiveGraphPlanningRuntimeEvent(value: unknown): void {
  if (!value || typeof value !== 'object') return
  const event = value as Partial<GraphPlanningLifecycleEvent>
  if (
    event.version !== 1 ||
    typeof event.event !== 'string' ||
    typeof event.draftId !== 'string' ||
    typeof event.sourceTurnId !== 'string' ||
    typeof event.revision !== 'number' ||
    typeof event.state !== 'string' ||
    !Array.isArray(event.issues) ||
    !Array.isArray(event.tasks)
  ) return
  useGraphStore.getState().receivePlanningEvent(
    event as GraphPlanningLifecycleEvent
  )
}

export function receiveGraphChildRuntimeEvent(event: RuntimeChildEventPayload): void {
  useGraphStore.getState().receiveChildRuntimeEvent(event)
}

export type { GraphChildReturnTarget } from './graph-child-runtime'
export {
  graphChildRuntimeFromDiagnostics,
  graphChildRuntimeFromEvent,
  mergeGraphChildRuntime
} from './graph-child-runtime'

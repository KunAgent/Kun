import {
  DEFAULT_APPROVAL_REVIEWER,
  type ApprovalPolicy,
  type ApprovalReviewer,
  type SandboxMode
} from '../contracts/policy.js'
import type { DelegationRuntime } from '../delegation/delegation-runtime.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { TurnService } from '../services/turn-service.js'
import type { GraphRuntimeStartOptions } from './graph-runtime-factory.js'
import type { GraphRuntimeConfig } from '../config/kun-config.js'
import type { RegisterUnit } from '../contracts/activity.js'
import { graphParentAuthorityToolNames } from '../graph/graph-tool-boundary.js'
import type { CapabilityToolSpec } from '../adapters/tool/capability-registry.js'
import type { TurnRunOutcome } from '../loop/turn-execution-types.js'

type GraphAuthorityDefaults = {
  model: string
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
  approvalReviewer?: ApprovalReviewer
  allowedMcpServers: string[]
  disabledSkillIds: string[]
  networkAllowed: boolean
  workerModel?: GraphRuntimeConfig['workerModel']
}

export function createGraphRuntimeStartOptions(input: {
  delegation: () => DelegationRuntime | undefined
  threads: Pick<ThreadStore, 'get'>
  resumeTurn: (
    request: Parameters<TurnService['resumeGraphLeadTurn']>[0]
  ) => ReturnType<TurnService['resumeGraphLeadTurn']>
  isTurnExecutionActive: (turnId: string) => boolean
  isShuttingDown?: () => boolean
  steerTurn: (
    request: Parameters<TurnService['steerTurn']>[0]
  ) => ReturnType<TurnService['steerTurn']>
  runAgentTurn: (
    threadId: string,
    turnId: string
  ) => Promise<TurnRunOutcome>
  defaults: () => GraphAuthorityDefaults
  tools: () => CapabilityToolSpec[]
  skillIds: () => string[]
  /** Mission-control activity rows for worker attempts (P1-25). */
  activity?: Pick<{ register(unit: RegisterUnit): unknown }, 'register'>
}): GraphRuntimeStartOptions {
  return {
    delegation: input.delegation,
    steerTurn: input.steerTurn,
    leadTurn: async ({ run, reasons, nodeIds, digest }) => {
      if (input.isShuttingDown?.()) {
        return {
          status: 'deferred' as const,
          reason: 'Graph runtime is shutting down.',
          retryAfterMs: 60_000
        }
      }
      const thread = await input.threads.get(run.threadId)
      if (!thread) {
        return { status: 'orphaned' as const, reason: `source thread not found: ${run.threadId}` }
      }
      const prompt = graphLeadPrompt({
        runId: run.id,
        runStatus: run.status,
        reasons,
        nodeIds,
        digest
      })
      const sourceTurn = thread.turns.find((turn) => turn.id === run.sourceTurnId)
      if (!sourceTurn) {
        return { status: 'orphaned' as const, reason: `source turn not found: ${run.sourceTurnId}` }
      }
      if (sourceTurn.status !== 'running') {
        // Legacy GraphRuns may have been detached from an already-terminal
        // source turn. Preserve immutable history instead of fabricating a
        // replacement Lead turn.
        return run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled'
          ? { status: 'terminal' as const }
          : {
              status: 'orphaned' as const,
              reason: `Graph source turn ${sourceTurn.id} is ${sourceTurn.status}`
            }
      }
      if (input.isTurnExecutionActive(sourceTurn.id)) {
        if (input.isShuttingDown?.()) {
          return {
            status: 'deferred' as const,
            reason: 'Graph runtime is shutting down.',
            retryAfterMs: 60_000
          }
        }
        await input.steerTurn({
          threadId: run.threadId,
          turnId: sourceTurn.id,
          text: prompt,
          messageSource: 'graph_runtime'
        })
        // Acknowledge only after the episode prompt is durably accepted. If
        // steering fails or the host exits first, restart redelivers it.
        await input.resumeTurn({
          threadId: run.threadId,
          turnId: sourceTurn.id,
          runId: run.id,
          lastDeliveredSeq: run.lastEventSeq,
          terminal:
            run.status === 'completed' ||
            run.status === 'failed' ||
            run.status === 'cancelled'
        })
        return {
          status: 'delivered' as const,
          sourceTurnId: sourceTurn.id,
          deliveredSeq: run.lastEventSeq,
          executionActive: true
        }
      }
      if (input.isShuttingDown?.()) {
        return {
          status: 'deferred' as const,
          reason: 'Graph runtime is shutting down.',
          retryAfterMs: 60_000
        }
      }
      const previousDeliveredSeq =
        sourceTurn.graphLeadLifecycle?.runId === run.id
          ? sourceTurn.graphLeadLifecycle.lastDeliveredSeq
          : 0
      const resumed = await input.resumeTurn({
        threadId: run.threadId,
        turnId: sourceTurn.id,
        runId: run.id,
        lastDeliveredSeq: previousDeliveredSeq,
        terminal:
          run.status === 'completed' ||
          run.status === 'failed' ||
          run.status === 'cancelled'
      })
      if (input.isShuttingDown?.()) {
        await input.runAgentTurn(run.threadId, sourceTurn.id)
        return {
          status: 'deferred' as const,
          reason: 'Graph runtime shut down while reacquiring the source turn.',
          retryAfterMs: 60_000
        }
      }
      await input.steerTurn({
        threadId: run.threadId,
        turnId: sourceTurn.id,
        text: prompt,
        messageSource: 'graph_runtime'
      })
      await input.resumeTurn({
        threadId: run.threadId,
        turnId: sourceTurn.id,
        runId: run.id,
        lastDeliveredSeq: run.lastEventSeq,
        terminal:
          run.status === 'completed' ||
          run.status === 'failed' ||
          run.status === 'cancelled'
      })
      if (resumed === 'already_running') {
        return {
          status: 'delivered' as const,
          sourceTurnId: sourceTurn.id,
          deliveredSeq: run.lastEventSeq,
          executionActive: true
        }
      }
      let outcome = await input.runAgentTurn(run.threadId, sourceTurn.id)
      // A wake-up can reacquire the execution lease during the tiny interval
      // between a previous slice parking and its active-run promise settling.
      // Once that promise is gone, start the continuation that owns the lease.
      while (
        (outcome === 'suspended' || outcome === 'suspended_pending_supervision') &&
        !input.isShuttingDown?.() &&
        input.isTurnExecutionActive(sourceTurn.id)
      ) {
        outcome = await input.runAgentTurn(run.threadId, sourceTurn.id)
      }
      return {
        status: 'delivered' as const,
        sourceTurnId: sourceTurn.id,
        deliveredSeq: run.lastEventSeq,
        executionActive: input.isTurnExecutionActive(sourceTurn.id),
        ...(outcome === ('suspended_pending_supervision' as TurnRunOutcome)
          ? { parkedWithPendingSupervision: true }
          : {})
      }
    },
    isLeadTurnActive: (run) => input.isTurnExecutionActive(run.sourceTurnId),
    activity: input.activity,
    authorityForRun: async (run) => {
      const thread = await input.threads.get(run.threadId)
      const sourceTurn = thread?.turns.find((turn) => turn.id === run.sourceTurnId)
      const defaults = input.defaults()
      const sandboxMode =
        sourceTurn?.sandboxMode ??
        thread?.sandboxMode ??
        defaults.sandboxMode
      const model =
        sourceTurn?.actingModelRoute?.model ??
        sourceTurn?.model ??
        thread?.model ??
        defaults.model
      const providerId =
        sourceTurn?.actingModelRoute?.providerId ??
        sourceTurn?.providerId ??
        thread?.providerId ??
        'default'
      const accountId =
        sourceTurn?.actingModelRoute?.accountId ??
        sourceTurn?.accountId ??
        (providerId === thread?.providerId ? thread?.accountId : undefined)
      const configuredWorkerModel = defaults.workerModel?.mode === 'fixed'
        ? defaults.workerModel
        : undefined
      const tools = input.tools()
      const allowedProviders = [...new Set(tools
        .filter((tool) => defaults.networkAllowed || tool.effects?.network === false)
        .map((tool) => tool.providerId))]
      return {
        workspaceRoot: run.plans.at(-1)!.workspaceRoot,
        model,
        providerId,
        ...(accountId ? { accountId } : {}),
        allowedModelProviderIds: [...new Set([
          providerId,
          ...(configuredWorkerModel ? [configuredWorkerModel.providerId] : [])
        ])],
        allowedModels: [...new Set([
          model,
          ...(configuredWorkerModel ? [configuredWorkerModel.model] : [])
        ])],
        allowedProviderIds: allowedProviders,
        reasoningEffort: sourceTurn?.reasoningEffort ?? 'off',
        approvalPolicy:
          sourceTurn?.approvalPolicy ??
          thread?.approvalPolicy ??
          defaults.approvalPolicy,
        sandboxMode,
        approvalReviewer:
          sourceTurn?.approvalReviewer ??
          thread?.approvalReviewer ??
          defaults.approvalReviewer ??
          DEFAULT_APPROVAL_REVIEWER,
        allowedTools: graphParentAuthorityToolNames(tools
          .filter((tool) => allowedProviders.includes(tool.providerId))
          .map((tool) => tool.name)),
        blockedTools: [],
        allowedSkills: input.skillIds(),
        blockedSkills: defaults.disabledSkillIds,
        allowedMcpServers: defaults.allowedMcpServers,
        blockedMcpServers: [],
        readScopes: ['.'],
        writeScopes: sandboxMode === 'read-only' ? [] : ['.'],
        networkAllowed: defaults.networkAllowed
      }
    }
  }
}

function graphLeadPrompt(input: {
  runId: string
  runStatus: string
  reasons: string[]
  nodeIds: string[]
  digest: string
}): string {
  return [
    `Graph Lead supervision for durable run ${input.runId}.`,
    `Signals: ${input.reasons.join(', ') || 'status change'}.`,
    input.nodeIds.length ? `Affected nodes: ${input.nodeIds.join(', ')}.` : '',
    input.digest ? `Bounded signal digest:\n${input.digest}` : '',
    'Inspect current durable truth with graph_control_run before deciding.',
    'Use only validated Graph tools for mutations. Do not edit Graph state indirectly.',
    ['completed', 'failed', 'cancelled'].includes(input.runStatus)
      ? 'Present the persisted terminal outcome, synthesis, evidence, changed files, checks, costs, and unresolved risks to the user.'
      : [
          'Report a concise milestone to the user from this same Lead turn.',
          'Actively inspect affected and live worker sessions with graph_supervise_node; choose a bounded wait and inspect again when progress is healthy.',
          'Guide drift or missing deliverables immediately, verify the correction, and resolve safe issues; retry, repair, patch, or rebind eligible work when evidence requires it.',
          'Request human input only for decisions that policy or risk prevents you from making.',
          'Do not treat dispatch or one milestone as completion. Suspend only after this supervision episode is handled and no live worker requires continued observation; the same Lead turn will resume on later durable signals.'
        ].join(' ')
  ].filter(Boolean).join('\n\n')
}

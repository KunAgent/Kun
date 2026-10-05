import type { TurnItem } from '../contracts/items.js'
import type {
  DelegatedProviderKind,
  DelegatedSessionPreparation
} from '../runtime/delegated-session-binding.js'
import { needsHandoff } from './handoff-plan.js'
import { priorItemsForDelegatedTurn } from '../runtime/delegated-session-binding.js'
import { buildHandoffBrief, type HandoffBriefResult } from './handoff-brief.js'
import { extractWorkState } from './work-state.js'
import type {
  HandoffBudgets,
  HandoffReason,
  WorkState
} from './handoff-types.js'

/**
 * Structural view of the task-workspace service a delegated runtime needs —
 * avoids a hard dependency on the service implementation.
 */
export type TaskWorkspaceLister = {
  list(filter: { ownerThreadId: string }): readonly {
    path: string
    branch?: string
    changedFiles: readonly string[]
  }[]
}

/**
 * Per-turn handoff planner for delegated runtimes (docs/ade/08 §4–§5). Given a
 * session preparation it decides whether the next prompt needs a deterministic
 * brief, builds it, and returns the `handoff_injected` event payload.
 */

export type TurnHandoffEvent = {
  kind: 'handoff_injected'
  reason: HandoffReason
  mode: 'full' | 'delta'
  sinceTurnId?: string
  from: { harnessName: string; model?: string }
  to: { harnessName: string; model?: string }
  workspace?: { path: string; branch?: string }
  stats: {
    recentTurns: number
    digestLines: number
    files: number
    commands: number
    bytes: number
  }
  briefDigest: string
}

export type TurnHandoff = {
  /** Text to splice into the prompt (replaces the portable transcript). */
  brief: HandoffBriefResult
  event: TurnHandoffEvent
  /** Routine portable continuation needs history but no user-facing transfer. */
  background?: boolean
}

export type BuildTurnHandoffInput = {
  items: readonly TurnItem[]
  currentTurnId: string
  preparation: DelegatedSessionPreparation
  /**
   * The turn's working directory + branch for the brief header; defaults to the
   * preparation route's workspace.
   */
  workspacePath?: string
  workspaceBranch?: string
  /** Optional precomputed work state (e.g. already merged task workspace). */
  workState?: WorkState
  /** Task-workspace record merged into extracted work state when present. */
  taskWorkspace?: { changedFiles: readonly string[]; branch?: string }
  budgets?: Partial<HandoffBudgets>
}

export function delegatedProviderKindLabel(kind: DelegatedProviderKind | 'kun'): string {
  switch (kind) {
    case 'agent-sdk':
      return 'Claude Code'
    case 'cursor-sdk':
      return 'Cursor'
    case 'antigravity-cli':
      return 'Antigravity'
    case 'acp':
      return 'ACP agent'
    case 'codex-app-server':
      return 'Codex'
    case 'pi-rpc':
      return 'Pi'
    case 'kun':
      return 'Kun'
  }
}

function handoffReason(preparation: DelegatedSessionPreparation): HandoffReason {
  return preparation.rebaseReason === 'route_changed' ||
    preparation.rebaseReason === 'new'
    ? 'harness-switch'
    : 'rebase'
}

function handoffSource(
  preparation: DelegatedSessionPreparation
): { harnessName: string; model?: string } {
  const from =
    preparation.rebasedFrom ?? preparation.parkedDelta?.fromRoute ?? undefined
  // Without a displaced route the previous surface was the native Kun loop.
  return from
    ? { harnessName: delegatedProviderKindLabel(from.providerKind), model: from.model }
    : { harnessName: 'Kun' }
}

/**
 * Decide and build the handoff for this turn. `null` when the turn resumes a
 * native session normally or there is no conversational history to hand over.
 */
export function buildTurnHandoff(input: BuildTurnHandoffInput): TurnHandoff | null {
  const plan = needsHandoff(input.preparation, priorItemsForDelegatedTurn(input.items, input.currentTurnId))
  if (!plan) return null
  const reason: HandoffReason =
    plan.mode === 'delta' ? 'harness-switch' : handoffReason(input.preparation)
  const brief = buildHandoffBrief({
    items: input.items,
    currentTurnId: input.currentTurnId,
    reason,
    mode: plan.mode,
    ...(plan.mode === 'delta' ? { sinceTurnId: plan.sinceTurnId } : {}),
    from: handoffSource(input.preparation),
    to: {
      harnessName: delegatedProviderKindLabel(input.preparation.route.providerKind),
      ...(input.preparation.route.model
        ? { model: input.preparation.route.model }
        : {})
    },
    ...(input.workspacePath || input.preparation.route.workspace
      ? {
          workspace: {
            path: input.workspacePath ?? input.preparation.route.workspace,
            ...(input.workspaceBranch ? { branch: input.workspaceBranch } : {})
          }
        }
      : {}),
    workState:
      input.workState ??
      extractWorkState(input.items, input.taskWorkspace),
    ...(input.budgets ? { budgets: input.budgets } : {})
  })
  return {
    brief,
    ...(input.preparation.route.continuationMode === 'portable' && !input.preparation.rebaseReason &&
      !input.preparation.parkedDelta ? { background: true } : {}),
    event: {
      kind: 'handoff_injected',
      reason,
      mode: plan.mode,
      ...(plan.mode === 'delta' ? { sinceTurnId: plan.sinceTurnId } : {}),
      from: handoffSource(input.preparation),
      to: {
        harnessName: delegatedProviderKindLabel(input.preparation.route.providerKind),
        ...(input.preparation.route.model
          ? { model: input.preparation.route.model }
          : {})
      },
      ...(input.workspacePath || input.preparation.route.workspace
        ? {
            workspace: {
              path: input.workspacePath ?? input.preparation.route.workspace,
              ...(input.workspaceBranch ? { branch: input.workspaceBranch } : {})
            }
          }
        : {}),
      stats: brief.stats,
      briefDigest: brief.digest
    }
  }
}

/**
 * Runtime-side handoff resolution shared by the delegated runtimes: applies
 * the deterministicHandoff gate, folds the turn's task workspace (when the
 * turn runs inside one) into the brief, and delegates to buildTurnHandoff.
 */
export function resolveTurnHandoff(input: {
  enabled: boolean
  preparation: DelegatedSessionPreparation | undefined
  items: readonly TurnItem[]
  currentTurnId: string
  ownerThreadId: string
  workspacePath: string | undefined
  taskWorkspaces?: TaskWorkspaceLister
}): TurnHandoff | undefined {
  if (!input.enabled || !input.preparation) return undefined
  const taskWorkspace = input.taskWorkspaces
    ?.list({ ownerThreadId: input.ownerThreadId })
    .filter((record) => record.path === input.workspacePath)
    .at(-1)
  return buildTurnHandoff({
    items: input.items,
    currentTurnId: input.currentTurnId,
    preparation: input.preparation,
    ...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
    ...(taskWorkspace?.branch ? { workspaceBranch: taskWorkspace.branch } : {}),
    ...(taskWorkspace ? { taskWorkspace } : {})
  }) ?? undefined
}

export type HandoffInjectedRecord =
  & { threadId: string; turnId: string; harnessId: string }
  & TurnHandoffEvent

/** Record the `handoff_injected` marker for a resolved turn handoff. */
export async function recordHandoffInjected(
  record: (event: HandoffInjectedRecord) => Promise<unknown> | unknown,
  ids: { threadId: string; turnId: string; harnessId: string },
  handoff: TurnHandoff | TurnHandoffEvent | undefined
): Promise<void> {
  if (handoff && 'background' in handoff && handoff.background) return
  const event = handoff ? ('event' in handoff ? handoff.event : handoff) : undefined
  if (event) await record({ ...ids, ...event })
}

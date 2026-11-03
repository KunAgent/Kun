/**
 * New-session clicks are asynchronous (settings, project defaults, reuse
 * lookup, create). Two rapid clicks used to run two creations and leave two
 * empty rows, so identical intents share one in-flight creation while each
 * caller still applies its own navigation guard to activation.
 */
import type { NormalizedThread } from '../agent/types'
import type { ChatState } from './chat-store-types'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import { readThreadWorktreeRegistry } from '../lib/thread-worktree-registry'
import {
  activeThreadIsUntouched,
  isThreadAvailableForNewSession,
  listedThreadEmptiness,
  threadBelongsToWorkspace
} from './chat-store-runtime-helpers'

export type ThreadCreationIntentOptions = {
  workspaceRoot?: string
  forceNew?: boolean
  agentSurface?: 'code' | 'design'
  workspaceMode?: 'ade'
  conversation?: boolean
  agentId?: string
  harnessId?: string
  model?: string
  providerId?: string
  credentialMode?: string
  gatewayBinding?: unknown
  useWorktreePool?: boolean
  worktreeBranch?: string
}

/**
 * Intent identity: everything that makes another creation a different task.
 * The guard is per click and deliberately excluded.
 */
export function threadCreationIntentKey(
  options: ThreadCreationIntentOptions,
  state: Pick<ChatState, 'activeThreadId' | 'threads'>
): string {
  const activeThread = state.activeThreadId
    ? state.threads.find((thread) => thread.id === state.activeThreadId)
    : null
  const workspaceRoot = normalizeWorkspaceRoot(options.workspaceRoot ?? '') ||
    normalizeWorkspaceRoot(activeThread?.workspace ?? '')
  return JSON.stringify([
    options.conversation === true ? 'conversation' : 'thread',
    workspaceRoot,
    options.workspaceMode === 'ade' ? 'ade' : options.agentSurface ?? 'code',
    options.forceNew === true ? 'force-new' : 'reuse',
    options.useWorktreePool === true ? 'worktree' : 'local',
    options.worktreeBranch?.trim() ?? '',
    options.agentId?.trim() ?? '',
    options.harnessId?.trim() ?? '',
    options.providerId?.trim() ?? '',
    options.model?.trim() ?? '',
    options.credentialMode ?? ''
  ])
}

type ThreadCreationEntry = {
  promise: Promise<string | null>
  /**
   * The newest click's guard owns the shared creation. A stale guard must not
   * abort work another click is now waiting on, so every member refreshes this.
   */
  guard: () => boolean
}

const inFlightCreations = new Map<string, ThreadCreationEntry>()

export function pendingThreadCreation(intentKey: string): ThreadCreationEntry | undefined {
  return inFlightCreations.get(intentKey)
}

export function trackThreadCreation(
  intentKey: string,
  creation: Promise<string | null>,
  guard: () => boolean
): void {
  inFlightCreations.set(intentKey, { promise: creation, guard })
}

/** A click that joined a shared creation becomes the one its activation obeys. */
export function adoptThreadCreationGuard(intentKey: string, guard: () => boolean): void {
  const entry = inFlightCreations.get(intentKey)
  if (entry) entry.guard = guard
}

/** Whether the shared creation may still take over the view. */
export function threadCreationStillWanted(intentKey: string): boolean {
  const entry = inFlightCreations.get(intentKey)
  return entry ? entry.guard() : true
}

export function releaseThreadCreation(
  intentKey: string,
  creation: Promise<string | null>
): void {
  if (inFlightCreations.get(intentKey)?.promise === creation) inFlightCreations.delete(intentKey)
}

/**
 * Reuse compatibility for an explicit configuration: a persona-pinned task may
 * only land in a thread already pinned to that persona, and an ordinary task
 * must not take over a persona thread. A thread owned by an external harness is
 * never a Kun task landing page.
 */
export function threadMatchesCreationIntent(input: {
  thread: NormalizedThread
  agentId?: string
  harnessId?: string
}): boolean {
  const agentId = input.agentId?.trim() ?? ''
  if (agentId) {
    if (input.thread.agentId !== agentId) return false
  } else if (input.thread.agentId) {
    return false
  }
  const harnessId = input.harnessId?.trim() ?? ''
  const threadHarness = input.thread.harnessId?.trim() ?? ''
  if (harnessId) return threadHarness === harnessId
  return !threadHarness || threadHarness === 'kun'
}

/**
 * A worktree task cannot reuse a main-checkout thread. The only safe reuse is
 * the thread already prepared for this same project and isolation intent, which
 * the worktree registry records under the project path.
 */
export function preparedWorktreeThreadForNewTask(
  state: Pick<ChatState, 'activeThreadId' | 'threads'>,
  workspaceRoot: string
): string | null {
  const id = state.activeThreadId
  if (!id) return null
  const thread = state.threads.find((item) => item.id === id)
  if (!thread || !isThreadAvailableForNewSession(thread)) return null
  const record = readThreadWorktreeRegistry().worktrees[id]
  if (record?.projectPath && normalizeWorkspaceRoot(record.projectPath) === normalizeWorkspaceRoot(workspaceRoot)) {
    return id
  }
  // Before the worktree is attached the thread still points at the project root.
  return threadBelongsToWorkspace(thread, workspaceRoot) ? id : null
}

/** Re-validate after an awaited lookup so a turn started meanwhile is respected. */
export function reuseTargetStillEmpty(
  state: ChatState,
  threadId: string
): boolean {
  const thread = state.threads.find((item) => item.id === threadId) ??
    (state.adeThreads ?? []).find((item) => item.id === threadId)
  if (!thread) return false
  if (!isThreadAvailableForNewSession(thread)) return false
  if (listedThreadEmptiness(thread) === 'used') return false
  if (state.activeThreadId !== threadId) return true
  return activeThreadIsUntouched(state)
}

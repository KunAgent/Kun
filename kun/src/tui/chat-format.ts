import { homedir } from 'node:os'
import { sep } from 'node:path'
import type { AttachmentMetadata } from '../contracts/attachments.js'
import { formatContextGauge, type ActivityVisualKind } from './activity.js'
import type { TuiController, TuiControllerState } from './controller.js'
import { latestTuiGraphRun, summarizeTuiGraphRun } from './graph-mode.js'
import { elapsedDuration, elapsedStartGapMs, humanizeToolName } from './render-utils.js'
import { sanitizeTerminalText } from './safe-text.js'
import { matchingRequestContextSnapshot, type ProjectedTurnActivity } from './state.js'

export { sanitizeTerminalText }

export const TOTAL_ELAPSED_MIN_START_GAP_MS = 100

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / 1024 / 1024).toFixed(1)} MiB`
}

export function safeError(error: unknown): string {
  return sanitizeTerminalText(error instanceof Error ? error.message : String(error)).slice(0, 300)
}

export function redactExactSecret(value: string, secret: string): string {
  return secret ? value.split(secret).join('<redacted>') : value
}

export function imagePasteShortcutLabel(platform = process.platform): string {
  if (platform === 'darwin') return '⌘V / Ctrl+X V'
  if (platform === 'win32') return 'Ctrl+V / Alt+V'
  return 'Ctrl+V / Ctrl+X V'
}

export function currentWorkspace(state: TuiControllerState, controller: TuiController): string {
  return sanitizeTerminalText(state.projection?.thread.workspace ?? controller.options.workspace)
}

export function displayWorkspace(workspace: string, home = homedir()): string {
  const displayed = workspace === home
    ? '~'
    : workspace.startsWith(`${home}${sep}`)
      ? `~${workspace.slice(home.length)}`
      : workspace
  return sanitizeTerminalText(displayed)
}

export function currentModel(state: TuiControllerState, controller: TuiController): string {
  const latestTurn = [...(state.projection?.thread.turns ?? [])].reverse().find((turn) => turn.model || turn.providerId)
  const model = controller.options.model ?? latestTurn?.model ?? state.projection?.thread.model ?? controller.runtime.runtimeInfo.model
  const provider = controller.options.providerId ?? latestTurn?.providerId ?? state.projection?.thread.providerId
  if (!model) return 'not selected · /connect'
  return sanitizeTerminalText(provider ? `${provider} / ${model}` : model)
}

export type ComposerMode = 'agent' | 'plan' | 'graph' | 'goal'

export function currentMode(state: TuiControllerState): ComposerMode {
  const thread = state.projection?.thread
  if (thread?.goal?.status === 'active') return 'goal'
  // The label describes what the next submission will do. A previous turn's
  // mode is history and must not hide a mode change that has not sent yet.
  const mode = thread?.mode ?? state.composerMode
  if (mode === 'plan') return 'plan'
  return state.composerOrchestration === 'graph' ? 'graph' : 'agent'
}

export function activityLabel(activity: ProjectedTurnActivity | undefined): string {
  if (!activity) return 'Kun is working'
  if (activity.label) return activity.label
  switch (activity.phase) {
    case 'starting': return 'Starting'
    case 'thinking': return 'Thinking'
    case 'responding': return 'Responding'
    case 'tool': return activity.toolName ? `Running ${humanizeToolName(activity.toolName)}` : 'Running tool'
    case 'retrying': return 'Retrying model request'
    case 'compacting': return 'Compacting context'
    case 'waiting': return 'Waiting'
  }
}

export type StatusTone = 'muted' | 'focus' | 'success' | 'warning' | 'danger' | 'accent'

export type ActivitySegment = { text: string; tone: StatusTone }

export type ActivityDescription = {
  /** A real pipeline phase is in progress; otherwise the row is a notice. */
  active: boolean
  visualKind: ActivityVisualKind
  /** Phase label, e.g. "Thinking" or "Running Bash". */
  text: string
  /** "· 3.2s" or "· 3.2s · total 41s". */
  elapsed: string
  /** The latest notice: alone when nothing is active, beside the phase otherwise. */
  notice?: { kind: 'info' | 'error' | 'hint'; message: string }
  /** Right-aligned status, joined with " · ". */
  right: ActivitySegment[]
}

/**
 * Data behind the single activity row above the composer. It appears only
 * for real phases (sending, waiting, reasoning, output, tools, subagents,
 * retries, reconnects) or a pending notice, and never fakes a percentage.
 */
export function describeActivity(
  state: TuiControllerState,
  controller: TuiController,
  width: number,
  transientHint?: string,
  nowMs = Date.now()
): ActivityDescription | undefined {
  const projection = state.projection
  const notice = state.notification
  const activity = projection?.activity
  const activeChild = [...(projection?.childRuns ?? [])].reverse().find((run) =>
    run.parentTurnId === projection?.runningTurnId && (run.status === 'queued' || run.status === 'running')
  )
  const reconnecting = state.connection === 'reconnecting'
  const connectionPending = reconnecting ||
    (state.connection === 'connecting' && !projection?.runningTurnId)
  const waitingForApproval = Boolean(projection?.pendingApproval) && !state.busy
  const waitingForInput = Boolean(projection?.pendingUserInput) && !state.busy
  const active = Boolean(state.busy || projection?.runningTurnId || activeChild || connectionPending)
  if (!active && !transientHint && !notice) return undefined

  const text = state.busy
    ? state.busyLabel ?? 'Working'
    : reconnecting && projection?.runningTurnId
      ? 'Reconnecting to live stream'
      : projection?.pendingApproval
        ? `Approval required · ${projection.pendingApproval.toolName}`
        : projection?.pendingUserInput
          ? 'Your input is required'
          : activeChild
            ? `Subagent · ${activeChild.label || activeChild.profile || activeChild.childId}`
            : connectionPending
              ? 'Connecting to runtime'
              : activityLabel(activity)
  const phaseSince = state.busy ? state.busyStartedAt : activeChild?.startedAt ?? activity?.startedAt
  const runningTurn = projection?.thread.turns.find((turn) => turn.id === projection.runningTurnId)
  const turnSince = activity?.turnStartedAt ?? runningTurn?.startedAt ?? runningTurn?.createdAt
  const phaseElapsed = elapsedDuration(phaseSince, undefined, true, nowMs)
  const turnElapsed = projection?.runningTurnId ? elapsedDuration(turnSince, undefined, true, nowMs) : ''
  // Rounded display strings flicker on tenth-second boundaries; compare the
  // stable start-time gap instead and hide a second timer below that grain.
  const showTotal = Boolean(turnElapsed) && width >= 84 &&
    elapsedStartGapMs(turnSince, phaseSince) >= TOTAL_ELAPSED_MIN_START_GAP_MS
  const visualKind: ActivityVisualKind = waitingForApproval || waitingForInput
    ? 'attention'
    : activity?.phase === 'retrying' || connectionPending
      ? 'retrying'
      : activeChild
        ? 'subagent'
        : state.busy || !activity
          ? 'waiting'
          : activity.phase === 'thinking'
            ? 'thinking'
            : activity.phase === 'responding'
              ? 'responding'
              : activity.phase === 'tool'
                ? 'tool'
                : 'waiting'
  const contextSnapshot = matchingRequestContextSnapshot(projection, {
    model: controller.options.model ?? projection?.thread.model,
    providerId: controller.options.providerId ?? projection?.thread.providerId
  })
  const gauge = contextSnapshot
    ? formatContextGauge(contextSnapshot.estimatedInputTokens, contextSnapshot.contextWindowTokens)
    : undefined
  const noticeMessage = notice ? sanitizeTerminalText(notice.message) : ''
  const right: ActivitySegment[] = waitingForApproval
    ? [{ text: 'Action required', tone: 'warning' }]
    : waitingForInput
      ? [{ text: 'Action required', tone: 'accent' }]
      : state.connection === 'connecting'
        ? [{ text: 'Connecting', tone: 'warning' }]
        : state.connection === 'reconnecting'
          ? [{ text: 'Reconnecting', tone: 'warning' }]
          : active && notice
            ? [{ text: `${notice.kind === 'error' ? '!' : '✓'} ${noticeMessage}`, tone: notice.kind === 'error' ? 'danger' : 'success' }]
            : projection?.runningTurnId
              ? [
                  ...(gauge ? [{ text: gauge, tone: 'muted' as const }] : []),
                  ...(width >= 62 ? [{ text: 'Esc stop', tone: 'muted' as const }] : [])
                ]
              : state.busy
                ? [{ text: 'Working', tone: 'focus' }]
                : gauge
                  ? [{ text: gauge, tone: 'muted' }]
                  : state.connection === 'connected'
                    ? [{ text: 'Ready', tone: 'success' }]
                    : [{ text: state.connection, tone: 'warning' }]
  return {
    active,
    visualKind,
    text: sanitizeTerminalText(text),
    elapsed: active ? (showTotal ? `· ${phaseElapsed} · total ${turnElapsed}` : `· ${phaseElapsed}`) : '',
    ...(transientHint
      ? { notice: { kind: 'hint' as const, message: sanitizeTerminalText(transientHint) } }
      : notice ? { notice: { kind: notice.kind, message: noticeMessage } } : {}),
    right
  }
}

export type GraphProgressDescription = {
  title: string
  status: string
  tone: StatusTone
  accepted: number
  total: number
  activeAgents: number
  revision: number
}

export function describeGraphProgress(state: TuiControllerState): GraphProgressDescription | undefined {
  const threadId = state.projection?.thread.id
  if (!threadId) return undefined
  const run = latestTuiGraphRun(state.graphRuns, threadId)
  if (!run) return undefined
  const progress = summarizeTuiGraphRun(run)
  const tone: StatusTone = progress.status === 'completed'
    ? 'success'
    : progress.status === 'failed' || progress.status === 'cancelled'
      ? 'danger'
      : 'warning'
  return {
    title: sanitizeTerminalText(progress.title),
    status: progress.status,
    tone,
    accepted: progress.accepted,
    total: progress.total,
    activeAgents: progress.activeAgents,
    revision: progress.revision
  }
}

export type AttachmentDescription = { kind: 'Image' | 'File' | 'Attachment'; details: string }

export function describeAttachment(attachment: AttachmentMetadata | undefined): AttachmentDescription {
  if (!attachment) return { kind: 'Attachment', details: 'attached' }
  const dimensions = attachment.width && attachment.height
    ? `${attachment.width}×${attachment.height}`
    : undefined
  return {
    kind: attachment.kind === 'image' ? 'Image' : 'File',
    details: [
      sanitizeTerminalText(attachment.name),
      attachment.mimeType,
      formatBytes(attachment.byteSize),
      dimensions
    ].filter(Boolean).join(' · ')
  }
}

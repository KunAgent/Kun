import {
  Editor,
  Input,
  Markdown,
  ProcessTerminal,
  TUI,
  decodeKittyPrintable,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type EditorTheme,
  type Focusable,
  type MarkdownTheme,
  type OverlayHandle,
  type SelectListTheme,
  type SlashCommand
} from '@earendil-works/pi-tui'
import {
  providerCatalogEntries,
  type ProviderCatalogAuthFlow,
  type ProviderCatalogAuthType,
  type ProviderCatalogKind
} from '@kun/provider-catalog'
import { spawn } from 'node:child_process'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, sep } from 'node:path'
import { stdin as processStdin, stdout as processStdout } from 'node:process'
import { redactSecrets, redactSecretText } from '../config/secret-redaction.js'
import { withRuntimeDataDirAncillaryWriter } from '../server/runtime-data-dir-lease.js'
import type { AttachmentMetadata } from '../contracts/attachments.js'
import type { TurnItem } from '../contracts/items.js'
import type { ModelReasoningEffort } from '../contracts/capabilities.js'
import {
  KUN_TOOL_PERMISSION_MODES,
  kunToolPermissionModeFromSettings,
  kunToolPermissionModeSettings,
  type ApprovalPolicy,
  type ApprovalReviewer,
  type KunToolPermissionMode,
  type SandboxMode
} from '../contracts/policy.js'
import {
  isModelConnectionProfileUsable,
  type ClaudeSdkInstallStatus,
  type ModelConnectionOAuthStatus,
  type ModelConnectionProfile,
  type ModelConnectionSnapshot
} from '../contracts/model-connections.js'
import type { TuiCommand, TuiCommandDefinition } from './commands.js'
import { parseTuiCommand, TUI_COMMAND_DEFINITIONS, TUI_SLASH_COMMANDS } from './commands.js'
import { runSelfUpdateCommand } from '../cli/self-update.js'
import {
  activityFrame,
  formatContextGauge,
  formatTokenCount,
  type ActivityVisualKind
} from './activity.js'
import { parseTuiKeymapConfig, type TuiKeyAction, type TuiKeymap } from './keymap.js'
import { TuiClientError, type KunTuiClient, type SkillsSnapshot } from './client.js'
import type { TuiControllerState } from './controller.js'
import { TuiController } from './controller.js'
import {
  sanitizeTerminalText as stripTerminalControls,
  wrapText
} from './layout.js'
import { codeFenceLanguage, highlightTerminalCode, terminalAssistantMarkdown } from './markdown-code.js'
import {
  contextualFooter,
  pageFrame,
  sectionLabel,
  selectionRow,
  statusGlyph,
  visual,
  visualDensity
} from './visual-system.js'
import { InlineStreamTerminal, ScrollbackPreservingTerminal } from './pi-terminal.js'
import { ProviderQuotaDialog } from './provider-quota.js'
import { UsageDialog } from './usage-report.js'
import {
  installAntigravityCli,
  resolveAntigravityCliCommand,
  resolveGeminiCliCommand,
  type OfficialProviderCliId
} from '../services/official-provider-cli.js'
import {
  copyWithSystemClipboard,
  editTextInExternalEditor,
  lastAssistantText,
  osc52ClipboardSequence,
  renderThreadMarkdown,
  runInteractiveProviderCli,
  writeThreadExport
} from './operations.js'
import {
  applyRuntimeEvent,
  hydrateProjectedChildRuns,
  matchingRequestContextSnapshot,
  projectThreadSnapshot,
  type ProjectedApprovalReview,
  type ProjectedChildRun,
  type ProjectedTurnActivity,
  type ThreadProjection
} from './state.js'
import type { TerminalInput, TerminalOutput } from './pi-terminal.js'
import {
  latestTuiGraphRun,
  moveTuiGraphBoardSelection,
  projectTuiGraphBoard,
  type TuiGraphBoardNode,
  type TuiGraphBoardProjection,
  summarizeTuiGraphRun
} from './graph-mode.js'
import {
  answerCurrentUserInputWithText,
  confirmCurrentUserInput,
  createUserInputSession,
  currentUserInputQuestion,
  isUserInputSessionComplete,
  moveUserInputOption,
  orderedUserInputAnswers,
  selectedUserInputLabels,
  toggleCurrentUserInputOption,
  type UserInputSession
} from './user-input.js'
import {
  ClipboardImageError,
  clipboardImageEmptyHint,
  readClipboardImage,
  type ClipboardImage
} from './clipboard-image.js'
import { WorkspaceFileAutocompleteProvider } from './file-mentions.js'
import { bold, dim, blue, cyan, green, yellow, red, magenta, italic, isCancelInput, EXIT_CONFIRM_WINDOW_MS, UNDO_ESCAPE_WINDOW_MS, TOTAL_ELAPSED_MIN_START_GAP_MS, BRACKETED_PASTE_START, BRACKETED_PASTE_END, ENABLE_MOUSE_TRACKING, DISABLE_MOUSE_TRACKING, DIRECT_SEMANTIC_ACTIONS, sanitizeTerminalText, selectTheme, editorTheme, markdownTheme, parseSgrMouseEvent, writeLocalShareSnapshot, removeLocalShareSnapshot, type SgrMouseEvent, type ExclusiveRouteHandle } from './pi-common.js'
import { elapsedDuration, elapsedStartGapMs, formatDurationMs, formatGoalDuration, humanizeToolName } from './render-utils.js'

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / 1024 / 1024).toFixed(1)} MiB`
}

export function renderUserAttachment(
  attachment: AttachmentMetadata | undefined,
  width: number
): string {
  if (!attachment) {
    return truncateToWidth(`   └ ${cyan('Attachment')} ${dim('· attached')}`, width)
  }
  const kind = attachment.kind === 'image' ? 'Image' : 'File'
  const dimensions = attachment.width && attachment.height
    ? `${attachment.width}×${attachment.height}`
    : undefined
  const details = [
    sanitizeTerminalText(attachment.name),
    attachment.mimeType,
    formatBytes(attachment.byteSize),
    dimensions
  ].filter(Boolean).join(' · ')
  return truncateToWidth(`   └ ${cyan(kind)}  ${dim(details)}`, width)
}

export function safeError(error: unknown): string {
  return sanitizeTerminalText(error instanceof Error ? error.message : String(error)).slice(0, 300)
}

export function redactExactSecret(value: string, secret: string): string {
  return secret ? value.split(secret).join('<redacted>') : value
}

export function renderContextBar(state: TuiControllerState, controller: TuiController, width: number): string {
  const workspace = currentWorkspace(state, controller)
  const workspaceLabel = width >= 68
    ? displayWorkspace(workspace)
    : basename(workspace) || workspace
  const connection = state.connection === 'connected'
    ? ''
    : state.connection === 'disconnected'
      ? red('disconnected')
      : yellow(state.connection)
  return joinSides(
    ` ${cyan(bold('KUN'))}  ${dim(sanitizeTerminalText(workspaceLabel))}`,
    connection,
    width
  )
}

export function renderConversationContext(
  state: TuiControllerState,
  controller: TuiController,
  width: number
): string {
  const thread = state.projection?.thread
  if (!thread) return ''
  const left = ` ${cyan(bold('KUN'))}${dim(' / ')}${bold(sanitizeTerminalText(thread.title || 'Untitled'))}`
  const right = state.connection === 'connected'
    ? ''
    : state.connection === 'disconnected'
      ? red('disconnected')
      : yellow(state.connection)
  return joinSides(left, right, width)
}

export function renderKunWelcome(
  state: TuiControllerState,
  controller: TuiController,
  width: number,
  height: number
): string[] {
  const contentWidth = Math.max(20, Math.min(width - (width >= 36 ? 4 : 0), 76))
  const compactHeight = height < 24
  const threadCount = state.threads.length
  const version = sanitizeTerminalText(controller.runtime.runtimeInfo.serviceVersion)
  const workspace = displayWorkspace(currentWorkspace(state, controller))
  const effort = state.reasoningEffort ?? 'default'
  const metadata = width < 60
    ? [
        `${dim('Workspace')}  ${sanitizeTerminalText(workspace)}`,
        `${dim('Model')}      ${sanitizeTerminalText(currentModel(state, controller))}`,
        `${dim('Mode')}       ${currentMode(state)} · ${effort}`
      ]
    : [
        joinSides(`${dim('Workspace')}  ${sanitizeTerminalText(workspace)}`, `${dim('Model')}  ${sanitizeTerminalText(currentModel(state, controller))}`, contentWidth),
        joinSides(`${dim('Mode')}       ${currentMode(state)} · ${effort}`, `${dim('Version')}  ${version}`, contentWidth)
      ]
  const body = [
    renderContextBar(state, controller, contentWidth),
    ...(compactHeight ? [] : ['']),
    ` ${cyan(bold('Welcome to Kun'))}`,
    ...(compactHeight ? [] : [` ${dim('A focused terminal agent that keeps working with you.')}`]),
    '',
    ...metadata,
    '',
    ` ${cyan('›')} ${bold('Type a task')} ${dim('and press Enter')}`,
    ` ${cyan('›')} ${bold('/graph <requirement>')} ${dim('start or steer a Graph run')}`,
    ` ${cyan('›')} ${bold('/connect')} ${dim('add or manage a provider')}`,
    ` ${cyan('›')} ${bold('/sessions')} ${dim(threadCount ? `resume previous work · ${threadCount} saved` : 'resume previous work')}`,
    ` ${cyan('›')} ${bold(imagePasteShortcutLabel())} ${dim('paste a screenshot · /paste also works')}`
  ]
  const padding = ' '.repeat(Math.max(0, Math.floor((width - contentWidth) / 2)))
  return body.map((line) => `${padding}${truncateToWidth(line, contentWidth)}`)
}

export function renderActivityRow(
  state: TuiControllerState,
  controller: TuiController,
  width: number,
  animationFrame = 0,
  transientHint?: string
): string {
  const notice = state.notification
  const activity = state.projection?.activity
  const projection = state.projection
  const activeChild = [...(projection?.childRuns ?? [])].reverse().find((run) =>
    run.parentTurnId === projection?.runningTurnId && (run.status === 'queued' || run.status === 'running')
  )
  const reconnecting = state.connection === 'reconnecting'
  const connectionPending = reconnecting ||
    state.connection === 'connecting' && !projection?.runningTurnId
  const waitingForApproval = Boolean(projection?.pendingApproval) && !state.busy
  const waitingForInput = Boolean(projection?.pendingUserInput) && !state.busy
  const active = Boolean(
    state.busy || projection?.runningTurnId || activeChild ||
    connectionPending
  )
  if (!active && !transientHint && !notice) return ''
  const activityText = state.busy
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
  const activitySince = state.busy
    ? state.busyStartedAt
    : activeChild?.startedAt ?? activity?.startedAt
  const runningTurn = projection?.thread.turns.find((turn) => turn.id === projection.runningTurnId)
  const turnSince = activity?.turnStartedAt ?? runningTurn?.startedAt ?? runningTurn?.createdAt
  const nowMs = Date.now()
  const phaseElapsed = elapsedDuration(activitySince, undefined, true, nowMs)
  const turnElapsed = projection?.runningTurnId
    ? elapsedDuration(turnSince, undefined, true, nowMs)
    : ''
  // The first pipeline phase normally starts only a few milliseconds after
  // the turn. Comparing rounded display strings made `total` alternate on
  // each tenth-second boundary. Base visibility on the stable start-time gap
  // instead, and omit a second timer when the difference is below the finest
  // precision we display.
  const showTotalElapsed = turnElapsed && width >= 84 &&
    elapsedStartGapMs(turnSince, activitySince) >= TOTAL_ELAPSED_MIN_START_GAP_MS
  const elapsedText = showTotalElapsed
    ? `· ${phaseElapsed} · total ${turnElapsed}`
    : `· ${phaseElapsed}`
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
  const rawGlyph = activityFrame(visualKind, animationFrame)
  const activeGlyph = visualKind === 'attention' || visualKind === 'retrying'
    ? yellow(` ${rawGlyph}`)
    : cyan(` ${rawGlyph}`)
  const left = active
    ? `${activeGlyph} ${bold(sanitizeTerminalText(activityText))} ${dim(elapsedText)}`
    : transientHint
      ? yellow(` ! ${sanitizeTerminalText(transientHint)}`)
    : notice
      ? (notice.kind === 'error' ? red(` ! ${notice.message}`) : green(` ✓ ${notice.message}`))
      : `${dim(' Enter send · Ctrl+J newline')}`
  const contextSnapshot = matchingRequestContextSnapshot(projection, {
    model: controller.options.model ?? projection?.thread.model,
    providerId: controller.options.providerId ?? projection?.thread.providerId
  })
  const usageText = contextSnapshot
    ? formatContextGauge(
        contextSnapshot.estimatedInputTokens,
        contextSnapshot.contextWindowTokens
      )
    : undefined
  const status = waitingForApproval
    ? yellow('Action required')
    : waitingForInput
      ? magenta('Action required')
      : state.connection === 'connecting'
        ? yellow('Connecting')
        : state.connection === 'reconnecting'
          ? yellow('Reconnecting')
          : active && notice
          ? (notice.kind === 'error'
              ? red(`! ${sanitizeTerminalText(notice.message)}`)
              : green(`✓ ${sanitizeTerminalText(notice.message)}`))
        : projection?.runningTurnId
          ? [
              ...(usageText ? [dim(usageText)] : []),
              ...(width >= 62 ? [dim('Esc stop')] : [])
            ].join(dim(' · '))
          : state.busy
            ? cyan('Working')
            : usageText
              ? dim(usageText)
              : state.connection === 'connected'
                ? green('Ready')
                : yellow(state.connection)
  return joinSides(left, ` ${status}`, width)
}

export function renderGraphProgressRow(
  state: TuiControllerState,
  width: number
): string {
  const threadId = state.projection?.thread.id
  if (!threadId) return ''
  const run = latestTuiGraphRun(state.graphRuns, threadId)
  if (!run) return ''
  const progress = summarizeTuiGraphRun(run)
  const status = progress.status === 'completed'
    ? green(progress.status)
    : progress.status === 'failed' || progress.status === 'cancelled'
      ? red(progress.status)
      : yellow(progress.status)
  const left = width < 64
    ? ` ${magenta(bold('GRAPH'))}  ${status}`
    : ` ${magenta(bold('GRAPH'))}  ${sanitizeTerminalText(progress.title)}`
  const right = (width < 64
    ? ['/graph status']
    : [
        '/graph status',
        `${progress.accepted}/${progress.total} accepted`,
        `${progress.activeAgents} agents`,
        ...(width >= 96 ? [`r${progress.revision}`] : []),
        status
      ]).join(dim(' · '))
  return joinSides(left, right, width)
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

export function renderKunComposerFrame(
  editorLines: string[],
  state: TuiControllerState,
  controller: TuiController,
  width: number,
  keymap?: TuiKeymap
): string[] {
  const safeWidth = Math.max(20, width)
  const borderIndex = editorLines.findIndex((line, index) =>
    index > 0 && /^─+(?:\s+[↑↓].*)?$/u.test(stripTerminalControls(line))
  )
  const split = borderIndex >= 0 ? borderIndex : Math.max(1, editorLines.length)
  const content = editorLines.slice(1, split)
  const autocomplete = editorLines.slice(Math.min(editorLines.length, split + 1))
  const topLabel = editorRuleLabel(editorLines[0])
  const dividerLabel = borderIndex >= 0 ? editorRuleLabel(editorLines[borderIndex]) : ''
  const lines = [
    composerRule('┌', '┐', safeWidth, topLabel),
    ...renderPendingAttachmentChips(state.pendingAttachments, safeWidth),
    ...content.map((line, index) => composerContent(line, safeWidth, index === 0 ? ` ${yellow('›')} ` : '   ')),
    composerRule('├', '┤', safeWidth, dividerLabel),
    ...autocomplete.map((line) => composerContent(line, safeWidth, '   '))
  ]
  if (autocomplete.length) lines.push(composerRule('├', '┤', safeWidth))
  lines.push(
    composerContent(renderComposerMetadata(state, controller, safeWidth - 4, keymap), safeWidth, ' '),
    composerRule('└', '┘', safeWidth)
  )
  return lines
}

export function renderPendingAttachmentChips(
  attachments: readonly AttachmentMetadata[],
  width: number
): string[] {
  return attachments.map((attachment, index) => {
    const kind = attachment.kind === 'image' ? 'Image' : 'File'
    const left = [
      cyan(`Attachment ${index + 1}/${attachments.length}`),
      cyan(`[${kind}]`),
      sanitizeTerminalText(attachment.name),
      dim(`· ${formatBytes(attachment.byteSize)}`)
    ].join(' ')
    const last = index === attachments.length - 1
    const right = last
      ? dim(width >= 72 ? 'Backspace/Del remove' : 'Del remove')
      : ''
    return composerContent(joinSides(left, right, Math.max(8, width - 4)), width, ' ')
  })
}

export function editorRuleLabel(line: string | undefined): string {
  if (!line) return ''
  return stripTerminalControls(line).replaceAll('─', '').trim()
}

export function composerRule(left: string, right: string, width: number, label = ''): string {
  if (!label) return cyan(`${left}${'─'.repeat(Math.max(0, width - 2))}${right}`)
  const safeLabel = truncateToWidth(sanitizeTerminalText(label), Math.max(1, width - 6))
  const prefix = `─ ${safeLabel} `
  return cyan(`${left}${prefix}${'─'.repeat(Math.max(0, width - visibleWidth(prefix) - 2))}${right}`)
}

export function composerContent(line: string, width: number, prefix: string): string {
  const inner = width - 2
  const value = truncateToWidth(`${prefix}${line}`, inner)
  return `${cyan('│')}${value}${' '.repeat(Math.max(0, inner - visibleWidth(value)))}${cyan('│')}`
}

export function renderComposerMetadata(
  state: TuiControllerState,
  controller: TuiController,
  width: number,
  _keymap?: TuiKeymap
): string {
  const mode = currentMode(state)
  const metadata = [
    dim(currentModel(state, controller)),
    dim('·'),
    cyan(state.reasoningEffort ?? 'default'),
    dim('·'),
    mode === 'goal'
      ? green(bold(mode))
      : mode === 'plan'
        ? yellow(bold(mode))
        : mode === 'graph'
          ? magenta(bold(mode))
        : dim(mode)
  ].join(' ')
  return truncateToWidth(` ${metadata}`, width)
}

export function renderShortcutFooter(
  state: TuiControllerState,
  keymap: TuiKeymap,
  width: number,
  leaderHint?: Array<{ action: TuiKeyAction; key: string }>,
  pointerMode = false
): string {
  if (leaderHint) {
    const labels: Partial<Record<TuiKeyAction, string>> = {
      session_new: 'new', session_list: 'sessions', session_timeline: 'timeline',
      session_compact: 'compact', session_export: 'export', session_status: 'status',
      messages_copy: 'copy', model_list: 'models', agent_list: 'mode',
      pointer_mode_toggle: 'pointer', session_undo: 'undo', session_redo: 'redo', app_exit: 'quit'
    }
    const text = leaderHint
      .filter((entry) => labels[entry.action])
      .slice(0, width >= 94 ? 11 : width >= 54 ? 6 : 3)
      .map((entry) => `${cyan(bold(entry.key))} ${dim(labels[entry.action]!)}`)
      .join(dim('  ·  '))
    return ` ${yellow(bold('Leader'))}  ${text}`
  }
  if (pointerMode) {
    const running = Boolean(state.projection?.runningTurnId)
    const clickableSubagent = Boolean(state.projection?.childRuns.length)
    const actions = [
      `${cyan(bold(running ? 'Esc' : 'Enter'))} ${dim(running ? 'stop' : 'send')}`,
      ...(running && width >= 54 ? [`${cyan(bold(keymap.display('input_steer')))} ${dim('steer')}`] : []),
      ...(clickableSubagent && width >= 72 ? [`${cyan(bold('Click'))} ${dim('open subagent')}`] : []),
      ...(width >= 88 ? [`${cyan(bold(imagePasteShortcutLabel()))} ${dim('image')}`] : []),
      `${cyan(bold(keymap.display('command_list')))} ${dim('commands')}`
    ]
    return truncateToWidth(` ${actions.join(dim('  ·  '))}`, width)
  }
  return truncateToWidth(
    ` ${cyan(bold('History'))} ${dim(`wheel · drag copy · ${keymap.display('command_list')} commands · ${keymap.display('pointer_mode_toggle')} clicks`)}`,
    width
  )
}

export function renderKunWordmark(width: number, version: string): string[] {
  return [truncateToWidth(
    ` ${blue(bold('KUN'))}  ${dim(`terminal agent · v${version}`)}`,
    Math.max(1, width)
  )]
}

export function imagePasteShortcutLabel(platform = process.platform): string {
  if (platform === 'darwin') return '⌘V / Ctrl+X V'
  if (platform === 'win32') return 'Ctrl+V / Alt+V'
  return 'Ctrl+V / Ctrl+X V'
}

export function currentWorkspace(state: TuiControllerState, controller: TuiController): string {
  return sanitizeTerminalText(state.projection?.thread.workspace ?? controller.options.workspace)
}

export function displayWorkspace(workspace: string): string {
  const home = homedir()
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

export function currentMode(state: TuiControllerState): 'agent' | 'plan' | 'graph' | 'goal' {
  const thread = state.projection?.thread
  if (thread?.goal?.status === 'active') return 'goal'
  // This label describes what the next submission will do. A previous turn's
  // mode is history and must not hide a mode change that has not sent yet.
  const mode = thread?.mode ?? state.composerMode
  if (mode === 'plan') return 'plan'
  return state.composerOrchestration === 'graph' ? 'graph' : 'agent'
}

export function joinSides(left: string, right: string, width: number): string {
  if (!right) return truncateToWidth(left, width)
  const rightLimit = Math.max(8, Math.floor(width * 0.55))
  const clippedRight = truncateToWidth(right, rightLimit)
  const leftLimit = Math.max(1, width - visibleWidth(clippedRight) - 1)
  const clippedLeft = truncateToWidth(left, leftLimit)
  const gap = ' '.repeat(Math.max(1, width - visibleWidth(clippedLeft) - visibleWidth(clippedRight)))
  return `${clippedLeft}${gap}${clippedRight}`
}

// Outlined containers are reserved for the explicitly requested centered
// detail popups: child transcripts and the Graph board. Full-page routes use
// pageFrame instead.

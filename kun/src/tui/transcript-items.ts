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
import type { ExplorationEntry, ExplorationStage, ExplorationTimelineEntry, ReasoningItem } from './transcript-exploration.js'
import { EXPLORE_GROUP_COMPACT_LIMIT, explorationEntryFailed, explorationStageDuration, explorationToolAction, renderExplorationDetail } from './transcript-exploration.js'
import { childIdFromToolResult, conciseToolResultSummary, elapsedDuration, humanizeToolName, itemDuration, oneLine, outputText, plainLines, resolveReasoningEndAt, sourcePageSuffix, summarize, toolAction, toolResultSummary, toolTreeSection } from './render-utils.js'
import { renderUserAttachment } from './render-layout.js'
import { friendlyRuntimeError, isModelConnectionError } from './render-utils.js'

export class ApprovalReviewComponent implements Component {
  constructor(private review: ProjectedApprovalReview) {}

  update(review: ProjectedApprovalReview): void {
    this.review = review
  }

  invalidate(): void {}

  render(width: number, animationFrame = 0): string[] {
    const contentWidth = Math.max(8, width - 2)
    const inProgress = this.review.status === 'in-progress'
    const icon = inProgress
      ? cyan(activityFrame('waiting', animationFrame))
      : this.review.status === 'approved'
        ? green('✓')
        : this.review.status === 'aborted'
          ? yellow('■')
          : red('✗')
    const title = inProgress
      ? `Reviewing ${this.review.toolName}`
      : `Agent review ${this.review.status}`
    const metadata = [
      ...(this.review.riskLevel ? [`risk ${this.review.riskLevel}`] : []),
      ...(this.review.decision ? [this.review.decision] : [])
    ].join(' · ')
    const lines = [
      truncateToWidth(
        ` ${icon} ${bold(sanitizeTerminalText(title))}${metadata ? ` ${dim(`· ${metadata}`)}` : ''}`,
        contentWidth
      )
    ]
    const detail = this.review.rationale || (inProgress ? this.review.summary : '')
    if (detail) {
      lines.push(...plainLines(detail, Math.max(8, contentWidth - 4), 0)
        .map((line) => truncateToWidth(`   ${dim(line)}`, contentWidth)))
    }
    return lines
  }
}

export class ExplorationGroupComponent implements Component {
  constructor(
    private stage: ExplorationStage,
    private showToolDetails: boolean,
    private showReasoning: boolean
  ) {}

  update(stage: ExplorationStage, showToolDetails: boolean, showReasoning: boolean): void {
    this.stage = stage
    this.showToolDetails = showToolDetails
    this.showReasoning = showReasoning
  }

  invalidate(): void {}

  render(width: number, animationFrame = 0): string[] {
    const contentWidth = Math.max(8, width - 2)
    const visibleTimeline: ExplorationTimelineEntry[] = []
    let visibleActions = 0
    for (const entry of this.stage.timeline) {
      if (entry.kind === 'reasoning') {
        if (this.showReasoning && (this.showToolDetails || visibleActions <= EXPLORE_GROUP_COMPACT_LIMIT)) {
          visibleTimeline.push(entry)
        }
        continue
      }
      if (this.showToolDetails || visibleActions < EXPLORE_GROUP_COMPACT_LIMIT) {
        visibleTimeline.push(entry)
      }
      visibleActions += 1
    }
    const renderedActionCount = Math.min(visibleActions, EXPLORE_GROUP_COMPACT_LIMIT)
    const omitted = this.showToolDetails ? 0 : this.stage.entries.length - renderedActionCount
    const failedCount = this.stage.entries.filter(explorationEntryFailed).length
    const icon = this.stage.active
      ? cyan(activityFrame('tool', animationFrame))
      : failedCount > 0
        ? red('✗')
        : dim('●')
    const title = this.stage.active ? 'Exploring' : 'Explored'
    const duration = explorationStageDuration(this.stage)
    const metadata = [
      `${this.stage.entries.length} ${this.stage.entries.length === 1 ? 'action' : 'actions'}`,
      ...(failedCount > 0 ? [`${failedCount} failed`] : []),
      ...(duration ? [duration] : [])
    ].join(' · ')
    const lines = [
      truncateToWidth(` ${icon} ${bold(title)}${metadata ? ` ${dim(`· ${metadata}`)}` : ''}`, contentWidth)
    ]

    visibleTimeline.forEach((timelineEntry, index) => {
      const last = index === visibleTimeline.length - 1 && omitted === 0
      if (timelineEntry.kind === 'reasoning') {
        const sourceIndex = this.stage.timeline.indexOf(timelineEntry)
        const nextEntry = this.stage.timeline[sourceIndex + 1]
        const endedAt = timelineEntry.item.finishedAt ??
          (nextEntry?.kind === 'reasoning'
            ? nextEntry.item.createdAt
            : nextEntry?.entry.call.createdAt)
        lines.push(...this.renderReasoningEntry(
          timelineEntry.item,
          last,
          contentWidth,
          animationFrame,
          endedAt
        ))
      } else {
        lines.push(...this.renderEntry(timelineEntry.entry, last, contentWidth, animationFrame))
      }
    })
    if (omitted > 0) {
      lines.push(truncateToWidth(`   └ ${dim(`… +${omitted} more`)}`, contentWidth))
    }
    return lines
  }

  private renderReasoningEntry(
    item: ReasoningItem,
    last: boolean,
    width: number,
    animationFrame: number,
    endedAt?: string
  ): string[] {
    const branch = last ? '└' : '├'
    const continuation = last ? ' ' : '│'
    const lastTimelineEntry = this.stage.timeline.at(-1)
    const running = this.stage.active &&
      item.status === 'running' &&
      lastTimelineEntry?.kind === 'reasoning' &&
      lastTimelineEntry.item.id === item.id
    const duration = itemDuration(item, running, endedAt)
    const title = running
      ? `${cyan(activityFrame('thinking', animationFrame))} ${dim(italic('Thinking…'))}`
      : dim(italic('Thinking'))
    return [
      truncateToWidth(
        `   ${branch} ${title}${duration ? ` ${dim(`· ${duration}`)}` : ''}`,
        width
      ),
      ...plainLines(item.text, Math.max(8, width - 8), 0)
        .map((line) => truncateToWidth(`   ${continuation}  ${dim(italic(line))}`, width))
    ]
  }

  private renderEntry(
    entry: ExplorationEntry,
    last: boolean,
    width: number,
    animationFrame: number
  ): string[] {
    const failed = explorationEntryFailed(entry)
    const running = this.stage.active &&
      !entry.result &&
      entry.call.status !== 'failed' &&
      entry.call.status !== 'aborted'
    const branch = last ? '└' : '├'
    const continuation = last ? ' ' : '│'
    const status = failed
      ? `${red('✗')} `
      : running
        ? `${cyan(activityFrame('tool', animationFrame))} `
        : ''
    const baseAction = explorationToolAction(entry.call) ?? toolAction(entry.call)
    const action = { ...baseAction, subject: `${baseAction.subject}${sourcePageSuffix(entry.result?.output)}` }
    const duration = elapsedDuration(
      entry.call.createdAt,
      entry.result?.finishedAt ?? entry.call.finishedAt,
      running
    )
    const summary = truncateToWidth(
      `   ${branch} ${status}${cyan(bold(action.verb))}${action.subject ? ` ${sanitizeTerminalText(action.subject)}` : ''}${duration ? ` ${dim(`· ${duration}`)}` : ''}`,
      width
    )
    if (!this.showToolDetails) return [summary]

    const details = [
      ...renderExplorationDetail(
        'input',
        outputText(entry.call.arguments),
        width,
        20,
        continuation,
        dim
      ),
      ...(entry.result
        ? renderExplorationDetail(
            'output',
            outputText(entry.result.output),
            width,
            40,
            continuation,
            entry.result.isError ? red : dim
          )
        : [])
    ]
    return [summary, ...details]
  }
}

export class ItemComponent implements Component {
  readonly kind: TurnItem['kind']
  private item: TurnItem
  private markdown?: Markdown
  private showReasoning: boolean
  private showToolDetails: boolean
  private toolResult?: Extract<TurnItem, { kind: 'tool_result' }>
  private turnRunning: boolean
  private legacyGui: boolean
  private reasoningRunning: boolean
  private reasoningEndedAt?: string
  private attachmentMetadata: Readonly<Record<string, AttachmentMetadata>>
  private userAttachmentIds: readonly string[]

  constructor(
    item: TurnItem,
    showReasoning: boolean,
    showToolDetails: boolean,
    toolResult?: Extract<TurnItem, { kind: 'tool_result' }>,
    turnRunning = false,
    legacyGui = false,
    reasoningRunning = false,
    reasoningEndedAt?: string,
    attachmentMetadata: Readonly<Record<string, AttachmentMetadata>> = {},
    userAttachmentIds: readonly string[] = []
  ) {
    this.kind = item.kind
    this.item = item
    this.showReasoning = showReasoning
    this.showToolDetails = showToolDetails
    this.toolResult = toolResult
    this.turnRunning = turnRunning
    this.legacyGui = legacyGui
    this.reasoningRunning = reasoningRunning
    this.reasoningEndedAt = reasoningEndedAt
    this.attachmentMetadata = attachmentMetadata
    this.userAttachmentIds = userAttachmentIds
    if (item.kind === 'assistant_text') {
      this.markdown = new Markdown(
        terminalAssistantMarkdown(
          sanitizeTerminalText(item.text),
          turnRunning && item.status === 'running'
        ),
        2,
        0,
        markdownTheme
      )
    }
  }

  update(
    item: TurnItem,
    showReasoning: boolean,
    showToolDetails: boolean,
    toolResult?: Extract<TurnItem, { kind: 'tool_result' }>,
    turnRunning = false,
    legacyGui = false,
    reasoningRunning = false,
    reasoningEndedAt?: string,
    attachmentMetadata: Readonly<Record<string, AttachmentMetadata>> = {},
    userAttachmentIds: readonly string[] = []
  ): void {
    this.item = item
    this.showReasoning = showReasoning
    this.showToolDetails = showToolDetails
    this.toolResult = toolResult
    this.turnRunning = turnRunning
    this.legacyGui = legacyGui
    this.reasoningRunning = reasoningRunning
    this.reasoningEndedAt = reasoningEndedAt
    this.attachmentMetadata = attachmentMetadata
    this.userAttachmentIds = userAttachmentIds
    if (item.kind === 'assistant_text') {
      this.markdown?.setText(terminalAssistantMarkdown(
        sanitizeTerminalText(item.text),
        turnRunning && item.status === 'running'
      ))
    }
  }

  setReasoningExpanded(expanded: boolean): void {
    if (this.kind === 'assistant_reasoning') this.showReasoning = expanded
  }

  render(width: number, animationFrame = 0): string[] {
    const item = this.item
    const contentWidth = Math.max(8, width - 2)
    switch (item.kind) {
      case 'goal_context':
      case 'model_context':
      case 'runtime_context_source':
      case 'interruption_note':
        return []
      case 'user_message': {
        const body = plainLines(item.displayText ?? item.text, Math.max(8, contentWidth - 2), 0)
        const attachments = this.userAttachmentIds.map((attachmentId) =>
          renderUserAttachment(this.attachmentMetadata[attachmentId], contentWidth)
        )
        return [
          `${yellow(bold(' › You'))}${body[0] ? `  ${yellow(body[0])}` : ''}`,
          ...body.slice(1).map((line) => yellow(`   ${line}`)),
          ...attachments
        ]
      }
      case 'assistant_text': {
        const body = this.markdown
          ?.render(Math.max(1, contentWidth - 3))
          .map((line) => `   ${line}`) ?? []
        return body
      }
      case 'assistant_reasoning': {
        return renderKunThinking(item, contentWidth, {
          expanded: this.showReasoning,
          running: this.reasoningRunning,
          endedAt: this.reasoningEndedAt,
          animationFrame
        })
      }
      case 'tool_call': {
        const result = this.toolResult
        const running = !result && this.turnRunning && item.status !== 'failed' && item.status !== 'aborted'
        const failed = result?.isError || item.status === 'failed' || item.status === 'aborted'
        const icon = failed
          ? red('✗')
          : running
            ? cyan(activityFrame('tool', animationFrame))
            : green('●')
        const baseAction = toolAction(item)
        const action = { ...baseAction, subject: `${baseAction.subject}${sourcePageSuffix(result?.output)}` }
        const duration = elapsedDuration(item.createdAt, result?.finishedAt ?? item.finishedAt, running)
        const compactResult = result ? conciseToolResultSummary(result.output) : undefined
        const details = this.showToolDetails
          ? [
              ...toolTreeSection('input', outputText(item.arguments), contentWidth, 20, !result, dim),
              ...(result
                ? toolTreeSection('output', outputText(result.output), contentWidth, 40, true, result.isError ? red : dim)
                : [])
            ]
          : result?.isError
            ? toolTreeSection('', toolResultSummary(result.output), contentWidth, 4, true, red)
            : compactResult
              ? toolTreeSection('', compactResult, contentWidth, 1, true, dim)
              : []
        return [
          truncateToWidth(
            ` ${icon} ${bold(action.verb)}${action.subject ? ` ${dim(`· ${sanitizeTerminalText(action.subject)}`)}` : ''}${duration ? ` ${dim(`· ${duration}`)}` : ''}`,
            contentWidth
          ),
          ...details
        ]
      }
      case 'tool_result': {
        const output = outputText(item.output)
        return [
          ` ${item.isError ? red('✗') : green('●')} ${bold(humanizeToolName(item.toolName))}`,
          ...toolTreeSection(
            '',
            output,
            contentWidth,
            this.showToolDetails ? 50 : item.isError ? 5 : 2,
            true,
            item.isError ? red : dim
          )
        ]
      }
      case 'approval': return [` ${yellow('!')} Approval ${item.status}: ${sanitizeTerminalText(item.summary)}`]
      case 'user_input': return [` ${magenta('?')} Input ${item.status}: ${sanitizeTerminalText(item.prompt)}`]
      case 'compaction': return [` ${magenta('↺')} Compacted ${item.replacedTokens.toLocaleString()} tokens`]
      case 'context_window': return [` ${magenta('⇢')} Switched context window (${item.reason})`]
      case 'review': return [magenta(' Review'), ...plainLines(item.reviewText ?? item.title, contentWidth, 2)]
      case 'error': {
        const warning = item.severity === 'warning' || item.status === 'aborted' || item.status === 'completed'
        const color = warning ? yellow : red
        const title = item.status === 'aborted'
          ? 'Stopped'
          : item.code === 'empty_turn'
            ? 'No response'
            : isModelConnectionError(item)
              ? 'Model connection failed'
              : 'Turn failed'
        return [
          color(` ✕ ${bold(title)}`),
          ...plainLines(friendlyRuntimeError(item.message), contentWidth, 3).slice(0, 8).map((line) => color(`   ${line}`)),
          ...(isModelConnectionError(item)
            ? [
                cyan('   Run /connect, select this provider, then choose Sign in again / reconnect.'),
                dim(this.legacyGui
                  ? '   Kun will update the protected store and active GUI runtime.'
                  : '   Or use /model to choose another model.')
              ]
            : [])
        ]
      }
    }
  }

  invalidate(): void { this.markdown?.invalidate() }
}

export function renderKunThinking(
  item: Extract<TurnItem, { kind: 'assistant_reasoning' }>,
  width: number,
  options: {
    expanded: boolean
    running: boolean
    endedAt?: string
    animationFrame?: number
  }
): string[] {
  const contentWidth = Math.max(8, width)
  const duration = itemDuration(item, options.running, options.endedAt)
  const title = options.running
    ? `${cyan(activityFrame('thinking', options.animationFrame ?? 0))} ${dim(italic('Thinking…'))} ${dim(`· ${duration}`)}`
    : `${dim('●')} ${dim(italic('Thinking'))} ${dim(duration ? `· ${duration}` : '')}`
  if (!options.expanded) {
    const rich = `   ${dim('▸')} ${title} ${dim('· collapsed · click or /thinking expand')}`
    const full = `   ${dim('▸')} ${title} ${dim('· collapsed · /thinking expand')}`
    const compact = `   ${dim('▸')} ${title} ${dim('· /thinking expand')}`
    const row = visibleWidth(rich) <= contentWidth
      ? rich
      : visibleWidth(full) <= contentWidth
        ? full
        : compact
    return [truncateToWidth(row, contentWidth)]
  }
  return [
    truncateToWidth(`   ${dim('▾')} ${title} ${dim('· click to collapse')}`, contentWidth),
    ...plainLines(item.text, Math.max(8, contentWidth - 7), 0)
      .map((line) => `${dim('     │')} ${dim(italic(line))}`)
  ]
}

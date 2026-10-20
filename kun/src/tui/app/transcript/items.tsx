import { createMemo, For, Index, Show, type JSX } from 'solid-js'
import type { AttachmentMetadata } from '../../../contracts/attachments.js'
import type { TurnItem } from '../../../contracts/items.js'
import { activityFrame } from '../../activity.js'
import { describeAttachment } from '../../chat-format.js'
import { friendlyRuntimeError, isModelConnectionError, itemDuration } from '../../render-utils.js'
import { sanitizeTerminalText } from '../../safe-text.js'
import type { ProjectedApprovalReview } from '../../state.js'
import { useApp } from '../context.js'
import type { ComposerMode } from '../../chat-format.js'
import { reasoningSummary } from '../../transcript-trail.js'
import { PANEL_BAR } from '../chat/composer.js'
import { Line, seg, styled, type SegInput } from '../ui.js'
import { Txt } from '../txt.js'

type ReasoningItem = Extract<TurnItem, { kind: 'assistant_reasoning' }>

export function UserMessageView(props: {
  item: Extract<TurnItem, { kind: 'user_message' }>
  mode: ComposerMode
  attachmentIds: readonly string[]
  attachments: Readonly<Record<string, AttachmentMetadata>>
}): JSX.Element {
  const app = useApp()
  const text = () => sanitizeTerminalText(props.item.displayText ?? props.item.text)
  return (
    <box border={['left']} borderColor={app.theme().modes[props.mode]} customBorderChars={PANEL_BAR} flexShrink={0}>
      <box flexDirection="column" flexGrow={1} backgroundColor={app.theme().panel} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
        <Txt content={styled(app.theme(), [text()])} wrapMode="word" />
        <Show when={props.attachmentIds.length > 0}>
          <box flexDirection="row" flexWrap="wrap" columnGap={1} paddingTop={1} flexShrink={0}>
            <For each={props.attachmentIds}>
              {(id) => {
                const description = describeAttachment(props.attachments[id])
                return (
                  <Txt content={styled(app.theme(), [
                    { text: ` ${description.kind.toLowerCase()} `, color: app.theme().panel, bg: app.theme().brand, bold: true },
                    { text: ` ${description.details} `, tone: 'muted', bg: app.theme().high }
                  ])} wrapMode="none" />
                )
              }}
            </For>
          </box>
        </Show>
      </box>
    </box>
  )
}

/**
 * Reasoning as one line in the thinking color: "◐ Thinking: summary" while
 * it streams, "+ Thought: summary · 2.1s" when done. Expanded, the body
 * follows behind a thin edge.
 */
export function ThinkingView(props: {
  item: ReasoningItem
  expanded: boolean
  running: boolean
  endedAt?: string
  frame: number
  clickable: boolean
  onToggle?: () => void
}): JSX.Element {
  const app = useApp()
  const duration = () => itemDuration(props.item, props.running, props.endedAt)
  const summary = () => reasoningSummary(props.item.text)
  const title = (): SegInput[] => props.running
    ? [seg.think(activityFrame('thinking', props.frame)), seg.think(summary() ? ` Thinking: ${summary()}` : ' Thinking')]
    : [seg.think(props.expanded ? '- Thought' : '+ Thought'), seg.think(summary() ? `: ${summary()}` : ''), duration() ? seg.think(` · ${duration()}`) : undefined]
  return (
    <box flexDirection="column" flexShrink={0} paddingLeft={3}>
      <box
        flexShrink={0}
        {...(props.expanded ? { border: ['left'] as ['left'], borderColor: app.theme().edge, customBorderChars: PANEL_BAR, paddingLeft: 1 } : {})}
        {...(props.onToggle ? { onMouseDown: props.onToggle } : {})}
      >
        <Line segments={title()} maxWidth={Math.max(10, app.width() - 6)} />
      </box>
      <Show when={props.expanded}>
        <box border={['left']} borderColor={app.theme().edge} customBorderChars={PANEL_BAR} paddingLeft={1} paddingTop={1} flexShrink={0}>
          <Txt content={styled(app.theme(), [seg.muted(sanitizeTerminalText(props.item.text))])} wrapMode="word" />
        </box>
      </Show>
    </box>
  )
}

export function ErrorView(props: { item: Extract<TurnItem, { kind: 'error' }>; legacyGui: boolean }): JSX.Element {
  const warning = () => props.item.severity === 'warning' || props.item.status === 'aborted' || props.item.status === 'completed'
  const tone = () => (warning() ? 'warning' : 'danger') as 'warning' | 'danger'
  const title = () => props.item.status === 'aborted'
    ? 'Stopped'
    : props.item.code === 'empty_turn'
      ? 'No response'
      : isModelConnectionError(props.item) ? 'Model connection failed' : 'Turn failed'
  const lines = createMemo(() => friendlyRuntimeError(props.item.message).split('\n').slice(0, 8))
  return (
    <box flexDirection="column" flexShrink={0}>
      <Line segments={[{ text: '   ✗ ', tone: tone() }, { text: title(), tone: tone(), bold: true }]} />
      <Index each={lines()}>{(line) => <Line segments={[{ text: `     ${line()}`, tone: 'muted' }]} />}</Index>
      <Show when={isModelConnectionError(props.item)}>
        <Line segments={[seg.brand('     Run /connect, select this provider, then choose Sign in again / reconnect.')]} />
        <Line segments={[seg.muted(props.legacyGui
          ? '     Kun will update the protected store and active GUI runtime.'
          : '     Or use /model to choose another model.')]} />
      </Show>
    </box>
  )
}

export function ApprovalReviewView(props: { review: ProjectedApprovalReview; frame: number }): JSX.Element {
  const app = useApp()
  const inProgress = () => props.review.status === 'in-progress'
  const icon = (): SegInput => inProgress()
    ? seg.focus(activityFrame('waiting', props.frame))
    : props.review.status === 'approved'
      ? seg.success('✓')
      : props.review.status === 'aborted' ? seg.warning('■') : seg.danger('✗')
  const metadata = () => [
    ...(props.review.riskLevel ? [`risk ${props.review.riskLevel}`] : []),
    ...(props.review.decision ? [props.review.decision] : [])
  ].join(' · ')
  const detail = () => props.review.rationale || (inProgress() ? props.review.summary : '')
  return (
    <box flexDirection="column" flexShrink={0}>
      <Line segments={[
        '   ', icon(), ' ',
        seg.muted(sanitizeTerminalText(inProgress() ? `Reviewing ${props.review.toolName}` : `Agent review ${props.review.status}`)),
        metadata() ? seg.muted(` · ${metadata()}`) : undefined
      ]} />
      <Show when={detail()}>
        <box paddingLeft={5} flexShrink={0}>
          <Txt content={styled(app.theme(), [seg.faint(sanitizeTerminalText(detail()))])} wrapMode="word" />
        </box>
      </Show>
    </box>
  )
}

/** Compact one-line items: approvals, questions, compaction, review, context switches. */
export function CompactItemView(props: { item: TurnItem }): JSX.Element {
  const app = useApp()
  const item = props.item
  switch (item.kind) {
    case 'approval':
      return <Line segments={['   ', seg.warning('△'), seg.muted(` Approval ${item.status}: ${sanitizeTerminalText(item.summary)}`)]} />
    case 'user_input':
      return <Line segments={['   ', seg.accent('?'), seg.muted(` Question ${item.status}: ${sanitizeTerminalText(item.prompt)}`)]} />
    case 'compaction':
      return <Line segments={['   ', seg.accent('↺'), seg.muted(` Compacted ${item.replacedTokens.toLocaleString()} tokens`)]} />
    case 'context_window':
      return <Line segments={['   ', seg.accent('⇢'), seg.muted(` Switched context window (${item.reason})`)]} />
    case 'review':
      return (
        <box flexDirection="column" flexShrink={0}>
          <Line segments={[seg.accent('   Review')]} />
          <box paddingLeft={5} flexShrink={0}>
            <Txt content={styled(app.theme(), [sanitizeTerminalText(item.reviewText ?? item.title)])} wrapMode="word" />
          </box>
        </box>
      )
    default:
      return <box height={0} />
  }
}

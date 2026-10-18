import { createMemo, For, Index, Show, type JSX } from 'solid-js'
import type { AttachmentMetadata } from '../../../contracts/attachments.js'
import type { TurnItem } from '../../../contracts/items.js'
import { activityFrame } from '../../activity.js'
import { describeAttachment } from '../../chat-format.js'
import { friendlyRuntimeError, isModelConnectionError, itemDuration } from '../../render-utils.js'
import { sanitizeTerminalText } from '../../safe-text.js'
import type { ProjectedApprovalReview } from '../../state.js'
import { useApp } from '../context.js'
import { Line, seg, styled, type SegInput } from '../ui.js'
import { Txt } from '../txt.js'

type ReasoningItem = Extract<TurnItem, { kind: 'assistant_reasoning' }>

export function UserMessageView(props: {
  item: Extract<TurnItem, { kind: 'user_message' }>
  attachmentIds: readonly string[]
  attachments: Readonly<Record<string, AttachmentMetadata>>
}): JSX.Element {
  const app = useApp()
  const text = () => sanitizeTerminalText(props.item.displayText ?? props.item.text)
  return (
    <box flexDirection="column" flexShrink={0}>
      <box flexDirection="row" flexShrink={0}>
        <box flexShrink={0}>
          <Txt content={styled(app.theme(), [seg.user(' › You', { bold: true }), '  '])} wrapMode="none" />
        </box>
        <box flexGrow={1} flexShrink={1} minWidth={0}>
          <Txt content={styled(app.theme(), [seg.user(text())])} wrapMode="word" />
        </box>
      </box>
      <For each={props.attachmentIds}>
        {(id) => {
          const description = describeAttachment(props.attachments[id])
          return <Line segments={['   └ ', seg.focus(description.kind), '  ', seg.muted(description.details)]} />
        }}
      </For>
    </box>
  )
}

/**
 * Thinking row. Collapsed by default to a single disclosure line with its
 * duration; expanded shows the muted, italic reasoning body.
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
  const title = (): SegInput[] => props.running
    ? [seg.focus(activityFrame('thinking', props.frame)), ' ', seg.muted('Thinking…', { italic: true }), seg.muted(` · ${duration()}`)]
    : [seg.muted('●'), ' ', seg.muted('Thinking', { italic: true }), duration() ? seg.muted(` · ${duration()}`) : undefined]
  const hint = () => props.expanded
    ? props.clickable ? ' · click to collapse' : ''
    : props.clickable ? ' · collapsed · click or /thinking expand' : ' · /thinking expand'
  return (
    <box flexDirection="column" flexShrink={0}>
      <box flexShrink={0} {...(props.onToggle ? { onMouseDown: props.onToggle } : {})}>
        <Line segments={['   ', seg.muted(props.expanded ? '▾' : '▸'), ' ', ...title(), seg.muted(hint())]} />
      </box>
      <Show when={props.expanded}>
        <box flexDirection="row" flexShrink={0}>
          <box flexShrink={0} width={7}>
            <Txt content={styled(app.theme(), [seg.muted('     │')])} wrapMode="none" />
          </box>
          <box flexGrow={1} flexShrink={1} minWidth={0}>
            <Txt content={styled(app.theme(), [seg.muted(sanitizeTerminalText(props.item.text), { italic: true })])} wrapMode="word" />
          </box>
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
      <Line segments={[{ text: ' ✕ ', tone: tone() }, { text: title(), tone: tone(), bold: true }]} />
      <Index each={lines()}>{(line) => <Line segments={[{ text: `   ${line()}`, tone: tone() }]} />}</Index>
      <Show when={isModelConnectionError(props.item)}>
        <Line segments={[seg.focus('   Run /connect, select this provider, then choose Sign in again / reconnect.')]} />
        <Line segments={[seg.muted(props.legacyGui
          ? '   Kun will update the protected store and active GUI runtime.'
          : '   Or use /model to choose another model.')]} />
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
        ' ', icon(), ' ',
        seg.bold(sanitizeTerminalText(inProgress() ? `Reviewing ${props.review.toolName}` : `Agent review ${props.review.status}`)),
        metadata() ? seg.muted(` · ${metadata()}`) : undefined
      ]} />
      <Show when={detail()}>
        <box paddingLeft={3} flexShrink={0}>
          <Txt content={styled(app.theme(), [seg.muted(sanitizeTerminalText(detail()))])} wrapMode="word" />
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
      return <Line segments={[' ', seg.warning('!'), ` Approval ${item.status}: ${sanitizeTerminalText(item.summary)}`]} />
    case 'user_input':
      return <Line segments={[' ', seg.accent('?'), ` Input ${item.status}: ${sanitizeTerminalText(item.prompt)}`]} />
    case 'compaction':
      return <Line segments={[' ', seg.accent('↺'), ` Compacted ${item.replacedTokens.toLocaleString()} tokens`]} />
    case 'context_window':
      return <Line segments={[' ', seg.accent('⇢'), ` Switched context window (${item.reason})`]} />
    case 'review':
      return (
        <box flexDirection="column" flexShrink={0}>
          <Line segments={[seg.accent(' Review')]} />
          <box paddingLeft={2} flexShrink={0}>
            <Txt content={styled(app.theme(), [sanitizeTerminalText(item.reviewText ?? item.title)])} wrapMode="word" />
          </box>
        </box>
      )
    default:
      return <box height={0} />
  }
}

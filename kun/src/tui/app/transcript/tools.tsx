import { createMemo, For, Index, Show, type JSX } from 'solid-js'
import type { TurnItem } from '../../../contracts/items.js'
import { activityFrame } from '../../activity.js'
import {
  conciseToolResultSummary,
  elapsedDuration,
  humanizeToolName,
  itemDuration,
  outputText,
  sourcePageSuffix,
  toolAction,
  toolResultSummary
} from '../../render-utils.js'
import { sanitizeTerminalText } from '../../safe-text.js'
import {
  EXPLORE_GROUP_COMPACT_LIMIT,
  explorationEntryFailed,
  explorationStageDuration,
  explorationToolAction,
  isToolResultFinal,
  type ExplorationEntry,
  type ExplorationStage,
  type ExplorationTimelineEntry,
  type ReasoningItem,
  type ToolResultItem
} from '../../transcript-exploration.js'
import type { ToneName } from '../theme.js'
import { Line, seg, type SegInput } from '../ui.js'

type ToolCallItem = Extract<TurnItem, { kind: 'tool_call' }>

/**
 * Tree-shaped detail section ("└ input  …", "│        …"). Lines are clipped,
 * not wrapped, and capped at `maxLines` so tool output stays bounded.
 */
export function TreeSection(props: {
  label: string
  value: string
  maxLines: number
  terminal: boolean
  tone: ToneName
  indent?: string
}): JSX.Element {
  const lines = createMemo(() => sanitizeTerminalText(props.value || '').split('\n').slice(0, props.maxLines))
  const label = () => sanitizeTerminalText(props.label).slice(0, 12)
  return (
    <Index each={lines()}>
      {(line, index) => {
        const marker = index === 0 ? (props.terminal ? '└' : '├') : '│'
        const prefix = index === 0 && label() ? `${label()}  ` : ' '.repeat(label() ? label().length + 2 : 0)
        return <Line segments={[{ text: `${props.indent ?? '   '}${marker} ${prefix}${line()}`, tone: props.tone }]} />
      }}
    </Index>
  )
}

export function ToolCallView(props: {
  item: ToolCallItem
  result?: ToolResultItem
  turnRunning: boolean
  details: boolean
  frame: number
}): JSX.Element {
  const running = () => !isToolResultFinal(props.result) && props.turnRunning && props.item.status !== 'failed' && props.item.status !== 'aborted'
  const failed = () => Boolean(props.result?.isError) || props.item.status === 'failed' || props.item.status === 'aborted'
  const action = createMemo(() => {
    const base = toolAction(props.item)
    return { ...base, subject: `${base.subject}${sourcePageSuffix(props.result?.output)}` }
  })
  const duration = () => elapsedDuration(props.item.createdAt, props.result?.finishedAt ?? props.item.finishedAt, running())
  const icon = (): SegInput => failed()
    ? seg.danger('✗')
    : running() ? seg.focus(activityFrame('tool', props.frame)) : seg.success('●')
  const summary = createMemo(() => props.result ? conciseToolResultSummary(props.result.output) : undefined)
  return (
    <box flexDirection="column" flexShrink={0}>
      <Line segments={[
        ' ', icon(), ' ', seg.bold(action().verb),
        action().subject ? seg.muted(` · ${sanitizeTerminalText(action().subject)}`) : undefined,
        duration() ? seg.muted(` · ${duration()}`) : undefined
      ]} />
      <Show
        when={props.details}
        fallback={
          <Show when={props.result?.isError} fallback={
            <Show when={summary()}>
              <TreeSection label="" value={summary()!} maxLines={1} terminal tone="muted" />
            </Show>
          }>
            <TreeSection label="" value={toolResultSummary(props.result!.output)} maxLines={4} terminal tone="danger" />
          </Show>
        }
      >
        <TreeSection label="input" value={outputText(props.item.arguments)} maxLines={20} terminal={!props.result} tone="muted" />
        <Show when={props.result}>
          <TreeSection label="output" value={outputText(props.result!.output)} maxLines={40} terminal tone={props.result!.isError ? 'danger' : 'muted'} />
        </Show>
      </Show>
    </box>
  )
}

export function ToolResultView(props: { item: ToolResultItem; details: boolean }): JSX.Element {
  return (
    <box flexDirection="column" flexShrink={0}>
      <Line segments={[' ', props.item.isError ? seg.danger('✗') : seg.success('●'), ' ', seg.bold(humanizeToolName(props.item.toolName))]} />
      <TreeSection
        label=""
        value={outputText(props.item.output)}
        maxLines={props.details ? 50 : props.item.isError ? 5 : 2}
        terminal
        tone={props.item.isError ? 'danger' : 'muted'}
      />
    </box>
  )
}

/** "Exploring / Explored" group of consecutive read-only discovery calls. */
export function ExplorationView(props: {
  stage: ExplorationStage
  details: boolean
  showReasoning: boolean
  frame: number
}): JSX.Element {
  const visible = createMemo(() => {
    const timeline: ExplorationTimelineEntry[] = []
    let actions = 0
    for (const entry of props.stage.timeline) {
      if (entry.kind === 'reasoning') {
        if (props.showReasoning && (props.details || actions <= EXPLORE_GROUP_COMPACT_LIMIT)) timeline.push(entry)
        continue
      }
      if (props.details || actions < EXPLORE_GROUP_COMPACT_LIMIT) timeline.push(entry)
      actions += 1
    }
    const rendered = Math.min(actions, EXPLORE_GROUP_COMPACT_LIMIT)
    const omitted = props.details ? 0 : props.stage.entries.length - rendered
    // A running stage shows its newest actions; finished stages show the start.
    if (!props.details && props.stage.active && timeline.length > 4) {
      const tail = timeline.slice(-4)
      return { timeline: tail, omitted: omitted + (timeline.length - tail.length), leading: true }
    }
    return { timeline, omitted, leading: false }
  })
  const failedCount = () => props.stage.entries.filter(explorationEntryFailed).length
  const duration = () => explorationStageDuration(props.stage)
  const metadata = () => [
    `${props.stage.entries.length} ${props.stage.entries.length === 1 ? 'action' : 'actions'}`,
    ...(failedCount() > 0 ? [`${failedCount()} failed`] : []),
    ...(duration() ? [duration()] : [])
  ].join(' · ')
  return (
    <box flexDirection="column" flexShrink={0}>
      <Line segments={[
        ' ',
        props.stage.active ? seg.focus(activityFrame('tool', props.frame)) : failedCount() > 0 ? seg.danger('✗') : seg.muted('●'),
        ' ',
        seg.bold(props.stage.active ? 'Exploring' : 'Explored'),
        seg.muted(` · ${metadata()}`)
      ]} />
      <Show when={visible().leading}>
        <Line segments={[seg.muted(`   ┊ … ${visible().omitted} earlier`)]} />
      </Show>
      <For each={visible().timeline}>
        {(entry, index) => {
          const last = () => index() === visible().timeline.length - 1 && (visible().leading || visible().omitted === 0)
          return entry.kind === 'reasoning'
            ? <ExplorationReasoning stage={props.stage} item={entry.item} last={last()} frame={props.frame} />
            : <ExplorationAction stage={props.stage} entry={entry.entry} last={last()} details={props.details} frame={props.frame} />
        }}
      </For>
      <Show when={!visible().leading && visible().omitted > 0}>
        <Line segments={[seg.muted(`   └ … +${visible().omitted} more`)]} />
      </Show>
    </box>
  )
}

function ExplorationReasoning(props: { stage: ExplorationStage; item: ReasoningItem; last: boolean; frame: number }): JSX.Element {
  const running = () => {
    const tail = props.stage.timeline.at(-1)
    return props.stage.active && props.item.status === 'running' && tail?.kind === 'reasoning' && tail.item.id === props.item.id
  }
  const endedAt = () => {
    const index = props.stage.timeline.findIndex((entry) => entry.kind === 'reasoning' && entry.item.id === props.item.id)
    const next = props.stage.timeline[index + 1]
    return props.item.finishedAt ?? (next?.kind === 'reasoning' ? next.item.createdAt : next?.entry.call.createdAt)
  }
  const duration = () => itemDuration(props.item, running(), endedAt())
  const lines = () => sanitizeTerminalText(props.item.text).split('\n')
  return (
    <box flexDirection="column" flexShrink={0}>
      <Line segments={[
        `   ${props.last ? '└' : '├'} `,
        running() ? seg.focus(`${activityFrame('thinking', props.frame)} `) : undefined,
        seg.muted(running() ? 'Thinking…' : 'Thinking', { italic: true }),
        duration() ? seg.muted(` · ${duration()}`) : undefined
      ]} />
      <Index each={lines()}>
        {(line) => <Line segments={[`   ${props.last ? ' ' : '│'}  `, seg.muted(line(), { italic: true })]} />}
      </Index>
    </box>
  )
}

function ExplorationAction(props: {
  stage: ExplorationStage
  entry: ExplorationEntry
  last: boolean
  details: boolean
  frame: number
}): JSX.Element {
  const failed = () => explorationEntryFailed(props.entry)
  const running = () => props.stage.active && !isToolResultFinal(props.entry.result) && props.entry.call.status !== 'failed' && props.entry.call.status !== 'aborted'
  const action = createMemo(() => {
    const base = explorationToolAction(props.entry.call) ?? toolAction(props.entry.call)
    return { ...base, subject: `${base.subject}${sourcePageSuffix(props.entry.result?.output)}` }
  })
  const duration = () => elapsedDuration(props.entry.call.createdAt, props.entry.result?.finishedAt ?? props.entry.call.finishedAt, running())
  const continuation = () => (props.last ? ' ' : '│')
  return (
    <box flexDirection="column" flexShrink={0}>
      <Line segments={[
        `   ${props.last ? '└' : '├'} `,
        failed() ? seg.danger('✗ ') : running() ? seg.focus(`${activityFrame('tool', props.frame)} `) : undefined,
        seg.focus(action().verb, { bold: true }),
        action().subject ? ` ${sanitizeTerminalText(action().subject)}` : undefined,
        duration() ? seg.muted(` · ${duration()}`) : undefined
      ]} />
      <Show when={props.details}>
        <ExplorationDetail label="input" value={outputText(props.entry.call.arguments)} maxLines={20} continuation={continuation()} tone="muted" />
        <Show when={props.entry.result}>
          <ExplorationDetail
            label="output"
            value={outputText(props.entry.result!.output)}
            maxLines={40}
            continuation={continuation()}
            tone={props.entry.result!.isError ? 'danger' : 'muted'}
          />
        </Show>
      </Show>
    </box>
  )
}

function ExplorationDetail(props: { label: string; value: string; maxLines: number; continuation: string; tone: ToneName }): JSX.Element {
  const lines = createMemo(() => sanitizeTerminalText(props.value || '').split('\n').slice(0, props.maxLines))
  return (
    <Index each={lines()}>
      {(line, index) => (
        <Line segments={[
          `   ${props.continuation}  `,
          {
            text: `${index === lines().length - 1 ? '└' : '├'} ${index === 0 ? `${props.label} · ` : ' '.repeat(props.label.length + 3)}${line()}`,
            tone: props.tone
          }
        ]} />
      )}
    </Index>
  )
}

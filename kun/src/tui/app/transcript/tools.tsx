import { createMemo, For, Index, Match, Show, Switch, type JSX } from 'solid-js'
import type { TurnItem } from '../../../contracts/items.js'
import { activityFrame } from '../../activity.js'
import {
  conciseToolResultSummary,
  elapsedDuration,
  humanizeToolName,
  outputText,
  sourcePageSuffix,
  toolAction,
  toolResultSummary
} from '../../render-utils.js'
import { sanitizeTerminalText } from '../../safe-text.js'
import {
  explorationEntryFailed,
  explorationToolAction,
  isToolResultFinal,
  type ExplorationEntry,
  type ExplorationStage,
  type ToolResultItem
} from '../../transcript-exploration.js'
import { reasoningSummary, TOOL_GLYPHS, toolCategory } from '../../transcript-trail.js'
import { AppContext, useApp } from '../context.js'
import type { ToneName } from '../theme.js'
import { Line, seg, SplitRow, type SegInput } from '../ui.js'

type ToolCallItem = Extract<TurnItem, { kind: 'tool_call' }>

/** Input/output detail lines under a tool row (ctrl+o), clipped and capped. */
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
        return <Line segments={[{ text: `${props.indent ?? '     '}${marker} ${prefix}${line()}`, tone: props.tone }]} />
      }}
    </Index>
  )
}

function toolState(item: ToolCallItem, result: ToolResultItem | undefined, turnRunning: boolean) {
  const failed = Boolean(result?.isError) || item.status === 'failed' || item.status === 'aborted'
  const running = !failed && !isToolResultFinal(result) && turnRunning
  return { failed, running }
}

/** One muted row: glyph, verb, subject, duration. Status colors only the glyph's row. */
function ToolRow(props: {
  glyph: string
  verb: string
  subject: string
  duration: string
  running: boolean
  failed: boolean
  awaiting: boolean
  frame: number
}): JSX.Element {
  const tone = (): ToneName => (props.awaiting ? 'warning' : props.failed ? 'danger' : 'muted')
  const glyph = (): SegInput => props.awaiting
    ? seg.warning('△')
    : props.failed ? seg.danger('✗') : props.running ? seg.brand(activityFrame('tool', props.frame)) : seg.muted(props.glyph)
  return (
    <Line segments={[
      '   ', glyph(), ' ',
      { text: props.verb, tone: tone() },
      props.subject ? { text: ` ${sanitizeTerminalText(props.subject)}`, tone: tone() } : undefined,
      props.duration && !props.awaiting ? seg.faint(` · ${props.duration}`) : undefined
    ]} />
  )
}

function shellOutput(value: unknown): { text: string; exitCode?: number | null } {
  if (typeof value === 'string') return { text: value }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const exitCode = typeof record.exit_code === 'number' || record.exit_code === null ? record.exit_code as number | null : undefined
    const text = typeof record.output === 'string' ? record.output : conciseToolResultSummary(value) ?? ''
    return { text, ...(exitCode !== undefined ? { exitCode } : {}) }
  }
  return { text: '' }
}

/** Command in a raised block: "$ command", the output's tail, then the exit status. */
function ShellBlock(props: { item: ToolCallItem; result?: ToolResultItem; turnRunning: boolean; details: boolean; frame: number }): JSX.Element {
  const app = useApp()
  const state = () => toolState(props.item, props.result, props.turnRunning)
  const command = () => toolAction(props.item).subject
  const output = createMemo(() => shellOutput(props.result?.output))
  const tail = createMemo(() => {
    const lines = sanitizeTerminalText(output().text).split('\n').filter((line) => line.trim())
    const limit = props.details ? 40 : state().failed ? 5 : 3
    return lines.slice(-limit)
  })
  const duration = () => elapsedDuration(props.item.createdAt, props.result?.finishedAt ?? props.item.finishedAt, state().running)
  const exitLine = (): SegInput[] => {
    const code = output().exitCode
    const failed = state().failed || (typeof code === 'number' && code !== 0)
    const label = typeof code === 'number' ? `exit ${code}` : failed ? 'failed' : 'done'
    return failed ? [seg.danger(`✗ ${label}`), seg.faint(` · ${duration()}`)] : [seg.faint(`✓ ${label} · ${duration()}`)]
  }
  return (
    <box marginLeft={3} flexShrink={0} flexDirection="column" backgroundColor={app.theme().raised} paddingLeft={2} paddingRight={2}>
      <AppContext.Provider value={{ ...app, width: () => Math.max(10, app.width() - 7) }}>
        <Line segments={[
          state().running ? seg.brand(`${activityFrame('tool', props.frame)} `) : undefined,
          seg.muted(`$ ${sanitizeTerminalText(command())}`),
          state().running ? seg.faint(` · ${duration()}`) : undefined
        ]} />
        <For each={tail()}>{(line) => <Line segments={[seg.muted(line)]} />}</For>
        <Show when={!state().running && props.result}>
          <Line segments={exitLine()} />
        </Show>
      </AppContext.Provider>
    </box>
  )
}

type DiffLine = { kind: 'add' | 'del'; text: string }

function editDiff(args: Record<string, unknown>): DiffLine[] | undefined {
  const pairs: Array<{ oldText: string; newText: string }> = []
  if (typeof args.oldText === 'string' && typeof args.newText === 'string') pairs.push({ oldText: args.oldText, newText: args.newText })
  if (Array.isArray(args.edits)) {
    for (const edit of args.edits) {
      if (edit && typeof edit === 'object' && typeof edit.oldText === 'string' && typeof edit.newText === 'string') {
        pairs.push({ oldText: edit.oldText, newText: edit.newText })
      }
    }
  }
  if (!pairs.length) return undefined
  return pairs.flatMap((pair) => [
    ...sanitizeTerminalText(pair.oldText).split('\n').map((text) => ({ kind: 'del' as const, text })),
    ...sanitizeTerminalText(pair.newText).split('\n').map((text) => ({ kind: 'add' as const, text }))
  ])
}

/** Edit in a raised block: "← Edit path   +2 −2" over the changed lines. */
function EditBlock(props: { item: ToolCallItem; result?: ToolResultItem; turnRunning: boolean; details: boolean; frame: number; diff: DiffLine[] }): JSX.Element {
  const app = useApp()
  const state = () => toolState(props.item, props.result, props.turnRunning)
  const limit = () => (props.details ? 60 : 8)
  const shown = () => props.diff.slice(0, limit())
  const added = () => props.diff.filter((line) => line.kind === 'add').length
  const deleted = () => props.diff.filter((line) => line.kind === 'del').length
  const inner = () => Math.max(10, app.width() - 7)
  return (
    <box marginLeft={3} flexShrink={0} flexDirection="column" backgroundColor={app.theme().raised}>
      <AppContext.Provider value={{ ...app, width: inner }}>
        <box paddingLeft={2} paddingRight={2} flexShrink={0}>
          <SplitRow
            left={[
              state().failed ? seg.danger('✗ ') : state().running ? seg.brand(`${activityFrame('tool', props.frame)} `) : undefined,
              seg.muted(`← Edit ${sanitizeTerminalText(toolAction(props.item).subject)}`)
            ]}
            right={[seg.success(`+${added()}`), seg.danger(`  −${deleted()}`)]}
          />
        </box>
        <For each={shown()}>
          {(line) => (
            <box flexShrink={0} paddingLeft={2} backgroundColor={line.kind === 'add' ? app.theme().diff.addBg : app.theme().diff.delBg}>
              <Line segments={[seg.color(`${line.kind === 'add' ? '+' : '-'} ${line.text}`, line.kind === 'add' ? app.theme().diff.addFg : app.theme().diff.delFg)]} />
            </box>
          )}
        </For>
        <Show when={props.diff.length > limit()}>
          <box paddingLeft={2} flexShrink={0}><Line segments={[seg.faint(`… ${props.diff.length - limit()} more lines · ctrl+o`)]} /></box>
        </Show>
        <Show when={state().failed && props.result}>
          <box paddingLeft={2} flexShrink={0}><Line segments={[seg.danger(toolResultSummary(props.result!.output))]} /></box>
        </Show>
      </AppContext.Provider>
    </box>
  )
}

export function ToolCallView(props: {
  item: ToolCallItem
  result?: ToolResultItem
  turnRunning: boolean
  details: boolean
  frame: number
  awaiting: boolean
}): JSX.Element {
  const category = () => toolCategory(props.item.toolName)
  const state = () => toolState(props.item, props.result, props.turnRunning)
  const diff = createMemo(() => (category() === 'edit' ? editDiff(props.item.arguments) : undefined))
  const action = createMemo(() => {
    const base = toolAction(props.item)
    const lines = category() === 'write' && typeof props.item.arguments.content === 'string'
      ? ` · ${props.item.arguments.content.split('\n').length} lines`
      : ''
    return { verb: category() === 'write' ? 'Write' : base.verb, subject: `${base.subject}${sourcePageSuffix(props.result?.output)}${lines}` }
  })
  const duration = () => elapsedDuration(props.item.createdAt, props.result?.finishedAt ?? props.item.finishedAt, state().running)
  return (
    <Switch fallback={
      <box flexDirection="column" flexShrink={0}>
        <ToolRow
          glyph={TOOL_GLYPHS[category()]}
          verb={action().verb}
          subject={action().subject}
          duration={duration()}
          running={state().running}
          failed={state().failed}
          awaiting={props.awaiting}
          frame={props.frame}
        />
        <Show when={props.details} fallback={
          <Show when={state().failed && props.result}>
            <TreeSection label="" value={toolResultSummary(props.result!.output)} maxLines={4} terminal tone="danger" />
          </Show>
        }>
          <TreeSection label="input" value={outputText(props.item.arguments)} maxLines={20} terminal={!props.result} tone="faint" />
          <Show when={props.result}>
            <TreeSection label="output" value={outputText(props.result!.output)} maxLines={40} terminal tone={props.result!.isError ? 'danger' : 'faint'} />
          </Show>
        </Show>
      </box>
    }>
      <Match when={category() === 'run' && !props.awaiting}>
        <ShellBlock item={props.item} {...(props.result ? { result: props.result } : {})} turnRunning={props.turnRunning} details={props.details} frame={props.frame} />
      </Match>
      <Match when={diff() && !props.awaiting}>
        <EditBlock item={props.item} {...(props.result ? { result: props.result } : {})} turnRunning={props.turnRunning} details={props.details} frame={props.frame} diff={diff()!} />
      </Match>
    </Switch>
  )
}

export function ToolResultView(props: { item: ToolResultItem; details: boolean }): JSX.Element {
  return (
    <box flexDirection="column" flexShrink={0}>
      <Line segments={['   ', props.item.isError ? seg.danger('✗') : seg.muted('•'), ' ', { text: humanizeToolName(props.item.toolName), tone: props.item.isError ? 'danger' : 'muted' }]} />
      <TreeSection
        label=""
        value={outputText(props.item.output)}
        maxLines={props.details ? 50 : props.item.isError ? 5 : 2}
        terminal
        tone={props.item.isError ? 'danger' : 'faint'}
      />
    </box>
  )
}

const LIVE_EXPLORE_ROWS = 4

/** Consecutive read-only discovery calls, one muted row each; a running group shows its newest rows. */
export function ExplorationView(props: {
  stage: ExplorationStage
  details: boolean
  showReasoning: boolean
  frame: number
}): JSX.Element {
  const visible = createMemo(() => {
    const timeline = props.stage.timeline.filter((entry) => entry.kind !== 'reasoning' || props.showReasoning)
    if (!props.details && props.stage.active && timeline.length > LIVE_EXPLORE_ROWS) {
      return { timeline: timeline.slice(-LIVE_EXPLORE_ROWS), omitted: timeline.length - LIVE_EXPLORE_ROWS }
    }
    return { timeline, omitted: 0 }
  })
  return (
    <box flexDirection="column" flexShrink={0}>
      <Show when={visible().omitted > 0}>
        <Line segments={[seg.faint(`   … ${visible().omitted} earlier`)]} />
      </Show>
      <For each={visible().timeline}>
        {(entry) => entry.kind === 'reasoning'
          ? <Line segments={['   ', seg.think(`+ Thought: ${reasoningSummary(entry.item.text)}`)]} />
          : <ExplorationAction stage={props.stage} entry={entry.entry} details={props.details} frame={props.frame} />}
      </For>
    </box>
  )
}

function ExplorationAction(props: { stage: ExplorationStage; entry: ExplorationEntry; details: boolean; frame: number }): JSX.Element {
  const failed = () => explorationEntryFailed(props.entry)
  const running = () => props.stage.active && !isToolResultFinal(props.entry.result) && props.entry.call.status !== 'failed' && props.entry.call.status !== 'aborted'
  const action = createMemo(() => {
    const base = explorationToolAction(props.entry.call) ?? toolAction(props.entry.call)
    return { ...base, subject: `${base.subject}${sourcePageSuffix(props.entry.result?.output)}` }
  })
  const duration = () => elapsedDuration(props.entry.call.createdAt, props.entry.result?.finishedAt ?? props.entry.call.finishedAt, running())
  return (
    <box flexDirection="column" flexShrink={0}>
      <ToolRow
        glyph={TOOL_GLYPHS[toolCategory(props.entry.call.toolName)]}
        verb={action().verb}
        subject={action().subject}
        duration={props.details ? duration() : ''}
        running={running()}
        failed={failed()}
        awaiting={false}
        frame={props.frame}
      />
      <Show when={props.details}>
        <TreeSection label="input" value={outputText(props.entry.call.arguments)} maxLines={20} terminal={!props.entry.result} tone="faint" />
        <Show when={props.entry.result}>
          <TreeSection label="output" value={outputText(props.entry.result!.output)} maxLines={40} terminal tone={props.entry.result!.isError ? 'danger' : 'faint'} />
        </Show>
      </Show>
    </box>
  )
}

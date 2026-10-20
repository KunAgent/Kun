import { createMemo, For, Index, Show, type JSX } from 'solid-js'
import { activityFrame } from '../../activity.js'
import { cellWidth } from '../../layout.js'
import { elapsedDuration, formatDurationMs } from '../../render-utils.js'
import { sanitizeTerminalText } from '../../safe-text.js'
import type { ProjectedChildRun } from '../../state.js'
import {
  childActivityVisualKind,
  childBriefMetrics,
  childCardMeta,
  childCardStatus,
  childGroupBreakdown,
  elapsedMilliseconds,
  isActiveChildRun,
  isForegroundChildRun
} from '../../subagent-format.js'
import { useApp } from '../context.js'
import { Line, seg, SplitRow, type SegInput } from '../ui.js'

/**
 * Cards stop growing here so their right column stays near the text. They
 * stay fluid below it: a scrollbar narrows the viewport, and the right
 * column must not be the part that gets clipped.
 */
const CARD_MAX_WIDTH = 100
const NAME_COLUMN_MAX = 10
const GROUP_BAR_WIDTH = 12

function previewLines(text: string, limit: number): string[] {
  return sanitizeTerminalText(text).split('\n').filter((line) => line.trim()).slice(0, limit)
}

function childName(child: ProjectedChildRun): string {
  return sanitizeTerminalText(child.profileName || child.profile || 'agent')
}

function statusGlyph(child: ProjectedChildRun, frame: number): SegInput {
  if (isActiveChildRun(child)) return seg.brand(activityFrame('subagent', frame))
  return child.status === 'failed' || child.status === 'aborted' ? seg.danger('✗') : seg.success('✓')
}

/** "done · 1m 40s", "failed · 22s", or just "18s" while running. */
function statusSegments(child: ProjectedChildRun): SegInput[] {
  const status = childCardStatus(child)
  return [
    status.state ? (status.failed ? seg.danger(`${status.state} · `) : seg.faint(`${status.state} · `)) : undefined,
    seg.muted(status.elapsed)
  ]
}

/** What the child is doing now: its activity, or why it has none yet. */
function activitySegments(child: ProjectedChildRun, frame: number): SegInput[] {
  if (child.activity) {
    return [
      seg.brand(activityFrame(childActivityVisualKind(child), frame)),
      seg.muted(` ${sanitizeTerminalText(child.activity.label)}`),
      seg.faint(` · ${elapsedDuration(child.activity.startedAt, undefined, true)}`)
    ]
  }
  return [seg.faint(child.status === 'queued' ? 'Waiting for an execution slot…' : 'Working independently…')]
}

function useCardWidth(): () => number {
  const app = useApp()
  return () => Math.min(app.width(), CARD_MAX_WIDTH)
}

/**
 * One delegated agent as a card: type, task and status on the title row,
 * then a rail carrying its model and metrics, what it is doing now or the
 * result, and the open hint. The rail is teal while the agent works.
 */
export function ChildRunView(props: {
  child: ProjectedChildRun
  expanded: boolean
  frame: number
  /** Show the click hint (in-progress entries with the mouse on). */
  hint: boolean
  onOpen?: () => void
}): JSX.Element {
  const width = useCardWidth()
  const child = () => props.child
  const active = () => isActiveChildRun(child())
  const failed = () => child().status === 'failed' || child().status === 'aborted'
  const label = () => sanitizeTerminalText(child().label || child().prompt || '')
  const rows = createMemo((): SegInput[][] => {
    const out: SegInput[][] = []
    const meta = childCardMeta(child())
    if (meta) out.push([seg.faint(meta)])
    if (active()) out.push(activitySegments(child(), props.frame))
    if (props.expanded && child().prompt) out.push([seg.faint(`Task: ${sanitizeTerminalText(child().prompt!)}`)])
    if (!active() && child().text) {
      for (const line of previewLines(child().text!, props.expanded ? 8 : failed() ? 3 : 2)) {
        out.push([failed() ? seg.danger(line) : seg.muted(line)])
      }
    }
    if (props.hint) out.push([seg.faint(`click to open · /subagents${isForegroundChildRun(child()) ? ' · ctrl+b background' : ''}`)])
    return out
  })
  const rail = (index: number): SegInput => {
    const glyph = index === rows().length - 1 ? '╰ ' : '│ '
    return active() ? seg.brand(glyph) : seg.faint(glyph)
  }
  return (
    <box flexDirection="column" flexShrink={0} width="100%" maxWidth={CARD_MAX_WIDTH} {...(props.onOpen ? { onMouseDown: props.onOpen } : {})}>
      <SplitRow
        width={width()}
        left={['   ', statusGlyph(child(), props.frame), ' ', seg.bold(childName(child())), label() ? `  ${label()}` : undefined]}
        right={statusSegments(child())}
      />
      <Index each={rows()}>
        {(row, index) => <Line segments={['   ', rail(index), ...row()]} maxWidth={width()} />}
      </Index>
    </box>
  )
}

/**
 * Agents delegated together, as a tree under one header with a progress
 * bar. Each branch is one agent; a working agent shows its current step
 * under its branch.
 */
export function ChildRunGroupView(props: {
  children: readonly ProjectedChildRun[]
  expanded: boolean
  frame: number
  /** Show the click hint (in-progress entries with the mouse on). */
  hint: boolean
  onOpen?: (childId: string) => void
}): JSX.Element {
  const width = useCardWidth()
  const total = () => props.children.length
  const done = () => props.children.filter((child) => !isActiveChildRun(child)).length
  const active = () => done() < total()
  const failed = () => props.children.some((child) => child.status === 'failed' || child.status === 'aborted')
  const elapsed = () => formatDurationMs(Math.max(0, ...props.children.map((child) =>
    child.durationMs ?? elapsedMilliseconds(child.startedAt, child.updatedAt, isActiveChildRun(child))
  )))
  const nameColumn = createMemo(() => Math.min(NAME_COLUMN_MAX, Math.max(...props.children.map((child) => cellWidth(childName(child))))))
  const filled = () => Math.round((done() / Math.max(1, total())) * GROUP_BAR_WIDTH)
  const header = (): SegInput[] => [
    '   ',
    active() ? seg.brand(activityFrame('subagent', props.frame)) : failed() ? seg.danger('✗') : seg.success('✓'),
    ' ', seg.bold(`${total()} agents`),
    seg.muted(`  ${childGroupBreakdown(props.children)}`)
  ]
  const progress = (): SegInput[] => [
    seg.brand('▰'.repeat(filled())),
    seg.faint(`${'▱'.repeat(GROUP_BAR_WIDTH - filled())} `),
    seg.muted(`${done()}/${total()} · ${elapsed()}`)
  ]
  return (
    <box flexDirection="column" flexShrink={0} width="100%" maxWidth={CARD_MAX_WIDTH}>
      <SplitRow width={width()} left={header()} right={progress()} />
      <For each={props.children}>
        {(child, index) => {
          const last = () => index() === props.children.length - 1
          const childFailed = () => child.status === 'failed' || child.status === 'aborted'
          const name = () => {
            const value = childName(child)
            return value + ' '.repeat(Math.max(0, nameColumn() - cellWidth(value)))
          }
          const description = () => sanitizeTerminalText(child.label || child.prompt || child.childId)
          const details = (): SegInput[][] => {
            if (isActiveChildRun(child)) return [activitySegments(child, props.frame)]
            if (!child.text) return []
            const limit = props.expanded ? 6 : childFailed() ? 2 : 1
            return previewLines(child.text, limit).map((line) => [childFailed() ? seg.danger(line) : seg.faint(line)])
          }
          const right = (): SegInput[] => {
            const status = childCardStatus(child)
            const metrics = childBriefMetrics(child)
            if (status.failed) return [seg.danger(`${status.state} · `), seg.muted(status.elapsed)]
            return [seg.faint(status.state ? `${status.state} · ` : ''), seg.muted(metrics || status.elapsed)]
          }
          return (
            <box flexDirection="column" flexShrink={0} {...(props.onOpen ? { onMouseDown: () => props.onOpen!(child.childId) } : {})}>
              <SplitRow
                width={width()}
                left={['   ', seg.faint(last() ? '└─ ' : '├─ '), statusGlyph(child, props.frame), ' ', name(), seg.muted(`  ${description()}`)]}
                right={right()}
              />
              <Index each={details()}>
                {(row) => <Line segments={['   ', seg.faint(last() ? '     ' : '│    '), ...row()]} maxWidth={width()} />}
              </Index>
              <Show when={props.expanded && child.prompt && child.prompt !== child.label}>
                <Line segments={['   ', seg.faint(last() ? '     ' : '│    '), seg.faint(`Task: ${sanitizeTerminalText(child.prompt!)}`)]} maxWidth={width()} />
              </Show>
            </box>
          )
        }}
      </For>
      <Show when={props.hint}>
        <Line segments={[seg.faint('        click an agent to open it · /subagents · ctrl+b background')]} />
      </Show>
    </box>
  )
}

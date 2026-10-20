import { createMemo, For, Index, Show, type JSX } from 'solid-js'
import { activityFrame } from '../../activity.js'
import { elapsedDuration } from '../../render-utils.js'
import { sanitizeTerminalText } from '../../safe-text.js'
import type { ProjectedChildRun } from '../../state.js'
import {
  childActivityVisualKind,
  childGroupSummary,
  childMetrics,
  childStatusLabel,
  childStatusTone,
  isActiveChildRun,
  isForegroundChildRun
} from '../../subagent-format.js'
import { Line, seg, type SegInput } from '../ui.js'

function statusSeg(child: ProjectedChildRun): SegInput {
  return { text: childStatusLabel(child), tone: childStatusTone(child) }
}

function previewLines(text: string, limit: number): string[] {
  return sanitizeTerminalText(text).split('\n').filter((line) => line.trim()).slice(0, limit)
}

export function ChildRunView(props: {
  child: ProjectedChildRun
  expanded: boolean
  frame: number
  /** Show the click hint (in-progress entries with the mouse on). */
  hint: boolean
  onOpen?: () => void
}): JSX.Element {
  const child = () => props.child
  const active = () => isActiveChildRun(child())
  const failed = () => child().status === 'failed' || child().status === 'aborted'
  const label = () => sanitizeTerminalText(child().label || child().profile || 'Subagent')
  const role = () => (child().profile && child().profile !== child().label ? ` · ${sanitizeTerminalText(child().profile!)}` : '')
  const metrics = () => childMetrics(child())
  const preview = createMemo(() => {
    if (active() && child().activity) return []
    if (child().text) return previewLines(child().text!, props.expanded ? 8 : failed() ? 5 : 2)
    return []
  })
  return (
    <box flexDirection="column" flexShrink={0} {...(props.onOpen ? { onMouseDown: props.onOpen } : {})}>
      <Line segments={[
        '   ',
        active() ? seg.brand(activityFrame('subagent', props.frame)) : failed() ? seg.danger('✗') : seg.success('✓'),
        ' ', { text: label(), tone: failed() ? 'danger' : 'muted' }, seg.faint(role()),
        metrics() ? seg.muted(` · ${metrics()}`) : undefined,
        seg.muted(' · '), statusSeg(child())
      ]} />
      <Show when={active() && child().activity}>
        <Line segments={[
          '     ',
          seg.brand(activityFrame(childActivityVisualKind(child()), props.frame)),
          seg.muted(` ${sanitizeTerminalText(child().activity!.label)}`),
          seg.faint(` · ${elapsedDuration(child().activity!.startedAt, undefined, true)}`)
        ]} />
      </Show>
      <Show when={active() && !child().activity && !child().text}>
        <Line segments={[seg.faint(`     ${child().status === 'queued' ? 'Waiting for an execution slot…' : 'Working independently…'}`)]} />
      </Show>
      <Index each={preview()}>
        {(line) => <Line segments={[{ text: `     ${line()}`, tone: failed() ? 'danger' : 'faint' }]} />}
      </Index>
      <Show when={props.expanded && child().prompt}>
        <Line segments={[seg.faint(`     Task: ${sanitizeTerminalText(child().prompt!)}`)]} />
      </Show>
      <Show when={props.hint}>
        <Line segments={[seg.faint(`     click to open · /subagents${isForegroundChildRun(child()) ? ' · ctrl+b background' : ''}`)]} />
      </Show>
    </box>
  )
}

export function ChildRunGroupView(props: {
  children: readonly ProjectedChildRun[]
  expanded: boolean
  frame: number
  /** Show the click hint (in-progress entries with the mouse on). */
  hint: boolean
  onOpen?: (childId: string) => void
}): JSX.Element {
  const summary = createMemo(() => childGroupSummary(props.children))
  return (
    <box flexDirection="column" flexShrink={0}>
      <Line segments={[
        '   ',
        summary().active ? seg.brand(activityFrame('subagent', props.frame)) : summary().failed ? seg.danger('✗') : seg.success('✓'),
        ' ', seg.muted(summary().title),
        summary().breakdown ? seg.faint(` (${summary().breakdown})`) : undefined,
        summary().metrics ? seg.faint(` · ${summary().metrics}`) : undefined
      ]} />
      <For each={props.children}>
        {(child) => {
          const description = () => sanitizeTerminalText(child.label || child.prompt || child.childId)
          const preview = () => child.text || (isActiveChildRun(child)
            ? child.status === 'queued' ? 'Waiting to start…' : 'Working independently…'
            : child.prompt)
          return (
            <box flexDirection="column" flexShrink={0} {...(props.onOpen ? { onMouseDown: () => props.onOpen!(child.childId) } : {})}>
              <Line segments={[
                '     ',
                isActiveChildRun(child) ? seg.brand(activityFrame('subagent', props.frame)) : child.status === 'failed' ? seg.danger('✗') : seg.success('✓'),
                ' ', sanitizeTerminalText(child.profileName || child.profile || 'agent'),
                seg.muted(` · ${description()}`),
                childMetrics(child) ? seg.faint(` · ${childMetrics(child)}`) : undefined,
                seg.muted(' · '), statusSeg(child)
              ]} />
              <Show
                when={isActiveChildRun(child) && child.activity}
                fallback={
                  <Index each={preview() ? previewLines(preview()!, props.expanded ? 6 : isActiveChildRun(child) ? 1 : 0) : []}>
                    {(line) => <Line segments={[seg.faint(`       ${line()}`)]} />}
                  </Index>
                }
              >
                <Line segments={[
                  '       ',
                  seg.brand(activityFrame(childActivityVisualKind(child), props.frame)),
                  seg.muted(` ${sanitizeTerminalText(child.activity!.label)}`),
                  seg.faint(` · ${elapsedDuration(child.activity!.startedAt, undefined, true)}`)
                ]} />
              </Show>
            </box>
          )
        }}
      </For>
      <Show when={props.hint}>
        <Line segments={[seg.faint('     click an agent to open it · /subagents · ctrl+b background')]} />
      </Show>
    </box>
  )
}

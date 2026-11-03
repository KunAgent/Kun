import type { RGBA } from '@opentui/core'
import { createMemo, Show, type JSX } from 'solid-js'
import { activityFrame, type ActivityVisualKind } from '../../activity.js'
import { describeActivity, describeGraphProgress, sanitizeTerminalText, type ActivityDescription } from '../../chat-format.js'
import type { TuiKeyAction } from '../../keymap.js'
import { cellWidth } from '../../layout.js'
import { formatGoalDuration } from '../../render-utils.js'
import { useApp } from '../context.js'
import type { KunTheme } from '../theme.js'
import { seg, SplitRow, type SegInput } from '../ui.js'

/** Kun's activity glyphs: thinking in the thinking color, waiting in orange. */
export function activityColor(theme: KunTheme, kind: ActivityVisualKind): RGBA {
  if (kind === 'thinking') return theme.think
  if (kind === 'attention' || kind === 'retrying') return theme.warning
  return theme.brand
}

function segmentsWidth(segments: readonly SegInput[]): number {
  return segments.reduce((sum, segment) => sum + (segment ? cellWidth(typeof segment === 'string' ? segment : segment.text) : 0), 0)
}

function joinSegments(parts: SegInput[][], separator: SegInput): SegInput[] {
  return parts.flatMap((part, index) => (index === 0 ? part : [separator, ...part]))
}

const LEADER_LABELS: Partial<Record<TuiKeyAction, string>> = {
  session_new: 'new', session_list: 'sessions', session_timeline: 'timeline',
  session_compact: 'compact', session_export: 'export', session_status: 'status',
  messages_copy: 'copy', model_list: 'models', agent_list: 'mode', sidebar_toggle: 'sidebar',
  pointer_mode_toggle: 'mouse', session_undo: 'undo', session_redo: 'redo', app_exit: 'quit'
}

/**
 * The row under the prompt: what Kun is doing (or the latest notice) on the
 * left, Leader choices or the three everyday keys on the right.
 */
export function PromptFooter(props: { home?: boolean }): JSX.Element {
  const app = useApp()
  const activity = createMemo(() => {
    app.tick()
    return describeActivity(app.session.state, app.controller, app.width(), app.session.transientHint)
  })
  const noticeSegments = (notice: ActivityDescription['notice']): SegInput[] => {
    if (!notice) return []
    if (notice.kind === 'hint') return [seg.warning(` ! ${notice.message}`)]
    return notice.kind === 'error' ? [seg.danger(` ! ${notice.message}`)] : [seg.success(' ✓ '), seg.muted(notice.message)]
  }
  const left = (): SegInput[] => {
    const value = activity()
    if (value?.active) {
      const glyph = activityFrame(value.visualKind, app.session.animationFrame)
      return [
        ' ', seg.color(glyph, activityColor(app.theme(), value.visualKind)),
        seg.muted(` ${value.text.charAt(0).toLowerCase()}${value.text.slice(1)} ${value.elapsed}`),
        // A notice that arrives mid-turn takes the place of the interrupt key.
        ...(value.notice ? ['  ', ...noticeSegments(value.notice)] : ['   esc', seg.muted(' interrupt')])
      ]
    }
    if (value?.notice) return noticeSegments(value.notice)
    return props.home ? [] : [seg.faint(' enter send · ctrl+j newline')]
  }
  const right = createMemo((): SegInput[] => {
    app.tick()
    const keymap = app.session.keymap
    const width = app.width()
    const key = (name: string, label: string): SegInput[] => [name, seg.muted(` ${label}`)]
    const leader = app.session.leaderHint
    if (leader) {
      const entries = leader.filter((entry) => LEADER_LABELS[entry.action]).slice(0, width >= 110 ? 9 : width >= 70 ? 5 : 2)
      return [seg.warning('leader', { bold: true }), '  ', ...joinSegments(entries.map((entry) => key(entry.key.toLowerCase(), LEADER_LABELS[entry.action]!)), '   ')]
    }
    // Hints in priority order, kept only while they fit beside the status.
    const candidates: SegInput[][] = [
      key(keymap.display('command_list').toLowerCase(), 'commands'),
      key('tab', 'modes'),
      ...(props.home ? [] : [key(keymap.display('session_list').toLowerCase(), 'sessions')]),
      key(keymap.display('variant_cycle').toLowerCase(), 'effort')
    ]
    let budget = width - segmentsWidth(left()) - 3
    const kept: SegInput[][] = []
    for (const candidate of candidates) {
      const cost = segmentsWidth(candidate) + (kept.length ? 3 : 0)
      if (cost > budget) break
      kept.push(candidate)
      budget -= cost
    }
    return kept.length ? [...joinSegments([...kept].reverse(), '   '), ' '] : []
  })
  return <SplitRow left={left()} right={right()} />
}

/**
 * Goal and Graph ribbons above the prompt: the goal's objective with its time,
 * or the Graph run's acceptance progress. Clicking the Graph ribbon opens it.
 */
export function ModeRibbon(): JSX.Element {
  const app = useApp()
  const view = createMemo(() => {
    app.tick()
    const state = app.session.state
    const graph = describeGraphProgress(state)
    if (graph) return { kind: 'graph' as const, graph }
    const goal = state.projection?.thread.goal
    if (goal && goal.status !== 'complete') return { kind: 'goal' as const, goal }
    return undefined
  })
  return (
    <Show when={view()}>
      <Show
        when={view()!.kind === 'graph'}
        fallback={(() => {
          const goal = () => (view() as Extract<ReturnType<typeof view>, { kind: 'goal' }>).goal
          return (
            <box flexShrink={0} backgroundColor={app.theme().goalBg}>
              <SplitRow
                left={[seg.success(' ◎ Goal ', { bold: true }), `  ${sanitizeTerminalText(goal().objective)}`]}
                right={[seg.muted(`${sanitizeTerminalText(goal().status)} · ${formatGoalDuration(goal().timeUsedSeconds)} · /goal `)]}
              />
            </box>
          )
        })()}
      >
        {(() => {
          const graph = () => (view() as Extract<ReturnType<typeof view>, { kind: 'graph' }>).graph
          return (
            <box flexShrink={0} backgroundColor={app.theme().graphBg} onMouseDown={() => app.session.handleLiveClick({ kind: 'graph' })}>
              <SplitRow
                left={[seg.warning(' ⬡ Graph ', { bold: true }), `  ${graph().title}`]}
                right={[seg.muted(`${graph().accepted}/${graph().total} accepted · ${graph().activeAgents} agents · `), { text: graph().status, tone: graph().tone }, ' ']}
              />
            </box>
          )
        })()}
      </Show>
    </Show>
  )
}

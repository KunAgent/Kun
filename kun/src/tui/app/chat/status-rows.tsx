import { createMemo, Show, type JSX } from 'solid-js'
import { activityFrame } from '../../activity.js'
import {
  currentWorkspace,
  describeActivity,
  describeGraphProgress,
  displayWorkspace,
  sanitizeTerminalText,
  type StatusTone
} from '../../chat-format.js'
import type { TuiKeyAction } from '../../keymap.js'
import { useApp } from '../context.js'
import type { ToneName } from '../theme.js'
import { seg, SplitRow, type SegInput } from '../ui.js'

const toneOf = (value: StatusTone): ToneName => value

function joinSegments(parts: SegInput[][], separator: SegInput): SegInput[] {
  return parts.flatMap((part, index) => (index === 0 ? part : [separator, ...part]))
}

export function ActivityRow(): JSX.Element {
  const app = useApp()
  const activity = createMemo(() => {
    app.tick()
    return describeActivity(app.session.state, app.controller, app.width(), app.session.transientHint)
  })
  const left = (): SegInput[] => {
    const value = activity()!
    if (value.active) {
      const glyph = activityFrame(value.visualKind, app.session.animationFrame)
      const attention = value.visualKind === 'attention' || value.visualKind === 'retrying'
      return [' ', attention ? seg.warning(glyph) : seg.focus(glyph), ' ', seg.bold(value.text), ' ', seg.muted(value.elapsed)]
    }
    const notice = value.notice
    if (!notice) return [seg.muted(' Enter send · Ctrl+J newline')]
    if (notice.kind === 'hint') return [seg.warning(` ! ${notice.message}`)]
    return notice.kind === 'error' ? [seg.danger(` ! ${notice.message}`)] : [seg.success(` ✓ ${notice.message}`)]
  }
  const right = (): SegInput[] => joinSegments(activity()!.right.map((part) => [{ text: part.text, tone: toneOf(part.tone) }]), seg.muted(' · '))
  return (
    <Show when={activity()}>
      <SplitRow left={left()} right={right()} />
    </Show>
  )
}

export function GraphProgressRow(props: { onClick?: () => void }): JSX.Element {
  const app = useApp()
  const progress = createMemo(() => {
    app.tick()
    return describeGraphProgress(app.session.state)
  })
  const status = (): SegInput => ({ text: progress()!.status, tone: toneOf(progress()!.tone) })
  return (
    <Show when={progress()}>
      <SplitRow
        {...(props.onClick ? { onMouseDown: props.onClick } : {})}
        left={app.width() < 64
          ? [' ', seg.accent('GRAPH', { bold: true }), '  ', status()]
          : [' ', seg.accent('GRAPH', { bold: true }), '  ', progress()!.title]}
        right={app.width() < 64
          ? [seg.muted('/graph status')]
          : joinSegments([
              [seg.muted('/graph status')],
              [`${progress()!.accepted}/${progress()!.total} accepted`],
              [`${progress()!.activeAgents} agents`],
              ...(app.width() >= 96 ? [[`r${progress()!.revision}`]] : []),
              [status()]
            ], seg.muted(' · '))}
      />
    </Show>
  )
}

const LEADER_LABELS: Partial<Record<TuiKeyAction, string>> = {
  session_new: 'new', session_list: 'sessions', session_timeline: 'timeline',
  session_compact: 'compact', session_export: 'export', session_status: 'status',
  messages_copy: 'copy', model_list: 'models', agent_list: 'mode', sidebar_toggle: 'sidebar',
  pointer_mode_toggle: 'mouse', session_undo: 'undo', session_redo: 'redo', app_exit: 'quit'
}

/**
 * Bottom status bar: workspace and connection on the left; Leader choices
 * while a Leader sequence is pending, otherwise the main shortcuts.
 */
export function StatusFooter(props: { home?: boolean }): JSX.Element {
  const app = useApp()
  const left = createMemo((): SegInput[] => {
    app.tick()
    const state = app.session.state
    const workspace = displayWorkspace(currentWorkspace(state, app.controller))
    const connection = state.connection === 'connected'
      ? []
      : [seg.muted(' · '), state.connection === 'disconnected' ? seg.danger(state.connection) : seg.warning(state.connection)]
    return [' ', seg.muted(workspace), ...connection]
  })
  const right = createMemo((): SegInput[] => {
    app.tick()
    const session = app.session
    const keymap = session.keymap
    const width = app.width()
    const action = (key: string, label: string): SegInput[] => [seg.focus(key, { bold: true }), ' ', seg.muted(label)]
    const leader = session.leaderHint
    if (leader) {
      const entries = leader.filter((entry) => LEADER_LABELS[entry.action]).slice(0, width >= 110 ? 9 : width >= 70 ? 5 : 2)
      return [seg.warning('Leader', { bold: true }), '  ', ...joinSegments(entries.map((entry) => action(entry.key, LEADER_LABELS[entry.action]!)), seg.muted(' · ')), ' ']
    }
    if (props.home) {
      return [seg.muted(`Kun ${sanitizeTerminalText(app.controller.runtime.runtimeInfo.serviceVersion)}`), ' ']
    }
    const parts: SegInput[][] = [action(keymap.display('command_list'), 'commands')]
    if (width >= 70) parts.push(action(keymap.display('sidebar_toggle'), 'sidebar'))
    if (width >= 96) parts.push(action(keymap.display('tool_details_toggle'), 'details'))
    if (!session.pointerMode && width >= 84) parts.push([seg.warning('mouse off')])
    return [...joinSegments(parts, seg.muted(' · ')), ' ']
  })
  return <SplitRow left={left()} right={right()} />
}

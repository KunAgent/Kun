import { createMemo, Show, type JSX } from 'solid-js'
import { activityFrame } from '../../activity.js'
import {
  currentMode,
  currentModel,
  currentWorkspace,
  describeActivity,
  describeGraphProgress,
  displayWorkspace,
  imagePasteShortcutLabel,
  sanitizeTerminalText,
  type StatusTone
} from '../../chat-format.js'
import type { TuiKeyAction } from '../../keymap.js'
import { useApp } from '../context.js'
import type { ToneName } from '../theme.js'
import { Line, seg, SplitRow, type SegInput } from '../ui.js'

const toneOf = (value: StatusTone): ToneName => value

function joinSegments(parts: SegInput[][], separator: SegInput): SegInput[] {
  return parts.flatMap((part, index) => (index === 0 ? part : [separator, ...part]))
}

export function Welcome(props: { compact: boolean }): JSX.Element {
  const app = useApp()
  const view = createMemo(() => {
    app.tick()
    const state = app.session.state
    const controller = app.controller
    const effort = state.reasoningEffort ?? 'default'
    return {
      workspace: displayWorkspace(currentWorkspace(state, controller)),
      model: currentModel(state, controller),
      mode: `${currentMode(state)} · ${effort}`,
      version: sanitizeTerminalText(controller.runtime.runtimeInfo.serviceVersion),
      threads: state.threads.length,
      connection: state.connection
    }
  })
  const narrow = () => app.width() < 60
  const inner = () => Math.max(20, Math.min(app.width() - (app.width() >= 36 ? 4 : 0), 76))
  const command = (key: string, label: string): SegInput[] => [' ', seg.focus('›'), ' ', seg.bold(key), ' ', seg.muted(label)]
  return (
    <box flexDirection="column" flexShrink={0} alignItems="center" width="100%">
      <box flexDirection="column" flexShrink={0} width={inner()}>
        <SplitRow
          width={inner()}
          left={[' ', seg.brand('KUN', { bold: true }), '  ', seg.muted(view().workspace)]}
          right={view().connection === 'connected'
            ? []
            : [view().connection === 'disconnected' ? seg.danger('disconnected') : seg.warning(view().connection)]}
        />
        <Show when={!props.compact}><box height={1} /></Show>
        <Line segments={[' ', seg.brand('Welcome to Kun', { bold: true })]} />
        <Show when={!props.compact}>
          <Line segments={[' ', seg.muted('A focused terminal agent that keeps working with you.')]} />
        </Show>
        <box height={1} />
        <Show
          when={!narrow()}
          fallback={
            <>
              <Line segments={[' ', seg.muted('Workspace'), `  ${view().workspace}`]} />
              <Line segments={[' ', seg.muted('Model'), `      ${view().model}`]} />
              <Line segments={[' ', seg.muted('Mode'), `       ${view().mode}`]} />
            </>
          }
        >
          <SplitRow width={inner()} left={[' ', seg.muted('Workspace'), `  ${view().workspace}`]} right={[seg.muted('Model'), `  ${view().model}`]} />
          <SplitRow width={inner()} left={[' ', seg.muted('Mode'), `       ${view().mode}`]} right={[seg.muted('Version'), `  ${view().version}`]} />
        </Show>
        <box height={1} />
        <Line segments={command('Type a task', 'and press Enter')} maxWidth={inner()} />
        <Line segments={command('/graph <requirement>', 'start or steer a Graph run')} maxWidth={inner()} />
        <Line segments={command('/connect', 'add or manage a provider')} maxWidth={inner()} />
        <Line segments={command('/sessions', view().threads ? `resume previous work · ${view().threads} saved` : 'resume previous work')} maxWidth={inner()} />
        <Line segments={command(imagePasteShortcutLabel(), 'paste a screenshot · /paste also works')} maxWidth={inner()} />
      </box>
    </box>
  )
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
  messages_copy: 'copy', model_list: 'models', agent_list: 'mode',
  pointer_mode_toggle: 'pointer', session_undo: 'undo', session_redo: 'redo', app_exit: 'quit'
}

export function ShortcutFooter(): JSX.Element {
  const app = useApp()
  const segments = createMemo((): SegInput[] => {
    app.tick()
    const session = app.session
    const keymap = session.keymap
    const width = app.width()
    const action = (key: string, label: string): SegInput[] => [seg.focus(key, { bold: true }), ' ', seg.muted(label)]
    const leader = session.leaderHint
    if (leader) {
      const entries = leader.filter((entry) => LEADER_LABELS[entry.action]).slice(0, width >= 94 ? 11 : width >= 54 ? 6 : 3)
      return [' ', seg.warning('Leader', { bold: true }), '  ', ...joinSegments(entries.map((entry) => action(entry.key, LEADER_LABELS[entry.action]!)), seg.muted('  ·  '))]
    }
    if (session.pointerMode) {
      const running = Boolean(session.state.projection?.runningTurnId)
      return [' ', ...joinSegments([
        action(running ? 'Esc' : 'Enter', running ? 'stop' : 'send'),
        ...(running && width >= 54 ? [action(keymap.display('input_steer'), 'steer')] : []),
        ...(session.state.projection?.childRuns.length && width >= 72 ? [action('Click', 'open subagent')] : []),
        ...(width >= 88 ? [action(imagePasteShortcutLabel(), 'image')] : []),
        action(keymap.display('command_list'), 'commands')
      ], seg.muted('  ·  '))]
    }
    return [
      ' ', seg.focus('History', { bold: true }), ' ',
      seg.muted(`scrollback · ${keymap.display('tool_details_toggle')} transcript · ${keymap.display('command_list')} commands · ${keymap.display('pointer_mode_toggle')} clicks`)
    ]
  })
  return <Line segments={segments()} maxWidth={app.width()} />
}

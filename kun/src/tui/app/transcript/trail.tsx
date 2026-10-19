import type { JSX } from 'solid-js'
import { formatDurationMs } from '../../render-utils.js'
import { sanitizeTerminalText } from '../../safe-text.js'
import type { TranscriptEntry } from '../../transcript-model.js'
import { workTrailLabel } from '../../transcript-trail.js'
import { useApp } from '../context.js'
import { Line, seg, SplitRow } from '../ui.js'

/**
 * "▸ Worked 38s · read 4 · edit 2 · run 1": a finished turn's tool work in
 * one line. A click opens it in place; ctrl+o opens every trail.
 */
export function WorkTrailView(props: {
  entry: Extract<TranscriptEntry, { kind: 'work' }>
  onToggle?: (key: string) => void
}): JSX.Element {
  const app = useApp()
  return (
    <box flexShrink={0} {...(props.onToggle ? { onMouseDown: () => props.onToggle!(props.entry.key) } : {})}>
      <SplitRow
        left={['   ', seg.brand(props.entry.expanded ? '▾ ' : '▸ '), seg.muted(workTrailLabel(props.entry.trail))]}
        right={props.entry.expanded ? [seg.faint(`${app.session.keymap.display('tool_details_toggle').toLowerCase()} all `)] : []}
      />
    </box>
  )
}

/** "◆ Kun · deepseek-v4-flash · 38s" closing a finished turn. */
export function TurnFooterView(props: { entry: Extract<TranscriptEntry, { kind: 'turn-footer' }> }): JSX.Element {
  const outcome = () => props.entry.outcome
  return (
    <Line segments={[
      '   ', seg.brand('◆ '), seg.brand('Kun'),
      props.entry.model ? seg.muted(` · ${sanitizeTerminalText(props.entry.model)}`) : undefined,
      props.entry.durationMs !== undefined ? seg.muted(` · ${formatDurationMs(props.entry.durationMs)}`) : undefined,
      outcome() === 'aborted' ? seg.muted(' · interrupted') : outcome() === 'failed' ? seg.danger(' · failed') : undefined
    ]} />
  )
}

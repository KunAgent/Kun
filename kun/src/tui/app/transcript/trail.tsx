import type { JSX } from 'solid-js'
import { formatDurationMs } from '../../render-utils.js'
import { sanitizeTerminalText } from '../../safe-text.js'
import type { TranscriptEntry } from '../../transcript-model.js'
import { workTrailLabel } from '../../transcript-trail.js'
import { turnTimingParts } from '../../turn-timing.js'
import { useApp } from '../context.js'
import { Line, seg, SplitRow, type SegInput } from '../ui.js'

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

/**
 * "◆ Kun · deepseek-v4-flash · 38s · TTFT 0.6s · 52.4 tok/s" closing a
 * finished turn. Timing is the turn's average over its model calls.
 */
export function TurnFooterView(props: { entry: Extract<TranscriptEntry, { kind: 'turn-footer' }> }): JSX.Element {
  const outcome = () => props.entry.outcome
  const timing = (): SegInput[] => turnTimingParts(props.entry.timing).flatMap((part) => [
    seg.faint(part.label ? ` · ${part.label} ` : ' · '),
    seg.muted(part.value),
    part.unit ? seg.faint(` ${part.unit}`) : undefined
  ])
  return (
    <Line segments={[
      '   ', seg.brand('◆ '), seg.brand('Kun'),
      props.entry.model ? seg.muted(` · ${sanitizeTerminalText(props.entry.model)}`) : undefined,
      props.entry.durationMs !== undefined ? seg.muted(` · ${formatDurationMs(props.entry.durationMs)}`) : undefined,
      ...timing(),
      outcome() === 'aborted' ? seg.muted(' · interrupted') : outcome() === 'failed' ? seg.danger(' · failed') : undefined
    ]} />
  )
}

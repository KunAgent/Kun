import type { ReactElement } from 'react'
import { Server, SquareTerminal, TerminalSquare } from 'lucide-react'
import { AgentIcon } from '../agent-icon'
import type { TerminalTarget } from './terminal-backend'
import type { TerminalStatusDot } from './terminal-dock-model'

/** Kun's diamond mark, shared with the TUI, for Kun's own background shells. */
export function KunMark({ size = 11 }: { size?: number }): ReactElement {
  return (
    <svg className="kun-terminal-kun-mark" viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M12 2.5 21.5 12 12 21.5 2.5 12Z" />
    </svg>
  )
}

export function TerminalTargetIcon({
  target,
  dot,
  size = 15
}: {
  target: TerminalTarget
  dot?: TerminalStatusDot
  size?: number
}): ReactElement {
  return (
    <span className="kun-terminal-icon" style={{ width: size, height: size }}>
      {target.kind === 'kun-process' ? <KunMark size={Math.round(size * 0.74)} />
        : target.kind === 'agent' ? <AgentIcon harnessId={target.harnessId} size={size} />
          : target.kind === 'ssh' ? <Server width={size} height={size} strokeWidth={1.8} aria-hidden="true" />
            : <TerminalSquare width={size} height={size} strokeWidth={1.8} aria-hidden="true" />}
      {dot ? <span className="kun-terminal-dot" data-dot={dot} /> : null}
    </span>
  )
}

/** Icon for an agent catalog entry: harness logo, Kun mark or a terminal. */
export function TerminalAgentEntryIcon({ icon, size = 15 }: { icon: string; size?: number }): ReactElement {
  if (icon === 'kun') return <span className="kun-terminal-tile" style={{ width: size, height: size }}><KunMark size={Math.round(size * 0.6)} /></span>
  if (icon === 'terminal') return <SquareTerminal width={size} height={size} strokeWidth={1.8} aria-hidden="true" />
  return <AgentIcon harnessId={icon} size={size} />
}

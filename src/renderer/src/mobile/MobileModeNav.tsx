import { Briefcase, Code2, MessagesSquare, Radar } from 'lucide-react'
import type { MobileMode } from './navigation/mobile-page'
import './mobile-mode-nav.css'

export type MobileModeNavProps = {
  active: MobileMode
  /** Per-mode attention badge counts; zero/undefined hides the badge. */
  attention: Partial<Record<MobileMode, number>>
  labels: Record<MobileMode, string>
  /** Modes to render; ADE stays opt-in until `agents.kun.ade.enabled`. */
  modes: MobileMode[]
  onSelect: (mode: MobileMode) => void
}

const MODE_ICONS = {
  code: Code2,
  rooms: MessagesSquare,
  work: Briefcase,
  agents: Radar
} as const

/** Product destinations; the parent coordinates Work leave protection. */
export function MobileModeNav({ active, attention, labels, modes, onSelect }: MobileModeNavProps) {
  return <nav className="kun-mobile-mode-nav" aria-label="Workspace mode">
    {modes.map((id) => {
      const Icon = MODE_ICONS[id]
      const count = attention[id] ?? 0
      return <button key={id} type="button" aria-current={active === id ? 'page' : undefined}
        onClick={() => onSelect(id)}>
        <span className="kun-mobile-mode-icon">
          <Icon size={20} aria-hidden />
          {count > 0 ? <span className="kun-mobile-mode-badge"
            aria-label={`${count} ${labels[id]}`}>{Math.min(count, 99)}</span> : null}
        </span>
        <span>{labels[id]}</span>
      </button>
    })}
  </nav>
}

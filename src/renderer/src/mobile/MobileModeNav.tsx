import { Briefcase, Code2, MessagesSquare } from 'lucide-react'
import type { MobileMode } from './navigation/mobile-page'
import './mobile-mode-nav.css'

export type MobileModeNavProps = {
  active: MobileMode
  attentionCount: number
  labels: Record<MobileMode, string>
  onSelect: (mode: MobileMode) => void
}

const MODES = [
  { id: 'code', Icon: Code2 },
  { id: 'rooms', Icon: MessagesSquare },
  { id: 'work', Icon: Briefcase }
] as const

/** Three first-class product destinations; the parent coordinates Work leave protection. */
export function MobileModeNav({ active, attentionCount, labels, onSelect }: MobileModeNavProps) {
  return <nav className="kun-mobile-mode-nav" aria-label="Workspace mode">
    {MODES.map(({ id, Icon }) => <button key={id} type="button" aria-current={active === id ? 'page' : undefined}
      onClick={() => onSelect(id)}>
      <span className="kun-mobile-mode-icon">
        <Icon size={20} aria-hidden />
        {id === 'rooms' && attentionCount > 0 ? <span className="kun-mobile-mode-badge"
          aria-label={`${attentionCount} ${labels.rooms}`}>{Math.min(attentionCount, 99)}</span> : null}
      </span>
      <span>{labels[id]}</span>
    </button>)}
  </nav>
}

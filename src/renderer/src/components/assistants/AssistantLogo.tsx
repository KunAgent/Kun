import type { CSSProperties, ReactElement } from 'react'
import { Cloud } from 'lucide-react'
import { assistantMonogram, assistantPreset } from './assistant-catalog'

/**
 * One assistant's round avatar: its product logo, a custom assistant's fetched icon, or a monogram.
 * The cloud badge marks an external personal assistant; lists and headers show it, messages do not.
 */
export function AssistantLogo({ kind, name, icon, size = 34, badge = false, ring = 'var(--ds-bg-sidebar)' }: {
  kind: string
  name: string
  icon?: string
  size?: number
  badge?: boolean
  /** Colour of the gap around the badge: the surface the avatar sits on. */
  ring?: string
}): ReactElement {
  const preset = assistantPreset(kind)
  const disc: CSSProperties = { width: size, height: size }
  let content: ReactElement
  if (preset?.frame === 'cover') {
    content = <img src={preset.logo} alt="" draggable={false} className="h-full w-full object-cover" />
  } else if (preset || icon) {
    const scale = preset?.scale ?? 0.72
    content = <img src={preset?.logo ?? icon} alt="" draggable={false} className="object-contain"
      style={{ width: Math.round(size * scale), height: Math.round(size * scale) }} />
  } else {
    const monogram = assistantMonogram(name)
    disc.background = monogram.background
    disc.color = monogram.ink
    content = <span style={{ fontSize: Math.round(size * 0.42) }} className="font-semibold leading-none">{monogram.initial}</span>
  }
  const framed = preset?.frame === 'cover' ? 'bg-black ring-1 ring-inset ring-black/10'
    : preset || icon ? 'bg-white ring-1 ring-inset ring-[#e1e6ee]' : ''
  const badgeSize = Math.max(12, Math.round(size * 0.46))
  return <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}
    role="img" aria-label={preset ? `${name} · ${preset.name}` : name}>
    <span className={`flex items-center justify-center overflow-hidden rounded-full ${framed}`} style={disc}>{content}</span>
    {badge ? <span className="absolute grid place-items-center rounded-full bg-white text-[#4f5868] shadow-[0_1px_2px_rgba(15,23,42,0.18)]"
      style={{ width: badgeSize, height: badgeSize, right: -Math.round(badgeSize * 0.25), bottom: -Math.round(badgeSize * 0.2), boxShadow: `0 0 0 1.5px ${ring}, 0 1px 2px rgba(15,23,42,0.18)` }}>
      <Cloud size={Math.round(badgeSize * 0.62)} strokeWidth={2.4} aria-hidden="true" />
    </span> : null}
  </span>
}

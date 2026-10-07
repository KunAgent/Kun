import type { ReactElement } from 'react'
import { Image as ImageIcon, Type as TypeIcon } from 'lucide-react'

export function ModelCapabilityBadge({
  kind,
  label
}: {
  kind: 'vision' | 'text'
  label: string
}): ReactElement {
  const tone = kind === 'vision'
    ? 'border-emerald-300/70 bg-emerald-50 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:text-emerald-300'
    : 'border-ds-border bg-ds-hover text-ds-muted'
  const Icon = kind === 'vision' ? ImageIcon : TypeIcon
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 text-[10.5px] font-semibold leading-none ${tone}`}
      title={label}
    >
      <Icon className="h-3 w-3" strokeWidth={1.9} />
      <span>{label}</span>
    </span>
  )
}

import type { ReactElement, ReactNode } from 'react'
import { Pin, PinOff, SlidersHorizontal } from 'lucide-react'
import { useCanvasMotionStore } from '../../../../design/motion/canvas-motion-store'

export function propertiesPanelShellClass(surface: 'design' | 'code'): string {
  return surface === 'code'
    ? 'ds-no-drag absolute bottom-[92px] right-[64px] top-[60px] z-40 flex w-[236px] max-w-[calc(100%-80px)] flex-col overflow-hidden rounded-[14px] border border-ds-border-muted bg-white/88 text-[12px] text-ds-ink shadow-[0_14px_34px_rgba(20,47,95,0.11)] backdrop-blur-2xl dark:bg-ds-canvas/90'
    : 'ds-no-drag absolute bottom-[104px] right-[76px] top-[72px] z-40 flex w-[252px] flex-col overflow-hidden rounded-[18px] border border-ds-border-muted bg-white/82 text-[12px] text-ds-ink shadow-[0_18px_48px_rgba(20,47,95,0.12)] backdrop-blur-2xl dark:bg-ds-canvas/88 max-lg:bottom-[116px] max-lg:top-[76px]'
}

export function propertiesPanelTriggerClass(surface: 'design' | 'code'): string {
  return surface === 'code'
    ? 'ds-no-drag absolute right-[64px] top-[60px] z-40 inline-flex h-9 max-w-[calc(100%-80px)] items-center gap-2 rounded-full border border-ds-border-muted bg-white/88 px-3 text-[12px] font-medium text-ds-muted shadow-[0_10px_28px_rgba(20,47,95,0.1)] backdrop-blur-2xl transition hover:bg-white hover:text-ds-ink dark:bg-ds-canvas/90 dark:hover:bg-ds-canvas'
    : 'ds-no-drag absolute right-[76px] top-[72px] z-40 inline-flex h-9 items-center gap-2 rounded-full border border-ds-border-muted bg-white/82 px-3 text-[12px] font-medium text-ds-muted shadow-[0_12px_32px_rgba(20,47,95,0.11)] backdrop-blur-2xl transition hover:bg-white/95 hover:text-ds-ink dark:bg-ds-canvas/88 dark:hover:bg-ds-canvas max-lg:top-[76px]'
}

export function PropertiesPanelTrigger({
  count,
  label,
  surface,
  onOpen
}: {
  count: number
  label: string
  surface: 'design' | 'code'
  onOpen: () => void
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={propertiesPanelTriggerClass(surface)}
      title={label}
      aria-label={label}
      data-canvas-inspector-trigger={surface}
    >
      <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
      <span className="min-w-0 truncate">
        {label}
        {count > 1 ? <span className="ml-1 text-ds-faint">· {count}</span> : null}
      </span>
    </button>
  )
}

export function PropertiesPanelShell({
  children,
  count,
  pinned,
  pinLabel,
  surface,
  title,
  unpinLabel,
  onTogglePinned
}: {
  children: ReactNode
  count: number
  pinned: boolean
  pinLabel: string
  surface: 'design' | 'code'
  title: string
  unpinLabel: string
  onTogglePinned: () => void
}): ReactElement {
  const motionOpen = useCanvasMotionStore((state) => state.open)
  return (
    <aside
      className={propertiesPanelShellClass(surface)}
      data-canvas-inspector-surface={surface}
      style={surface === 'design' && motionOpen ? { bottom: 274 } : undefined}
    >
      <div className="flex h-9 shrink-0 items-center justify-between px-4">
        <span className="select-none text-[11px] font-medium uppercase tracking-[0.1em] text-ds-faint">
          {title}
          {count > 1 ? (
            <span className="ml-1 normal-case tracking-normal text-ds-faint">· {count}</span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={onTogglePinned}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] transition ${
            pinned ? 'text-accent' : 'text-ds-faint hover:bg-ds-hover hover:text-ds-ink'
          }`}
          title={pinned ? unpinLabel : pinLabel}
          aria-label={pinned ? unpinLabel : pinLabel}
        >
          {pinned ? (
            <PinOff className="h-3.5 w-3.5" strokeWidth={1.8} />
          ) : (
            <Pin className="h-3.5 w-3.5" strokeWidth={1.8} />
          )}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
    </aside>
  )
}

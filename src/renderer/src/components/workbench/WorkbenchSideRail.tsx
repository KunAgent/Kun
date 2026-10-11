import type { HTMLAttributes, ReactNode } from 'react'

const BUTTON_BASE =
  'ds-side-rail-button inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint/30 [&>svg]:h-[18px] [&>svg]:w-[18px] [&>img]:h-[18px] [&>img]:w-[18px]'
const BUTTON_ACTIVE = 'ds-side-rail-button-active bg-accent-soft text-accent'
const BUTTON_IDLE = 'bg-transparent text-ds-muted hover:bg-ds-hover hover:text-ds-ink'

export function sideRailButtonClass(active: boolean, extra?: string): string {
  return `${BUTTON_BASE} ${active ? BUTTON_ACTIVE : BUTTON_IDLE}${extra ? ` ${extra}` : ''}`
}

/** A short rule between rail groups. */
export function WorkbenchSideRailDivider({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`ds-side-rail-divider my-1 h-px w-5 shrink-0 bg-ds-border ${className}`} />
}

export function WorkbenchSideRailSurface({ children, className = '', ...props }:
  HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return <div {...props}
    className={`ds-workbench-side-rail ds-sidebar-surface ds-no-drag flex h-full w-[52px] shrink-0 flex-col items-center gap-1 border-l border-ds-border-muted py-3 ${className}`}>
    {children}
  </div>
}

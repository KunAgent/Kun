import type { HTMLAttributes, ReactNode } from 'react'

const BUTTON_BASE =
  'ds-side-rail-button inline-flex h-8 w-8 items-center justify-center rounded-[var(--ds-radius-control)] border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30'
const BUTTON_ACTIVE = 'border-ds-border-strong bg-ds-card text-ds-ink'
const BUTTON_IDLE =
  'border-transparent bg-transparent text-ds-faint opacity-90 hover:border-ds-border-muted hover:bg-ds-hover hover:text-ds-ink hover:opacity-100'

export function sideRailButtonClass(active: boolean, extra?: string): string {
  return `${BUTTON_BASE} ${active ? BUTTON_ACTIVE : BUTTON_IDLE}${extra ? ` ${extra}` : ''}`
}

export function WorkbenchSideRailSurface({ children, className = '', ...props }:
  HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return <div {...props}
    className={`ds-workbench-side-rail ds-sidebar-surface ds-no-drag flex h-full w-12 shrink-0 flex-col items-center gap-1.5 border-l border-ds-border-muted py-3 ${className}`}>
    {children}
  </div>
}

/**
 * Borderless header actions shared by the Code top bar and the task header,
 * so every icon in that row has one size, weight and hover treatment.
 */
export const HEADER_ICON_BUTTON_CLASS =
  'ds-topbar-action-button inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--ds-radius-control)] border border-transparent bg-transparent text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint/30 disabled:cursor-not-allowed disabled:opacity-40'

/** Icon plus short label, for header actions that need a word (Trace, draft). */
export function headerTextButtonClass(pressed = false): string {
  return `ds-header-text-button ds-no-drag relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--ds-radius-control)] px-2.5 text-[12.5px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint/30 ${
    pressed ? 'bg-ds-hover text-ds-ink' : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
  }`
}

export const HEADER_ICON_CLASS = 'h-4 w-4 shrink-0'
export const HEADER_ICON_STROKE = 1.75

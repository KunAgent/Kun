/** Severity of one dock card; it drives the icon, color and announcement role. */
export type ToastTone = 'running' | 'success' | 'info' | 'warning' | 'error'

export type ToastAction = {
  label: string
  run: () => void
  /** Keyboard hint rendered after the label, e.g. "⌘Z". */
  shortcut?: string
}

export type ToastProgress = {
  /** 0-100; omitted renders an indeterminate bar. */
  percent?: number
  /** Accessible name for the progressbar. */
  label: string
  /** Left side of the meta line, e.g. "128 / 200 MB". */
  detail?: string
  /** Right side of the meta line; falls back to the rounded percentage. */
  trailing?: string
}

export type ToastInput = {
  /** Stable identity: republishing the same id updates the card in place. */
  id: string
  tone: ToastTone
  title: string
  description?: string
  /** Short counter next to the title, e.g. "1 / 3". */
  badge?: string
  progress?: ToastProgress
  actions?: ToastAction[]
  /** Auto-dismiss delay; null keeps the card until the user dismisses it. */
  durationMs?: number | null
  /** Epoch ms of a running job; the card ticks an elapsed suffix while set. */
  since?: number
  /** Runs whenever the card leaves the dock, including auto-dismissal. */
  onDismiss?: () => void
}

export type ToastItem = Required<Pick<ToastInput, 'id' | 'tone' | 'title'>> &
  Omit<ToastInput, 'id' | 'tone' | 'title' | 'durationMs'> & {
    /** Insertion order; the dock renders oldest first so new cards land last. */
    sequence: number
    durationMs: number | null
    /** Time left before auto-dismiss; null when the card never expires. */
    remainingMs: number | null
    /** Epoch ms the countdown ends; null while paused or while waiting. */
    expiresAt: number | null
    paused: boolean
    /** Fields that decide whether a republish changes the card at all. */
    signature: string
  }

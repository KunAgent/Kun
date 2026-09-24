/**
 * Hover-intent state machine for the block handle's grip menu (§9.3).
 *
 * States: closed → opening (armed by trigger hover) → open-hover (opened by
 * hover, auto-closes when both trigger and menu are left) → open-pinned
 * (clicked open or promoted from open-hover, never auto-closes).
 *
 * All timing lives here so the handle stays a thin event adapter and the
 * behavior is testable with fake timers.
 */
export type HoverIntent = {
  /** Pointer entered the grip. Arms the open timer. */
  enterTrigger: () => void
  /** Pointer left the grip. Cancels a pending open; schedules close when open-hover. */
  leaveTrigger: () => void
  /** Pointer entered the menu DOM. Cancels a pending close. */
  enterMenu: () => void
  /** Pointer left the menu DOM. Schedules close when open-hover. */
  leaveMenu: () => void
  /** Promote an open-hover menu to pinned (click while hovering). */
  pin: () => void
  /** Open immediately in pinned mode (grip click). */
  openNow: () => void
  /** True while the menu is open in either mode. */
  isOpen: () => boolean
  /** Close immediately regardless of state. */
  closeNow: () => void
  /** Clear all pending timers. */
  dispose: () => void
}

export function createHoverIntent(opts: {
  openDelay: number
  closeDelay: number
  /** `pinned` is true for click/long-press opens and false for hover opens. */
  onOpen: (pinned: boolean) => void
  onClose: () => void
}): HoverIntent {
  type State = 'closed' | 'opening' | 'open-hover' | 'open-pinned'
  let state: State = 'closed'
  let openTimer: ReturnType<typeof setTimeout> | null = null
  let closeTimer: ReturnType<typeof setTimeout> | null = null

  const clearOpen = (): void => {
    if (openTimer !== null) {
      clearTimeout(openTimer)
      openTimer = null
    }
  }
  const clearClose = (): void => {
    if (closeTimer !== null) {
      clearTimeout(closeTimer)
      closeTimer = null
    }
  }
  const open = (pinned: boolean): void => {
    clearOpen()
    clearClose()
    if (state === 'closed' || state === 'opening') {
      state = pinned ? 'open-pinned' : 'open-hover'
      opts.onOpen(pinned)
    } else if (pinned) {
      state = 'open-pinned'
    }
  }
  const scheduleClose = (): void => {
    if (state !== 'open-hover' || closeTimer !== null) return
    closeTimer = setTimeout(() => {
      closeTimer = null
      if (state === 'open-hover') {
        state = 'closed'
        opts.onClose()
      }
    }, opts.closeDelay)
  }

  return {
    enterTrigger() {
      if (state !== 'closed') {
        clearClose()
        return
      }
      state = 'opening'
      openTimer = setTimeout(() => {
        openTimer = null
        if (state === 'opening') open(false)
      }, opts.openDelay)
    },
    leaveTrigger() {
      if (state === 'opening') {
        clearOpen()
        state = 'closed'
        return
      }
      scheduleClose()
    },
    enterMenu() {
      clearClose()
    },
    leaveMenu() {
      scheduleClose()
    },
    pin() {
      if (state === 'open-hover') state = 'open-pinned'
    },
    openNow() {
      open(true)
    },
    isOpen() {
      return state === 'open-hover' || state === 'open-pinned'
    },
    closeNow() {
      clearOpen()
      clearClose()
      if (state !== 'closed') {
        state = 'closed'
        opts.onClose()
      }
    },
    dispose() {
      clearOpen()
      clearClose()
      state = 'closed'
    }
  }
}

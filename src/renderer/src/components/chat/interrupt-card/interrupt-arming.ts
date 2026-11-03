import { createContext, useContext } from 'react'

/*
 * Arming: an interrupt card takes the composer's place while the user may be
 * mid-keystroke (typing a follow-up, holding Enter) or mid-click (aiming at
 * the send button, double-clicking the previous approval's choice). Input
 * already in flight must never decide the new request, so every decision
 * input is ignored for a short window after a card appears or switches to a
 * new request: digits, Enter, Space and Esc in the navigation hook, and
 * clicks on option rows and footer buttons in the primitives.
 */

/** How long decision inputs stay disarmed after a card / request appears. */
export const INTERRUPT_ARM_DELAY_MS = 500

/** Timestamp (ms, `Date.now()` clock) from which decision inputs count. */
export function interruptArmDeadline(nowMs: number, delayMs: number = INTERRUPT_ARM_DELAY_MS): number {
  return nowMs + Math.max(0, delayMs)
}

/**
 * Provided by InterruptCard: returns true once the current request is armed.
 * Outside a card (tests, previews) everything counts as armed.
 */
export const InterruptArmingContext = createContext<() => boolean>(() => true)

/** Arming check for decision controls rendered inside an InterruptCard. */
export function useInterruptArmed(): () => boolean {
  return useContext(InterruptArmingContext)
}

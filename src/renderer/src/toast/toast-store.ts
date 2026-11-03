import { create } from 'zustand'
import { defaultToastDurationMs, splitToastWindow, toastSignature } from './toast-queue'
import type { ToastInput, ToastItem } from './toast-types'

type ToastState = {
  /** Cards the dock renders, oldest first. */
  items: ToastItem[]
  /** Persistent cards held back until a visible slot frees up. */
  waitingItems: ToastItem[]
  /** Adds or refreshes a card; an unchanged signature is ignored. */
  publish: (input: ToastInput) => void
  dismiss: (id: string) => void
  /** Freezes the countdown while the pointer or keyboard focus is on a card. */
  pause: (id: string) => void
  resume: (id: string) => void
}

type WindowState = Pick<ToastState, 'items' | 'waitingItems'>

const timers = new Map<string, ReturnType<typeof setTimeout>>()
let nextSequence = 1

function clearTimer(id: string): void {
  const timer = timers.get(id)
  if (timer === undefined) return
  clearTimeout(timer)
  timers.delete(id)
}

function startTimer(id: string, ms: number): void {
  clearTimer(id)
  timers.set(id, setTimeout(() => {
    timers.delete(id)
    useToastStore.getState().dismiss(id)
  }, Math.max(0, ms)))
}

function allItems(state: WindowState): ToastItem[] {
  return [...state.items, ...state.waitingItems]
}

/**
 * Recomputes the visible window and keeps every countdown in sync with it:
 * visible and unpaused cards tick, everything else freezes with the time it
 * has left. Waiting cards start their countdown only once they are shown.
 */
function withWindow(queue: ToastItem[]): WindowState {
  const { visible, waiting } = splitToastWindow(queue)
  const now = Date.now()
  const shown = new Set(visible.map((item) => item.id))
  const tick = (item: ToastItem): ToastItem => {
    const ticking = shown.has(item.id) && !item.paused && item.remainingMs !== null
    if (!ticking) {
      if (item.expiresAt === null) return item
      clearTimer(item.id)
      return { ...item, remainingMs: Math.max(0, item.expiresAt - now), expiresAt: null }
    }
    if (item.expiresAt !== null) return item
    startTimer(item.id, item.remainingMs ?? 0)
    return { ...item, expiresAt: now + (item.remainingMs ?? 0) }
  }
  const bySequence = (left: ToastItem, right: ToastItem): number => left.sequence - right.sequence
  return {
    items: [...visible].sort(bySequence).map(tick),
    waitingItems: [...waiting].sort(bySequence).map(tick)
  }
}

export const useToastStore = create<ToastState>((set, get) => ({
  items: [],
  waitingItems: [],

  publish: (input) => set((state) => {
    const signature = toastSignature(input)
    const queue = allItems(state)
    const index = queue.findIndex((item) => item.id === input.id)
    const durationMs = input.durationMs === undefined
      ? defaultToastDurationMs(input.tone, input.actions)
      : input.durationMs
    if (index < 0) {
      return withWindow([...queue, {
        ...input,
        sequence: nextSequence++,
        durationMs,
        remainingMs: durationMs,
        expiresAt: null,
        paused: false,
        signature
      }])
    }
    const current = queue[index]
    if (current.signature === signature) return state
    // A phase change (running -> success) restarts the countdown with the new
    // duration; progress updates inside one phase keep the clock running.
    const keepClock = current.durationMs === durationMs
    return withWindow(queue.map((item, position) => position !== index ? item : {
      ...item,
      ...input,
      sequence: item.sequence,
      durationMs,
      remainingMs: keepClock ? item.remainingMs : durationMs,
      expiresAt: keepClock ? item.expiresAt : null,
      signature
    }))
  }),

  dismiss: (id) => {
    const target = allItems(get()).find((item) => item.id === id)
    if (!target) return
    clearTimer(id)
    set((state) => withWindow(allItems(state).filter((item) => item.id !== id)))
    target.onDismiss?.()
  },

  pause: (id) => set((state) => {
    if (!allItems(state).some((item) => item.id === id && !item.paused)) return state
    return withWindow(allItems(state).map((item) => item.id === id ? { ...item, paused: true } : item))
  }),

  resume: (id) => set((state) => {
    if (!allItems(state).some((item) => item.id === id && item.paused)) return state
    return withWindow(allItems(state).map((item) => item.id === id ? { ...item, paused: false } : item))
  })
}))

/** Test and teardown helper: forgets every card and pending countdown. */
export function resetToasts(): void {
  for (const id of [...timers.keys()]) clearTimer(id)
  useToastStore.setState({ items: [], waitingItems: [] })
}

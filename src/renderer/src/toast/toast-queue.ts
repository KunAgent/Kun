import type { ToastInput, ToastItem, ToastTone } from './toast-types'

/** The dock never shows more than this many cards at once. */
export const TOAST_MAX_VISIBLE = 3
/** Design rule: plain successes and hints clear themselves after 4s. */
export const TOAST_DEFAULT_MS = 4_000
/** Design rule: anything the user can undo or retry stays long enough to use. */
export const TOAST_ACTION_MS = 12_000

/**
 * Cards that must survive a crowded dock. Work in flight and failures the
 * user still has to act on are never dropped to make room for a success.
 */
export function isToastPersistent(item: ToastItem): boolean {
  return item.durationMs === null || (item.actions?.length ?? 0) > 0
}

export function defaultToastDurationMs(tone: ToastTone, actions: ToastInput['actions']): number | null {
  if (tone === 'running' || tone === 'error') return null
  return actions?.length ? TOAST_ACTION_MS : TOAST_DEFAULT_MS
}

export type ToastWindow = {
  visible: ToastItem[]
  /** Persistent cards held back until a slot frees; they keep their place. */
  waiting: ToastItem[]
}

/**
 * Splits the queue into what the dock shows and what it keeps. Persistent
 * cards claim slots first, so a restart or a failure is never hidden behind
 * disposable successes; transient cards give way to newer transient cards.
 */
export function splitToastWindow(items: ToastItem[], max = TOAST_MAX_VISIBLE): ToastWindow {
  if (items.length <= max) return { visible: items, waiting: [] }
  const persistent = items.filter(isToastPersistent).slice(-max)
  const slots = max - persistent.length
  const transient = slots > 0 ? items.filter((item) => !isToastPersistent(item)).slice(-slots) : []
  const shown = new Set([...persistent, ...transient].map((item) => item.id))
  return {
    visible: items.filter((item) => shown.has(item.id)),
    waiting: items.filter((item) => !shown.has(item.id) && isToastPersistent(item))
  }
}

/**
 * Everything that changes what a card renders. Publishers can rebuild their
 * input object on every render; an unchanged signature is a no-op, so the
 * dismiss countdown is never restarted by a re-render.
 */
export function toastSignature(input: ToastInput): string {
  const actions = (input.actions ?? []).map((action) => `${action.label}=>${action.shortcut ?? ''}`).join('|')
  const progress = input.progress
    ? `${input.progress.label}@${input.progress.percent === undefined ? '?' : Math.round(input.progress.percent)}@${input.progress.detail ?? ''}@${input.progress.trailing ?? ''}`
    : ''
  return [
    input.tone,
    input.title,
    input.description ?? '',
    input.badge ?? '',
    progress,
    actions,
    input.durationMs === undefined ? 'auto' : String(input.durationMs),
    input.since === undefined ? '' : String(input.since)
  ].join('\u0000')
}

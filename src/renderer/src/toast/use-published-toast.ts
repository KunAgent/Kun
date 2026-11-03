import { useEffect, useRef } from 'react'
import { useToastStore } from './toast-store'
import { toastSignature } from './toast-queue'
import type { ToastInput } from './toast-types'

/**
 * Keeps a set of dock cards in sync with whatever a surface already tracks.
 *
 * Publishers rebuild their inputs on every render; a card is only written
 * when its rendered fields change, so a re-render never restarts a dismiss
 * countdown. Ids that disappear from the set are dismissed, which is how a
 * surface reports "this notification no longer applies"; unmounting the
 * publisher removes its cards too.
 */
export function usePublishedToasts(inputs: readonly ToastInput[]): void {
  const publish = useToastStore((state) => state.publish)
  const dismiss = useToastStore((state) => state.dismiss)
  const signature = inputs.map(toastSignature).join('\u0001')
  const latest = useRef(inputs)
  latest.current = inputs
  const published = useRef<readonly string[]>([])

  useEffect(() => {
    const next = latest.current
    const live = new Set(next.map((input) => input.id))
    for (const input of next) publish(input)
    for (const id of published.current) if (!live.has(id)) dismiss(id)
    published.current = [...live]
  }, [dismiss, publish, signature])

  useEffect(() => () => {
    for (const id of published.current) dismiss(id)
  }, [dismiss])
}

/** Single-card convenience wrapper; `null` means "remove my card". */
export function usePublishedToast(input: ToastInput | null): void {
  usePublishedToasts(input ? [input] : [])
}

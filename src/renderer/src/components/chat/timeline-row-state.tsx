import { createContext, useContext, useState, type Dispatch, type SetStateAction } from 'react'

export const TimelineRowStateContext = createContext<Map<string, unknown> | null>(null)

/** Small interaction state survives viewport eviction; the owning list owns its lifetime. */
export function useTimelineRowState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const retained = useContext(TimelineRowStateContext)
  const [value, setValue] = useState<T>(() => retained?.has(key) ? retained.get(key) as T : initial)
  const update: Dispatch<SetStateAction<T>> = (action) => {
    setValue((previous) => {
      const next = typeof action === 'function' ? (action as (value: T) => T)(previous) : action
      retained?.set(key, next)
      return next
    })
  }
  return [value, update]
}

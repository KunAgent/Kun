import { useCallback, useEffect, useState } from 'react'
import type { QuotaDisplayMode } from './quota-view-model'

const MODE_KEY = 'kun.quota.displayMode'
const EXPANDED_KEY = 'kun.quota.expandedProviders'
const MODE_EVENT = 'kun-quota-display-mode'

function readModeState(): { mode: QuotaDisplayMode; explicit: boolean } {
  try {
    const stored = window.localStorage.getItem(MODE_KEY)
    return {
      mode: stored === 'left' ? 'left' : 'used',
      explicit: stored === 'left' || stored === 'used'
    }
  } catch {
    return { mode: 'used', explicit: false }
  }
}

function readExpanded(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(EXPANDED_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/**
 * Used or left: one choice for every meter, in the right panel and the tray
 * popover alike. Each is its own window on the same origin, so a change in
 * one reaches the other through the storage event; the same window hears it
 * through a local event, since storage events skip the window that wrote.
 */
export function useQuotaDisplayMode(): [QuotaDisplayMode, (mode: QuotaDisplayMode) => void] {
  const [state, setModeState] = useState(readModeState)

  useEffect(() => {
    const sync = (): void => {
      const next = readModeState()
      setModeState((prev) =>
        prev.mode === next.mode && prev.explicit === next.explicit ? prev : next
      )
    }
    const onStorage = (event: StorageEvent): void => {
      if (event.key === MODE_KEY) sync()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener(MODE_EVENT, sync)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(MODE_EVENT, sync)
    }
  }, [])

  const setMode = useCallback((next: QuotaDisplayMode): void => {
    setModeState({ mode: next, explicit: true })
    try {
      window.localStorage.setItem(MODE_KEY, next)
    } catch {
      // A blocked store keeps the choice for this window only.
    }
    window.dispatchEvent(new Event(MODE_EVENT))
  }, [])

  return [state.mode, setMode]
}

/** Which providers' cards list every window rather than the first few. */
export function useExpandedQuotaCards(): [Set<string>, (providerId: string) => void] {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(readExpanded()))
  const toggle = useCallback((providerId: string): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(providerId)) next.delete(providerId)
      else next.add(providerId)
      try {
        window.localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]))
      } catch {
        // Not remembered when storage is unavailable.
      }
      return next
    })
  }, [])
  return [expanded, toggle]
}

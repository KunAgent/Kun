import { useEffect, useState } from 'react'
import { APP_LOCALES, type AppLocale } from '@shared/app-locales'

/** Matches the Rooms mobile breakpoint so Remote web reuses the same notion of "phone-sized". */
export const NARROW_VIEWPORT_QUERY = '(max-width: 767px)'

export function isRemoteWeb(): boolean {
  return typeof window !== 'undefined' && window.kunGui?.isRemoteWeb === true
}

/**
 * A Remote client picks its own UI language in browser storage; writing it
 * into the host's global settings would relabel the desktop app too.
 */
export const REMOTE_LOCALE_KEY = 'kun.remote.locale'

export function readRemoteLocaleOverride(): AppLocale | null {
  if (!isRemoteWeb()) return null
  try {
    const value = window.localStorage.getItem(REMOTE_LOCALE_KEY)
    return (APP_LOCALES as readonly string[]).includes(value ?? '') ? (value as AppLocale) : null
  } catch {
    return null
  }
}

export function writeRemoteLocaleOverride(locale: AppLocale): void {
  if (!isRemoteWeb()) return
  try {
    window.localStorage.setItem(REMOTE_LOCALE_KEY, locale)
  } catch {
    // Storage can be blocked in some embeds; the pick still applies live.
  }
}

function narrowQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(NARROW_VIEWPORT_QUERY)
    : null
}

export function isNarrowViewportNow(): boolean {
  return narrowQuery()?.matches ?? false
}

export function useIsNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(isNarrowViewportNow)
  useEffect(() => {
    const query = narrowQuery()
    if (!query) return
    const onChange = (event: MediaQueryListEvent) => setNarrow(event.matches)
    setNarrow(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return narrow
}

/**
 * True only for Remote browser clients on phone-sized viewports. Desktop
 * Electron windows — even when resized small — keep the regular layout.
 */
export function useRemoteMobileLayout(): boolean {
  return useIsNarrowViewport() && isRemoteWeb()
}

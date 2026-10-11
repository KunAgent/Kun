import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { mobilePageUrl, readMobilePage, sameMobilePage, type MobilePage } from './mobile-page'

const HISTORY_INDEX_KEY = '__kunMobileHistoryIndex'

function historyIndex(state: unknown): number | null {
  if (!state || typeof state !== 'object') return null
  const index = (state as Record<string, unknown>)[HISTORY_INDEX_KEY]
  return typeof index === 'number' && Number.isSafeInteger(index) && index >= 0 ? index : null
}

function indexedState(state: unknown, index: number): Record<string, unknown> {
  const original = state && typeof state === 'object' && !Array.isArray(state)
    ? state as Record<string, unknown> : { originalState: state }
  return { ...original, [HISTORY_INDEX_KEY]: index }
}

function currentPage(fallbackMode: MobilePage['mode'] = 'code'): MobilePage {
  if (typeof window === 'undefined') return { mode: fallbackMode, kind: 'home' }
  const url = new URL(window.location.href)
  return !url.searchParams.has('mode') && !url.searchParams.has('mobile')
    ? { mode: fallbackMode, kind: 'home' }
    : readMobilePage(url)
}

export type MobileNavigationGuard = (current: MobilePage, next: MobilePage) => boolean | Promise<boolean>

/** Navigation remains separate from the shared conversation/runtime store. */
export function useMobileNavigation(
  guardRef?: RefObject<MobileNavigationGuard | null>,
  fallbackMode: MobilePage['mode'] = 'code'
): {
  page: MobilePage
  navigate: (page: MobilePage, replace?: boolean) => void
} {
  const [page, setPage] = useState(() => currentPage(fallbackMode))
  const pageRef = useRef(page)
  const historyStateRef = useRef(typeof window === 'undefined' ? null : window.history.state)
  const entryIndexRef = useRef(historyIndex(historyStateRef.current) ?? 0)
  const restoringIndexRef = useRef<number | null>(null)
  const navigationRevisionRef = useRef(0)
  pageRef.current = page
  useEffect(() => {
    if (historyIndex(window.history.state) === null) {
      window.history.replaceState(indexedState(window.history.state, entryIndexRef.current), '', window.location.href)
      historyStateRef.current = window.history.state
    }
    let serial = 0
    const onPopState = (): void => {
      const targetIndex = historyIndex(window.history.state)
      if (restoringIndexRef.current !== null && targetIndex === restoringIndexRef.current) {
        restoringIndexRef.current = null
        historyStateRef.current = window.history.state
        return
      }
      restoringIndexRef.current = null
      const attempt = ++serial
      const revision = navigationRevisionRef.current
      const previous = pageRef.current
      const next = currentPage(fallbackMode)
      void Promise.resolve().then(() => guardRef?.current?.(previous, next) ?? true).catch(() => false).then((allowed) => {
        if (attempt !== serial || revision !== navigationRevisionRef.current) return
        if (allowed) {
          historyStateRef.current = window.history.state
          if (targetIndex !== null) entryIndexRef.current = targetIndex
          pageRef.current = next
          setPage(next)
          return
        }
        const current = new URL(window.location.href)
        if (targetIndex !== null && targetIndex !== entryIndexRef.current) {
          // Restore the original entry in place. This preserves both Back and
          // Forward after an unsaved-work guard rejects the transition.
          restoringIndexRef.current = entryIndexRef.current
          window.history.go(targetIndex < entryIndexRef.current ? 1 : -1)
        } else {
          // An untagged entry may come from another router or an older build.
          window.history.pushState(indexedState(historyStateRef.current, entryIndexRef.current), '',
            mobilePageUrl(current, previous))
        }
      })
    }
    window.addEventListener('popstate', onPopState)
    return () => { serial += 1; window.removeEventListener('popstate', onPopState) }
  }, [fallbackMode, guardRef])

  const navigate = useCallback((next: MobilePage, replace = false): void => {
    const current = new URL(window.location.href)
    const normalized = readMobilePage(new URL(mobilePageUrl(current, next), current))
    const url = mobilePageUrl(current, normalized)
    if (sameMobilePage(currentPage(fallbackMode), normalized)
      && current.pathname + current.search + current.hash === url) return
    navigationRevisionRef.current += 1
    const index = replace ? entryIndexRef.current : entryIndexRef.current + 1
    // Retain unrelated history metadata owned by the application.
    if (replace) window.history.replaceState(indexedState(window.history.state, index), '', url)
    else window.history.pushState(indexedState(window.history.state, index), '', url)
    historyStateRef.current = window.history.state
    entryIndexRef.current = index
    pageRef.current = normalized
    setPage(normalized)
  }, [fallbackMode])

  return { page, navigate }
}

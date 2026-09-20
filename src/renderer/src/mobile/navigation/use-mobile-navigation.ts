import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { mobilePageUrl, readMobilePage, sameMobilePage, type MobilePage } from './mobile-page'

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
  pageRef.current = page
  useEffect(() => {
    let serial = 0
    const onPopState = (): void => {
      const attempt = ++serial
      const previous = pageRef.current
      const next = currentPage(fallbackMode)
      void Promise.resolve(guardRef?.current?.(previous, next) ?? true).then((allowed) => {
        if (attempt !== serial) return
        if (allowed) {
          pageRef.current = next
          setPage(next)
          return
        }
        const current = new URL(window.location.href)
        window.history.replaceState(window.history.state, '', mobilePageUrl(current, previous))
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
    // Retain unrelated history metadata owned by the application.
    if (replace) window.history.replaceState(window.history.state, '', url)
    else window.history.pushState(window.history.state, '', url)
    pageRef.current = normalized
    setPage(normalized)
  }, [fallbackMode])

  return { page, navigate }
}

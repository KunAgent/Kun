import { useCallback, useEffect, useState } from 'react'
import { mobilePageUrl, readMobilePage, sameMobilePage, type MobilePage } from './mobile-page'

function currentPage(): MobilePage {
  return typeof window === 'undefined' ? { mode: 'code', kind: 'home' } : readMobilePage(new URL(window.location.href))
}

/** Navigation remains separate from the shared conversation/runtime store. */
export function useMobileNavigation(): {
  page: MobilePage
  navigate: (page: MobilePage, replace?: boolean) => void
} {
  const [page, setPage] = useState(currentPage)
  useEffect(() => {
    const onPopState = (): void => setPage(currentPage())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = useCallback((next: MobilePage, replace = false): void => {
    const current = new URL(window.location.href)
    const normalized = readMobilePage(new URL(mobilePageUrl(current, next), current))
    const url = mobilePageUrl(current, normalized)
    if (sameMobilePage(currentPage(), normalized)
      && current.pathname + current.search + current.hash === url) return
    // Retain unrelated history metadata owned by the application.
    if (replace) window.history.replaceState(window.history.state, '', url)
    else window.history.pushState(window.history.state, '', url)
    setPage(normalized)
  }, [])

  return { page, navigate }
}

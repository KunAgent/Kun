import { useLayoutEffect, useState } from 'react'

const OVERLAYS = '.kun-onb,[data-whats-new-dialog],[aria-modal="true"],[role="alertdialog"]'

// WebContentsView is above renderer DOM regardless of z-index. Hide its
// presentation for app dialogs, but keep the browser's supervision lease.
export function useAgentBrowserOccluded(): boolean {
  const [occluded, setOccluded] = useState(false)
  useLayoutEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
    const update = () => setOccluded(Array.from(document.querySelectorAll<HTMLElement>(OVERLAYS)).some((node) => {
      if (node.closest('[data-agent-browser-surface-host],[data-browser-preview-frame]')) return false
      if (!node.getClientRects().length || node.closest('[hidden],[aria-hidden="true"]')) return false
      const style = window.getComputedStyle(node)
      return style.display !== 'none' && style.visibility !== 'hidden'
    }))
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'aria-modal', 'role', 'open', 'data-state']
    })
    return () => observer.disconnect()
  }, [])
  return occluded
}

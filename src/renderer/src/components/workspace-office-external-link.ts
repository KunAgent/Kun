import type { MouseEvent as ReactMouseEvent } from 'react'

const CONTROLLED_HREF_ATTRIBUTE = 'data-kun-office-href'

export function secureWorkspaceOfficeLinks(container: ParentNode): void {
  for (const anchor of container.querySelectorAll<HTMLAnchorElement>('a')) {
    const href = anchor.getAttribute('href')?.trim() ?? ''
    anchor.removeAttribute('target')
    anchor.removeAttribute('ping')
    anchor.removeAttribute('referrerpolicy')
    anchor.removeAttribute(CONTROLLED_HREF_ATTRIBUTE)
    if (/^(https?:|mailto:)/i.test(href)) {
      anchor.setAttribute(CONTROLLED_HREF_ATTRIBUTE, href)
    }
    // Keep keyboard/link semantics without retaining a directly navigable URL.
    anchor.setAttribute('href', '#')
  }
}

export function openWorkspaceOfficeExternalLink(
  event: Pick<ReactMouseEvent<HTMLElement>, 'target' | 'preventDefault'>
): void {
  const anchor = event.target instanceof Element
    ? event.target.closest('a[href]') as HTMLAnchorElement | null
    : null
  if (!anchor) return
  event.preventDefault()
  // Viewers that mount pages lazily cannot pre-secure every link, so fall back to the live href.
  const href = (anchor.getAttribute(CONTROLLED_HREF_ATTRIBUTE) ?? anchor.getAttribute('href') ?? '').trim()
  if (!/^(https?:|mailto:)/i.test(href)) return
  void window.kunGui?.openExternal?.(href)?.catch(() => undefined)
}

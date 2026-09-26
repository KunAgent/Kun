import { useLayoutEffect } from 'react'

/** Keep the phone shell and portaled sheets above the software keyboard without changing routes. */
export function useMobileViewport(): void {
  useLayoutEffect(() => {
    const root = document.documentElement
    const viewport = window.visualViewport
    const properties = ['--kun-mobile-height', '--kun-mobile-top', '--kun-mobile-bottom']
    const previous = properties.map((name) => root.style.getPropertyValue(name))
    const update = (): void => {
      // Pinch zoom should magnify the UI, not resize/reflow it under the fingers.
      if (viewport && Math.abs(viewport.scale - 1) > 0.01) return
      const height = viewport?.height ?? window.innerHeight
      const top = viewport?.offsetTop ?? 0
      if (!Number.isFinite(height) || height <= 0) return
      const bottom = Math.max(0, window.innerHeight - height - top)
      root.style.setProperty(properties[0], `${height}px`)
      root.style.setProperty(properties[1], `${top}px`)
      root.style.setProperty(properties[2], `${bottom}px`)
      // Chrome shrinks the layout viewport instead of reporting a bottom
      // offset, so treat either signal past ~80px as "keyboard open". CSS can
      // then drop chrome (mode nav) that would crowd the composer. Landscape
      // phones lose a larger share of a short viewport, so the bottom-offset
      // signal relaxes there (browser chrome rarely eats >50px in landscape).
      const landscape = window.innerWidth > window.innerHeight
      const keyboardOpen = bottom > 80
        || height < window.innerHeight * 0.62
        || (landscape && bottom > 60)
      root.dataset.keyboardOpen = keyboardOpen ? 'true' : 'false'
    }
    update()
    window.addEventListener('resize', update)
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    return () => {
      window.removeEventListener('resize', update)
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
      properties.forEach((name, index) => {
        if (previous[index]) root.style.setProperty(name, previous[index])
        else root.style.removeProperty(name)
      })
      delete root.dataset.keyboardOpen
    }
  }, [])
}

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
      root.style.setProperty(properties[0], `${height}px`)
      root.style.setProperty(properties[1], `${top}px`)
      root.style.setProperty(properties[2], `${Math.max(0, window.innerHeight - height - top)}px`)
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
    }
  }, [])
}

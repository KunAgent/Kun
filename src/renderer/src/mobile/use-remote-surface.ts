import { useEffect, useLayoutEffect, useState } from 'react'
import { resolveRemoteSurface, type RemoteSurface } from './remote-surface'

export function currentRemoteSurface(): RemoteSurface {
  if (typeof window === 'undefined') return 'desktop'
  return resolveRemoteSurface({
    remote: window.kunGui?.isRemoteWeb === true,
    viewportWidth: window.innerWidth,
    coarsePointer: typeof window.matchMedia === 'function'
      && window.matchMedia('(pointer: coarse)').matches,
    screenWidth: window.screen?.width ?? 0,
    screenHeight: window.screen?.height ?? 0
  })
}

export function useRemoteSurface(): RemoteSurface {
  const [surface, setSurface] = useState(currentRemoteSurface)
  useLayoutEffect(() => {
    const root = document.documentElement
    const previous = root.dataset.remoteSurface
    root.dataset.remoteSurface = surface
    return () => {
      if (previous === undefined) delete root.dataset.remoteSurface
      else root.dataset.remoteSurface = previous
    }
  }, [surface])
  useEffect(() => {
    const update = (): void => setSurface(currentRemoteSurface())
    const pointer = typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)') : null
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    pointer?.addEventListener('change', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
      pointer?.removeEventListener('change', update)
    }
  }, [])
  return surface
}

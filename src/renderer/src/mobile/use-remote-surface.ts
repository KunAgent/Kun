import { useEffect, useLayoutEffect, useState } from 'react'
import { resolveRemoteSurface, type RemoteSurface } from './remote-surface'

export const REMOTE_SURFACE_OVERRIDE_KEY = 'kun.remote.surface'

/** `?surface=mobile|desktop` persists to sessionStorage; the stored value wins afterwards. */
export function readRemoteSurfaceOverride(): RemoteSurface | null {
  if (typeof window === 'undefined') return null
  try {
    const param = new URL(window.location.href).searchParams.get('surface')
    if (param === 'mobile' || param === 'desktop') {
      window.sessionStorage.setItem(REMOTE_SURFACE_OVERRIDE_KEY, param)
      return param
    }
    const stored = window.sessionStorage.getItem(REMOTE_SURFACE_OVERRIDE_KEY)
    return stored === 'mobile' || stored === 'desktop' ? stored : null
  } catch {
    return null
  }
}

/** Persists the manual surface choice and reloads so the other shell boots cleanly. */
export function switchRemoteSurface(surface: RemoteSurface): void {
  try {
    window.sessionStorage.setItem(REMOTE_SURFACE_OVERRIDE_KEY, surface)
  } catch {
    // sessionStorage may be unavailable; the URL param still works next launch.
  }
  window.location.reload()
}

export function currentRemoteSurface(previous?: RemoteSurface): RemoteSurface {
  if (typeof window === 'undefined') return 'desktop'
  return resolveRemoteSurface({
    remote: window.kunGui?.isRemoteWeb === true,
    viewportWidth: window.innerWidth,
    coarsePointer: typeof window.matchMedia === 'function'
      && window.matchMedia('(pointer: coarse)').matches,
    screenWidth: window.screen?.width ?? 0,
    screenHeight: window.screen?.height ?? 0,
    override: readRemoteSurfaceOverride()
  }, previous)
}

export function useRemoteSurface(): RemoteSurface {
  const [surface, setSurface] = useState(() => currentRemoteSurface())
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
    const update = (): void => setSurface((previous) => currentRemoteSurface(previous))
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

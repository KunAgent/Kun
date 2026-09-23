export type RemoteSurface = 'desktop' | 'mobile'

export type RemoteSurfaceEnvironment = {
  remote: boolean
  viewportWidth: number
  coarsePointer: boolean
  screenWidth: number
  screenHeight: number
  /** Explicit user choice (?surface= or sessionStorage); wins over every heuristic. */
  override?: RemoteSurface | null
}

export const MOBILE_MAX_WIDTH = 767
export const MOBILE_EXIT_WIDTH = 900

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

/**
 * Keyboard geometry must never decide which application shell is mounted.
 * Between MOBILE_MAX_WIDTH and MOBILE_EXIT_WIDTH the previous surface is kept
 * so iPad rotation and split-view resizing do not remount the whole shell.
 */
export function resolveRemoteSurface(
  environment: RemoteSurfaceEnvironment,
  previous?: RemoteSurface
): RemoteSurface {
  if (environment.override === 'mobile' || environment.override === 'desktop') {
    return environment.override
  }
  if (!environment.remote) return 'desktop'
  if (isPositiveFinite(environment.viewportWidth)) {
    if (environment.viewportWidth <= MOBILE_MAX_WIDTH) return 'mobile'
    if (environment.viewportWidth > MOBILE_EXIT_WIDTH) return 'desktop'
    if (previous) return previous
  }
  const phoneScreen = isPositiveFinite(environment.screenWidth)
    && isPositiveFinite(environment.screenHeight)
    && Math.min(environment.screenWidth, environment.screenHeight) <= MOBILE_MAX_WIDTH
  return environment.coarsePointer && phoneScreen ? 'mobile' : 'desktop'
}

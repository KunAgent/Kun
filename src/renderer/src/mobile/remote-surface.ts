export type RemoteSurface = 'desktop' | 'mobile'

export type RemoteSurfaceEnvironment = {
  remote: boolean
  viewportWidth: number
  coarsePointer: boolean
  screenWidth: number
  screenHeight: number
}

export const MOBILE_MAX_WIDTH = 767

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

/** Keyboard geometry must never decide which application shell is mounted. */
export function resolveRemoteSurface(environment: RemoteSurfaceEnvironment): RemoteSurface {
  if (!environment.remote) return 'desktop'
  if (isPositiveFinite(environment.viewportWidth) && environment.viewportWidth <= MOBILE_MAX_WIDTH) {
    return 'mobile'
  }
  const phoneScreen = isPositiveFinite(environment.screenWidth)
    && isPositiveFinite(environment.screenHeight)
    && Math.min(environment.screenWidth, environment.screenHeight) <= MOBILE_MAX_WIDTH
  return environment.coarsePointer && phoneScreen ? 'mobile' : 'desktop'
}

import { createContext, useContext } from 'react'

/**
 * Which chrome hosts the timeline. `desktop` keeps hover-only action rows and
 * the turn jump rail; `mobile` swaps them for a touch "more" sheet and a
 * floating back-to-latest button — all decided here so shared bubble/card
 * components never reach for viewport sniffing themselves.
 */
export type TimelineSurface = 'desktop' | 'mobile'

const TimelineSurfaceContext = createContext<TimelineSurface>('desktop')

export const TimelineSurfaceProvider = TimelineSurfaceContext.Provider

export function useTimelineSurface(): TimelineSurface {
  return useContext(TimelineSurfaceContext)
}

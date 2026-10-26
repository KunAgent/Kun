import { useCallback, useEffect, useRef } from 'react'
import {
  buildHtmlElementMapScript,
  normalizeHtmlElementMap,
  type HtmlElementMap
} from './html-element-map'

const REFRESH_INTERVAL_MS = 600
const FIRST_REPORT_DELAY_MS = 40

type Options = {
  /** The pointer is over the frame, or an element is selected. */
  armed: boolean
  /** Changes whenever the preview document is replaced. */
  epoch: string
  executeScript: (code: string) => Promise<unknown> | null
}

/**
 * Keeps the latest element map of a frame. The guest answers an unchanged page
 * with a tiny payload, so the poll costs one cheap round trip per tick and only
 * while the frame is armed.
 */
export function useHtmlFrameElementMap({ armed, epoch, executeScript }: Options): {
  getMap: () => HtmlElementMap | null
  refresh: (force?: boolean) => Promise<HtmlElementMap | null>
} {
  const mapRef = useRef<HtmlElementMap | null>(null)
  const live = useRef({ epoch, executeScript })
  live.current = { epoch, executeScript }
  const inFlight = useRef<Promise<HtmlElementMap | null> | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // A new document has none of the guest state: drop the old table at once.
  useEffect(() => { mapRef.current = null }, [epoch])

  const refresh = useCallback((force = false): Promise<HtmlElementMap | null> => {
    if (inFlight.current) return inFlight.current
    const capturedEpoch = live.current.epoch
    const pending = live.current.executeScript(buildHtmlElementMapScript(!force && Boolean(mapRef.current)))
    if (!pending) return Promise.resolve(mapRef.current)
    const task = (async (): Promise<HtmlElementMap | null> => {
      try {
        const result = normalizeHtmlElementMap(await pending)
        if (!mounted.current || capturedEpoch !== live.current.epoch) return mapRef.current
        if (result && result !== 'unchanged') mapRef.current = result
        else if (!result) mapRef.current = null
        return mapRef.current
      } catch {
        return mapRef.current
      } finally {
        inFlight.current = null
      }
    })()
    inFlight.current = task
    return task
  }, [])

  useEffect(() => {
    if (!armed) return
    const first = window.setTimeout(() => { void refresh(true) }, FIRST_REPORT_DELAY_MS)
    const timer = window.setInterval(() => { void refresh(false) }, REFRESH_INTERVAL_MS)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
    }
  }, [armed, epoch, refresh])

  return { getMap: useCallback(() => mapRef.current, []), refresh }
}

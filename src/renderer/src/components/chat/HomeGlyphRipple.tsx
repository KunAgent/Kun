import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import {
  GlyphRippleField,
  glyphScriptForLanguage,
  type GlyphClearRect,
  type GlyphFieldColors
} from '../../lib/glyph-ripple-field'
import { useHomeGlyphRippleEnabled } from './use-home-glyph-ripple-enabled'

/** Content the glyphs fade away from, with its padding and fade distance in field units. */
const CLEAR_TARGETS = [
  { selector: '[data-home-hero-content]', pad: 18, feather: 70 },
  { selector: '[data-floating-composer]', pad: 6, feather: 46 },
  { selector: '[data-home-quick-start]', pad: 4, feather: 40 }
] as const

/** Presses on these start their own interaction, never a ripple. */
const IGNORE_SELECTOR = [
  'button', 'a', 'input', 'textarea', 'select', 'label', 'summary', '[role="button"]',
  '[role="menu"]', '[role="listbox"]', '[role="dialog"]', '[contenteditable="true"]',
  '[data-floating-composer]', '[data-home-quick-start]', '[data-glyph-ripple-ignore]'
].join(', ')

const FADE_MS = 200

function luminance(color: string): number {
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [255, 255, 255]
  const [r, g, b] = channels.map((value) => value / 255)
  return 0.2126 * (r ?? 1) + 0.7152 * (g ?? 1) + 0.0722 * (b ?? 1)
}

/** Theme tokens resolved to plain colors through the canvas's own computed style. */
function readColors(canvas: HTMLCanvasElement): GlyphFieldColors {
  const style = getComputedStyle(canvas)
  return { ink: style.color, accent: style.caretColor, dark: luminance(style.textDecorationColor) < 0.4 }
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * The Code home's glyph field: a canvas laid under the hero and composer of
 * `hostRef` (the chat main stack). At rest only a faint wind of characters
 * drifts through; a press on empty space sends a ripple that lights the field
 * up, then dissolves. It fades out with the home layout and gives its backing
 * stores back.
 */
export function HomeGlyphRipple({ hostRef, active }: {
  hostRef: RefObject<HTMLElement | null>
  active: boolean
}): ReactElement | null {
  const enabled = useHomeGlyphRippleEnabled()
  const { i18n } = useTranslation()
  // Chinese UI draws Han characters, every other language Latin glyphs.
  const script = glyphScriptForLanguage(i18n.resolvedLanguage ?? i18n.language)
  const scriptRef = useRef(script)
  scriptRef.current = script
  const shown = active && enabled === true
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const shownRef = useRef(shown)
  /** Re-measure and resync the wind when `shown` or the language changes. */
  const refreshRef = useRef<(() => void) | null>(null)
  const [mounted, setMounted] = useState(shown)
  const [visible, setVisible] = useState(false)
  shownRef.current = shown

  useEffect(() => {
    if (shown) {
      setMounted(true)
      // Back on the home before the fade ended (a send rolled back): re-measure.
      refreshRef.current?.()
      const frame = requestAnimationFrame(() => setVisible(true))
      return () => cancelAnimationFrame(frame)
    }
    setVisible(false)
    refreshRef.current?.()
    const timer = window.setTimeout(() => setMounted(false), FADE_MS)
    return () => window.clearTimeout(timer)
  }, [shown])

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!mounted || !host || !canvas) return
    const field = new GlyphRippleField(canvas)
    let frame = 0
    const zoomOf = (box: DOMRect): number => (host.clientWidth > 0 ? box.width / host.clientWidth : 1)
    // The resting wind runs only while the home is shown, visible and motion is allowed.
    const syncWind = (): void =>
      field.setWind(shownRef.current && !reducedMotion() && document.visibilityState === 'visible')

    const resizeObserver = new ResizeObserver(() => schedule())
    const observed = new Set<Element>()
    const watch = (element: Element): void => {
      if (observed.has(element)) return
      observed.add(element)
      resizeObserver.observe(element)
    }

    const relayout = (): void => {
      frame = 0
      if (!shownRef.current) return
      const box = host.getBoundingClientRect()
      const zoom = zoomOf(box)
      const clear: GlyphClearRect[] = []
      for (const target of CLEAR_TARGETS) {
        const element = host.querySelector(target.selector)
        if (!element) continue
        watch(element)
        const rect = element.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) continue
        clear.push({
          x: (rect.left - box.left) / zoom + host.scrollLeft,
          y: (rect.top - box.top) / zoom + host.scrollTop,
          width: rect.width / zoom,
          height: rect.height / zoom,
          pad: target.pad,
          feather: target.feather
        })
      }
      for (const child of Array.from(host.children)) if (child !== canvas) watch(child)
      field.layout(host.clientWidth, host.clientHeight, zoom * (window.devicePixelRatio || 1), clear, readColors(canvas),
        scriptRef.current)
      syncWind()
    }
    function schedule(): void {
      if (!frame) frame = requestAnimationFrame(relayout)
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (!shownRef.current || event.button !== 0 || !event.isPrimary || reducedMotion()) return
      const target = event.target
      if (target instanceof Element && target.closest(IGNORE_SELECTOR)) return
      const box = host.getBoundingClientRect()
      const zoom = zoomOf(box)
      field.ripple((event.clientX - box.left) / zoom + host.scrollLeft, (event.clientY - box.top) / zoom + host.scrollTop)
    }

    // Theme, palette and dark-UI colour edits all land on <html> attributes.
    let recolorFrame = 0
    const themeObserver = new MutationObserver(() => {
      if (recolorFrame) return
      recolorFrame = requestAnimationFrame(() => {
        recolorFrame = 0
        field.recolor(readColors(canvas))
      })
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] })

    watch(host)
    refreshRef.current = () => {
      syncWind()
      schedule()
    }
    schedule()
    const motionQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null
    motionQuery?.addEventListener('change', syncWind)
    document.addEventListener('visibilitychange', syncWind)
    // Lazy timeline chunks and home cards settle after the first frame.
    const settleTimers = [320, 1200].map((delay) => window.setTimeout(schedule, delay))
    host.addEventListener('pointerdown', onPointerDown)
    return () => {
      host.removeEventListener('pointerdown', onPointerDown)
      motionQuery?.removeEventListener('change', syncWind)
      document.removeEventListener('visibilitychange', syncWind)
      resizeObserver.disconnect()
      themeObserver.disconnect()
      settleTimers.forEach((timer) => window.clearTimeout(timer))
      if (frame) cancelAnimationFrame(frame)
      if (recolorFrame) cancelAnimationFrame(recolorFrame)
      refreshRef.current = null
      field.release()
    }
  }, [hostRef, mounted])

  // A language switch rebuilds the grid in the other script.
  useEffect(() => {
    refreshRef.current?.()
  }, [script])

  if (!mounted) return null
  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-home-glyph-ripple
      className="ds-home-glyph-ripple"
      data-visible={visible ? 'true' : 'false'}
    />
  )
}

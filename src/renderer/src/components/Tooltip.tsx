import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState
} from 'react'

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right'

export type TooltipProps = {
  /** Content to show inside the tooltip. */
  content: ReactNode
  /** The element the tooltip anchors to. */
  children: ReactElement
  /** Preferred placement. Falls back to the nearest available direction if clipped. */
  placement?: TooltipPlacement
  /** Delay before showing (ms). Default 400. */
  showDelay?: number
  /** Delay before hiding (ms). Default 150. */
  hideDelay?: number
  /** Whether touch interactions are supported. Default true. */
  touchSupport?: boolean
  /** Additional class names for the tooltip popup. */
  className?: string
  /** Additional class names for the tooltip arrow. */
  arrowClassName?: string
  /** Distance between tooltip and target (px). Default 6. */
  gap?: number
}

const arrowSize = 6

export function Tooltip({
  content,
  children,
  placement: preferredPlacement = 'top',
  showDelay = 400,
  hideDelay = 150,
  touchSupport = true,
  className = '',
  arrowClassName = '',
  gap = 6
}: TooltipProps): ReactElement {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ top: -9999, left: -9999, placement: preferredPlacement })
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const clearTimers = useCallback(() => {
    if (showTimerRef.current) { clearTimeout(showTimerRef.current); showTimerRef.current = null }
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null }
  }, [])

  const reposition = useCallback(() => {
    if (!triggerRef.current || !tooltipRef.current) return
    const triggerRect = triggerRef.current.getBoundingClientRect()
    const tooltipRect = tooltipRef.current.getBoundingClientRect()
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const { top, left, placement } = computePosition(triggerRect, tooltipRect, preferredPlacement, gap, viewport)
    setPos({ top, left, placement })
  }, [preferredPlacement, gap])

  const scheduleShow = useCallback(() => {
    clearTimers()
    showTimerRef.current = setTimeout(() => {
      setVisible(true)
    }, showDelay)
  }, [clearTimers, showDelay, reposition])

  const scheduleHide = useCallback(() => {
    clearTimers()
    hideTimerRef.current = setTimeout(() => {
      setVisible(false)
    }, hideDelay)
  }, [clearTimers, hideDelay])

  // 可见时监听滚动/缩放重新定位
  useLayoutEffect(() => {
    if (!visible) return
    reposition()
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [visible, reposition])

  // 触摸处理
  const touchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleTouch = useCallback((e: React.TouchEvent) => {
    if (!touchSupport) return
    e.preventDefault()
    if (visible) {
      setVisible(false)
      if (touchTimerRef.current) { clearTimeout(touchTimerRef.current); touchTimerRef.current = null }
      return
    }
    scheduleShow()
    touchTimerRef.current = setTimeout(() => setVisible(false), 3000)
  }, [touchSupport, visible, scheduleShow])

  const arrowPlacement = pos.placement

  return (
    <>
      <span
        ref={triggerRef}
        className="inline-flex"
        onMouseEnter={scheduleShow}
        onMouseLeave={scheduleHide}
        onFocus={scheduleShow}
        onBlur={scheduleHide}
        onTouchStart={touchSupport ? handleTouch : undefined}
      >
        {children}
      </span>
      {visible ? (
        <div
          ref={tooltipRef}
          role="tooltip"
          className={`pointer-events-none fixed z-[9999] ${className}`}
          style={{ top: pos.top, left: pos.left }}
        >
          <div
            className={`whitespace-nowrap rounded-lg border border-ds-border bg-ds-elevated px-2.5 py-1.5 text-[12.5px] font-medium text-ds-ink shadow-lg ${arrowClassName || ''}`}
          >
            {content}
          </div>
          <div
            className={`absolute ${arrowClassName}`}
            style={{
              ...(arrowPlacement === 'top' ? { bottom: '100%', left: '50%', marginLeft: -arrowSize, marginBottom: -1 } : {}),
              ...(arrowPlacement === 'bottom' ? { top: '100%', left: '50%', marginLeft: -arrowSize, marginTop: -1 } : {}),
              ...(arrowPlacement === 'left' ? { right: '100%', top: '50%', marginTop: -arrowSize, marginRight: -1 } : {}),
              ...(arrowPlacement === 'right' ? { left: '100%', top: '50%', marginTop: -arrowSize, marginLeft: -1 } : {})
            }}
          >
            <svg width={arrowSize * 2} height={arrowSize * 2} viewBox={`0 0 ${arrowSize * 2} ${arrowSize * 2}`} className="block">
              {arrowPlacement === 'top' ? (
                <polygon points={`0,0 ${arrowSize * 2},0 ${arrowSize},${arrowSize * 2}`} className="fill-ds-elevated stroke-ds-border" strokeWidth="0.5" />
              ) : arrowPlacement === 'bottom' ? (
                <polygon points={`0,${arrowSize * 2} ${arrowSize * 2},${arrowSize * 2} ${arrowSize},0`} className="fill-ds-elevated stroke-ds-border" strokeWidth="0.5" />
              ) : arrowPlacement === 'left' ? (
                <polygon points={`${arrowSize * 2},0 ${arrowSize * 2},${arrowSize * 2} 0,${arrowSize}`} className="fill-ds-elevated stroke-ds-border" strokeWidth="0.5" />
              ) : (
                <polygon points={`0,0 0,${arrowSize * 2} ${arrowSize * 2},${arrowSize}`} className="fill-ds-elevated stroke-ds-border" strokeWidth="0.5" />
              )}
            </svg>
          </div>
        </div>
      ) : null}
    </>
  )
}

function computePosition(
  triggerRect: DOMRect,
  tooltipRect: DOMRect,
  preferred: TooltipPlacement,
  gap: number,
  viewport: { width: number; height: number }
): { top: number; left: number; placement: TooltipPlacement } {
  const candidates: TooltipPlacement[] = [preferred, 'top', 'bottom', 'left', 'right']
  const unique = [...new Set(candidates)]

  for (const placement of unique) {
    let top: number
    let left: number

    switch (placement) {
      case 'top':
        top = triggerRect.top - tooltipRect.height - gap
        left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2
        break
      case 'bottom':
        top = triggerRect.bottom + gap
        left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2
        break
      case 'left':
        top = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2
        left = triggerRect.left - tooltipRect.width - gap
        break
      case 'right':
        top = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2
        left = triggerRect.right + gap
        break
    }

    const clampedLeft = Math.max(arrowSize, Math.min(left, viewport.width - tooltipRect.width - arrowSize))
    const clampedTop = Math.max(arrowSize, Math.min(top, viewport.height - tooltipRect.height - arrowSize))

    if (Math.abs(clampedLeft - left) < 20 && Math.abs(clampedTop - top) < 20) {
      return { top: clampedTop, left: clampedLeft, placement }
    }
  }

  const fallbackTop = Math.max(arrowSize, Math.min(triggerRect.bottom + gap, viewport.height - tooltipRect.height - arrowSize))
  const fallbackLeft = Math.max(arrowSize, Math.min(
    triggerRect.left + (triggerRect.width - tooltipRect.width) / 2,
    viewport.width - tooltipRect.width - arrowSize
  ))
  return { top: fallbackTop, left: fallbackLeft, placement: 'bottom' }
}

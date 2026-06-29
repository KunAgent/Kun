import type { ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useInjectedMemoryTooltipText } from './injected-memory-lookup'

type TooltipState = {
  text: string
  x: number
  y: number
}

function chipTooltipPosition(clientX: number, anchorRect: DOMRect): { x: number; y: number } {
  const maxWidth = Math.min(320, window.innerWidth - 24)
  const x = Math.max(12, Math.min(clientX - maxWidth / 2, window.innerWidth - maxWidth - 12))
  const y = Math.max(12, anchorRect.top - 8)
  return { x, y }
}

export function InjectedMemoryMetaChip({
  meta,
  memoryIds,
  chipClass
}: {
  meta?: Record<string, unknown>
  memoryIds: string[]
  chipClass: string
}): ReactElement | null {
  const { t } = useTranslation('common')
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const tooltipText = useInjectedMemoryTooltipText(meta, memoryIds)

  const showTooltip = useCallback(
    (clientX: number): void => {
      if (!tooltipText.trim()) return
      const anchorRect = anchorRef.current?.getBoundingClientRect()
      if (!anchorRect) return
      setTooltip({ text: tooltipText, ...chipTooltipPosition(clientX, anchorRect) })
    },
    [tooltipText]
  )

  const moveTooltip = useCallback((clientX: number): void => {
    setTooltip((current) => {
      if (!current) return current
      const anchorRect = anchorRef.current?.getBoundingClientRect()
      if (!anchorRect) return current
      return { ...current, ...chipTooltipPosition(clientX, anchorRect) }
    })
  }, [])

  const hideTooltip = useCallback((): void => {
    setTooltip(null)
  }, [])

  if (memoryIds.length === 0) return null

  return (
    <>
      <span
        ref={anchorRef}
        className={`${chipClass} cursor-default`}
        onPointerEnter={(event) => showTooltip(event.clientX)}
        onPointerMove={(event) => moveTooltip(event.clientX)}
        onPointerLeave={hideTooltip}
        onPointerCancel={hideTooltip}
      >
        {t('toolInjectedMemories')} {memoryIds.length}
      </span>
      {tooltip
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[9999] max-w-[min(20rem,calc(100vw-1.5rem))] whitespace-pre-wrap break-words rounded-lg border border-ds-border bg-ds-elevated px-2.5 py-1.5 text-[12px] font-normal leading-5 text-ds-ink shadow-[0_14px_36px_rgba(15,23,42,0.22)]"
              style={{ left: tooltip.x, top: tooltip.y, transform: 'translateY(-100%)' }}
            >
              {tooltip.text}
            </div>,
            document.body
          )
        : null}
    </>
  )
}

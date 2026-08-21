import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'

export const COMPOSER_FLOATING_STATUS_HEIGHT_PROPERTY = '--ds-composer-floating-status-height'

export function publishComposerFloatingStatusHeight(
  floatingStack: HTMLElement,
  height: number
): HTMLElement | null {
  const chatStack = floatingStack.closest<HTMLElement>('.ds-chat-main-stack')
  if (!chatStack) return null
  const normalizedHeight = Number.isFinite(height) ? Math.max(0, Math.ceil(height)) : 0
  chatStack.style.setProperty(COMPOSER_FLOATING_STATUS_HEIGHT_PROPERTY, `${normalizedHeight}px`)
  return chatStack
}

type Props = {
  floatingStatuses?: ReactNode
  flowPanels?: ReactNode
}

/**
 * Owns the persistent surfaces above the composer.
 *
 * Compact summaries float over the conversation. Larger or expanding panels
 * keep normal-flow space so their controls never cover message content.
 */
export function FloatingComposerAboveInputStack({
  floatingStatuses,
  flowPanels
}: Props): ReactElement {
  const floatingStackRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const floatingStack = floatingStackRef.current
    if (!floatingStack) return
    let chatStack: HTMLElement | null = null
    const updateHeight = (): void => {
      const nextChatStack = publishComposerFloatingStatusHeight(
        floatingStack,
        floatingStack.offsetHeight
      )
      if (chatStack && chatStack !== nextChatStack) {
        chatStack.style.removeProperty(COMPOSER_FLOATING_STATUS_HEIGHT_PROPERTY)
      }
      chatStack = nextChatStack
    }
    const clearHeight = (): void => {
      chatStack?.style.removeProperty(COMPOSER_FLOATING_STATUS_HEIGHT_PROPERTY)
    }

    updateHeight()
    if (typeof ResizeObserver === 'undefined') return clearHeight
    const observer = new ResizeObserver(updateHeight)
    observer.observe(floatingStack)
    return () => {
      observer.disconnect()
      clearHeight()
    }
  }, [])

  return (
    <>
      <div
        ref={floatingStackRef}
        data-composer-floating-status-stack
        className="pointer-events-none absolute inset-x-0 bottom-full z-30 flex w-full flex-col items-center gap-2 empty:hidden"
      >
        {floatingStatuses}
      </div>
      <div
        data-composer-flow-panel-stack
        className="mb-2 flex w-full flex-col items-center gap-2 empty:hidden"
      >
        {flowPanels}
      </div>
    </>
  )
}

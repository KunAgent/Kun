import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type RefObject
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { MessageCircleMore, Reply } from 'lucide-react'
import { useChatStore } from '../../store/chat-store'
import { bodyZoom, toLayoutPx } from '../../lib/body-zoom'
import { createMessageQuote } from '../../lib/message-quote'
import {
  canReplyInMainComposer,
  replyWithQuoteInMainComposer,
  replyWithQuoteInSideConversation,
  sideConversationQuoteBlocker,
  startSideConversationWithQuote
} from '../../lib/message-quote-actions'
import {
  readTimelineSelection,
  selectionToolbarPlacement,
  type TimelineSelectionSnapshot,
  type ToolbarPlacement
} from './timeline-selection'

type Props = {
  /** The timeline's scroll viewport; selections outside it are ignored. */
  containerRef: RefObject<HTMLElement | null>
  /**
   * `main`: reply into the main composer or start a side conversation.
   * `side`: reply into the composer of side conversation `sideId`.
   */
  surface: 'main' | 'side'
  sideId?: string
}

/** Keyboard selections settle before the toolbar appears. */
const SELECTION_SETTLE_MS = 150

export function MessageSelectionToolbar({ containerRef, surface, sideId }: Props): ReactElement | null {
  const { t } = useTranslation('common')
  const [snapshot, setSnapshot] = useState<TimelineSelectionSnapshot | null>(null)
  const [placement, setPlacement] = useState<ToolbarPlacement | null>(null)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const snapshotRef = useRef<TimelineSelectionSnapshot | null>(null)
  const pointerDownRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const frameRef = useRef<number | null>(null)
  const dismissedTextRef = useRef<string | null>(null)
  snapshotRef.current = snapshot

  const canReply = useChatStore((state) => surface === 'side'
    ? Boolean(sideId && state.sideConversations[sideId])
    : canReplyInMainComposer(state))
  const sideBlocker = useChatStore((state) =>
    surface === 'main' ? sideConversationQuoteBlocker(state) : null)
  const showSide = surface === 'main'
  // The main toolbar belongs to the Code conversation; elsewhere it stays off.
  const enabled = canReply

  const sync = useCallback((): void => {
    const root = containerRef.current
    const next = root ? readTimelineSelection(root, window.getSelection()) : null
    if (!next) dismissedTextRef.current = null
    setSnapshot(next && next.text !== dismissedTextRef.current ? next : null)
  }, [containerRef])

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return
    // A pointer release syncs right away; the selectionchange that browsers
    // may dispatch just after it must not push that back into the debounce.
    let immediatePending = false
    const schedule = (delay: number): void => {
      if (immediatePending && delay > 0) return
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      immediatePending = delay === 0
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        immediatePending = false
        sync()
      }, delay)
    }
    const syncOnFrame = (): void => {
      if (!snapshotRef.current || frameRef.current !== null) return
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null
        sync()
      })
    }
    const onSelectionChange = (): void => {
      if (!pointerDownRef.current) schedule(SELECTION_SETTLE_MS)
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && toolbarRef.current?.contains(event.target)) return
      pointerDownRef.current = true
      setSnapshot(null)
    }
    const onPointerUp = (): void => {
      if (!pointerDownRef.current) return
      pointerDownRef.current = false
      schedule(0)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !snapshotRef.current) return
      dismissedTextRef.current = snapshotRef.current.text
      setSnapshot(null)
    }
    const viewport = containerRef.current
    document.addEventListener('selectionchange', onSelectionChange)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointercancel', onPointerUp, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', syncOnFrame)
    viewport?.addEventListener('scroll', syncOnFrame, { passive: true })
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointerup', onPointerUp, true)
      window.removeEventListener('pointercancel', onPointerUp, true)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', syncOnFrame)
      viewport?.removeEventListener('scroll', syncOnFrame)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
      timerRef.current = null
      frameRef.current = null
    }
  }, [containerRef, enabled, sync])

  // Measure the rendered toolbar, then place it; it stays hidden until placed.
  useLayoutEffect(() => {
    const root = containerRef.current
    const toolbar = toolbarRef.current
    if (!snapshot || !root || !toolbar) {
      setPlacement(null)
      return
    }
    const zoom = bodyZoom()
    const next = selectionToolbarPlacement({
      lineRects: snapshot.lineRects,
      bounds: root.getBoundingClientRect(),
      toolbar: { width: toolbar.offsetWidth * zoom, height: toolbar.offsetHeight * zoom }
    })
    setPlacement(next
      ? { ...next, left: toLayoutPx(next.left, zoom), top: toLayoutPx(next.top, zoom) }
      : null)
  }, [containerRef, snapshot])

  if (!enabled || !snapshot) return null

  const run = async (action: 'reply' | 'side'): Promise<void> => {
    const quote = createMessageQuote({
      rawText: snapshot.text,
      role: snapshot.role,
      sourceBlockId: snapshot.sourceBlockId
    })
    if (!quote) return
    const done = action === 'side'
      ? startSideConversationWithQuote(quote)
      : surface === 'side' && sideId
        ? replyWithQuoteInSideConversation(sideId, quote)
        : await replyWithQuoteInMainComposer(quote)
    if (!done) return
    window.getSelection()?.removeAllRanges()
    setSnapshot(null)
  }

  const sideDisabledReason = sideBlocker === 'runtime'
    ? t('messageQuoteSideNeedsRuntime')
    : sideBlocker === 'no-thread'
      ? t('messageQuoteSideNeedsThread')
      : undefined
  const buttonClass =
    'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2.5 text-[12.5px] font-medium text-ds-ink transition-colors hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint/30 disabled:cursor-not-allowed disabled:text-ds-faint disabled:hover:bg-transparent'

  return createPortal(
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label={t('messageQuoteToolbarLabel')}
      data-message-selection-toolbar={surface}
      data-placement={placement?.placement}
      className="ds-message-selection-toolbar ds-no-drag fixed z-40 flex h-9 items-center gap-0.5 rounded-[10px] border border-ds-border bg-ds-elevated px-1"
      style={{
        left: placement?.left ?? 0,
        top: placement?.top ?? 0,
        visibility: placement ? 'visible' : 'hidden'
      }}
      // Keep the document selection (and composer focus) while clicking.
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
    >
      {showSide ? (
        <button
          type="button"
          className={buttonClass}
          disabled={Boolean(sideBlocker)}
          title={sideDisabledReason ?? t('messageQuoteStartSideTitle')}
          onClick={() => void run('side')}
          data-message-quote-action="side"
        >
          <MessageCircleMore className="h-3.5 w-3.5" strokeWidth={1.85} aria-hidden />
          {t('messageQuoteStartSide')}
        </button>
      ) : null}
      {showSide ? (
        <span aria-hidden className="mx-0.5 h-4 w-px bg-ds-border" />
      ) : null}
      {canReply ? (
        <button
          type="button"
          className={buttonClass}
          title={t('messageQuoteReplyTitle')}
          onClick={() => void run('reply')}
          data-message-quote-action="reply"
        >
          <Reply className="h-3.5 w-3.5" strokeWidth={1.85} aria-hidden />
          {t('messageQuoteReply')}
        </button>
      ) : null}
    </div>,
    document.body
  )
}

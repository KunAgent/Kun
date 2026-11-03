import { useCallback, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveTrayKinds, type TrayKind, type TrayKindId } from './tray-kind'
import { TraySegmentButton } from './tray-primitives'
import './composer-tray.css'

export type ComposerActivityTrayProps = {
  /** Raw hook results in any order; null entries are skipped. */
  kinds: ReadonlyArray<TrayKind | null | undefined>
  /** Side conversation / narrow composer: icon + count segments. */
  compact?: boolean
  /** Queue section closest to the input. Pass null when nothing is queued. */
  queue?: ReactNode
  /**
   * A composer menu (actions, slash, mentions, goal panel) opened, or an
   * interrupt card took the input slot: close the sheet when this turns true.
   */
  menuOpen?: boolean
  /** Closes the sheet when it changes (for example the active thread id). */
  resetKey?: string | null
}

/**
 * Activity tray tucked behind the composer shell (or the interrupt card that
 * replaces it): an optional sheet, the segment bar, then the queue.
 *
 * One sheet is open at a time. Clicking the open segment, Esc, a pointer down
 * outside the tray, or opening a composer menu closes it. Renders nothing when
 * no kind is present and nothing is queued.
 */
export function ComposerActivityTray({
  kinds,
  compact = false,
  queue,
  menuOpen = false,
  resetKey
}: ComposerActivityTrayProps): ReactElement | null {
  const { t } = useTranslation('common')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const sheetId = useId()
  const [openId, setOpenId] = useState<TrayKindId | null>(null)
  const resolved = resolveTrayKinds(kinds)
  const openKind = openId
    ? resolved.find((kind) => kind.id === openId && kind.renderSheet !== null) ?? null
    : null
  const close = useCallback(() => setOpenId(null), [])
  const sheet = openKind?.renderSheet ? openKind.renderSheet({ close, compact }) : null
  const sheetOpen = openKind !== null && sheet != null && sheet !== false

  // A vanished kind (or one with nothing to show) must not reopen its sheet
  // when it comes back later.
  useEffect(() => {
    if (openId && !sheetOpen) setOpenId(null)
  }, [openId, sheetOpen])

  useEffect(() => {
    if (menuOpen) setOpenId(null)
  }, [menuOpen])

  useEffect(() => {
    setOpenId(null)
  }, [resetKey])

  useEffect(() => {
    if (!sheetOpen || typeof window === 'undefined') return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) return
      setOpenId(null)
    }
    // Capture phase so the composer's own Esc handling (stop the turn) sees a
    // handled event and leaves the running turn alone.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return
      event.preventDefault()
      const root = rootRef.current
      const focusInside = root != null && document.activeElement instanceof Node &&
        root.contains(document.activeElement)
      setOpenId(null)
      if (focusInside && openId) {
        root?.querySelector<HTMLButtonElement>(`[data-tray-kind="${openId}"]`)?.focus()
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [openId, sheetOpen])

  const hasQueue = queue != null && queue !== false
  if (resolved.length === 0 && !hasQueue) return null

  const renderSegment = (kind: TrayKind): ReactElement => (
    <TraySegmentButton
      key={kind.id}
      kind={kind}
      open={sheetOpen && openKind?.id === kind.id}
      compact={compact}
      controlsId={sheetId}
      onClick={() => {
        if (kind.renderSheet === null) {
          kind.onActivate?.()
          return
        }
        setOpenId((current) => (current === kind.id ? null : kind.id))
      }}
    />
  )
  const startKinds = resolved.filter((kind) => kind.align !== 'end')
  const endKinds = resolved.filter((kind) => kind.align === 'end')

  return (
    <div
      ref={rootRef}
      className="ds-composer-tray ds-no-drag"
      data-composer-tray
      data-compact={compact ? 'true' : undefined}
    >
      {sheetOpen && openKind ? (
        <section
          id={sheetId}
          className="ds-composer-tray-sheet"
          data-tray-sheet={openKind.id}
          aria-label={openKind.ariaLabel}
        >
          {sheet}
        </section>
      ) : null}
      {resolved.length > 0 ? (
        <div className="ds-composer-tray-bar" role="group" aria-label={t('composerTray.regionLabel')}>
          {startKinds.map(renderSegment)}
          {endKinds.length > 0 ? <span className="ds-composer-tray-spacer" aria-hidden="true" /> : null}
          {endKinds.map(renderSegment)}
        </div>
      ) : null}
      {hasQueue ? (
        <div
          className="ds-composer-tray-queue"
          role="group"
          aria-label={t('composerTray.queueLabel')}
          data-composer-tray-queue
        >
          {queue}
        </div>
      ) : null}
    </div>
  )
}

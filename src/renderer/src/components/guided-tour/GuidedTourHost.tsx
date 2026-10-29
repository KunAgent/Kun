import { useEffect, useLayoutEffect, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import kunClipUrl from '../../../../asset/img/kun_clip.png'
import { useRemoteMobileLayout } from '../../lib/remote-mobile'
import { useChatStore } from '../../store/chat-store'
import { useFocusModeStore } from '../../store/focus-mode-store'
import { GuidedTour, visibleTarget } from './GuidedTour'
import { GuidedTourHub } from './GuidedTourHub'
import { readModeTourDue, readOverviewTourDue, readTourSeen, useGuidedTourStore } from './guided-tour-store'
import { currentGuidedMode, GUIDED_TOURS, GUIDED_TOURS_BUTTON, type GuidedTourId } from './guided-tour-steps'
import './guided-tour.css'

/** How often to look for a due tour while none is on screen; a cheap DOM read. */
const CHECK_MS = 1_200
const HINT_MS = 7_000
const ALL_TOURS: readonly GuidedTourId[] = ['overview', 'code', 'work', 'chats']

/** First-run setup, the what's-new dialog or any other modal goes first. */
function anotherDialogOpen(): boolean {
  return Boolean(document.querySelector('.kun-onb, [data-whats-new-dialog], [aria-modal="true"], [role="alertdialog"]'))
}

/** The tour that should open now, if its screen is ready; null while nothing is due. */
export function dueGuidedTour(): GuidedTourId | null {
  const { requested, quietMode } = useGuidedTourStore.getState()
  const mode = currentGuidedMode()
  if (requested) {
    const definition = GUIDED_TOURS[requested]
    if (definition.mode && definition.mode !== mode) return null
    return visibleTarget(definition.replayReadySelector ?? definition.readySelector) ? requested : null
  }
  if (readOverviewTourDue()) return visibleTarget(GUIDED_TOURS.overview.readySelector) ? 'overview' : null
  if (!mode || mode === quietMode || !readModeTourDue(mode)) return null
  return visibleTarget(GUIDED_TOURS[mode].readySelector) ? mode : null
}

/** Points once at the ? list after a tour closes, then fades out. */
function ReplayHint(): ReactElement | null {
  const { t } = useTranslation('common')
  const dismissHint = useGuidedTourStore((s) => s.dismissHint)
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null)
  useLayoutEffect(() => {
    const button = document.querySelector(GUIDED_TOURS_BUTTON)
    if (!button) { dismissHint(); return }
    const zoom = document.body.getBoundingClientRect().width / Math.max(1, document.body.clientWidth) || 1
    const rect = button.getBoundingClientRect()
    setAnchor({ left: Math.max(12, rect.left / zoom - 8), bottom: Math.max(12, window.innerHeight / zoom - rect.top / zoom + 10) })
  }, [dismissHint])
  useEffect(() => {
    const timer = window.setTimeout(dismissHint, HINT_MS)
    return () => window.clearTimeout(timer)
  }, [dismissHint])
  if (!anchor) return null
  return (
    <button type="button" className="guided-tour-hint" role="status" data-guided-tour-hint onClick={dismissHint}
      style={{ left: anchor.left, bottom: anchor.bottom }}>
      <img src={kunClipUrl} alt="" draggable={false} />
      <span>{t('guidedTourHint')}</span>
    </button>
  )
}

/**
 * Owns every guided tour: the overview after first-run setup or an update across the redesign,
 * then each mode's tour the first time that mode opens, plus the ? list that replays them.
 * Nothing starts over a dialog, during a running reply or before the runtime is ready.
 */
export function GuidedTourHost(): ReactElement | null {
  const remoteMobile = useRemoteMobileLayout()
  // Focus mode hides most of what the tours point at; they wait until it is off.
  const focusMode = useFocusModeStore((s) => s.enabled)
  const { active, hint, hubOpen } = useGuidedTourStore(useShallow((s) => ({ active: s.active, hint: s.hint, hubOpen: s.hubOpen })))
  const { runtimeReady, initialSetupOpen, busy } = useChatStore(useShallow((s) => ({
    runtimeReady: s.runtimeConnection === 'ready',
    initialSetupOpen: s.initialSetupOpen,
    busy: s.busy
  })))

  useEffect(() => {
    if (remoteMobile || active || focusMode || !runtimeReady || initialSetupOpen || busy) return
    const timer = window.setInterval(() => {
      const store = useGuidedTourStore.getState()
      if (!store.requested && ALL_TOURS.every((id) => readTourSeen(id))) return
      const mode = currentGuidedMode()
      if (store.quietMode && mode && mode !== store.quietMode) store.clearQuietMode()
      if (store.hubOpen || document.hidden || anotherDialogOpen()) return
      const due = dueGuidedTour()
      if (due) store.start(due)
    }, CHECK_MS)
    return () => window.clearInterval(timer)
  }, [active, busy, focusMode, initialSetupOpen, remoteMobile, runtimeReady])

  if (remoteMobile) return null
  return (
    <>
      {active ? <GuidedTour key={active} tour={active} /> : null}
      {!active && hint ? createPortal(<ReplayHint />, document.body) : null}
      {hubOpen ? <GuidedTourHub /> : null}
    </>
  )
}

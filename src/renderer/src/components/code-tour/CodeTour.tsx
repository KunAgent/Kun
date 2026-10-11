import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import kunMagicUrl from '../../../../asset/img/kun_magic.png'
import kunClipUrl from '../../../../asset/img/kun_clip.png'
import kunLaptopUrl from '../../../../asset/img/kun_laptop.png'
import kunWrenchUrl from '../../../../asset/img/kun_wrench.png'
import kunHeadsetUrl from '../../../../asset/img/kun_headset.png'
import { useRemoteMobileLayout } from '../../lib/remote-mobile'
import { useChatStore } from '../../store/chat-store'
import { readCodeTourDue, useCodeTourStore } from './code-tour-store'
import {
  CODE_TOUR_STEPS,
  placeCoach,
  toOverlayBox,
  type Box,
  type CoachPlacement,
  type CodeTourArt,
  type CodeTourStep
} from './code-tour-geometry'
import { CodeTourDone, CodeTourWelcome } from './CodeTourCards'
import './code-tour.css'

const ART: Record<CodeTourArt, string> = {
  magic: kunMagicUrl,
  clip: kunClipUrl,
  laptop: kunLaptopUrl,
  wrench: kunWrenchUrl,
  headset: kunHeadsetUrl
}

/** Wait for Code to settle before greeting; retry while another dialog is up. */
const AUTO_START_DELAY_MS = 1_200
const AUTO_START_RETRY_MS = 1_500
const HINT_MS = 7_000

function visibleTarget(step: CodeTourStep): HTMLElement | null {
  const element = document.querySelector<HTMLElement>(step.selector)
  if (!element) return null
  const rect = element.getBoundingClientRect()
  return rect.width > 4 && rect.height > 4 ? element : null
}

function availableSteps(): CodeTourStep[] {
  return CODE_TOUR_STEPS.filter((step) => visibleTarget(step) !== null)
}

/** First-run setup, the what's-new dialog or any other modal goes first. */
function anotherDialogOpen(): boolean {
  return Boolean(document.querySelector('.kun-onb, [data-whats-new-dialog], [aria-modal="true"], [role="alertdialog"]'))
}

function rectOf(element: Element): Box {
  const rect = element.getBoundingClientRect()
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

function Coach({ steps, index, rootRef }: {
  steps: CodeTourStep[]
  index: number
  rootRef: RefObject<HTMLDivElement | null>
}): ReactElement | null {
  const { t } = useTranslation('common')
  const { goTo, showDone, close } = useCodeTourStore(useShallow((s) => ({ goTo: s.goTo, showDone: s.showDone, close: s.close })))
  const popRef = useRef<HTMLElement | null>(null)
  const [placement, setPlacement] = useState<CoachPlacement | null>(null)
  const step = steps[index]

  const measure = useCallback((): void => {
    const root = rootRef.current
    if (!root || !step) return
    const target = visibleTarget(step)
    if (!target) return
    const overlay = rectOf(root)
    const box = toOverlayBox(rectOf(target), overlay, root.clientWidth)
    const pop = popRef.current
    const popSize = { width: pop?.offsetWidth || 360, height: pop?.offsetHeight || 190 }
    const next = placeCoach(box, { width: root.clientWidth, height: root.clientHeight }, popSize, step.side)
    setPlacement((current) => (current && JSON.stringify(current) === JSON.stringify(next) ? current : next))
  }, [rootRef, step])

  useLayoutEffect(() => { measure() }, [measure])
  useEffect(() => {
    // Sidebars animate and lists load after the step starts; keep following the target.
    const timer = window.setInterval(measure, 400)
    window.addEventListener('resize', measure)
    return () => { window.clearInterval(timer); window.removeEventListener('resize', measure) }
  }, [measure])
  useEffect(() => {
    popRef.current?.querySelector<HTMLElement>('[data-code-tour-primary]')?.focus()
  }, [index])

  if (!step) return null
  const last = index >= steps.length - 1
  const next = (): void => { if (last) showDone(); else goTo(index + 1) }
  const spotStyle: CSSProperties | undefined = placement ? {
    left: placement.spot.left, top: placement.spot.top, width: placement.spot.width, height: placement.spot.height
  } : undefined
  const popStyle: CSSProperties = placement
    ? { left: placement.popover.left, top: placement.popover.top, '--code-tour-caret': `${placement.caret}px` } as CSSProperties
    : { visibility: 'hidden' }

  return (
    <>
      {spotStyle ? <div className="code-tour-spot" style={spotStyle} aria-hidden="true" /> : null}
      <section ref={popRef} className="code-tour-pop" data-side={placement?.side ?? 'right'} style={popStyle}
        role="dialog" aria-modal="true" aria-labelledby="code-tour-pop-title" data-code-tour-step={step.id}>
        <span className="code-tour-caret" aria-hidden="true" />
        <button type="button" className="code-tour-close" aria-label={t('codeTourClose')} onClick={close}>
          <X size={14} strokeWidth={2} aria-hidden="true" />
        </button>
        <div className="code-tour-pop-main">
          <span className="code-tour-pop-art" aria-hidden="true">
            <img src={ART[step.art]} alt="" draggable={false} />
          </span>
          <div className="code-tour-pop-text">
            <span className="code-tour-pop-count">{t('codeTourStepCount', { current: index + 1, total: steps.length })}</span>
            <h3 id="code-tour-pop-title" className="code-tour-pop-title">{t(`codeTourStep_${step.id}_title`)}</h3>
            <p className="code-tour-pop-body">{t(`codeTourStep_${step.id}_body`)}</p>
          </div>
        </div>
        <div className="code-tour-pop-foot">
          <span className="code-tour-dots" aria-hidden="true">
            {steps.map((item, i) => <span key={item.id} className={i === index ? 'is-active' : ''} />)}
          </span>
          <button type="button" className="code-tour-text-button" onClick={close}>{t('codeTourSkip')}</button>
          {index > 0 ? (
            <button type="button" className="code-tour-button is-small" onClick={() => goTo(index - 1)}>{t('codeTourPrev')}</button>
          ) : null}
          <button type="button" className="code-tour-button is-primary is-small" data-code-tour-primary="true" onClick={next}>
            {t(last ? 'codeTourFinish' : 'codeTourNext')}
          </button>
        </div>
      </section>
    </>
  )
}

/** Points once at the replay button under the composer, then fades out. */
function ReplayHint(): ReactElement | null {
  const { t } = useTranslation('common')
  const dismissHint = useCodeTourStore((s) => s.dismissHint)
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const button = document.querySelector('[data-code-tour-replay]')
    if (!button) return
    const zoomed = document.body.getBoundingClientRect().width / Math.max(1, document.body.clientWidth) || 1
    const rect = button.getBoundingClientRect()
    setAnchor({ left: Math.max(12, rect.left / zoomed), top: rect.bottom / zoomed + 8 })
  }, [])
  useEffect(() => {
    const timer = window.setTimeout(dismissHint, HINT_MS)
    return () => window.clearTimeout(timer)
  }, [dismissHint])
  return (
    <button type="button" className="code-tour-hint" role="status" onClick={dismissHint}
      style={anchor ? { left: anchor.left, top: anchor.top, right: 'auto' } : undefined}>
      <img src={kunClipUrl} alt="" draggable={false} />
      <span>{t('codeTourHint')}</span>
    </button>
  )
}

/**
 * Code's first-open guide: a welcome card about the current project, spotlight
 * steps over the real sidebar and home composer, then a few ways to begin.
 * Opens by itself once after first-run setup; replayable from the button under
 * the composer.
 */
export function CodeTour({ setInput }: { setInput: (value: string) => void }): ReactElement | null {
  const remoteMobile = useRemoteMobileLayout()
  const { phase, step, hint, open, startCoach, close } = useCodeTourStore(useShallow((s) => ({
    phase: s.phase, step: s.step, hint: s.hint, open: s.open, startCoach: s.startCoach, close: s.close
  })))
  const { runtimeReady, initialSetupOpen } = useChatStore(useShallow((s) => ({
    runtimeReady: s.runtimeConnection === 'ready',
    initialSetupOpen: s.initialSetupOpen
  })))
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [steps, setSteps] = useState<CodeTourStep[]>([])
  const [welcomeSteps, setWelcomeSteps] = useState(0)

  useEffect(() => {
    if (remoteMobile || phase !== 'idle' || !runtimeReady || initialSetupOpen || !readCodeTourDue()) return
    let timer = 0
    const attempt = (delay: number): void => {
      timer = window.setTimeout(() => {
        if (!readCodeTourDue()) return
        if (anotherDialogOpen() || document.hidden) attempt(AUTO_START_RETRY_MS)
        else open()
      }, delay)
    }
    attempt(AUTO_START_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [initialSetupOpen, open, phase, remoteMobile, runtimeReady])

  useEffect(() => {
    if (phase === 'welcome') setWelcomeSteps(availableSteps().length)
  }, [phase])

  useEffect(() => {
    if (phase === 'idle') return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close()
        return
      }
      if (phase !== 'coach') return
      const state = useCodeTourStore.getState()
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        if (state.step >= steps.length - 1) state.showDone()
        else state.goTo(state.step + 1)
      } else if (event.key === 'ArrowLeft' && state.step > 0) {
        event.preventDefault()
        state.goTo(state.step - 1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [close, phase, steps.length])

  useEffect(() => {
    // Back on the Code home mid-tour (the overlay unmounted with the view): find the targets again.
    if (phase !== 'coach' || steps.length > 0) return
    const found = availableSteps()
    if (found.length > 0) setSteps(found)
    else useCodeTourStore.getState().showDone()
  }, [phase, steps.length])

  const beginCoach = (): void => {
    const found = availableSteps()
    setSteps(found)
    if (found.length === 0) useCodeTourStore.getState().showDone()
    else startCoach()
  }

  const prefill = (prompt: string): void => {
    setInput(prompt)
    window.setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>('[data-primary-floating-composer] textarea')?.focus()
    }, 60)
  }

  if (remoteMobile) return null
  if (phase === 'idle') return hint ? createPortal(<div className="code-tour-root is-passive"><ReplayHint /></div>, document.body) : null

  return createPortal(
    <div ref={rootRef} className="code-tour-root" data-code-tour-phase={phase}>
      <div className={`code-tour-scrim ${phase === 'coach' ? 'is-clear' : ''}`} aria-hidden="true" />
      {phase === 'welcome' ? (
        <CodeTourWelcome stepCount={welcomeSteps} onStart={beginCoach} onSkip={close} />
      ) : phase === 'coach' ? (
        <Coach steps={steps} index={Math.min(step, Math.max(0, steps.length - 1))} rootRef={rootRef} />
      ) : (
        <CodeTourDone onClose={close} onPrefill={prefill} />
      )}
    </div>,
    document.body
  )
}

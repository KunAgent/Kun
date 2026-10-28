import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import kunGreetUrl from '../../../../asset/img/kun_greet.png'
import kunMagicUrl from '../../../../asset/img/kun_magic.png'
import kunClipUrl from '../../../../asset/img/kun_clip.png'
import kunLaptopUrl from '../../../../asset/img/kun_laptop.png'
import kunWrenchUrl from '../../../../asset/img/kun_wrench.png'
import kunHeadsetUrl from '../../../../asset/img/kun_headset.png'
import kunSearchUrl from '../../../../asset/img/kun_search.png'
import kunCheerUrl from '../../../../asset/img/kun_cheer.png'
import { useGuidedTourStore } from './guided-tour-store'
import { GUIDED_TOURS, type GuidedTourArt, type GuidedTourId, type GuidedTourStep } from './guided-tour-steps'
import { placeCoach, toOverlayBox, type Box, type CoachPlacement } from './guided-tour-geometry'
import { GuidedTourLastActions } from './GuidedTourLastActions'
import './guided-tour.css'

const ART: Record<GuidedTourArt, string> = {
  greet: kunGreetUrl,
  magic: kunMagicUrl,
  clip: kunClipUrl,
  laptop: kunLaptopUrl,
  wrench: kunWrenchUrl,
  headset: kunHeadsetUrl,
  search: kunSearchUrl,
  cheer: kunCheerUrl
}

export function visibleTarget(selector: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    const rect = element.getBoundingClientRect()
    if (rect.width > 4 && rect.height > 4) return element
  }
  return null
}

/** The tour's steps whose targets are on screen right now. */
export function availableSteps(id: GuidedTourId): GuidedTourStep[] {
  return GUIDED_TOURS[id].steps.filter((step) => visibleTarget(step.selector) !== null)
}

function rectOf(element: Element): Box {
  const rect = element.getBoundingClientRect()
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

function Coach({ tour, steps, index, rootRef }: {
  tour: GuidedTourId
  steps: GuidedTourStep[]
  index: number
  rootRef: RefObject<HTMLDivElement | null>
}): ReactElement | null {
  const { t } = useTranslation('common')
  const goTo = useGuidedTourStore((s) => s.goTo)
  const close = useGuidedTourStore((s) => s.close)
  const popRef = useRef<HTMLElement | null>(null)
  const [placement, setPlacement] = useState<CoachPlacement | null>(null)
  const step = steps[index]
  const middle = steps.filter((item) => !item.kind)
  const middleIndex = step ? middle.indexOf(step) : -1

  const measure = useCallback((): void => {
    const root = rootRef.current
    if (!root || !step) return
    const target = visibleTarget(step.selector)
    if (!target) return
    const box = toOverlayBox(rectOf(target), rectOf(root), root.clientWidth)
    const pop = popRef.current
    const popSize = { width: pop?.offsetWidth || 340, height: pop?.offsetHeight || 190 }
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
    popRef.current?.querySelector<HTMLElement>('[data-guided-tour-primary]')?.focus()
  }, [index])

  if (!step) return null
  const last = index >= steps.length - 1
  const next = (): void => { if (last) close(); else goTo(index + 1) }
  const spotStyle: CSSProperties | undefined = placement ? {
    left: placement.spot.left, top: placement.spot.top, width: placement.spot.width, height: placement.spot.height
  } : undefined
  const popStyle: CSSProperties = placement
    ? { left: placement.popover.left, top: placement.popover.top, '--guided-tour-caret': `${placement.caret}px` } as CSSProperties
    : { visibility: 'hidden' }
  const key = `guidedTour_${tour}_${step.id}`

  return (
    <>
      {spotStyle ? <div className="guided-tour-spot" style={spotStyle} aria-hidden="true" /> : null}
      <section ref={popRef} className={`guided-tour-pop${step.kind === 'last' ? ' is-last' : ''}`}
        data-side={placement?.side ?? 'right'} style={popStyle}
        role="dialog" aria-modal="true" aria-labelledby="guided-tour-pop-title"
        data-guided-tour={tour} data-guided-tour-step={step.id}>
        <span className="guided-tour-caret" aria-hidden="true" />
        <button type="button" className="guided-tour-close" aria-label={t('guidedTourClose')} onClick={close}>
          <X size={14} strokeWidth={2} aria-hidden="true" />
        </button>
        <div className="guided-tour-pop-main">
          <span className="guided-tour-pop-art" aria-hidden="true">
            <img src={ART[step.art]} alt="" draggable={false} />
          </span>
          <div className="guided-tour-pop-text">
            {middleIndex >= 0 ? (
              <span className="guided-tour-pop-count">
                {t('guidedTourStepCount', { current: middleIndex + 1, total: middle.length })}
              </span>
            ) : null}
            <h3 id="guided-tour-pop-title" className="guided-tour-pop-title">{t(`${key}_title`)}</h3>
            <p className="guided-tour-pop-body">{t(`${key}_body`)}</p>
          </div>
        </div>
        {step.kind === 'intro' ? (
          <div className="guided-tour-pop-foot">
            <span className="guided-tour-foot-hint">{t('guidedTourEscHint')}</span>
            <button type="button" className="guided-tour-text-button" onClick={close}>{t('guidedTourLater')}</button>
            <button type="button" className="guided-tour-button is-primary is-small" data-guided-tour-primary="true" onClick={next}>
              {t('guidedTourStart')}
            </button>
          </div>
        ) : step.kind === 'last' ? (
          <GuidedTourLastActions tour={tour} onBack={index > 0 ? () => goTo(index - 1) : undefined} />
        ) : (
          <div className="guided-tour-pop-foot">
            <span className="guided-tour-dots" aria-hidden="true">
              {middle.map((item) => <span key={item.id} className={item === step ? 'is-active' : ''} />)}
            </span>
            <button type="button" className="guided-tour-text-button" onClick={close}>{t('guidedTourSkip')}</button>
            {index > 0 ? (
              <button type="button" className="guided-tour-button is-small" onClick={() => goTo(index - 1)}>{t('guidedTourPrev')}</button>
            ) : null}
            <button type="button" className="guided-tour-button is-primary is-small" data-guided-tour-primary="true" onClick={next}>
              {t(last ? 'guidedTourFinish' : 'guidedTourNext')}
            </button>
          </div>
        )}
      </section>
    </>
  )
}

/**
 * A spotlight tour over the real app: every card points at a control and says what it does.
 * The opening card asks to start, the closing card carries the tour's own next steps.
 */
export function GuidedTour({ tour }: { tour: GuidedTourId }): ReactElement | null {
  const step = useGuidedTourStore((s) => s.step)
  const close = useGuidedTourStore((s) => s.close)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [steps] = useState<GuidedTourStep[]>(() => availableSteps(tour))

  useEffect(() => {
    if (steps.length === 0) close()
  }, [close, steps.length])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const state = useGuidedTourStore.getState()
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        state.close()
        return
      }
      const current = steps[state.step]
      if (!current || current.kind) return
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        state.goTo(Math.min(state.step + 1, steps.length - 1))
      } else if (event.key === 'ArrowLeft' && state.step > 0) {
        event.preventDefault()
        state.goTo(state.step - 1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [steps])

  if (steps.length === 0) return null
  return createPortal(
    <div ref={rootRef} className="guided-tour-root" data-guided-tour-active={tour}>
      <div className="guided-tour-scrim" aria-hidden="true" />
      <Coach tour={tour} steps={steps} index={Math.min(step, steps.length - 1)} rootRef={rootRef} />
    </div>,
    document.body
  )
}

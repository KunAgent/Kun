import type { KeyboardEvent, ReactElement, ReactNode } from 'react'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import kunMarkUrl from '../../../../asset/img/kun_tray_mac.svg?url'
import kunGreetUrl from '../../../../asset/img/kun_greet.png'
import kunWrenchUrl from '../../../../asset/img/kun_wrench.png'
import kunHeadsetUrl from '../../../../asset/img/kun_headset.png'
import kunSearchUrl from '../../../../asset/img/kun_search.png'
import kunCheerUrl from '../../../../asset/img/kun_cheer.png'
import {
  ONBOARDING_STEPS,
  canOpenOnboardingStep,
  onboardingStepIndex,
  type OnboardingDirection,
  type OnboardingStep
} from './onboarding-steps'

/** Painted Kun poses, one per step; the art is never redrawn as vectors. */
const MASCOTS: Readonly<Record<OnboardingStep, { src: string; width: number; shadowBottom: number }>> = {
  welcome: { src: kunGreetUrl, width: 178, shadowBottom: -2 },
  model: { src: kunWrenchUrl, width: 196, shadowBottom: 24 },
  permission: { src: kunHeadsetUrl, width: 196, shadowBottom: 22 },
  agents: { src: kunSearchUrl, width: 196, shadowBottom: 22 },
  ready: { src: kunCheerUrl, width: 206, shadowBottom: 20 }
}

const STARS: ReadonlyArray<{ left: string; top: string; delay: string; big?: boolean }> = [
  { left: '12%', top: '9%', delay: '.2s' },
  { left: '78%', top: '6%', delay: '1.1s', big: true },
  { left: '64%', top: '18%', delay: '2.3s' },
  { left: '88%', top: '31%', delay: '.7s' },
  { left: '22%', top: '38%', delay: '1.8s', big: true },
  { left: '52%', top: '44%', delay: '2.9s' },
  { left: '8%', top: '56%', delay: '1.4s' },
  { left: '92%', top: '60%', delay: '.4s' },
  { left: '70%', top: '50%', delay: '3.2s' },
  { left: '36%', top: '64%', delay: '2.1s', big: true }
]

const WAVES = [
  'M0 62 C100 34 200 34 300 62 S500 90 600 62 S800 34 900 62 S1100 90 1200 62 V112 H0 Z',
  'M0 58 C120 82 180 82 300 58 S480 34 600 58 S780 82 900 58 S1080 34 1200 58 V112 H0 Z',
  'M0 66 C90 46 210 46 300 66 S510 86 600 66 S810 46 900 66 S1110 86 1200 66 V112 H0 Z'
]

export type OnboardingShellProps = {
  step: OnboardingStep
  direction: OnboardingDirection
  /** Bumps when content inside a step changes enough to replay the entrance. */
  contentKey: string
  saved: boolean
  preview: boolean
  leaving: boolean
  stepDetails: Readonly<Record<OnboardingStep, string>>
  bubble: string
  title: string
  subtitle: string
  optional?: boolean
  skipLabel?: string
  skipDisabled?: boolean
  onSkip?: () => void
  onStepSelect: (step: OnboardingStep) => void
  onEnter?: (event: KeyboardEvent<HTMLElement>) => void
  footer: ReactNode
  overlay?: ReactNode
  children: ReactNode
}

export function OnboardingShell(props: OnboardingShellProps): ReactElement {
  const { t } = useTranslation('settings')
  const currentIndex = onboardingStepIndex(props.step)
  const mascot = MASCOTS[props.step]
  return (
    <div className="kun-onb ds-no-drag" data-leaving={props.leaving ? 'true' : undefined} data-onboarding-step={props.step}>
      <div className="kun-onb-scrim" aria-hidden="true" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="kun-onb-title"
        className="kun-onb-dialog"
        onKeyDown={props.onEnter}
      >
        <aside className="kun-onb-stage" aria-label={t('onboarding.progressLabel')}>
          <div className="kun-onb-aurora" aria-hidden="true"><span /><span /><span /></div>
          <div className="kun-onb-stars" aria-hidden="true">
            {STARS.map((star) => (
              <i
                key={`${star.left}-${star.top}`}
                className={star.big ? 'is-big' : undefined}
                style={{ left: star.left, top: star.top, animationDelay: star.delay }}
              />
            ))}
          </div>
          <span className="kun-onb-moon" aria-hidden="true" />
          <div className="kun-onb-brand">
            <span className="kun-onb-logo" aria-hidden="true" style={{ ['--kun-onb-mark' as string]: `url("${kunMarkUrl}")` }}>
              <span />
            </span>
            <b>Kun</b>
            <span className="kun-onb-badge">{t(props.preview ? 'onboarding.previewBadge' : 'onboarding.badge')}</span>
          </div>
          <ol className="kun-onb-steps">
            {ONBOARDING_STEPS.map((step, index) => {
              const state = index < currentIndex ? 'is-done' : index === currentIndex ? 'is-current' : ''
              const reachable = index !== currentIndex && canOpenOnboardingStep(step, props.step, props.saved)
              const content = (
                <>
                  <span className="kun-onb-step-dot">
                    {index < currentIndex ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : index === currentIndex ? <i /> : null}
                  </span>
                  <span className="kun-onb-step-text">
                    <b>{t(`onboarding.steps.${step}.title`)}</b>
                    <small>{props.stepDetails[step]}</small>
                  </span>
                </>
              )
              return (
                <li key={step} className={state} aria-current={index === currentIndex ? 'step' : undefined}>
                  {reachable && !props.leaving ? (
                    <button type="button" className="kun-onb-step" onClick={() => props.onStepSelect(step)}>{content}</button>
                  ) : (
                    <span className="kun-onb-step">{content}</span>
                  )}
                </li>
              )
            })}
          </ol>
          <div className="kun-onb-hero" aria-hidden="true">
            <p key={props.bubble} className="kun-onb-bubble" style={{ marginTop: 0 }}>{props.bubble}</p>
            <div key={props.step} className="kun-onb-mascot" data-pose={props.step}>
              <img src={mascot.src} alt="" draggable={false} style={{ width: mascot.width }} />
              <span className="kun-onb-mascot-shadow" style={{ bottom: mascot.shadowBottom }} />
            </div>
          </div>
          <div className="kun-onb-waves" aria-hidden="true">
            {WAVES.map((path) => (
              <svg key={path} viewBox="0 0 1200 112" preserveAspectRatio="none"><path d={path} /></svg>
            ))}
          </div>
        </aside>

        <div className="kun-onb-main">
          <header key={`head-${props.step}`} className="kun-onb-head kun-onb-enter" data-direction={props.direction}>
            <div className="kun-onb-eyebrow">
              <span>
                {t('onboarding.stepCounter', { current: currentIndex + 1, total: ONBOARDING_STEPS.length })}
                {props.optional ? ` · ${t('onboarding.optional')}` : ''}
              </span>
              {props.onSkip ? (
                <button type="button" className="kun-onb-skip" onClick={props.onSkip} disabled={props.skipDisabled} data-onboarding-skip>
                  {props.skipLabel}
                </button>
              ) : null}
            </div>
            <h1 id="kun-onb-title" className="kun-onb-title">{props.title}</h1>
            <p className="kun-onb-subtitle">{props.subtitle}</p>
          </header>
          <div key={props.contentKey} className="kun-onb-body kun-onb-enter" data-direction={props.direction}>
            {props.children}
          </div>
          <footer className="kun-onb-foot">{props.footer}</footer>
          {props.overlay}
        </div>
      </section>
    </div>
  )
}

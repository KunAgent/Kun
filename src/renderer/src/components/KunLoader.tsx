import { useState, type ReactElement } from 'react'
import kunBird from '../../../asset/img/kun_bird.png'

type KunLoaderProps = {
  label: string
  /** Fill the parent and center the loader on the main surface. */
  fill?: boolean
  className?: string
}

// Two crests per half of the path, so sliding the 200%-wide SVG by -50% loops seamlessly.
const WAVE_PATH = 'M0 10 Q15 3 30 10 T60 10 T90 10 T120 10 T150 10 T180 10 T210 10 T240 10 V24 H0 Z'

/** Trailing ellipsis is replaced by the animated dots. */
export function kunLoaderLabelText(label: string): string {
  return label.replace(/[\s.。…]+$/u, '')
}

function Sea({ layer }: { layer: 'back' | 'front' }): ReactElement {
  return (
    <span className={`kun-loader__sea kun-loader__sea--${layer}`}>
      <svg className="kun-loader__wave" viewBox="0 0 240 24" preserveAspectRatio="none">
        <path d={WAVE_PATH} />
      </svg>
    </span>
  )
}

/**
 * Shared desktop loading state: Kun rides rolling waves, hops now and then,
 * and spins when clicked. Fades in after a short delay so fast
 * loads do not flash; styles live in styles/kun-loader.css.
 */
export function KunLoader({ label, fill = false, className = '' }: KunLoaderProps): ReactElement {
  const [flipping, setFlipping] = useState(false)
  const loader = (
    <div className={`kun-loader ${fill ? '' : className}`.trim()} role="status" aria-live="polite">
      <div className="kun-loader__scene" aria-hidden="true">
        <span className="kun-loader__bubble" />
        <span className="kun-loader__bubble" />
        <span className="kun-loader__bubble" />
        <Sea layer="back" />
        <span className="kun-loader__rider">
          <img
            className="kun-loader__bird"
            src={kunBird}
            alt=""
            draggable={false}
            data-flip={flipping || undefined}
            onClick={() => setFlipping(true)}
            onAnimationEnd={(event) => {
              if (event.animationName === 'kun-loader-flip') setFlipping(false)
            }}
          />
        </span>
        <span className="kun-loader__splash"><i /><i /></span>
        <Sea layer="front" />
      </div>
      <span className="kun-loader__label">
        {kunLoaderLabelText(label)}
        <span className="kun-loader__dots" aria-hidden="true"><i /><i /><i /></span>
      </span>
    </div>
  )
  if (!fill) return loader
  return (
    <div className={`flex h-full min-h-0 w-full items-center justify-center bg-ds-main ${className}`.trim()}>
      {loader}
    </div>
  )
}

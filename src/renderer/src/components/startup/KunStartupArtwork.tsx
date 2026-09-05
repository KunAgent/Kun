import type { ReactElement } from 'react'
import kunWordmarkUrl from '../../assets/startup/kun-startup-wordmark.webp'
import {
  KUN_STARTUP_VARIANT_CONFIG,
  type KunStartupVariant
} from './kun-startup-variants'

export type KunStartupMotion = 'running' | 'paused'

export function KunStartupArtwork({
  motion,
  variant = 'signal'
}: {
  motion: KunStartupMotion
  variant?: KunStartupVariant
}): ReactElement {
  const variantConfig = KUN_STARTUP_VARIANT_CONFIG[variant]

  return (
    <div
      className="kun-startup__artwork kun-startup__motion"
      data-motion={motion}
      data-variant={variant}
      data-testid="kun-startup-artwork"
      aria-hidden="true"
    >
      <span className="kun-startup-artwork__variant-aura kun-startup__motion" />
      <span className="kun-startup-artwork__variant-streaks kun-startup__motion" />
      <span className="kun-startup-artwork__prop-wrap kun-startup__motion">
        <img
          className="kun-startup-artwork__prop"
          src={variantConfig.propUrl}
          width="384"
          height="384"
          alt=""
          draggable={false}
          data-variant={variant}
          data-testid="kun-startup-prop"
        />
      </span>

      <div
        className="kun-startup-artwork__orbit"
        data-testid="kun-startup-orbit"
      >
        <span className="kun-startup-artwork__orbit-track" />
        <span className="kun-startup-artwork__orbit-runner kun-startup__motion">
          <span className="kun-startup-artwork__particle" />
        </span>
        <span className="kun-startup-artwork__orbit-runner kun-startup-artwork__orbit-runner--secondary kun-startup__motion">
          <span className="kun-startup-artwork__particle kun-startup-artwork__particle--secondary" />
        </span>
      </div>

      <div
        className="kun-startup-artwork__workspace-link"
        data-testid="kun-startup-workspace-link"
      >
        <svg
          className="kun-startup-artwork__workspace-rail"
          viewBox="0 0 300 78"
          preserveAspectRatio="none"
          focusable="false"
        >
          <path
            className="kun-startup-artwork__workspace-track"
            d="M 6 60 C 47 58, 72 31, 99 36 S 121 53, 134 48"
            pathLength="100"
          />
          <path
            className="kun-startup-artwork__workspace-flow kun-startup__motion"
            d="M 6 60 C 47 58, 72 31, 99 36 S 121 53, 134 48"
            pathLength="100"
          />
        </svg>
        <span className="kun-startup-artwork__workspace-node kun-startup-artwork__workspace-node--source" />
        <span className="kun-startup-artwork__workspace-node kun-startup-artwork__workspace-node--relay" />
        <span className="kun-startup-artwork__workspace-target kun-startup__motion">
          <svg
            className="kun-startup-artwork__workspace-icon"
            viewBox="0 0 28 24"
            focusable="false"
          >
            <path d="M3.5 8.5h8l2.4-3h5.6c1.1 0 2 .9 2 2v1" />
            <path d="M4 8.5h20l-2.2 10.2a2 2 0 0 1-2 1.6H5.7a2 2 0 0 1-2-2V10.5c0-1.1.9-2 2-2" />
          </svg>
        </span>
      </div>

      <span
        className="kun-startup-artwork__hologram kun-startup__motion"
        data-testid="kun-startup-hologram"
        data-wordmark="KUN"
      >
        <img
          className="kun-startup-artwork__wordmark"
          src={kunWordmarkUrl}
          width="720"
          height="248"
          alt=""
          draggable={false}
          data-testid="kun-startup-wordmark"
        />
        <span className="kun-startup-artwork__hologram-scan kun-startup__motion" />
        <span className="kun-startup-artwork__hologram-nodes kun-startup__motion">
          <i />
          <i />
          <i />
          <i />
        </span>
      </span>

      <span className="kun-startup-artwork__bird-wrap kun-startup__motion">
        <img
          className="kun-startup-artwork__bird"
          src={variantConfig.birdUrl}
          width="384"
          height="384"
          alt=""
          draggable={false}
          data-variant={variant}
          data-testid="kun-startup-bird"
        />
      </span>

      <span className="kun-startup-artwork__character-wrap kun-startup__motion">
        <img
          className="kun-startup-artwork__character"
          src={variantConfig.avatarUrl}
          width="768"
          height="768"
          alt=""
          draggable={false}
          data-variant={variant}
          data-testid="kun-startup-kun"
        />
      </span>
    </div>
  )
}

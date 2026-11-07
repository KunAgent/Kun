import type { ReactElement, Ref } from 'react'
import type { StoryPropKind } from './pet-story-types'

/** Small scene objects with readable silhouettes; no generic badge orbit. */
export function PetStoryProp({
  kind,
  elementRef
}: {
  kind: StoryPropKind
  elementRef: Ref<SVGSVGElement>
}): ReactElement {
  const line = '#796550',
    cream = '#fff4d9',
    blue = '#9ed8df',
    pink = '#edb7b7',
    gold = '#efc56a'
  let art: ReactElement
  switch (kind) {
    case 'ball':
      art = (
        <>
          <circle r="37" fill="#e8a45d" />
          <path d="M-36 0h72M0-37v74M-25-27q42 22 50 54M25-27q-42 22-50 54" fill="none" />
        </>
      )
      break
    case 'book':
      art = (
        <>
          <path d="M-43-21Q-20-31 0-20Q20-31 43-21V30Q20 22 0 33Q-20 22-43 30Z" fill="#dfb884" />
          <g style={{ transform: 'scaleX(calc(.12 + var(--pet-prop-detail, 0) * .88))' }}>
            <path d="M-39-26Q-20-34 0-22Q20-34 39-26V23Q20 17 0 29Q-20 17-39 23Z" fill="#fff9e9" />
            <path
              d="M0-22v51M-31-12l22 1M-31-2l22 1M-31 8l18 1M9-11l22-1M9 0l22-1M9 11l18-1"
              fill="none"
              opacity=".55"
            />
          </g>
        </>
      )
      break
    case 'page':
      art = (
        <g style={{ transformOrigin: '0px 0px', transform: 'scaleX(calc(1 - var(--pet-prop-detail, 0) * 2))' }}>
          <path d="M0-25Q20-34 43-26V27Q20 20 0 30Z" fill="#fffdf3" />
          <path d="M8-12l27-1M8-1l27-1M8 10l20-1" opacity=".45" />
        </g>
      )
      break
    case 'table':
      art = (
        <>
          <path d="M-32 5l-5 36M32 5l5 36" strokeWidth="6" />
          <ellipse cy="1" rx="48" ry="13" fill="#d2af87" />
          <ellipse cy="-4" rx="48" ry="13" fill="#ecd2a9" />
          <path d="M-27-5q18-6 38-2" stroke="#fff0d2" fill="none" />
        </>
      )
      break
    case 'cup':
      art = (
        <>
          <path d="M25-18h8q24 0 17 23q-4 10-21 7" fill="none" strokeWidth="7" />
          <path d="M-30-22h60l-4 47q-26 18-52 0Z" fill={cream} />
          <ellipse cy="-22" rx="30" ry="8" fill="#be9369" />
          <ellipse cy="33" rx="40" ry="7" fill={cream} />
          <g opacity=".5" stroke="#c6b99f" fill="none" style={{ opacity: 'var(--pet-prop-detail, 0)' }}>
            <path d="M-13-32q-8-10 0-17M8-32q8-10 0-17" />
          </g>
        </>
      )
      break
    case 'pot':
      art = (
        <>
          <path d="M-22-12l-26-11l13 31l20 8M26-15q29-15 24 19q-2 16-20 12" fill={cream} />
          <ellipse cy="8" rx="31" ry="29" fill={cream} />
          <path d="M-25-15q25-19 50 0Z" fill={blue} />
          <circle cy="-26" r="5" fill={gold} />
          <path d="M-5-2q-12 12 0 23q12-11 0-23" fill={blue} stroke="none" />
          <path
            d="M-46-18q-14 24-8 44"
            fill="none"
            stroke="#abd7df"
            strokeWidth="4"
            style={{ opacity: 'var(--pet-prop-detail, 0)' }}
          />
        </>
      )
      break
    case 'gift':
      art = (
        <>
          <rect x="-33" y="-11" width="66" height="49" rx="5" fill={pink} />
          <path d="M-5-10h10v48H-5Z" fill={cream} stroke="none" />
          <g
            style={{
              transform:
                'translateY(calc(var(--pet-prop-detail, 0) * -28px)) rotate(calc(var(--pet-prop-detail, 0) * -14deg))'
            }}
          >
            <rect x="-38" y="-21" width="76" height="15" rx="4" fill="#f4cbca" />
            <path d="M0-21q-29 0-23-18q9-18 23 18q14-36 23-18q6 18-23 18" fill={gold} />
          </g>
        </>
      )
      break
    case 'ribbon':
      art = <path d="M-13-35h26v70L0 24l-13 11Z" fill={pink} />
      break
    case 'bulb':
      art = (
        <>
          <circle cy="-9" r="29" fill={cream} />
          <path d="M-16 14l4 16h24l4-16M-11 37h22M-6 43H6M-6 24l-4-26l10 7l10-7l-4 26" fill={gold} />
          <g fill="none" stroke={gold} strokeWidth="4" style={{ opacity: 'var(--pet-prop-detail, 0)' }}>
            <path d="M0-44v-8M-37-32l-7-7M37-32l7-7M-42-5h-9M42-5h9" />
            <circle cy="-9" r="21" fill="#fbe6a3" stroke="none" />
          </g>
        </>
      )
      break
    case 'computer':
      art = (
        <>
          <rect x="-39" y="-34" width="78" height="54" rx="6" fill="#d8e5dd" />
          <rect x="-32" y="-27" width="64" height="38" rx="3" fill="#557778" />
          <path d="M-39 20l-9 16q0 6 48 6t48-6l-9-16Z" fill="#e8eee2" />
          <path d="M-22 28h44M-14 34h28" fill="none" />
          <path d="M-23-12h17M-23-1h27" stroke="#d0e6d6" />
          <path d="M-24 5h48" stroke="#314f54" strokeWidth="4" />
          <path
            d="M-24 5h48"
            stroke={gold}
            strokeWidth="4"
            pathLength="1"
            strokeDasharray="1"
            style={{ strokeDashoffset: 'calc(1 - var(--pet-prop-detail, 0))' }}
          />
        </>
      )
      break
    case 'brick':
      art = (
        <>
          <path d="M-30-20L0-33l30 13v44L0 38l-30-14Z" fill={blue} />
          <path d="M-30-20L0-6l30-14M0-6v44" fill="none" />
          <path d="M-8-16l8-4l8 4l-8 4Z" fill={cream} />
        </>
      )
      break
    case 'bug':
      art = (
        <>
          <path d="M-21-8l-17-11M-24 4h-17M-20 16l-17 12M21-8l17-11M24 4h17M20 16l17 12" fill="none" />
          <ellipse cy="5" rx="24" ry="30" fill="#b1c69a" />
          <circle cy="-26" r="14" fill="#cfdbbc" />
          <path d="M0-17v50M-7-35l-6-10M7-35l6-10" fill="none" />
          <circle cx="-6" cy="-26" r="2" />
          <circle cx="6" cy="-26" r="2" />
        </>
      )
      break
    case 'net':
      art = (
        <>
          <path d="M0 2v45" strokeWidth="6" />
          <ellipse cy="-18" rx="31" ry="25" fill="#d3e4dc88" />
          <path d="M-22-35l32 38M-8-42l32 34M22-35L-10 3M8-42L-24-8" fill="none" strokeWidth="1.3" />
          <ellipse cy="-18" rx="31" ry="25" fill="none" strokeWidth="4" />
        </>
      )
      break
    case 'star':
      art = <path d="M0-37l11 24l27 4l-20 19l5 27L0 24l-23 13l5-27l-20-19l27-4Z" fill={gold} />
      break
    case 'moon':
      art = <path d="M14-37A38 38 0 1 0 36 20A32 32 0 0 1 14-37Z" fill="#f7d99b" />
      break
    case 'bubble':
      art = (
        <g style={{ transform: 'scaleY(calc(1 - var(--pet-prop-detail, 0) * .75))' }}>
          <circle r="34" fill="#b3e0e63b" stroke="#97c8d3" />
          <path d="M-23-14q8-16 23-15" stroke="#fff" strokeWidth="5" fill="none" />
          <path d="M19 22q9-6 11-16" stroke={pink} strokeWidth="4" fill="none" />
        </g>
      )
      break
    case 'wand':
      art = (
        <>
          <path d="M0 1v42" strokeWidth="6" stroke="#a8c59c" />
          <circle cy="-20" r="21" fill="none" strokeWidth="5" stroke="#a8c59c" />
        </>
      )
      break
    case 'note':
      art = (
        <>
          <path d="M-8 22v-53l40-10v50M-8-18l40-10" fill="none" strokeWidth="5" />
          <ellipse cx="-18" cy="26" rx="15" ry="10" fill={gold} transform="rotate(-20 -18 26)" />
          <ellipse cx="22" cy="12" rx="15" ry="10" fill={gold} transform="rotate(-20 22 12)" />
        </>
      )
      break
    case 'drum':
      art = (
        <>
          <path d="M-35-18v43q35 21 70 0v-43" fill={pink} />
          <path d="M-30-8l13 35L0-3l17 30L30-8" fill="none" stroke={cream} strokeWidth="4" />
          <ellipse cy="-18" rx="35" ry="14" fill={cream} />
          <path d="M-34 25q34 16 68 0" fill="none" />
        </>
      )
      break
    case 'flag':
      art = (
        <>
          <path d="M-19-44v87M-34 43h30" fill="none" strokeWidth="4" />
          <path d="M-17-42h47l-9 17l9 17h-47Z" fill={pink} />
          <path d="M-12-35H19M-12-17H19" stroke={cream} />
        </>
      )
      break
    case 'baton':
      art = <rect x="-7" y="-39" width="14" height="78" rx="7" fill={gold} />
      break
    case 'bush':
      art = (
        <>
          <path d="M-45 27q-19-27 6-37q-4-28 20-26q18-27 35 0q28-13 28 18q28 16 6 45Z" fill="#a9c493" />
          <path d="M-27 4q11-12 18 3M7-12q15-7 21 4M-6 20q10-9 17-1" fill="none" stroke="#7fa276" />
        </>
      )
      break
    case 'spark':
      art = (
        <g stroke={gold} strokeWidth="4" fill="none">
          <path d="M0-36v13M0 23v13M-36 0h13M23 0h13M-26-26l10 10M16 16l10 10M-26 26l10-10M16-16l10-10" />
        </g>
      )
      break
    case 'heart':
      art = <path d="M0 34C-60 0-28-52 0-22C28-52 60 0 0 34Z" fill={pink} />
      break
    case 'plant':
      art = (
        <>
          <path d="M-20 11h40l-5 32h-30Z" fill="#d6b18e" />
          <path d="M0 12v-31" fill="none" />
          <path d="M0-8q-30-1-28-26q28-1 28 26M0-16q6-29 29-25q1 24-29 25" fill="#a8cfa0" />
        </>
      )
      break
    case 'constellation':
      art = <path d="M-45-3L-10-25L27-5L44 27" fill="none" stroke="#e3c77d" strokeDasharray="3 5" />
      break
  }
  return (
    <svg
      ref={elementRef}
      className="pet-story-prop"
      viewBox="-55 -55 110 110"
      aria-hidden="true"
      fill="none"
      stroke={line}
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {art}
    </svg>
  )
}

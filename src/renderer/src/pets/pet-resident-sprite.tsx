import { useRef, type ButtonHTMLAttributes, type ReactElement } from 'react'
import { PET_SHEET_COLUMNS, petSheetRowsForVersion, type PetAnimationState, type PetSpriteVersion } from '@shared/pets'
import { frameAtElapsedMs, nextFrameDelayMs, staticFrame } from './pet-animation'
import { paintPetStyle, usePetAnimationPainter } from './use-pet-animation-painter'

export function PetResidentSprite({ animation, version, sheet, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  animation: PetAnimationState; version: PetSpriteVersion; sheet?: string | null
}): ReactElement {
  const actor = useRef<HTMLButtonElement>(null)
  usePetAnimationPainter(`${sheet}:${animation}:${version}`, false, ({ elapsed, reduced }) => {
    const frame = reduced ? staticFrame(animation, version) : frameAtElapsedMs(animation, elapsed, version)
    paintPetStyle(actor.current, { backgroundPosition: frame.backgroundPosition })
    return nextFrameDelayMs(animation, elapsed)
  })
  return <button {...props} ref={actor} style={{ ...props.style,
    backgroundImage: sheet ? `url("${sheet}")` : undefined,
    backgroundSize: `${PET_SHEET_COLUMNS * 100}% ${petSheetRowsForVersion(version) * 100}%` }} />
}

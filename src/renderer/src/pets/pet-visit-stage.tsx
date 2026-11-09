import type { ButtonHTMLAttributes, ReactElement } from 'react'
import type { PetOverlayBootstrap, PetSummary } from '@shared/pets'
import type { PetVisit } from '@shared/pets-visits'
import { PetBottleStage } from './pet-bottle-stage'
import { PetJointStage } from './joint/joint-stage'
import './pet-visits.css'

export type PetVisitStageProps = {
  visit: PetVisit; pet: PetOverlayBootstrap; pets: PetSummary[]; width: number; height: number
  primaryOrigin: { x: number; y: number }; mascotWidth: number; language: string
  actorEvents: ButtonHTMLAttributes<HTMLButtonElement>; onDismiss: () => void
}

export function PetVisitStage(props: PetVisitStageProps): ReactElement {
  return props.visit.reason === 'bottle' ? <PetBottleStage {...props} /> : <PetJointStage {...props} />
}

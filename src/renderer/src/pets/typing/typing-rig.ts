import type { PetJointRig } from '@shared/pets-joint'
import type { PetSummary } from '@shared/pets'

/** Typing reaches use the blue wing itself, keeping Xiao Kun's cheeks outside the arm mask. */
export function petTypingRig(pet: Pick<PetSummary, 'id' | 'interactions'>): PetJointRig | undefined {
  const rig = pet.interactions?.joint
  if (!rig || pet.id !== 'kun:xiao-kun') return rig
  return { ...rig, arms: [
    { shoulder: [.15, .59], hand: [.105, .72], radius: .032 },
    { shoulder: [.71, .64], hand: [.80, .75], radius: .075 }
  ] }
}

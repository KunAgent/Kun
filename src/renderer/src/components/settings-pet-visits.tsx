import { useState, type ReactElement } from 'react'
import type { PetDesktopBridge, PetSettings, PetSummary } from '@shared/pets'
import { defaultPetVisits } from '@shared/pets-visits'
import { PetVisitControls } from '../pets/pet-visit-controls'
import { petEnsembleText } from '../pets/pet-ensemble-catalog'

export function SettingsPetVisits(props: {
  pets: PetSummary[]; settings: PetSettings | null; api: PetDesktopBridge
  language: string; onSettings: (settings: PetSettings) => void
}): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const canInvite = Boolean(props.settings?.selectedPetId && props.pets.some((pet) =>
    pet.id !== props.settings?.selectedPetId && pet.source === 'kun-builtin' && pet.available))
  return <details className="pet-visits-settings" onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>{petEnsembleText(['伙伴来访 · 默认自然发生', 'Visiting friends · naturally enabled'], props.language)}</summary>
    {expanded ? <PetVisitControls value={props.settings?.visits ?? defaultPetVisits()} canInvite={canInvite} language={props.language}
      onPreferences={async (next) => props.onSettings(await props.api.setPetVisitPreferences(next))}
      onInvite={async (scene) => {
        await props.api.requestPetVisit(scene)
        props.onSettings(await props.api.getPetSettings())
      }} /> : null}
  </details>
}

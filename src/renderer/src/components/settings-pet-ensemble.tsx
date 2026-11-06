import { useRef, useState, type ReactElement } from 'react'
import type { PetDesktopBridge, PetSettings, PetSummary } from '@shared/pets'
import { defaultPetEnsemble } from '@shared/pets-ensemble'
import { PetEnsembleControls } from '../pets/pet-ensemble-controls'
import { PetEnsembleStage } from '../pets/pet-ensemble-stage'
import { petEnsembleText } from '../pets/pet-ensemble-catalog'
import { usePetSurfaceSize } from '../pets/use-pet-surface-size'

export function SettingsPetEnsemble(props: {
  pets: PetSummary[]; settings: PetSettings | null; api: PetDesktopBridge
  language: string; onSettings: (settings: PetSettings) => void
}): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const preview = useRef<HTMLDivElement>(null)
  const size = usePetSurfaceSize(preview, expanded, { width: 360, height: 240 })
  const value = props.settings?.ensemble ?? defaultPetEnsemble()
  return <details className="pet-ensemble-settings" onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>{petEnsembleText(['伙伴小剧场 · 多人互动', 'Companion theater · Ensemble'], props.language)}</summary>
    {expanded ? <>
      <div ref={preview} className="pet-ensemble-settings-preview">
        <PetEnsembleStage settings={{ ...value, enabled: true }} pets={props.pets} language={props.language}
          width={Math.min(400, size.width)} height={240} />
      </div>
      <PetEnsembleControls value={value} pets={props.pets} language={props.language} onChange={async (next) => {
        let settings = await props.api.setPetEnsemble(next)
        if (next.enabled) {
          if (!settings.selectedPetId) settings = await props.api.selectPet(`kun:${next.members[0]}`)
          if (!settings.overlayOpen) settings = await props.api.setOverlayOpen(true)
        }
        props.onSettings(settings)
      }} />
    </> : null}
  </details>
}

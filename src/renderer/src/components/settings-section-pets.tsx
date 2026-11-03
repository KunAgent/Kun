import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, RefreshCw } from 'lucide-react'
import { PET_CELL_HEIGHT, PET_CELL_WIDTH, PET_SHEET_COLUMNS, petSheetRowsForVersion, type PetImportReport, type PetSettings, type PetSummary } from '@shared/pets'
import { staticFrame } from '../pets/pet-animation'
import { settingsButtonClass } from './settings-button'
import './settings-pets.css'

type PetsView = {
  status: 'loading' | 'ready' | 'error'
  pets: PetSummary[]
  settings: PetSettings | null
  report: PetImportReport | null
  error: string | null
  interactionNote: string | null
}

const initialView: PetsView = { status: 'loading', pets: [], settings: null, report: null, error: null, interactionNote: null }

export function PetsSettingsSection(): ReactElement {
  const { t } = useTranslation('settings')
  const [view, setView] = useState<PetsView>(initialView)
  const petsApi = typeof window === 'undefined' ? undefined : window.kunGui?.pets

  useEffect(() => {
    if (!petsApi) return undefined
    let cancelled = false
    const load = (): void => {
      void Promise.all([petsApi.listPets(), petsApi.getPetSettings(), petsApi.getPetInteraction()])
        .then(([pets, settings, interaction]) => {
          if (!cancelled) setView((current) => ({ ...current, status: 'ready', pets, settings, interactionNote: interaction.note, error: null }))
        })
        .catch((error: unknown) => {
          if (!cancelled) setView((current) => ({ ...current, status: 'error', error: error instanceof Error ? error.message : 'unavailable' }))
        })
    }
    load()
    return petsApi.onPetCatalogChanged(load)
  }, [petsApi])

  if (!petsApi) return <p>{t('petsDesktopOnly')}</p>
  const selected = view.settings?.selectedPetId
  const selectedPet = view.pets.find((pet) => pet.id === selected) ?? null
  const canOpen = Boolean(selectedPet?.available)
  const overlayOpen = Boolean(view.settings?.overlayOpen)

  const update = async (change: Promise<PetSettings>): Promise<void> => {
    const settings = await change
    setView((current) => ({ ...current, settings }))
    window.dispatchEvent(new Event('kun-pet-settings-changed'))
  }

  return (
    <section className="pets-settings" aria-busy={view.status === 'loading'}>
      <div className="pets-settings-toolbar">
        <button
          type="button"
          className={settingsButtonClass({ variant: 'primary' })}
          disabled={!canOpen}
          title={canOpen ? undefined : t('petsSelectFirst')}
          onClick={() => void update(petsApi.setOverlayOpen(!overlayOpen))}
        >
          {overlayOpen ? t('petsHide') : t('petsWake')}
        </button>
      </div>
      {view.status === 'loading' ? <p className="pets-settings-message">{t('petsLoading')}</p> : null}
      {view.status === 'error' ? <p className="pets-settings-message" role="alert">{t('petsLoadError')}</p> : null}
      {view.error ? <p className="pets-settings-message" role="alert">{view.error}</p> : null}
      {view.interactionNote ? <p className="pets-settings-note" role="status">{view.interactionNote}</p> : null}
      <div className="pets-settings-preview">
        <div className="pets-settings-preview-sprite">
          {selectedPet?.spritesheetUrl ? <PetPreview pet={selectedPet} pose="waiting" large /> : <div className="pets-settings-preview-placeholder">?</div>}
        </div>
        <div className="pets-settings-preview-meta">
          <span className="pets-settings-preview-label">{t('petsCurrent')}</span>
          <strong>{selectedPet?.displayName ?? t('petsNone')}</strong>
          <span>{selectedPet?.description ?? t('petsSelectFirst')}</span>
        </div>
      </div>
      <div className="pets-settings-section">
        <div className="pets-settings-section-header">
          <h2>{t('petsImported')}</h2>
          <div className="pets-settings-section-actions">
            <button type="button" className={settingsButtonClass({ variant: 'ghost', size: 'compact' })} onClick={() => void petsApi.refreshPets().then((report) => setView((current) => ({ ...current, report })))}>
              <RefreshCw className="h-4 w-4" /> {t('petsRefresh')}
            </button>
            <button type="button" className={settingsButtonClass({ variant: 'ghost', size: 'compact' })} onClick={() => void petsApi.openKunPetsDirectory()}>
              <FolderOpen className="h-4 w-4" /> {t('petsOpenKunDir')}
            </button>
            <button type="button" className={settingsButtonClass({ variant: 'ghost', size: 'compact' })} onClick={() => void petsApi.openCodexPetsDirectory()}>
              <FolderOpen className="h-4 w-4" /> {t('petsOpenCodexDir')}
            </button>
          </div>
        </div>
        <label className="pets-settings-toggle">
          <input
            type="checkbox"
            checked={view.settings?.importCodexPets !== false}
            onChange={(event) => void update(petsApi.setImportPreferences({ importCodexPets: event.target.checked }))}
          />
          {t('petsImportCodex')}
        </label>
        <div className="pets-settings-list" role="radiogroup" aria-label={t('petsImported')}>
          {view.status === 'ready' && view.pets.length === 0 ? <div className="pets-settings-empty">{t('petsEmpty')}</div> : null}
          {view.pets.map((pet) => (
            <label key={pet.id} className={`pets-settings-item${pet.id === selected ? ' pets-settings-item-active' : ''}${pet.available ? '' : ' pets-settings-item-missing'}`}>
              <input
                type="radio"
                name="selected-pet"
                value={pet.id}
                checked={pet.id === selected}
                disabled={!pet.available}
                onChange={() => void update(petsApi.selectPet(pet.id))}
              />
              {pet.spritesheetUrl ? <PetPreview pet={pet} pose="idle" /> : <span className="pet-static-preview" />}
              <span className="pets-settings-item-name">
                <span>{pet.displayName}</span>
                <span className="pets-settings-item-source">{t(`petsSource.${pet.source}`)}</span>
              </span>
              {pet.sourceMissing || pet.warning ? <span className="pets-settings-item-warning">{pet.warning || t('petsSourceMissing')}</span> : null}
            </label>
          ))}
        </div>
      </div>
      {view.report && (view.report.failed.length > 0 || view.report.sourceMissing.length > 0) ? (
        <div className="pets-settings-errors">
          <h3>{t('petsImportErrors')}</h3>
          <p>{t('petsReport', { failed: view.report.failed.length, missing: view.report.sourceMissing.length })}</p>
          <ul>
            {view.report.failed.map((item) => <li key={item.sourcePath}>{item.sourceId ?? item.sourcePath}: {item.error}</li>)}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

function PetPreview({ pet, pose, large = false }: { pet: PetSummary; pose: 'idle' | 'waiting'; large?: boolean }): ReactElement {
  const frame = staticFrame(pose, pet.spriteVersionNumber)
  const width = large ? 72 : 42
  const height = Math.round(width * (PET_CELL_HEIGHT / PET_CELL_WIDTH))
  const rows = petSheetRowsForVersion(pet.spriteVersionNumber)
  return (
    <span aria-hidden className="pet-static-preview" style={{ width, height }}>
      <img
        alt=""
        src={pet.spritesheetUrl}
        draggable={false}
        style={{
          width: width * PET_SHEET_COLUMNS,
          height: height * rows,
          maxWidth: 'none',
          maxHeight: 'none',
          transform: `translate(${-frame.column * width}px, ${-frame.row * height}px)`
        }}
      />
    </span>
  )
}

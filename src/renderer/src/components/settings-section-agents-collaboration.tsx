import { settingsButtonClass } from './settings-button'
import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import type {
  KunRuntimeSettingsV1,
  ModelProviderProfileV1
} from '@shared/app-settings'
import type {
  AdeCollaborationSettingsMutation,
  AdeCollaborationSettingsMutationResult,
  AdeCollaborationSettingsSnapshot,
  AdeCollaborationSettingsValue
} from '@shared/ade-collaboration-settings'
import type { KunRuntimeSettingsSyncStatusPayload } from '@shared/kun-gui-api'
import { defaultKunAdeSettings } from '@shared/app-settings-kun-harness'
import { SettingRow, SettingsCard, Toggle } from './settings-controls'
import { isKunModelProviderGroup } from '../lib/kun-model-provider-groups'
import type { SettingsDraftController } from './settings-draft-navigation'

type CollaborationView = {
  t: (key: string, options?: Record<string, unknown>) => string
  kun: KunRuntimeSettingsV1
  modelProviders: ModelProviderProfileV1[]
  activePanel: string
  load?: () => Promise<AdeCollaborationSettingsSnapshot>
  save?: (request: AdeCollaborationSettingsMutation) => Promise<AdeCollaborationSettingsMutationResult>
  beforeSave?: () => Promise<boolean>
  onSaved?: (snapshot: AdeCollaborationSettingsSnapshot) => void
  onDraftChange?: (controller: { save: () => Promise<boolean>; discard: () => void } | null) => void
}

type Draft = {
  enabled: boolean
  managerProviderId: string
  managerModel: string
  managerMayApprove: boolean
  allowUnattendedFullAccess: boolean
  softWorkers: string
  hardWorkers: string
  softTokens: string
  hardTokens: string
  hibernationEnabled: boolean
  idleMinutes: string
  structuredMinutes: string
  terminalMinutes: string
}

// The settings category unmounts when users visit Providers or Worktrees.
// Keep this non-secret draft in memory so returning to Collaboration preserves edits.
let pendingCollaborationDraft: { draft: Draft; revision: string } | null = null

function draftFrom(ade: AdeCollaborationSettingsValue): Draft {
  return {
    enabled: ade.enabled,
    managerProviderId: ade.managerModel?.providerId ?? '',
    managerModel: ade.managerModel?.model ?? '',
    managerMayApprove: ade.managerMayApprove,
    allowUnattendedFullAccess: ade.allowUnattendedFullAccess,
    softWorkers: String(ade.limits.softWorkers),
    hardWorkers: String(ade.limits.hardWorkers),
    softTokens: ade.budget?.softTokens === undefined ? '' : String(ade.budget.softTokens),
    hardTokens: ade.budget?.hardTokens === undefined ? '' : String(ade.budget.hardTokens),
    hibernationEnabled: ade.hibernation.enabled,
    idleMinutes: String(ade.hibernation.idleMinutes),
    structuredMinutes: String(ade.stall.structuredMinutes),
    terminalMinutes: String(ade.stall.terminalMinutes)
  }
}

function positiveInteger(raw: string, min: number, max: number): number | undefined {
  if (!/^\d+$/.test(raw.trim())) return undefined
  const value = Number(raw.trim())
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined
}

function draftValue(
  draft: Draft,
  providerIds: Set<string>,
  existingProviderId?: string
): AdeCollaborationSettingsValue | null {
  const softWorkers = positiveInteger(draft.softWorkers, 1, 16)
  const hardWorkers = positiveInteger(draft.hardWorkers, 1, 32)
  const idleMinutes = positiveInteger(draft.idleMinutes, 1, 1_440)
  const structuredMinutes = positiveInteger(draft.structuredMinutes, 1, 240)
  const terminalMinutes = positiveInteger(draft.terminalMinutes, 1, 480)
  const softTokens = draft.softTokens.trim() === ''
    ? undefined : positiveInteger(draft.softTokens, 1, Number.MAX_SAFE_INTEGER)
  const hardTokens = draft.hardTokens.trim() === ''
    ? undefined : positiveInteger(draft.hardTokens, 1, Number.MAX_SAFE_INTEGER)
  if (softWorkers === undefined || hardWorkers === undefined || softWorkers > hardWorkers ||
    idleMinutes === undefined || structuredMinutes === undefined || terminalMinutes === undefined ||
    (draft.softTokens.trim() !== '' && softTokens === undefined) ||
    (draft.hardTokens.trim() !== '' && hardTokens === undefined) ||
    (softTokens !== undefined && hardTokens !== undefined && softTokens > hardTokens)) return null
  const providerId = draft.managerProviderId.trim()
  const model = draft.managerModel.trim()
  if (providerId && ((!providerIds.has(providerId) && providerId !== existingProviderId) || !model)) return null
  return {
    enabled: draft.enabled,
    ...(providerId ? { managerModel: { providerId, model } } : {}),
    managerMayApprove: draft.managerMayApprove,
    allowUnattendedFullAccess: draft.allowUnattendedFullAccess,
    limits: { softWorkers, hardWorkers },
    ...(softTokens === undefined && hardTokens === undefined ? {} : { budget: { softTokens, hardTokens } }),
    hibernation: { enabled: draft.hibernationEnabled, idleMinutes },
    stall: { structuredMinutes, terminalMinutes }
  }
}

export function collaborationApplyLabelKey(
  generation: number,
  status: KunRuntimeSettingsSyncStatusPayload | null
): string {
  if (!status || status.generation < generation) return 'adeSettings.collaborationApply_syncing'
  if (status.generation > generation) return 'adeSettings.collaborationApply_superseded'
  return `adeSettings.collaborationApply_${status.state}`
}

/** Global defaults for new collaboration work, within the existing Agents settings category. */
export function AgentsCollaborationSettingsPanel({ view }: { view: CollaborationView }): ReactElement {
  const { t, kun, modelProviders, activePanel, load, onDraftChange } = view
  const ade = kun.ade ?? defaultKunAdeSettings()
  const kunProviders = modelProviders.filter(isKunModelProviderGroup)
  const [draft, setDraft] = useState<Draft>(() => pendingCollaborationDraft?.draft ?? draftFrom(ade))
  const [dirty, setDirty] = useState(pendingCollaborationDraft !== null)
  const [invalid, setInvalid] = useState(false)
  const [revision, setRevision] = useState<string | null>(pendingCollaborationDraft?.revision ?? null)
  const [savedSnapshot, setSavedSnapshot] = useState<AdeCollaborationSettingsSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<AdeCollaborationSettingsSnapshot | null>(null)
  const [savedGeneration, setSavedGeneration] = useState<number | null>(null)
  const [applyStatus, setApplyStatus] = useState<KunRuntimeSettingsSyncStatusPayload | null>(null)

  useEffect(() => {
    if (activePanel !== 'collaboration') return
    let cancelled = false
    setLoading(true)
    const read = load ?? (() => window.kunGui.getAdeCollaborationSettings())
    void read().then((snapshot) => {
      if (cancelled) return
      setSavedSnapshot(snapshot)
      if (!pendingCollaborationDraft) {
        setDraft(draftFrom(snapshot.value))
        setRevision(snapshot.revision)
      }
      setSaveError(null)
    }).catch((error) => {
      if (!cancelled) setSaveError(error instanceof Error ? error.message : String(error))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [activePanel, load])

  useEffect(() => {
    if (savedGeneration === null || typeof window === 'undefined') return
    const api = window.kunGui
    const accept = (next: KunRuntimeSettingsSyncStatusPayload): void => {
      if (next.generation >= savedGeneration) setApplyStatus(next)
    }
    void api.getRuntimeSettingsSyncStatus().then(accept).catch(() => undefined)
    return api.onRuntimeSettingsSyncStatus(accept)
  }, [savedGeneration])

  const edit = <K extends keyof Draft>(key: K, value: Draft[K]): void => {
    setDraft((current) => {
      const next = { ...current, [key]: value }
      if (revision) pendingCollaborationDraft = { draft: next, revision }
      return next
    })
    setDirty(true)
    setInvalid(false)
  }
  const save = async (): Promise<boolean> => {
    const value = draftValue(
      draft,
      new Set(kunProviders.map((provider) => provider.id)),
      savedSnapshot?.value.managerModel?.providerId
    )
    if (!value) {
      setInvalid(true)
      return false
    }
    if (!revision) return false
    setSaving(true)
    setSaveError(null)
    try {
      if (view.beforeSave && !(await view.beforeSave())) {
        setSaveError(t('adeSettings.collaborationOtherSettingsFailed'))
        return false
      }
      const saveRequest = view.save ?? ((request: AdeCollaborationSettingsMutation) =>
        window.kunGui.saveAdeCollaborationSettings(request))
      const result = await saveRequest({ expectedRevision: revision, value })
      if (!result.ok) {
        setConflict(result)
        return false
      }
      pendingCollaborationDraft = null
      setSavedSnapshot(result)
      setDraft(draftFrom(result.value))
      setRevision(result.revision)
      setDirty(false)
      setConflict(null)
      setSavedGeneration(result.generation)
      view.onSaved?.(result)
      return true
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      setSaving(false)
    }
  }
  const discard = (): void => {
    pendingCollaborationDraft = null
    if (savedSnapshot) {
      setDraft(draftFrom(savedSnapshot.value))
      setRevision(savedSnapshot.revision)
    }
    setDirty(false)
    setInvalid(false)
    setConflict(null)
  }
  const draftControllerRef = useRef<SettingsDraftController>({ save, discard })
  draftControllerRef.current = { save, discard }
  useEffect(() => {
    onDraftChange?.(dirty ? {
      save: () => draftControllerRef.current.save(),
      discard: () => draftControllerRef.current.discard()
    } : null)
    return () => onDraftChange?.(null)
  }, [dirty, onDraftChange])
  const inputClass =
    'min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none'
  const numberInput = (
    key: keyof Pick<Draft, 'softWorkers' | 'hardWorkers' | 'softTokens' | 'hardTokens' |
      'idleMinutes' | 'structuredMinutes' | 'terminalMinutes'>,
    label: string,
    max?: number
  ): ReactElement => (
    <label className="flex min-w-0 flex-col gap-1 text-[12px] text-ds-faint">
      <span>{label}</span>
      <input
        className={`${inputClass} w-28 max-w-full`}
        type="number"
        inputMode="numeric"
        min={1}
        max={max}
        value={draft[key]}
        aria-label={label}
        onChange={(event) => edit(key, event.target.value)}
      />
    </label>
  )

  return (
    <div
      id="agents-settings-panel-collaboration"
      role="tabpanel"
      aria-labelledby="agents-settings-tab-collaboration"
      className={activePanel === 'collaboration' ? '' : 'hidden'}
    >
      <SettingsCard title={t('adeSettings.collaborationTitle')}>
        <p className="pb-1 text-[12px] text-ds-faint">{t('adeSettings.collaborationDesc')}</p>
        <fieldset className="min-w-0 border-0 p-0 disabled:opacity-60" disabled={!revision || saving}>
        <SettingRow
          title={t('adeSettings.enabled')}
          description={t('adeSettings.enabledDesc')}
          control={
            <Toggle checked={draft.enabled} ariaLabel={t('adeSettings.enabled')}
              onChange={(value) => edit('enabled', value)} />
          }
        />
        <SettingRow
          title={t('adeSettings.managerModel')}
          description={t('adeSettings.managerModelDesc')}
          wideControl
          control={
            <div className="flex min-w-0 flex-wrap gap-2">
              <select
                className={`${inputClass} min-w-[10rem] flex-1`}
                value={draft.managerProviderId}
                aria-label={t('adeSettings.managerModel')}
                onChange={(event) => {
                  const providerId = event.target.value
                  const provider = kunProviders.find((item) => item.id === providerId)
                  setDraft((current) => {
                    const next = {
                      ...current,
                      managerProviderId: providerId,
                      managerModel: providerId ? provider?.models[0] ?? '' : ''
                    }
                    if (revision) pendingCollaborationDraft = { draft: next, revision }
                    return next
                  })
                  setDirty(true)
                  setInvalid(false)
                }}
              >
                <option value="">{t('adeSettings.managerModelDefault')}</option>
                {draft.managerProviderId && !kunProviders.some((item) => item.id === draft.managerProviderId)
                  ? <option value={draft.managerProviderId}>{draft.managerProviderId} · {t('adeSettings.projectUnsupportedSource')}</option> : null}
                {kunProviders.map((provider) => (
                  <option key={provider.id} value={provider.id}>{provider.name || provider.id}</option>
                ))}
              </select>
              {draft.managerProviderId && !kunProviders.some((item) => item.id === draft.managerProviderId)
                ? <span className="w-full text-[11px] text-amber-700 dark:text-amber-200">
                  {t('adeSettings.projectUnsupportedSource')}
                </span> : null}
              <input
                className={`${inputClass} min-w-[10rem] flex-1 font-mono text-[12px]`}
                value={draft.managerModel}
                placeholder={t('adeSettings.managerModelPlaceholder')}
                spellCheck={false}
                disabled={!draft.managerProviderId}
                aria-label={t('adeSettings.managerModelPlaceholder')}
                onChange={(event) => edit('managerModel', event.target.value)}
              />
            </div>
          }
        />
        <SettingRow
          title={t('adeSettings.managerMayApprove')}
          description={t('adeSettings.managerMayApproveDesc')}
          control={
            <Toggle checked={draft.managerMayApprove} ariaLabel={t('adeSettings.managerMayApprove')}
              onChange={(value) => edit('managerMayApprove', value)} />
          }
        />
        <SettingRow
          title={t('adeSettings.workerLimits')}
          description={t('adeSettings.workerLimitsDesc')}
          wideControl
          control={
            <div className="flex min-w-0 flex-wrap gap-3">
              {numberInput('softWorkers', t('adeSettings.softWorkers'), 16)}
              {numberInput('hardWorkers', t('adeSettings.hardWorkers'), 32)}
            </div>
          }
        />
        <details className="mt-4 border-t border-ds-border-muted pt-4">
          <summary className="cursor-pointer text-[13px] font-medium text-ds-ink">
            {t('adeSettings.collaborationAdvanced')}
          </summary>
          <div className="mt-2">
            <SettingRow
              title={t('adeSettings.allowUnattendedFullAccess')}
              description={t('adeSettings.allowUnattendedFullAccessDesc')}
              control={
                <Toggle checked={draft.allowUnattendedFullAccess}
                  ariaLabel={t('adeSettings.allowUnattendedFullAccess')}
                  onChange={(value) => edit('allowUnattendedFullAccess', value)} />
              }
            />
            <SettingRow
              title={t('adeSettings.budget')}
              description={t('adeSettings.budgetDesc')}
              wideControl
              control={
                <div className="flex min-w-0 flex-wrap gap-3">
                  {numberInput('softTokens', t('adeSettings.budgetSoft'))}
                  {numberInput('hardTokens', t('adeSettings.budgetHard'))}
                </div>
              }
            />
            <SettingRow
              title={t('adeSettings.hibernation')}
              description={t('adeSettings.hibernationDesc')}
              wideControl
              control={
                <div className="flex flex-wrap items-end gap-3">
                  <Toggle checked={draft.hibernationEnabled} ariaLabel={t('adeSettings.hibernation')}
                    onChange={(value) => edit('hibernationEnabled', value)} />
                  {numberInput('idleMinutes', t('adeSettings.hibernationMinutes'), 1_440)}
                </div>
              }
            />
            <SettingRow
              title={t('adeSettings.stallDetection')}
              description={t('adeSettings.stallDetectionDesc')}
              wideControl
              control={
                <div className="flex min-w-0 flex-wrap gap-3">
                  {numberInput('structuredMinutes', t('adeSettings.stallStructured'), 240)}
                  {numberInput('terminalMinutes', t('adeSettings.stallTerminal'), 480)}
                </div>
              }
            />
          </div>
        </details>
        </fieldset>
        {loading ? <p className="pt-3 text-[12px] text-ds-faint">{t('adeSettings.collaborationLoading')}</p> : null}
        {dirty ? <p className="pt-3 text-[12px] text-ds-muted">{t('adeSettings.collaborationUnsaved')}</p> : null}
        {invalid ? <p role="alert" className="pt-3 text-[12px] text-rose-600 dark:text-rose-300">
          {t('adeSettings.collaborationInvalid')}
        </p> : null}
        {saveError ? <p role="alert" className="break-words pt-3 text-[12px] text-rose-600 dark:text-rose-300">
          {t('adeSettings.collaborationSaveFailed', { message: saveError })}
        </p> : null}
        {conflict ? <div role="alert" className="mt-3 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-[12px] text-ds-ink">
          <p>{t('adeSettings.collaborationConflict')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={settingsButtonClass({ variant: 'link' })} onClick={() => {
              pendingCollaborationDraft = null
              setDraft(draftFrom(conflict.value))
              setSavedSnapshot(conflict)
              setRevision(conflict.revision)
              setDirty(false)
              setConflict(null)
            }}>{t('adeSettings.collaborationUseLatest')}</button>
            <button type="button" className={settingsButtonClass({ variant: 'link' })} onClick={() => {
              setSavedSnapshot(conflict)
              setRevision(conflict.revision)
              pendingCollaborationDraft = { draft, revision: conflict.revision }
              setConflict(null)
            }}>{t('adeSettings.collaborationReviewMine')}</button>
          </div>
        </div> : null}
        {savedGeneration !== null ? <p role="status" className="pt-3 text-[12px] text-ds-muted">
          {t(collaborationApplyLabelKey(savedGeneration, applyStatus))}
          {applyStatus?.generation === savedGeneration && applyStatus.message &&
            (applyStatus.state === 'failed' || applyStatus.state === 'unavailable')
            ? <span className="ml-1 break-words">{applyStatus.message}</span> : null}
        </p> : null}
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-ds-border-muted pt-4">
          <button className={settingsButtonClass()} type="button"
            disabled={!dirty || saving} onClick={discard}>{t('adeSettings.collaborationDiscard')}</button>
          <button type="button" className={settingsButtonClass({ variant: 'primary' })}
            disabled={!dirty || !revision || saving} onClick={() => void save()}>{t('adeSettings.collaborationSave')}</button>
        </div>
      </SettingsCard>
    </div>
  )
}

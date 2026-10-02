import { settingsButtonClass } from './settings-button'
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import type { KunRuntimeSettingsV1, ModelProviderProfileV1 } from '@shared/app-settings'
import { defaultKunAdeSettings } from '@shared/app-settings-kun-harness'
import {
  AdeProjectDefaultsSchema,
  type AdeProjectDefaultField,
  type AdeProjectDefaults,
  type AdeProjectDefaultsMutation,
  type AdeProjectDefaultsMutationResult,
  type AdeProjectDefaultsSnapshot
} from '@shared/ade-project-defaults'
import { useHarnessStore } from '../store/harness-store'
import { SettingsCard } from './settings-controls'
import type { SettingsDraftController } from './settings-draft-navigation'
import { isKunModelProviderGroup } from '../lib/kun-model-provider-groups'

type T = (key: string, options?: Record<string, unknown>) => string

type FormDraft = {
  routeEnabled: boolean
  harnessId: string
  model: string
  providerId: string
  credentialMode: '' | 'native-login' | 'provider' | 'kun-gateway'
  collaborationOverride: boolean
  collaborationEnabled: boolean
  managerOverride: boolean
  managerProviderId: string
  managerModel: string
  limitsOverride: boolean
  softWorkers: string
  hardWorkers: string
  budgetOverride: boolean
  softTokens: string
  hardTokens: string
  isolationOverride: boolean
  isolation: 'worktree' | 'local' | 'directory'
}

function fromValue(value: AdeProjectDefaults, kun: KunRuntimeSettingsV1): FormDraft {
  const global = kun.ade ?? defaultKunAdeSettings()
  return {
    routeEnabled: Boolean(value.route),
    harnessId: value.route?.harnessId ?? kun.harnesses?.defaultHarnessId ?? 'kun',
    model: value.route?.model ?? kun.model,
    providerId: value.route?.providerId ?? '',
    credentialMode: value.route?.credentialMode ?? '',
    collaborationOverride: value.collaborationEnabled !== undefined,
    collaborationEnabled: value.collaborationEnabled ?? false,
    managerOverride: Boolean(value.managerModel),
    managerProviderId: value.managerModel?.providerId ?? global.managerModel?.providerId ?? kun.providerId ?? '',
    managerModel: value.managerModel?.model ?? global.managerModel?.model ?? kun.model,
    limitsOverride: Boolean(value.limits),
    softWorkers: String(value.limits?.softWorkers ?? global.limits.softWorkers),
    hardWorkers: String(value.limits?.hardWorkers ?? global.limits.hardWorkers),
    budgetOverride: Boolean(value.budget),
    softTokens: value.budget?.softTokens === undefined ? '' : String(value.budget.softTokens),
    hardTokens: value.budget?.hardTokens === undefined ? '' : String(value.budget.hardTokens),
    isolationOverride: Boolean(value.isolation),
    isolation: value.isolation ?? 'local'
  }
}

function positive(raw: string, max: number): number | undefined {
  if (!/^\d+$/.test(raw.trim())) return undefined
  const value = Number(raw.trim())
  return Number.isSafeInteger(value) && value >= 1 && value <= max ? value : undefined
}

function toValue(draft: FormDraft): AdeProjectDefaults | null {
  const value: AdeProjectDefaults = {}
  if (draft.routeEnabled) {
    value.route = {
      harnessId: draft.harnessId.trim(),
      model: draft.model.trim(),
      ...(draft.credentialMode !== 'native-login' && draft.providerId.trim()
        ? { providerId: draft.providerId.trim() } : {}),
      ...(draft.credentialMode ? { credentialMode: draft.credentialMode } : {})
    }
  }
  if (draft.collaborationOverride) value.collaborationEnabled = draft.collaborationEnabled
  if (value.collaborationEnabled && value.route?.harnessId !== 'kun') return null
  if (draft.managerOverride) value.managerModel = {
    providerId: draft.managerProviderId.trim(), model: draft.managerModel.trim()
  }
  if (draft.limitsOverride) {
    const softWorkers = positive(draft.softWorkers, 16)
    const hardWorkers = positive(draft.hardWorkers, 32)
    if (softWorkers === undefined || hardWorkers === undefined) return null
    value.limits = { softWorkers, hardWorkers }
  }
  if (draft.budgetOverride) {
    const softTokens = draft.softTokens.trim() ? positive(draft.softTokens, Number.MAX_SAFE_INTEGER) : undefined
    const hardTokens = draft.hardTokens.trim() ? positive(draft.hardTokens, Number.MAX_SAFE_INTEGER) : undefined
    if ((draft.softTokens.trim() && softTokens === undefined) ||
      (draft.hardTokens.trim() && hardTokens === undefined)) return null
    value.budget = { softTokens, hardTokens }
  }
  if (draft.isolationOverride) value.isolation = draft.isolation
  const parsed = AdeProjectDefaultsSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

const FIELDS: AdeProjectDefaultField[] = [
  'route', 'collaborationEnabled', 'managerModel', 'limits', 'budget', 'isolation'
]

function valuesEqual(left: AdeProjectDefaults, right: AdeProjectDefaults): boolean {
  return FIELDS.every((field) => JSON.stringify(left[field]) === JSON.stringify(right[field]))
}

const pendingProjectDrafts = new Map<string, { draft: FormDraft; snapshot: AdeProjectDefaultsSnapshot }>()

/** Local overrides are saved independently of the repository's .kun/project.json. */
export function AdeProjectDefaultsPanel({
  t, projectPath, kun, providers, load, save, onDraftChange
}: {
  t: T
  projectPath: string
  kun: KunRuntimeSettingsV1
  providers: ModelProviderProfileV1[]
  load: (projectPath: string) => Promise<AdeProjectDefaultsSnapshot>
  save: (request: AdeProjectDefaultsMutation) => Promise<AdeProjectDefaultsMutationResult>
  onDraftChange?: (controller: SettingsDraftController | null) => void
}): ReactElement {
  const harnessRows = useHarnessStore((state) => state.rows)
  const kunRef = useRef(kun)
  kunRef.current = kun
  const kunProviders = providers.filter(isKunModelProviderGroup)
  const [snapshot, setSnapshot] = useState<AdeProjectDefaultsSnapshot | null>(null)
  const [draft, setDraft] = useState<FormDraft | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<AdeProjectDefaultsSnapshot | null>(null)
  const [savedGeneration, setSavedGeneration] = useState<number | null>(null)

  useEffect(() => {
    setSnapshot(null)
    setDraft(null)
    if (!projectPath) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void load(projectPath).then((next) => {
      if (cancelled) return
      const pending = pendingProjectDrafts.get(projectPath)
      setSnapshot(pending?.snapshot ?? next)
      setDraft(pending?.draft ?? fromValue(next.value, kunRef.current))
      if (pending && pending.snapshot.revision !== next.revision) setConflict(next)
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectPath, load])

  const edit = <K extends keyof FormDraft>(key: K, next: FormDraft[K]): void => {
    setDraft((current) => {
      if (!current) return current
      const updated = { ...current, [key]: next }
      if (snapshot) pendingProjectDrafts.set(projectPath, { draft: updated, snapshot })
      return updated
    })
    setError(null)
  }
  const refresh = (): void => {
    if (!projectPath) return
    setLoading(true)
    void load(projectPath).then((next) => {
      setSnapshot(next)
      setDraft(fromValue(next.value, kunRef.current))
      pendingProjectDrafts.delete(projectPath)
      setConflict(null)
      setError(null)
    }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setLoading(false))
  }
  const submit = async (): Promise<boolean> => {
    if (!snapshot || !draft || saving || conflict) return false
    const next = toValue(draft)
    if (!next) {
      setError(t('adeSettings.projectInvalid'))
      return false
    }
    if ((next.route?.harnessId === 'kun' && next.route.providerId &&
      !kunProviders.some((provider) => provider.id === next.route?.providerId)) ||
      (next.managerModel && !kunProviders.some((provider) => provider.id === next.managerModel?.providerId))) {
      setError(t('adeSettings.projectUnsupportedSource'))
      return false
    }
    const set: AdeProjectDefaults = {}
    const unset: AdeProjectDefaultField[] = []
    for (const field of FIELDS) {
      if (next[field] !== undefined) Object.assign(set, { [field]: next[field] })
      else if (snapshot.value[field] !== undefined) unset.push(field)
    }
    setSaving(true)
    setError(null)
    try {
      const result = await save({ projectPath, expectedRevision: snapshot.revision, set, unset })
      if (!result.ok) {
        setConflict(result)
        return false
      }
      pendingProjectDrafts.delete(projectPath)
      setSnapshot(result)
      setDraft(fromValue(result.value, kun))
      setSavedGeneration(result.generation)
      setConflict(null)
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      setSaving(false)
    }
  }
  const parsedDraftValue = draft ? toValue(draft) : null
  const collaborationNeedsKun = Boolean(draft?.collaborationOverride && draft.collaborationEnabled &&
    (!draft.routeEnabled || draft.harnessId !== 'kun'))
  const changed = Boolean(snapshot && draft &&
    (!parsedDraftValue || !valuesEqual(parsedDraftValue, snapshot.value)))
  const discard = (): void => {
    pendingProjectDrafts.delete(projectPath)
    if (snapshot) setDraft(fromValue(snapshot.value, kun))
    setConflict(null)
    setError(null)
  }
  const draftControllerRef = useRef<SettingsDraftController>({ save: submit, discard })
  draftControllerRef.current = { save: submit, discard }
  useEffect(() => {
    onDraftChange?.(changed ? {
      save: () => draftControllerRef.current.save(),
      discard: () => draftControllerRef.current.discard()
    } : null)
    return () => onDraftChange?.(null)
  }, [changed, onDraftChange])
  const inputClass = 'min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[12px] text-ds-ink focus:border-accent/40 focus:outline-none'
  const row = (label: string, override: boolean, onOverride: (value: boolean) => void,
    inherited: string, control: ReactNode): ReactElement => (
      <div className="grid min-w-0 gap-2 border-t border-ds-border-muted py-3 sm:grid-cols-[minmax(10rem,12rem)_minmax(0,1fr)]">
        <div className="min-w-0">
          <label className="flex items-center gap-2 text-[13px] font-medium text-ds-ink">
            <input type="checkbox" checked={override} onChange={(event) => onOverride(event.target.checked)} />
            {label}
          </label>
          <p className="mt-1 break-words text-[11px] text-ds-faint">
            {override ? t('adeSettings.projectCustom') : `${t('adeSettings.projectInherited')}: ${inherited}`}
          </p>
        </div>
        <fieldset disabled={!override} className="min-w-0 border-0 p-0 disabled:opacity-50">{control}</fieldset>
      </div>
    )

  return (
    <SettingsCard title={t('adeSettings.projectDefaultsTitle')}>
      <p className="text-[12px] text-ds-faint">{t('adeSettings.projectDefaultsDesc')}</p>
      {!projectPath ? <p className="py-4 text-[12px] text-ds-muted">{t('projectConfigWorkspaceRequired')}</p> : null}
      {loading ? <p className="py-4 text-[12px] text-ds-muted">{t('loading')}</p> : null}
      {snapshot && draft ? <>
        <div className="mt-3 rounded-xl border border-ds-border bg-ds-main/50 px-3 py-2 text-[11px] text-ds-muted">
          <div className="font-semibold text-ds-ink">{snapshot.project.kind === 'git'
            ? t('adeSettings.projectGit') : t('adeSettings.projectDirectory')}</div>
          <div className="break-all font-mono" title={snapshot.project.sourcePath}>{snapshot.project.sourcePath}</div>
        </div>
        {row(t('adeSettings.projectRoute'), draft.routeEnabled,
          (value) => edit('routeEnabled', value), t('adeSettings.projectRouteInherited'),
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            <select className={inputClass} value={draft.harnessId}
              aria-label={t('adeSettings.projectHarness')}
              onChange={(event) => edit('harnessId', event.target.value)}>
              {!harnessRows.some((entry) => entry.definition.id === draft.harnessId)
                ? <option value={draft.harnessId}>{draft.harnessId}</option> : null}
              {harnessRows.filter((entry) => entry.definition.transport !== 'terminal')
                .map((entry) => <option key={entry.definition.id} value={entry.definition.id}>
                  {entry.definition.displayName}</option>)}
            </select>
            <input className={inputClass} value={draft.model} aria-label={t('adeSettings.projectModel')}
              placeholder={t('adeSettings.projectModel')} onChange={(event) => edit('model', event.target.value)} />
            <select className={inputClass} value={draft.credentialMode}
              aria-label={t('adeSettings.projectCredentialMode')}
              onChange={(event) => {
                const credentialMode = event.target.value as FormDraft['credentialMode']
                setDraft((current) => current ? {
                  ...current, credentialMode,
                  providerId: credentialMode === 'native-login' ? '' : current.providerId
                } : current)
              }}>
              <option value="">{t('adeSettings.projectAgentDefault')}</option>
              <option value="native-login">{t('adeSettings.projectNativeLogin')}</option>
              <option value="provider">{t('adeSettings.projectProvider')}</option>
              <option value="kun-gateway">{t('adeSettings.projectGateway')}</option>
            </select>
            <select className={inputClass} value={draft.providerId}
              aria-label={t('adeSettings.projectModelSource')}
              onChange={(event) => edit('providerId', event.target.value)}>
              <option value="">{t('adeSettings.projectAgentDefault')}</option>
              {draft.providerId && !(draft.harnessId === 'kun' ? kunProviders : providers)
                .some((provider) => provider.id === draft.providerId)
                ? <option value={draft.providerId}>{draft.providerId} · {t('adeSettings.projectUnsupportedSource')}</option>
                : null}
              {(draft.harnessId === 'kun' ? kunProviders : providers).map((provider) => <option key={provider.id} value={provider.id}>
                {provider.name || provider.id}</option>)}
            </select>
          </div>)}
        {row(t('adeSettings.projectCollaboration'), draft.collaborationOverride,
          (value) => edit('collaborationOverride', value), t('adeSettings.projectCollaborationInherited'),
          <label className="inline-flex items-center gap-2 text-[12px] text-ds-ink">
            <input type="checkbox" checked={draft.collaborationEnabled}
              onChange={(event) => edit('collaborationEnabled', event.target.checked)} />
            {t('adeSettings.enabled')}
          </label>)}
        {collaborationNeedsKun ? <p role="alert" className="text-[12px] text-amber-700 dark:text-amber-200">
          {t('adeSettings.projectCollaborationRequiresKun')}
        </p> : null}
        {row(t('adeSettings.managerModel'), draft.managerOverride,
          (value) => edit('managerOverride', value), t('adeSettings.managerModelDefault'),
          <div className="flex min-w-0 flex-wrap gap-2">
            <select className={`${inputClass} flex-1`} value={draft.managerProviderId}
              aria-label={t('adeSettings.projectModelSource')}
              onChange={(event) => {
                const providerId = event.target.value
                const provider = kunProviders.find((item) => item.id === providerId)
                setDraft((current) => {
                  if (!current) return current
                  const updated = { ...current, managerProviderId: providerId,
                    managerModel: provider?.models[0] ?? '' }
                  if (snapshot) pendingProjectDrafts.set(projectPath, { draft: updated, snapshot })
                  return updated
                })
              }}>
              <option value="">{t('adeSettings.projectChooseSource')}</option>
              {draft.managerProviderId && !kunProviders.some((provider) => provider.id === draft.managerProviderId)
                ? <option value={draft.managerProviderId}>{draft.managerProviderId} · {t('adeSettings.projectUnsupportedSource')}</option>
                : null}
              {kunProviders.map((provider) => <option key={provider.id} value={provider.id}>
                {provider.name || provider.id}</option>)}
            </select>
            <input className={`${inputClass} flex-1`} value={draft.managerModel}
              aria-label={t('adeSettings.managerModelPlaceholder')}
              onChange={(event) => edit('managerModel', event.target.value)} />
          </div>)}
        {row(t('adeSettings.workerLimits'), draft.limitsOverride,
          (value) => edit('limitsOverride', value), t('adeSettings.projectLimitsInherited'),
          <div className="flex flex-wrap gap-2">
            <input className={`${inputClass} w-28`} type="number" min={1} max={16}
              value={draft.softWorkers} aria-label={t('adeSettings.softWorkers')}
              onChange={(event) => edit('softWorkers', event.target.value)} />
            <input className={`${inputClass} w-28`} type="number" min={1} max={32}
              value={draft.hardWorkers} aria-label={t('adeSettings.hardWorkers')}
              onChange={(event) => edit('hardWorkers', event.target.value)} />
          </div>)}
        {row(t('adeSettings.budget'), draft.budgetOverride,
          (value) => edit('budgetOverride', value), t('adeSettings.projectBudgetInherited'),
          <div className="flex flex-wrap gap-2">
            <input className={`${inputClass} w-32`} type="number" min={1} value={draft.softTokens}
              placeholder={t('adeSettings.budgetSoft')} aria-label={t('adeSettings.budgetSoft')}
              onChange={(event) => edit('softTokens', event.target.value)} />
            <input className={`${inputClass} w-32`} type="number" min={1} value={draft.hardTokens}
              placeholder={t('adeSettings.budgetHard')} aria-label={t('adeSettings.budgetHard')}
              onChange={(event) => edit('hardTokens', event.target.value)} />
          </div>)}
        {row(t('adeSettings.projectIsolation'), draft.isolationOverride,
          (value) => edit('isolationOverride', value), t('adeSettings.projectIsolationControlledInCode'),
          <select className={inputClass} value={draft.isolation}
            aria-label={t('adeSettings.projectIsolation')}
            onChange={(event) => edit('isolation', event.target.value as FormDraft['isolation'])}>
            <option value="local">{t('adeSettings.projectIsolationLocal')}</option>
            <option value="worktree">{t('adeSettings.projectIsolationWorktree')}</option>
          </select>)}
        {error ? <p role="alert" className="break-words pt-2 text-[12px] text-rose-600 dark:text-rose-300">{error}</p> : null}
        {conflict ? <div role="alert" className="mt-2 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-[12px] text-ds-ink">
          <p>{t('adeSettings.projectConflict')}</p>
          <button type="button"  className={settingsButtonClass({ variant: 'link', className: 'mt-2' })} onClick={() => {
            setSnapshot(conflict)
            setConflict(null)
          }}>{t('adeSettings.projectRebase')}</button>
        </div> : null}
        {savedGeneration !== null ? <p role="status" className="pt-2 text-[12px] text-ds-muted">
          {t('adeSettings.projectSaved')}
        </p> : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-ds-border-muted pt-4">
          <button className={settingsButtonClass()} type="button"
            disabled={changed || saving || loading} onClick={refresh}>{t('projectConfigRefresh')}</button>
          <button className={settingsButtonClass()} type="button"
            disabled={!changed || saving} onClick={discard}>
            {t('adeSettings.collaborationDiscard')}
          </button>
          <button type="button" className={settingsButtonClass({ variant: 'primary' })}
            disabled={!changed || saving || Boolean(conflict)} onClick={() => void submit()}>
            {t('adeSettings.collaborationSave')}
          </button>
        </div>
      </> : null}
    </SettingsCard>
  )
}

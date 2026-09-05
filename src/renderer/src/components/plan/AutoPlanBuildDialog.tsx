import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { CalendarClock, GitBranch, Hammer, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  formatInTimeZone,
  modelTimePricingState,
  relativeScheduleLabel,
  supportedTimeZones,
  systemTimeZone,
  timePricingScheduleLabel,
  zonedDateTimeToIso,
  type AppSettingsV1,
  type KunLabAutoPlanBuildSettingsV1,
  type ScheduleReasoningEffort,
  type ZonedDateTimeResult
} from '@shared/app-settings'
import { useChatStore } from '../../store/chat-store'
import { defaultScheduleDraft } from './PlanScheduledBuildDialog'
import type { AutoPlanBuildSelection } from '../../plan/auto-plan-build-intents'
import {
  resolveScheduleModelSelection,
  resolveScheduleReasoningSelection,
  scheduleModelProfileForSelection,
  scheduleModelProviderOptions,
  scheduleReasoningLabel,
  scheduleReasoningOptionsForModel
} from '../schedule/schedule-task-support'

const ERROR_KEYS = {
  'invalid-date': 'planScheduleBuildErrorInvalidDate',
  'invalid-time-zone': 'planScheduleBuildErrorInvalidTimeZone',
  'nonexistent-time': 'planScheduleBuildErrorNonexistentTime',
  'ambiguous-time': 'planScheduleBuildErrorAmbiguousTime',
  'past-time': 'planScheduleBuildErrorPastTime'
} as const

const PRICING_KEYS = {
  'unit-price-discount': 'planScheduleBuildPricingOffPeakPrice',
  'quota-multiplier': 'planScheduleBuildPricingOffPeakQuota'
} as const

function instantError(
  instant: Extract<ZonedDateTimeResult, { ok: false }>,
  t: (key: string) => string
): string {
  return t(ERROR_KEYS[instant.code] ?? 'planScheduleBuildErrorInvalidDate')
}

function openNativePicker(input: HTMLInputElement): void {
  try {
    input.showPicker?.()
  } catch {
    // Native typing remains available when Chromium rejects showPicker.
  }
}

export function AutoPlanBuildDialog({
  settings,
  defaults,
  submitting,
  error,
  onClose,
  onSubmit
}: {
  settings: AppSettingsV1
  defaults: KunLabAutoPlanBuildSettingsV1
  submitting: boolean
  error: string
  onClose: () => void
  onSubmit: (selection: AutoPlanBuildSelection, saveAsDefault: boolean) => Promise<void>
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const locale = i18n.resolvedLanguage ?? i18n.language
  const chat = useChatStore.getState()
  const initialTime = useMemo(() => defaultScheduleDraft(), [])
  const providers = useMemo(() => scheduleModelProviderOptions(settings), [settings])
  const initialSelection = useMemo(() => resolveScheduleModelSelection(
    providers,
    defaults.scheduledDefaults.providerId || chat.composerProviderId,
    defaults.scheduledDefaults.model || chat.composerModel
  ), [chat.composerModel, chat.composerProviderId, defaults.scheduledDefaults, providers])
  const [buildMode, setBuildMode] = useState(defaults.defaultBuildMode)
  const [useWorktree, setUseWorktree] = useState(defaults.useWorktreeByDefault)
  const [date, setDate] = useState(initialTime.date)
  const [time, setTime] = useState(initialTime.time)
  const [timeZone, setTimeZone] = useState(defaults.scheduledDefaults.timeZone || systemTimeZone())
  const [providerId, setProviderId] = useState(initialSelection.providerId)
  const [model, setModel] = useState(initialSelection.model)
  const selectedProvider = providers.find((provider) => provider.providerId === providerId)
  const profile = scheduleModelProfileForSelection(selectedProvider, model)
  const [reasoningEffort, setReasoningEffort] = useState<ScheduleReasoningEffort>(() =>
    resolveScheduleReasoningSelection(
      defaults.scheduledDefaults.reasoningEffort || chat.composerReasoningEffort,
      profile
    ))
  const reasoningOptions = scheduleReasoningOptionsForModel(profile)
  const instant = zonedDateTimeToIso(date, time, timeZone)
  const pricing = instant.ok
    ? modelTimePricingState(selectedProvider?.provider, model, instant.iso)
    : { state: 'unsupported' as const }
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const fieldClass = 'mt-1.5 h-10 w-full rounded-xl border border-ds-border bg-ds-card px-3 text-[13px] text-ds-ink outline-none focus:border-accent'

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || submitting) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    dialogRef.current?.focus()
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, submitting])

  const changeProvider = (nextId: string): void => {
    const next = providers.find((provider) => provider.providerId === nextId)
    const nextModel = next?.modelIds[0] ?? ''
    setProviderId(nextId)
    setModel(nextModel)
    setReasoningEffort(resolveScheduleReasoningSelection(
      undefined,
      scheduleModelProfileForSelection(next, nextModel)
    ))
  }

  const changeModel = (nextModel: string): void => {
    setModel(nextModel)
    setReasoningEffort(resolveScheduleReasoningSelection(
      reasoningEffort,
      scheduleModelProfileForSelection(selectedProvider, nextModel)
    ))
  }

  const submit = (saveAsDefault: boolean): void => {
    if (buildMode === 'scheduled' && (!instant.ok || !selectedProvider || !model)) return
    void onSubmit({
      buildMode,
      useWorktree,
      ...(buildMode === 'scheduled' && instant.ok
        ? {
            scheduled: {
              providerId,
              model,
              reasoningEffort,
              schedule: { kind: 'at', atTime: instant.iso, timeZone }
            }
          }
        : {})
    }, saveAsDefault)
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/25 p-4" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('autoPlanBuildDialogTitle')}
        tabIndex={-1}
        data-auto-plan-build-dialog
        className="max-h-[calc(100vh-32px)] w-full max-w-[640px] overflow-y-auto rounded-[24px] border border-ds-border bg-ds-card p-6 shadow-2xl outline-none"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[18px] font-semibold text-ds-ink">{t('autoPlanBuildDialogTitle')}</h2>
            <p className="mt-1 text-[12px] text-ds-muted">{t('autoPlanBuildDialogSubtitle')}</p>
          </div>
          <button type="button" disabled={submitting} onClick={onClose} aria-label={t('close')} className="rounded-full p-2 text-ds-muted hover:bg-ds-hover disabled:opacity-45"><X className="h-4 w-4" /></button>
        </div>

        <fieldset className="mt-5 grid grid-cols-2 gap-3" disabled={submitting}>
          <legend className="mb-2 text-[12px] font-medium text-ds-muted">{t('planBuildMode')}</legend>
          <button type="button" data-auto-plan-build-mode="direct" aria-pressed={buildMode === 'direct'} onClick={() => setBuildMode('direct')} className={`flex min-h-16 items-center gap-3 rounded-xl border px-4 text-left ${buildMode === 'direct' ? 'border-accent bg-accent-soft' : 'border-ds-border hover:bg-ds-hover'}`}>
            <Hammer className="h-5 w-5 text-accent" />
            <span><strong className="block text-[13px] text-ds-ink">{t('planBuildDirect')}</strong><small className="text-[11px] text-ds-muted">{t('autoPlanBuildDirectHint')}</small></span>
          </button>
          <button type="button" data-auto-plan-build-mode="scheduled" aria-pressed={buildMode === 'scheduled'} onClick={() => setBuildMode('scheduled')} className={`flex min-h-16 items-center gap-3 rounded-xl border px-4 text-left ${buildMode === 'scheduled' ? 'border-accent bg-accent-soft' : 'border-ds-border hover:bg-ds-hover'}`}>
            <CalendarClock className="h-5 w-5 text-accent" />
            <span><strong className="block text-[13px] text-ds-ink">{t('planScheduleBuild')}</strong><small className="text-[11px] text-ds-muted">{t('planScheduleBuildAutomaticHint')}</small></span>
          </button>
        </fieldset>

        <label className="mt-4 flex items-start gap-3 rounded-xl border border-ds-border px-4 py-3">
          <button type="button" role="switch" aria-checked={useWorktree} data-auto-plan-build-worktree onClick={() => setUseWorktree((current) => !current)} disabled={submitting} className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full ${useWorktree ? 'bg-accent' : 'bg-ds-faint'} disabled:opacity-45`}>
            <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${useWorktree ? 'translate-x-4' : ''}`} />
          </button>
          <span><strong className="flex items-center gap-1.5 text-[13px] text-ds-ink"><GitBranch className="h-3.5 w-3.5" />{t('autoPlanBuildUseWorktree')}</strong><small className="mt-0.5 block text-[11px] text-ds-muted">{t(useWorktree ? 'planWorktreePromptHint' : 'planWorktreeCurrentWorkspaceWarning')}</small></span>
        </label>

        {buildMode === 'scheduled' ? (
          <div className="mt-5 grid grid-cols-2 gap-4" data-auto-plan-build-schedule-fields>
            <label className="text-[12px] text-ds-muted">{t('planScheduleBuildDate')}<input data-auto-plan-schedule-date className={fieldClass} type="date" value={date} onClick={(event) => openNativePicker(event.currentTarget)} onChange={(event) => setDate(event.target.value)} /></label>
            <label className="text-[12px] text-ds-muted">{t('planScheduleBuildTime')}<input data-auto-plan-schedule-time className={fieldClass} type="time" value={time} onClick={(event) => openNativePicker(event.currentTarget)} onChange={(event) => setTime(event.target.value)} /></label>
            <label className="col-span-2 text-[12px] text-ds-muted">{t('planScheduleBuildTimeZone')}<select className={fieldClass} value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>{supportedTimeZones().map((zone) => <option key={zone}>{zone}</option>)}</select></label>
            <label className="text-[12px] text-ds-muted">{t('scheduleProvider')}<select className={fieldClass} value={providerId} onChange={(event) => changeProvider(event.target.value)}>{providers.map((provider) => <option key={provider.providerId} value={provider.providerId}>{provider.label}</option>)}</select></label>
            <label className="text-[12px] text-ds-muted">{t('scheduleModel')}<select className={fieldClass} value={model} onChange={(event) => changeModel(event.target.value)}>{selectedProvider?.modelIds.map((id) => <option key={id}>{id}</option>)}</select></label>
            <label className="col-span-2 text-[12px] text-ds-muted">{t('scheduleReasoning')}<select className={fieldClass} value={reasoningEffort} onChange={(event) => setReasoningEffort(event.target.value as ScheduleReasoningEffort)}>{reasoningOptions.map((effort) => <option key={effort} value={effort}>{scheduleReasoningLabel(effort, t)}</option>)}</select></label>
            {instant.ok ? <p className="col-span-2 text-[11.5px] text-ds-muted">{formatInTimeZone(instant.iso, timeZone, locale)} · {relativeScheduleLabel(instant.iso, Date.now(), locale)}</p> : <p role="alert" className="col-span-2 text-[12px] text-red-600">{instantError(instant, t)}</p>}
            {pricing.rule ? <div className="col-span-2 rounded-xl bg-accent-soft px-4 py-3 text-[12px] text-ds-ink"><strong>{t(PRICING_KEYS[pricing.rule.benefitKind])}</strong><div className="mt-1 text-ds-muted">{t(pricing.state === 'off-peak' ? 'planScheduleBuildPricingOffPeakState' : 'planScheduleBuildPricingStandardState', { schedule: timePricingScheduleLabel(pricing.rule, locale) })}</div></div> : null}
          </div>
        ) : null}

        {error ? <p className="mt-4 text-[12px] text-red-600" role="alert">{error}</p> : null}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" disabled={submitting} onClick={onClose} className="h-10 rounded-full px-4 text-[13px] text-ds-muted hover:bg-ds-hover disabled:opacity-45">{t('cancel')}</button>
          <button type="button" data-auto-plan-build-use-once disabled={submitting || (buildMode === 'scheduled' && !instant.ok)} onClick={() => submit(false)} className="h-10 rounded-full border border-accent px-4 text-[13px] font-medium text-accent disabled:opacity-45">{t('autoPlanBuildUseOnce')}</button>
          <button type="button" data-auto-plan-build-save-default disabled={submitting || (buildMode === 'scheduled' && !instant.ok)} onClick={() => submit(true)} className="h-10 rounded-full bg-accent px-5 text-[13px] font-medium text-white disabled:opacity-45">{submitting ? t('planScheduleBuildConfirmPending') : t('autoPlanBuildSaveDefault')}</button>
        </div>
      </div>
    </div>
  )
}

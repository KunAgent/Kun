import { useMemo, useState, type ReactElement } from 'react'
import { CalendarClock, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AppSettingsV1, ScheduleReasoningEffort, ScheduledTaskV1 } from '@shared/app-settings'
import { formatInTimeZone, modelTimePricingState, relativeScheduleLabel, supportedTimeZones, systemTimeZone, timePricingScheduleLabel, zonedDateTimeToIso, type ZonedDateTimeResult } from '@shared/app-settings'
import type { PlanBuildOrchestration } from '../../plan/plan-build'
import { useChatStore } from '../../store/chat-store'
import { resolveScheduleModelSelection, resolveScheduleReasoningSelection, scheduleModelProfileForSelection, scheduleModelProviderOptions, scheduleReasoningLabel, scheduleReasoningOptionsForModel } from '../schedule/schedule-task-support'

type ScheduleDialogDraft = {
  providerId: string
  model: string
  reasoningEffort: ScheduleReasoningEffort
  mode: 'agent'
  schedule: { kind: 'at'; atTime: string; timeZone: string }
}

type Props = {
  settings: AppSettingsV1
  orchestration: PlanBuildOrchestration
  initialTask?: ScheduledTaskV1 | null
  submitting: boolean
  error: string
  onClose: () => void
  onSubmit: (draft: ScheduleDialogDraft) => Promise<void>
}

const SCHEDULE_INSTANT_ERROR_KEYS = {
  'invalid-date': 'planScheduleBuildErrorInvalidDate',
  'invalid-time-zone': 'planScheduleBuildErrorInvalidTimeZone',
  'nonexistent-time': 'planScheduleBuildErrorNonexistentTime',
  'ambiguous-time': 'planScheduleBuildErrorAmbiguousTime',
  'past-time': 'planScheduleBuildErrorPastTime'
} as const

const SCHEDULE_PRICING_BENEFIT_KEYS = {
  'unit-price-discount': 'planScheduleBuildPricingOffPeakPrice',
  'quota-multiplier': 'planScheduleBuildPricingOffPeakQuota'
} as const

function scheduleInstantError(instant: Extract<ZonedDateTimeResult, { ok: false }>, t: (key: string) => string): string {
  const key = SCHEDULE_INSTANT_ERROR_KEYS[instant.code]
  return key ? t(key) : instant.message
}

function openNativePicker(input: HTMLInputElement): void {
  if (typeof input.showPicker !== 'function') return
  try {
    input.showPicker()
  } catch {
    // Keep the native click and keyboard behavior when Chromium rejects the picker request.
  }
}

export function defaultScheduleDraft(nowMs = Date.now()): { date: string; time: string } {
  const next = new Date(Math.floor(nowMs / 60_000) * 60_000 + 60_000)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return { date: `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`, time: `${pad(next.getHours())}:${pad(next.getMinutes())}` }
}

export function scheduleDraftFromTask(task: ScheduledTaskV1 | null | undefined): { date: string; time: string; timeZone: string } {
  if (!task) return { ...defaultScheduleDraft(), timeZone: systemTimeZone() }
  const timeZone = task.schedule.timeZone || systemTimeZone()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(task.schedule.atTime))
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? ''
  return { date: `${value('year')}-${value('month')}-${value('day')}`, time: `${value('hour')}:${value('minute')}`, timeZone }
}

export function PlanScheduledBuildDialog({ settings, orchestration, initialTask, submitting, error, onClose, onSubmit }: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const locale = i18n.resolvedLanguage ?? i18n.language
  const initial = useMemo(() => scheduleDraftFromTask(initialTask), [initialTask])
  const providers = useMemo(() => scheduleModelProviderOptions(settings), [settings])
  const chat = useChatStore.getState()
  const initialSelection = useMemo(
    () => resolveScheduleModelSelection(
      providers,
      initialTask?.providerId || chat.composerProviderId,
      initialTask?.model || chat.composerModel
    ),
    [chat.composerModel, chat.composerProviderId, initialTask, providers]
  )
  const [date, setDate] = useState(initial.date)
  const [time, setTime] = useState(initial.time)
  const [timeZone, setTimeZone] = useState(initial.timeZone)
  const [providerId, setProviderId] = useState(initialSelection.providerId)
  const [model, setModel] = useState(initialSelection.model)
  const selectedProvider = providers.find((provider) => provider.providerId === providerId)
  const selectedProfile = scheduleModelProfileForSelection(selectedProvider, model)
  const [reasoningEffort, setReasoningEffort] = useState<ScheduleReasoningEffort>(() =>
    resolveScheduleReasoningSelection(initialTask?.reasoningEffort || chat.composerReasoningEffort, selectedProfile))
  const reasoningOptions = scheduleReasoningOptionsForModel(selectedProfile)
  const instant = zonedDateTimeToIso(date, time, timeZone)
  const pricing = instant.ok ? modelTimePricingState(selectedProvider?.provider, model, instant.iso) : { state: 'unsupported' as const }
  const fieldClass = 'mt-1.5 h-10 w-full rounded-xl border border-ds-border bg-ds-card px-3 text-[13px] text-ds-ink outline-none focus:border-accent'

  const changeProvider = (nextId: string): void => {
    const next = providers.find((provider) => provider.providerId === nextId)
    const nextModel = next?.modelIds[0] ?? ''
    setProviderId(nextId)
    setModel(nextModel)
    setReasoningEffort(resolveScheduleReasoningSelection(undefined, scheduleModelProfileForSelection(next, nextModel)))
  }

  const changeModel = (nextModel: string): void => {
    setModel(nextModel)
    setReasoningEffort(resolveScheduleReasoningSelection(reasoningEffort, scheduleModelProfileForSelection(selectedProvider, nextModel)))
  }

  const submit = (): void => {
    if (!instant.ok || !selectedProvider || !model) return
    void onSubmit({
      providerId, model, reasoningEffort, mode: 'agent',
      schedule: { kind: 'at', atTime: instant.iso, timeZone }
    })
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/25 p-4" role="presentation">
      <div role="dialog" aria-modal="true" aria-label={t('planScheduleBuild')} className="w-full max-w-[620px] rounded-[24px] border border-ds-border bg-ds-card p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div><h2 className="text-[18px] font-semibold text-ds-ink">{t('planScheduleBuildTitle')}</h2><p className="mt-1 text-[12px] text-ds-muted">{t('planScheduleBuildSubtitle')}</p></div>
          <button type="button" onClick={onClose} aria-label={t('close')} className="rounded-full p-2 text-ds-muted hover:bg-ds-hover"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-4">
          <label className="text-[12px] text-ds-muted">{t('planScheduleBuildDate')}<input data-plan-schedule-date className={fieldClass} type="date" value={date} onClick={(event) => openNativePicker(event.currentTarget)} onChange={(event) => setDate(event.target.value)} /></label>
          <label className="text-[12px] text-ds-muted">{t('planScheduleBuildTime')}<input data-plan-schedule-time className={fieldClass} type="time" value={time} onClick={(event) => openNativePicker(event.currentTarget)} onChange={(event) => setTime(event.target.value)} /></label>
          <label className="col-span-2 text-[12px] text-ds-muted">{t('planScheduleBuildTimeZone')}<select className={fieldClass} value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>{supportedTimeZones().map((zone) => <option key={zone}>{zone}</option>)}</select></label>
          <label className="text-[12px] text-ds-muted">{t('scheduleProvider')}<select className={fieldClass} value={providerId} onChange={(event) => changeProvider(event.target.value)}>{providers.map((provider) => <option value={provider.providerId} key={provider.providerId}>{provider.label}</option>)}</select></label>
          <label className="text-[12px] text-ds-muted">{t('scheduleModel')}<select className={fieldClass} value={model} onChange={(event) => changeModel(event.target.value)}>{selectedProvider?.modelIds.map((id) => <option key={id}>{id}</option>)}</select></label>
          <label className="col-span-2 text-[12px] text-ds-muted">{t('scheduleReasoning')}<select className={fieldClass} value={reasoningEffort} onChange={(event) => setReasoningEffort(event.target.value as ScheduleReasoningEffort)}>{reasoningOptions.map((effort) => <option key={effort} value={effort}>{scheduleReasoningLabel(effort, t)}</option>)}</select></label>
        </div>
        {instant.ok ? <p className="mt-3 text-[11.5px] text-ds-muted">{formatInTimeZone(instant.iso, timeZone, locale)} · {relativeScheduleLabel(instant.iso, Date.now(), locale)}</p> : <p className="mt-3 text-[12px] text-red-600">{scheduleInstantError(instant, t)}</p>}
        {pricing.rule ? (
          <div data-plan-schedule-pricing className="mt-4 rounded-xl bg-accent-soft px-4 py-3 text-[12px] text-ds-ink">
            <strong>{t(SCHEDULE_PRICING_BENEFIT_KEYS[pricing.rule.benefitKind])}</strong>
            <div className="mt-1 text-ds-muted">
              {t(pricing.state === 'off-peak' ? 'planScheduleBuildPricingOffPeakState' : 'planScheduleBuildPricingStandardState', {
                schedule: timePricingScheduleLabel(pricing.rule, locale)
              })}
            </div>
          </div>
        ) : null}
        {error ? <p className="mt-4 text-[12px] text-red-600" role="alert">{error}</p> : null}
        <p className="mt-4 text-[11.5px] leading-5 text-ds-muted">{t('planScheduleBuildRunningNotice')}</p>
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="h-10 rounded-full px-4 text-[13px] text-ds-muted hover:bg-ds-hover">{t('cancel')}</button><button type="button" disabled={submitting || !instant.ok || !selectedProvider} onClick={submit} className="inline-flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-[13px] font-medium text-white disabled:opacity-45"><CalendarClock className="h-4 w-4" />{submitting ? t('planScheduleBuildConfirmPending') : t(initialTask ? 'planScheduleBuildModify' : 'planScheduleBuildConfirm')}</button></div>
      </div>
    </div>
  )
}

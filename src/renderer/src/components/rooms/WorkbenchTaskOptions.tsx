import type { WorkbenchExecution, WorkbenchRequest, WorkbenchSchedule } from '@shared/rooms-api'
import { useChatStore } from '../../store/chat-store'
import { FloatingComposerModelPicker, type ComposerReasoningEffort } from '../chat/FloatingComposerModelPicker'
import { serviceTierForComposerSelection } from '../chat/composer-fast-mode'
import { kunToolPermissionModeFromSettings } from '@shared/app-settings'
import { WorkbenchSchedulePicker } from './WorkbenchSchedulePicker'
import { useTranslation } from 'react-i18next'
import { SlidersHorizontal } from 'lucide-react'
import { resolveCodeAgentPreset } from '../chat/code-agent-presets'
import { resolveComposerAssistantProviderId } from '../chat/composer-model-selection'

export type WorkbenchTaskDraft = {
  title: string
  goal: string
  isolation: 'inherit' | 'worktree'
  execution: WorkbenchExecution
  schedule?: WorkbenchSchedule
  report: WorkbenchRequest['report']
}

export function initialWorkbenchTaskDraft(request: WorkbenchRequest): WorkbenchTaskDraft {
  const state = useChatStore.getState()
  const providerId = resolveComposerAssistantProviderId({ composerModelGroups: state.composerModelGroups,
    model: state.composerModel, storedProviderId: state.composerProviderId })
  const group = state.composerModelGroups.find((item) => item.providerId === providerId &&
    item.modelIds.includes(state.composerModel))
  const preset = state.codeAgentPresets.find((item) => item.id === state.composerPersonaId)
  const model = request.execution?.model ?? (state.composerModel && providerId ? {
    providerId, model: state.composerModel,
    ...(group?.accountId ? { accountId: group.accountId } : {}),
    ...(state.composerHarnessId ? { harnessId: state.composerHarnessId } : {}),
    ...(['native-login', 'provider', 'kun-gateway'].includes(state.composerCredentialMode)
      ? { credentialMode: state.composerCredentialMode as 'native-login' | 'provider' | 'kun-gateway' } : {}),
    reasoningEffort: state.composerReasoningEffort,
    ...(serviceTierForComposerSelection(state.composerFastMode, state.composerModelGroups,
      state.composerModel, providerId) ? { serviceTier: 'priority' as const } : {})
  } : undefined)
  return { title: request.title, goal: request.goal, isolation: request.isolation,
    execution: { mode: request.execution?.mode ?? (request.mode === 'plan' ? 'plan' : 'direct'),
      ...request.execution, ...(model ? { model } : {}),
      orchestration: request.execution?.orchestration ?? (state.graphEnabled ? state.composerOrchestration : 'direct'),
      permission: request.execution?.permission ?? (state.composerExecutionSettings
        ? kunToolPermissionModeFromSettings(state.composerExecutionSettings) : 'ask-for-approval'),
      ...(request.execution?.persona ? {} : preset ? { persona: { id: preset.id,
        name: resolveCodeAgentPreset(preset).name, text: resolveCodeAgentPreset(preset).persona.slice(0, 2000) } } : {}) },
    schedule: request.schedule, report: request.report }
}

const MODES: WorkbenchExecution['mode'][] = ['direct', 'plan', 'auto', 'goal']
const PERMISSIONS: NonNullable<WorkbenchExecution['permission']>[] = ['ask-for-approval', 'approve-for-me', 'full-access']

export function WorkbenchTaskOptions({ draft, onChange, editing, onEdit, code, permissionCeiling, project }: {
  draft: WorkbenchTaskDraft
  onChange: (draft: WorkbenchTaskDraft) => void
  editing: boolean
  onEdit: () => void
  code: boolean
  permissionCeiling?: WorkbenchExecution['permission']
  project?: string
}) {
  const { t } = useTranslation('common')
  const groups = useChatStore((state) => state.composerModelGroups)
  const pickList = useChatStore((state) => state.composerPickList)
  const presets = useChatStore((state) => state.codeAgentPresets)
  const graphEnabled = useChatStore((state) => state.graphEnabled)
  const model = draft.execution.model
  const changeExecution = (patch: Partial<WorkbenchExecution>) => onChange({ ...draft, execution: { ...draft.execution, ...patch } })
  const permission = draft.execution.permission ?? 'ask-for-approval'
  // Summary row: always show mode / model / permission; the rest only when non-default.
  const items: { label: string; tone?: 'warn' | 'strong' }[] = [
    ...(project ? [{ label: project, tone: 'strong' as const }] : []),
    { label: t(`roomsWorkbenchMode_${draft.execution.mode}`) },
    { label: model ? `${model.model}${model.reasoningEffort && model.reasoningEffort !== 'auto' ? ` · ${model.reasoningEffort}` : ''}` : t('roomsWorkbenchRuntimeModel') },
    ...(draft.isolation === 'worktree' ? [{ label: t('roomsWorkbenchIsolated') }] : []),
    ...(draft.execution.persona?.name ? [{ label: `${t('roomsWorkbenchPersona')}: ${draft.execution.persona.name}` }] : []),
    ...(draft.schedule?.kind === 'once' ? [{ label: `${t('roomsWorkbenchOnce')} · ${new Date(draft.schedule.runAt).toLocaleString()}` }] :
      draft.schedule?.kind === 'recurring' ? [{ label: `${t('roomsWorkbenchRecurring')} · ${draft.schedule.time}` }] : []),
    { label: t(`roomsWorkbenchPermission_${permission}`), ...(permission === 'full-access' ? { tone: 'warn' as const } : {}) }]
  return <>
    {editing ? null : <button type="button" className="rooms-workbench-option-summary" onClick={onEdit} title={t('roomsWorkbenchModify')}>
      <SlidersHorizontal size={13} aria-hidden="true" />
      <span className="rooms-workbench-option-items">{items.map((item, index) =>
        <span key={index} data-tone={item.tone}>{item.label}</span>)}</span>
      <em>{t('roomsWorkbenchModify')}</em></button>}
    {editing ? <div className="rooms-workbench-options">
      {code ? <div className="rooms-workbench-field rooms-workbench-field-span"><span>{t('roomsWorkbenchExecutionMode')}</span>
        <div className="rooms-workbench-segments" role="group">
          {MODES.map((value) => <button type="button" key={value} aria-pressed={draft.execution.mode === value}
            onClick={() => changeExecution({ mode: value })}>{t(`roomsWorkbenchMode_${value}`)}</button>)}
        </div></div> : null}
      {draft.execution.mode === 'goal' ? <label className="rooms-workbench-field rooms-workbench-field-span">{t('roomsWorkbenchTokenBudget')}<input type="number" min={1}
        value={draft.execution.goalTokenBudget ?? ''} onChange={(event) => changeExecution({ goalTokenBudget: event.target.value ? Number(event.target.value) : null })} /></label> : null}
      <div className="rooms-workbench-field rooms-workbench-field-span"><span>{t('roomsWorkbenchModel')}</span>
        <div className="rooms-workbench-desktop-model"><FloatingComposerModelPicker compact mode="select"
          composerModel={model?.model ?? ''} composerProviderId={model?.providerId ?? ''} composerPickList={pickList}
          composerModelGroups={groups} canChangeModel onComposerModelChange={(selected, providerId) => {
            const group = groups.find((item) => item.providerId === providerId && item.modelIds.includes(selected))
            if (!providerId) return
            changeExecution({ model: { providerId, model: selected, ...(group?.accountId ? { accountId: group.accountId } : {}),
              ...(model?.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}) } })
          }} composerReasoningEffort={model?.reasoningEffort} onComposerReasoningEffortChange={(effort: ComposerReasoningEffort) =>
            model && changeExecution({ model: { ...model, reasoningEffort: effort } })}
          composerFastMode={model?.serviceTier === 'priority'} onComposerFastModeChange={(enabled) =>
            model && changeExecution({ model: { ...model, serviceTier: enabled ? 'priority' : undefined } })} /></div>
        <select className="rooms-workbench-mobile-model" value={model ? `${model.providerId}/${model.model}` : ''}
          onChange={(event) => { const [providerId, ...parts] = event.target.value.split('/'); const selected = parts.join('/')
            const group = groups.find((item) => item.providerId === providerId)
            changeExecution({ model: { providerId, model: selected, ...(group?.accountId ? { accountId: group.accountId } : {}) } }) }}>
          <option value="">{t('roomsWorkbenchChooseModel')}</option>{groups.flatMap((group) => group.modelIds.map((id) =>
            <option key={`${group.providerId}/${id}`} value={`${group.providerId}/${id}`}>{group.label} · {id}</option>))}
        </select>
        {model ? <div className="rooms-workbench-mobile-model">
          <label>{t('roomsWorkbenchReasoning')}<select value={model.reasoningEffort ?? 'auto'} onChange={(event) =>
            changeExecution({ model: { ...model, reasoningEffort: event.target.value as ComposerReasoningEffort } })}>
            {['auto', 'off', 'low', 'medium', 'high', 'max'].map((effort) => <option value={effort} key={effort}>{effort}</option>)}
          </select></label>
          <label className="rooms-workbench-check"><input type="checkbox" checked={model.serviceTier === 'priority'} onChange={(event) =>
            changeExecution({ model: { ...model, serviceTier: event.target.checked ? 'priority' : undefined } })} />{t('roomsWorkbenchFastMode')}</label>
        </div> : null}
      </div>
      <div className="rooms-workbench-field"><span>{t('roomsWorkbenchPermission')}</span>
        <div className="rooms-workbench-segments" role="group">
          {PERMISSIONS.map((value, index) => <button type="button" key={value} aria-pressed={permission === value}
            disabled={permissionCeiling ? index > PERMISSIONS.indexOf(permissionCeiling) : false}
            title={permissionCeiling && index > PERMISSIONS.indexOf(permissionCeiling) ? t('roomsWorkbenchPermissionCeiling') : undefined}
            onClick={() => changeExecution({ permission: value })}>{t(`roomsWorkbenchPermission_${value}`)}</button>)}
        </div></div>
      {code ? <div className="rooms-workbench-field"><span>{t('roomsWorkbenchLocation')}</span>
        <div className="rooms-workbench-segments" role="group">
          <button type="button" aria-pressed={draft.isolation === 'inherit'} onClick={() => onChange({ ...draft, isolation: 'inherit' })}>{t('roomsWorkbenchCurrentProject')}</button>
          <button type="button" aria-pressed={draft.isolation === 'worktree'} onClick={() => onChange({ ...draft, isolation: 'worktree' })}>{t('roomsWorkbenchIsolated')}</button>
        </div></div> : null}
      <label className="rooms-workbench-field">{t('roomsWorkbenchPersona')}<select value={draft.execution.persona?.id ?? ''} onChange={(event) => {
        const preset = presets.find((item) => item.id === event.target.value)
        const resolved = preset ? resolveCodeAgentPreset(preset) : undefined
        changeExecution({ persona: resolved ? { id: resolved.id, name: resolved.name, text: resolved.persona.slice(0, 2000) } : undefined })
      }}><option value="">{t('roomsWorkbenchNone')}</option>{presets.map((preset) => <option value={preset.id} key={preset.id}>{resolveCodeAgentPreset(preset).name}</option>)}</select></label>
      {code && graphEnabled ? <div className="rooms-workbench-field"><span>{t('roomsWorkbenchOrchestration')}</span>
        <div className="rooms-workbench-segments" role="group">
          <button type="button" aria-pressed={(draft.execution.orchestration ?? 'direct') === 'direct'}
            onClick={() => changeExecution({ orchestration: 'direct' })}>{t('roomsWorkbenchMode_direct')}</button>
          <button type="button" aria-pressed={draft.execution.orchestration === 'graph'}
            onClick={() => changeExecution({ orchestration: 'graph' })}>Graph</button>
        </div></div> : null}
      <div className="rooms-workbench-field rooms-workbench-field-span">
        <WorkbenchSchedulePicker schedule={draft.schedule} onChange={(schedule) => onChange({ ...draft, schedule,
          report: schedule?.kind === 'recurring' && draft.schedule?.kind !== 'recurring' ? 'silent' : draft.report })} />
      </div>
      {draft.schedule?.kind === 'recurring' ? <label className="rooms-workbench-field">{t('roomsWorkbenchReportPolicy')}<select value={draft.report} onChange={(event) =>
        onChange({ ...draft, report: event.target.value as WorkbenchTaskDraft['report'] })}>
        <option value="silent">{t('roomsWorkbenchReportSilent')}</option><option value="final">{t('roomsWorkbenchReportFinal')}</option><option value="failure">{t('roomsWorkbenchReportFailure')}</option>
      </select></label> : null}
      {draft.execution.mode === 'goal' && !draft.execution.goalTokenBudget ? <p className="rooms-workbench-note rooms-workbench-field-span">{t('roomsWorkbenchUnboundedGoal')}</p> : null}
    </div> : null}
  </>
}

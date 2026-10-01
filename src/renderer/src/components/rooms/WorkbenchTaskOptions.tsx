import type { WorkbenchExecution, WorkbenchRequest, WorkbenchSchedule } from '@shared/rooms-api'
import { useChatStore } from '../../store/chat-store'
import { WorkbenchSchedulePicker } from './WorkbenchSchedulePicker'
import { useTranslation } from 'react-i18next'
import { SlidersHorizontal } from 'lucide-react'
import { resolveCodeAgentPreset } from '../chat/code-agent-presets'
import { WorkbenchTaskAgentPicker } from './WorkbenchTaskAgent'
import { workbenchExternalAgent } from './workbench-agent-selection'

export type WorkbenchTaskDraft = {
  title: string
  goal: string
  isolation: 'inherit' | 'worktree'
  execution: WorkbenchExecution
  schedule?: WorkbenchSchedule
  report: WorkbenchRequest['report']
}

export function initialWorkbenchTaskDraft(request: WorkbenchRequest): WorkbenchTaskDraft {
  // A proposal is its own execution choice. The unrelated Code composer can
  // change while this card is open; never borrow its Agent, model, or permission.
  const model = request.execution?.model
  return { title: request.title, goal: request.goal, isolation: request.isolation,
    execution: { mode: request.execution?.mode ?? (request.mode === 'plan' ? 'plan' : 'direct'),
      ...request.execution, ...(model ? { model } : {}),
      orchestration: request.execution?.orchestration ?? 'direct',
      permission: request.execution?.permission ?? 'ask-for-approval' },
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
  const presets = useChatStore((state) => state.codeAgentPresets)
  const graphEnabled = useChatStore((state) => state.graphEnabled)
  const model = draft.execution.model
  const external = code && workbenchExternalAgent(model)
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
            disabled={external && value !== 'direct'} title={external && value !== 'direct' ? t('roomsWorkbenchAgentDirectHint') : undefined}
            onClick={() => changeExecution({ mode: value })}>{t(`roomsWorkbenchMode_${value}`)}</button>)}
        </div></div> : null}
      {draft.execution.mode === 'goal' ? <label className="rooms-workbench-field rooms-workbench-field-span">{t('roomsWorkbenchTokenBudget')}<input type="number" min={1}
        value={draft.execution.goalTokenBudget ?? ''} onChange={(event) => changeExecution({ goalTokenBudget: event.target.value ? Number(event.target.value) : null })} /></label> : null}
      <WorkbenchTaskAgentPicker execution={draft.execution} code={code} onChange={(execution) => onChange({ ...draft, execution })} />
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
      {code && graphEnabled && !external ? <div className="rooms-workbench-field"><span>{t('roomsWorkbenchOrchestration')}</span>
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

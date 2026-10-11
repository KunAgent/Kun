import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCcw, SlidersHorizontal } from 'lucide-react'
import type { Room } from '@shared/rooms-api'
import { useChatStore } from '../../store/chat-store'
import { isKunModelProviderGroup } from '../../lib/kun-model-provider-groups'
import { FloatingComposerModelPicker } from '../chat/FloatingComposerModelPicker'
import type { ComposerReasoningEffort } from '../chat/floating-composer-model-picker-logic'
import type { AgentModels } from './AgentModelSettings'
import { agentPath } from './agent-client'
import { directModelGroups, directReasoningEffort } from './room-direct-model-groups'
import { roomPath, roomRequestId, roomsRequest } from './rooms-client'
import { RoomCodingAgentModelPicker } from './RoomCodingAgentModelPicker'
import './room-direct-model-picker.css'

type Change = { modelRef?: { providerId: string; accountId?: string; model: string }; executorModel?: string; reasoningEffort?: ComposerReasoningEffort }

/**
 * The private chat's "model · effort" pill, the same control as Code's
 * composer. A change applies to this conversation's next messages, never an
 * active or queued request, and shows only after the server confirms it.
 */
export function RoomDirectModelPicker({ room, onSaved, onBusyChange, agentRevision, onModels }: {
  room: Room; onSaved: () => Promise<void>; onBusyChange: (busy: boolean) => void; agentRevision?: number
  onModels?: () => void
}) {
  const { t } = useTranslation('common')
  const codeGroups = useChatStore((state) => state.composerModelGroups)
  const [models, setModels] = useState<AgentModels | null>(null)
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const mounted = useRef(true), saving = useRef(false)
  const busyCallback = useRef(onBusyChange); busyCallback.current = onBusyChange
  const controller = useRef<AbortController | null>(null)
  const revision = useRef(room.revision)
  const pending = useRef<{ key: string; id: string; revision: number } | null>(null)
  const agentId = room.members[0]?.participantAgentId
  const refresh = useCallback(async () => {
    controller.current?.abort()
    const abort = new AbortController(); controller.current = abort
    setLoading(true)
    try {
      if (!agentId) throw new Error(t('directCreationModelsEmpty'))
      const result = await roomsRequest<AgentModels>(agentPath(agentId) + '/models?room_id=' + encodeURIComponent(room.id), 'GET', undefined, abort.signal)
      if (mounted.current && !abort.signal.aborted) { setModels(result); setError('') }
    } catch (cause) {
      if (mounted.current && !abort.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    } finally { if (mounted.current && !abort.signal.aborted) setLoading(false) }
  }, [agentId, room.id, t])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; controller.current?.abort(); busyCallback.current(false) }
  }, [])
  useEffect(() => {
    revision.current = room.revision
    if (!saving.current) void refresh()
  }, [room.id, room.revision, agentId, agentRevision, refresh])

  const { groups, pick, keyFor } = useMemo(() =>
    directModelGroups(models?.options ?? [], codeGroups.filter(isKunModelProviderGroup)), [models, codeGroups])
  const effective = models?.roomOverride ?? models?.main
  const groupId = keyFor(effective)
  const group = groups.find((entry) => entry.providerId === groupId)
  const model = effective?.model ?? ''
  const effort = directReasoningEffort(room.privateReasoningEffort, group, model)

  const save = async (change: Change) => {
    if (saving.current || loading) return
    const key = JSON.stringify(change)
    saving.current = true; setBusy(true); onBusyChange(true); setError('')
    if (pending.current?.key !== key || pending.current.revision !== revision.current) {
      pending.current = { key, id: roomRequestId(), revision: revision.current }
    }
    try {
      const result = await roomsRequest<{ room: Room }>(roomPath(room.id) + '/direct/model', 'PUT', {
        clientRequestId: pending.current.id, expectedRevision: pending.current.revision, ...change })
      if (mounted.current) { revision.current = result.room.revision; await refresh(); await onSaved() }
    } catch (cause) {
      if (mounted.current) {
        await refresh()
        if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
        await onSaved()
      }
    } finally {
      saving.current = false
      if (mounted.current) { setBusy(false); onBusyChange(false) }
    }
  }
  const changeModel = (nextModel: string, nextGroup?: string) => {
    const option = pick(nextGroup, nextModel)
    if (!option?.providerId || (nextGroup === groupId && nextModel === model)) return
    // Keep the chosen effort when the new model supports it; otherwise move to the closest it offers.
    const nextEffort = directReasoningEffort(room.privateReasoningEffort, groups.find((entry) => entry.providerId === nextGroup), nextModel)
    void save({ modelRef: { providerId: option.providerId, accountId: option.accountId, model: option.model },
      ...(room.privateReasoningEffort && nextEffort !== room.privateReasoningEffort ? { reasoningEffort: nextEffort } : {}) })
  }
  const changeEffort = (next: ComposerReasoningEffort) => {
    if (next === effort) return
    void save({ reasoningEffort: next })
  }
  const emptyModelState = groups.length ? undefined : loading && !models ? 'loading' as const : 'unavailable' as const
  return <div className="direct-composer-model-picker" aria-busy={busy || loading} data-room-model-picker>
    {models?.agent?.executor ? <RoomCodingAgentModelPicker agent={models.agent} model={effective?.model}
      disabled={busy || loading} reasoningEffort={room.privateReasoningEffort}
      onChange={(executorModel, nextEffort) => void save({ executorModel,
        ...(room.privateReasoningEffort && nextEffort !== room.privateReasoningEffort ? { reasoningEffort: nextEffort } : {}) })}
      onReasoningEffortChange={(reasoningEffort) => void save({ reasoningEffort })} />
      : <FloatingComposerModelPicker compact mode="select" composerModel={model} composerProviderId={groupId}
      composerPickList={groups.flatMap((entry) => entry.modelIds)} composerModelGroups={groups}
      emptyModelState={emptyModelState} canChangeModel={!busy && !loading && Boolean(models)}
      composerReasoningEffort={effort} onComposerModelChange={changeModel} onComposerReasoningEffortChange={changeEffort}
      renderFooter={(close) => <div className="direct-model-panel-footer">
        <p>{t('directConversationModelHelp')}</p>
        {onModels ? <button type="button" onClick={() => { close(); onModels() }}>
          <SlidersHorizontal size={13} aria-hidden="true" />{t('directModelAgentDefaults')}
        </button> : null}
      </div>} />}
    {error ? <div className="direct-composer-model-error" role="alert">
      <span title={error}>{error}</span>
      <button type="button" disabled={busy || loading} aria-label={t('directCreationModelsRefresh')} title={t('directCreationModelsRefresh')}
        onClick={() => void refresh()}><RotateCcw size={12} aria-hidden="true" /></button>
    </div> : null}
  </div>
}

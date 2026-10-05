import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentIdentity, AgentModelOptions } from '@shared/rooms-api'
import { modelBindingKey } from './agent-client'
import { roomRequestId, roomsRequest } from './rooms-client'
import { useChatStore } from '../../store/chat-store'
import './room-creation-model-picker.css'
import { clearCreationModelRequest, readCreationModelRequest, saveCreationModelRequest, type CreationModelRequest } from './creation-model-request'

type ModelRef = NonNullable<AgentIdentity['modelRef']>

/** Discovery is read-only. A role is created only after an explicit choice and Continue. */
export function RoomCreationModelPicker({ onBack, onClose, onOpen, onBusyChange, onDismissReady }: {
  onBack: () => void; onClose: () => void; onOpen: (roomId: string) => void; onBusyChange: (busy: boolean) => void
  onDismissReady?: (dismiss: () => void) => void
}) {
  const { t } = useTranslation('common')
  const [data, setData] = useState<AgentModelOptions | null>(null)
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState('')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [restored] = useState(readCreationModelRequest)
  const [selected, setSelected] = useState<ModelRef | null>(restored?.modelRef ?? null)
  const [unknown, setUnknown] = useState(Boolean(restored)), [reconciling, setReconciling] = useState(Boolean(restored))
  const knownMissing = useRef(false)
  const callbacks = useRef({ onClose, onOpen, onDismissReady }); callbacks.current = { onClose, onOpen, onDismissReady }
  const mounted = useRef(true), inFlight = useRef(false)
  const selectElement = useRef<HTMLSelectElement>(null), initiallyFocused = useRef(false)
  const request = useRef<CreationModelRequest | null>(restored)
  const discovery = useRef<AbortController | null>(null)
  const refresh = useCallback(async () => {
    discovery.current?.abort()
    const controller = new AbortController(); discovery.current = controller
    setLoading(true); setLoadError('')
    try {
      const result = await roomsRequest<AgentModelOptions>('/v1/agents/creation-models', 'GET', undefined, controller.signal)
      if (mounted.current && !controller.signal.aborted) setData(result)
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current && !controller.signal.aborted) setLoading(false)
    }
  }, [])
  const dismiss = useCallback(() => {
    if (knownMissing.current) clearCreationModelRequest()
    callbacks.current.onClose()
  }, [])
  const reconcile = useCallback(async (): Promise<'created' | 'missing' | 'unknown'> => {
    if (!request.current) return 'missing'
    setReconciling(true)
    try {
      const result = await roomsRequest<{ created: { roomId: string; agentId: string } | null }>(
        '/v1/agents/creation-requests/' + encodeURIComponent(request.current.id))
      if (!mounted.current) return 'unknown'
      if (result.created) {
        clearCreationModelRequest(); callbacks.current.onOpen(result.created.roomId); callbacks.current.onClose()
        return 'created'
      }
      if (result.created !== null) throw new Error('Invalid creation status')
      knownMissing.current = true; setUnknown(false)
      return 'missing'
    } catch {
      if (mounted.current) { knownMissing.current = false; setUnknown(true) }
      return 'unknown'
    } finally { if (mounted.current) setReconciling(false) }
  }, [])
  useEffect(() => {
    mounted.current = true
    void refresh()
    if (request.current) void reconcile()
    callbacks.current.onDismissReady?.(dismiss)
    return () => { mounted.current = false; discovery.current?.abort() }
  }, [dismiss, reconcile, refresh])
  useEffect(() => {
    if (!loading && !loadError && !unknown && !reconciling && !initiallyFocused.current) { selectElement.current?.focus(); initiallyFocused.current = true }
  }, [loading, loadError, unknown, reconciling])
  const options = data?.options ?? []
  const selectedOption = options.find((option) => modelBindingKey(option) === modelBindingKey(selected))
  const eligible = Boolean(selectedOption?.available && selectedOption.providerId)
  const groups = [...new Set(options.map((option) => option.providerId))]
  const submit = async () => {
    if (inFlight.current || loading || reconciling || (!unknown && (Boolean(loadError) || !eligible)) || !selected) return
    inFlight.current = true
    setBusy(true); onBusyChange(true); setError('')
    const key = modelBindingKey(selected)
    if (request.current?.key !== key) request.current = { key, id: roomRequestId(), name: t('directNewAgentName'), modelRef: selected }
    knownMissing.current = false
    saveCreationModelRequest(request.current)
    try {
      const result = await roomsRequest<{ roomId: string }>('/v1/agents/quick-create', 'POST', {
        clientRequestId: request.current.id, name: request.current.name, setupMode: 'chat', modelRef: request.current.modelRef
      })
      if (mounted.current) { clearCreationModelRequest(); onOpen(result.roomId); onClose() }
    } catch (cause) {
      if (mounted.current) {
        const status = await reconcile()
        if (status !== 'created' && mounted.current) {
          setError(cause instanceof Error ? cause.message : String(cause))
          await refresh()
        }
      }
    } finally {
      inFlight.current = false
      if (mounted.current) { setBusy(false); onBusyChange(false) }
    }
  }
  return <div className="direct-creation-model" aria-busy={busy || loading || reconciling}>
    <p>{t('directCreationModelHelp')}</p>
    {reconciling ? <p role="status">{t('directCreationReconciling')}</p> : null}
    {unknown && !reconciling ? <p role="alert">{t('directCreationUnknown')}</p> : null}
    {restored && !unknown && !reconciling ? <p role="status">{t('directCreationRestored')}</p> : null}
    {loading ? <p role="status">{t('roomsLoading')}</p> : null}
    {loadError ? <div role="alert"><p>{loadError}</p></div> : null}
    {!loading && !loadError && !options.some((option) => option.available && option.providerId)
      ? <p role="status">{t('directCreationModelsEmpty')}</p> : null}
    <fieldset className="direct-model-field" disabled={busy || loading || reconciling || unknown || Boolean(loadError)}>
      <legend>{t('directCreationModelLabel')}</legend>
      <select ref={selectElement} aria-label={t('directCreationModelLabel')} value={modelBindingKey(selected)} onChange={(event) => {
        const option = options.find((item) => modelBindingKey(item) === event.target.value)
        // Reset the id even when a user switches away and returns to the original model.
        if (busy || reconciling || unknown) return
        if (knownMissing.current) clearCreationModelRequest()
        request.current = null; setError('')
        setSelected(option?.available && option.providerId
          ? { providerId: option.providerId, accountId: option.accountId, model: option.model } : null)
      }}>
        <option value="">{t('directChooseModel')}</option>
        {selected && !selectedOption ? <option value={modelBindingKey(selected)} disabled>{selected.model} · {t('directUnavailable')}</option> : null}
        {groups.map((id) => <optgroup key={id ?? ''} label={options.find((item) => item.providerId === id)?.providerLabel ?? id ?? ''}>
          {options.filter((item) => item.providerId === id).map((item) => <option key={modelBindingKey(item)} value={modelBindingKey(item)} disabled={!item.available || !item.providerId}>
            {item.model}{item.accountId ? ' · ' + item.accountId : ''}{!item.available || !item.providerId ? ' · ' + t('reason' in item && item.reason === 'agent_scope_unsupported' ? 'directScopeUnsupported' : 'directUnavailable') : ''}
          </option>)}
        </optgroup>)}
      </select>
    </fieldset>
    {selected ? <div className="direct-model-effective">
      <strong>{selected.model}</strong><small>{selectedOption?.providerLabel ?? selected.providerId}{selected.accountId ? ' · ' + selected.accountId : ''}</small>
      <small>{t(eligible ? 'directConfigured' : 'directUnavailable')}</small>
    </div> : null}
    <p className="rooms-run-note">{t('directCreationModelVerification')}</p>
    {error ? <div role="alert"><p>{/room coordinator (lease|ownership)|Conversation service is starting or reconnecting/i.test(error) ? t('directCoordinatorUnavailable') : error}</p></div> : null}
    {busy ? <p role="status">{t('directPreparingChat')}</p> : null}
    <div className="direct-creation-model-tools">
      <button type="button" disabled={busy || loading} onClick={() => void refresh()}>{t('directCreationModelsRefresh')}</button>
      <button type="button" disabled={busy || unknown || reconciling} onClick={() => { dismiss(); useChatStore.getState().openSettings('agents') }}>{t('directConfigureProviders')}</button>
    </div>
    <div className="direct-creation-model-actions">
      <button type="button" disabled={busy || unknown || reconciling} onClick={() => { if (knownMissing.current) clearCreationModelRequest(); onBack() }}>{t('directCreationBack')}</button>
      <button type="button" disabled={busy} onClick={dismiss}>{t('directCreationCancel')}</button>
      <button type="button" className="rooms-run-primary" disabled={busy || loading || reconciling || (!unknown && (Boolean(loadError) || !eligible))} onClick={() => void submit()}>{t(error || restored ? 'directRetry' : 'directCreationContinue')}</button>
    </div>
  </div>
}

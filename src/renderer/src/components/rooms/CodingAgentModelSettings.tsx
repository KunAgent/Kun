import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentIdentity } from '@shared/rooms-api'
import { RoomCodingAgentModelPicker } from './RoomCodingAgentModelPicker'
import { agentPath } from './agent-client'
import { roomRequestId, roomsRequest } from './rooms-client'

/** Model defaults belong to the external Agent's fixed engine and account. */
export function CodingAgentModelSettings({ agent, onSaved, onRefresh }: {
  agent: AgentIdentity; onSaved: () => void; onRefresh: () => void
}) {
  const { t } = useTranslation('common')
  const [current, setCurrent] = useState(agent)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false), mounted = useRef(true)
  const latest = useRef(agent); latest.current = agent
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { setCurrent(latest.current) }, [agent.revision])

  const apply = async (model: string) => {
    const executor = current.executor
    if (!executor || !model.trim() || model === executor.model || inFlight.current) return
    inFlight.current = true
    setBusy(true); setSaved(false); setError('')
    try {
      const result = await roomsRequest<{ agent: AgentIdentity }>(agentPath(current.id), 'PATCH', {
        clientRequestId: roomRequestId(), expectedRevision: current.revision,
        executor: { ...executor, model },
        ...(current.title === executor.model ? { title: model } : {})
      })
      if (mounted.current) { setCurrent(result.agent); setSaved(true); onSaved() }
    } catch (cause) {
      if (mounted.current) { setError(String(cause)); onRefresh() }
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return <div className="direct-model-settings">
    <fieldset className="direct-model-field" disabled={busy || Boolean(current.archivedAt)}>
      <legend>{t('directMainModel')}</legend>
      <p>{t('directMainHelp')}</p>
      <RoomCodingAgentModelPicker agent={current} disabled={busy || Boolean(current.archivedAt)} onChange={(model) => void apply(model)} />
      <div className="direct-model-effective">
        <strong>{t('directEffective', { model: current.executor?.model })}</strong>
        <small>{t(current.executor?.credentialMode === 'native-login' ? 'agentCenter.models.fromAgent' : 'agentCenter.models.fromProvider')}</small>
      </div>
      {busy || saved ? <small role="status">{t(busy ? 'directModelSaving' : 'directModelSaved')}</small> : null}
    </fieldset>
    {error ? <p role="alert" className="rooms-run-error">{error}</p> : null}
  </div>
}

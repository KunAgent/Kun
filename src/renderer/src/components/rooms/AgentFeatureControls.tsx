import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SlidersHorizontal } from 'lucide-react'
import type { AgentFeatures } from '@shared/rooms-api'
import { RoomPopover } from './RoomPopover'
import { useAgentResource } from './agent-client'
import { roomsRequest, roomRequestId } from './rooms-client'

type State = { features: AgentFeatures; revision: number | null; initializing?: boolean }
export function AgentFeatureControls() {
  const { t } = useTranslation('common')
  return <RoomPopover label={t('agentsFeatures')} trigger={<SlidersHorizontal size={17} />} width={280} align="end" className="rooms-icon-button">
    {() => <FeatureOptions />}
  </RoomPopover>
}
function FeatureOptions() {
  const { t } = useTranslation('common')
  const resource = useAgentResource<State>('/v1/agents/features')
  const [saved, setSaved] = useState<State | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [optimistic, setOptimistic] = useState<AgentFeatures | null>(null)
  const pending = useRef<{ hash: string; id: string } | null>(null)
  const data = (saved?.revision ?? -1) >= (resource.data?.revision ?? -1) ? saved ?? resource.data : resource.data
  const update = async (key: keyof AgentFeatures, enabled: boolean) => {
    if (!data || busy) return
    const features = { ...data.features, [key]: enabled }, hash = JSON.stringify([features, data.revision])
    if (pending.current?.hash !== hash) pending.current = { hash, id: roomRequestId() }
    setBusy(true); setError(''); setOptimistic(features)
    try {
      const value = await roomsRequest<State>('/v1/agents/features', 'PUT', {
        features, expectedRevision: data.revision, clientRequestId: pending.current.id })
      setSaved(value); pending.current = null; resource.refresh()
    } catch (cause) { setError(String(cause)) } finally { setBusy(false); setOptimistic(null) }
  }
  return <div className="agent-profile-form">
    {(['identities', 'memory', 'collaboration', 'proposals'] as const).map((key) => <label className="agent-checkbox" key={key}>
      <input type="checkbox" disabled={!data || busy} checked={optimistic?.[key] ?? data?.features[key] ?? false} onChange={(event) => void update(key, event.target.checked)} />
      {t('agentsFeature_' + key)}
    </label>)}
    <p className="rooms-run-note">{t('agentsFeaturesHint')}</p>
    {error || resource.error ? <p role="alert" className="rooms-run-error">{error || resource.error}</p> : null}
  </div>
}

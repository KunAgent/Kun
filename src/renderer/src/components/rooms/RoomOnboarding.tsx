import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentIdentity, OnboardingState, Room } from '@shared/rooms-api'
import { useAgentResource, agentMember } from './agent-client'
import { roomsRequest, roomRequestId } from './rooms-client'
import { AgentPicker } from './AgentPicker'
import { RoomAvatar } from './RoomAvatar'
import { RoomModal } from './RoomModal'
import { useChatStore } from '../../store/chat-store'

type Template = Pick<AgentIdentity, 'templateId' | 'name' | 'title' | 'instructions' | 'defaultRole' | 'presetId' | 'avatar'> & { examples: string[] }
export function useRoomOnboarding(onOpen: (id: string) => void) {
  const resource = useAgentResource<OnboardingState>('/v1/agents/onboarding')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const open = useRef(onOpen); open.current = onOpen
  const launched = useRef(false), refresh = useRef(resource.refresh); refresh.current = resource.refresh
  const perform = async (state: OnboardingState, action: 'initialize' | 'seen' | 'dismiss') =>
    roomsRequest<OnboardingState>('/v1/agents/onboarding', 'POST', { action, expectedRevision: state.revision,
      clientRequestId: action === 'initialize' ? 'starter-team-v2-auto' : roomRequestId() })
  useEffect(() => {
    if (!resource.data || launched.current || error) return
    const state = resource.data
    if (!state.fresh && !(state.completed && !state.seen)) return
    launched.current = true; setBusy(true)
    void (async () => {
      const result = state.fresh ? await perform(state, 'initialize') : state
      if (result.coordinatorRoomId) open.current(result.coordinatorRoomId)
      await perform(result, 'seen'); refresh.current()
    })().catch((cause) => { setError(String(cause)); launched.current = false }).finally(() => setBusy(false))
  }, [resource.data, error]) // The callback ref prevents navigation from rerunning setup.
  return { ...resource, error: error || resource.error, busy,
    retry: () => { setError(''); resource.refresh() },
    dismiss: async () => { if (resource.data) { try { await perform(resource.data, 'dismiss'); resource.refresh() } catch (cause) { setError(String(cause)) } } } }
}

export function RoomOnboardingDialog({ state, onClose, onComplete, onOpenAgent, onOpenGroup, onRefresh }: {
  state: OnboardingState; onClose: () => void; onComplete: (state: OnboardingState) => void; onOpenAgent: (id: string) => void; onOpenGroup: (id: string) => void; onRefresh: () => void
}) {
  const { t } = useTranslation('common')
  const [selections, setSelections] = useState(() => state.slots.map((slot) => ({ templateId: slot.templateId, agent: slot.agent })))
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const pending = useRef<{ hash: string; id: string } | null>(null)
  const submit = async () => {
    const values = selections.map((item) => ({ templateId: item.templateId, agentId: item.agent?.id ?? null, revision: item.agent?.revision }))
    const hash = JSON.stringify(values)
    if (pending.current?.hash !== hash) pending.current = { hash, id: roomRequestId() }
    setBusy(true); setError('')
    try {
      const result = await roomsRequest<OnboardingState>('/v1/agents/onboarding', 'POST', { action: 'complete', selections: values,
        expectedRevision: state.revision, clientRequestId: pending.current.id })
      onComplete(result)
    } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }
  return <RoomModal title={t('roomsInitTeam')} onClose={onClose} busy={busy}>
    <p>{t(state.completed ? 'roomsInitTeamReady' : 'roomsInitPreview')}</p>
    <div className="rooms-init-roster">{state.slots.map((slot, index) => {
      const agent = selections[index].agent
      return <section key={slot.templateId}><div><strong>{slot.name}</strong><p>{slot.title}</p></div>
        {state.completed ? agent ? <button type="button" onClick={() => onOpenAgent(agent.id)}>{agent.name} →</button> : <small>{t('agentsArchivedState')}</small> : <>
          <small>{agent ? t('roomsInitReuse', { name: agent.name }) : t('roomsInitCreate')}</small>
          <AgentPicker label={t('roomsInitChooseAgent')} excluded={selections.flatMap((item, i) => i !== index && item.agent ? [item.agent.id] : [])}
            onSelect={(value) => setSelections((old) => old.map((item, i) => i === index ? { ...item, agent: value } : item))} />
          {agent ? <button type="button" onClick={() => setSelections((old) => old.map((item, i) => i === index ? { ...item, agent: undefined } : item))}>{t('roomsInitCreateInstead')}</button> : null}
        </>}
      </section>
    })}</div>
    {error ? <div role="alert" className="rooms-run-error">{error}<button type="button" disabled={busy} onClick={onRefresh}>{t('roomsInitRefreshPreview')}</button></div> : null}
    {state.groupId ? <button type="button" className="rooms-run-primary" onClick={() => onOpenGroup(state.groupId!)}>{t('roomsInitOpenTeam')}</button> : null}
    {!state.completed ? <button type="button" className="rooms-run-primary" disabled={busy} onClick={() => void submit()}>{t(busy ? 'roomsLoading' : 'roomsInitComplete')}</button> : null}
  </RoomModal>
}

export function RoomWelcomeCard({ room, onTeam, onProfile }: { room: Room; onTeam: () => void; onProfile: () => void }) {
  const { t } = useTranslation('common')
  const agentId = room.members[0]?.participantAgentId
  const profile = useAgentResource<{ agent: AgentIdentity }>(agentId ? '/v1/agents/' + encodeURIComponent(agentId) : null)
  const catalog = useAgentResource<{ templates: Template[] }>('/v1/agents/templates')
  const agent = profile.data?.agent
  const template = catalog.data?.templates.find((item) => item.templateId === agent?.templateId ||
    (!agent?.templateId && agent?.id === 'agent-default-' + item.templateId))
  const examples = template?.examples ?? [t('roomsInitCustomExample')]
  return <section className="rooms-welcome-card" aria-label={t('roomsInitWelcome')}>
    <RoomAvatar member={agent ? agentMember(agent) : room.members[0]} label={room.name} size={60} />
    <h2>{t('roomsInitMeet', { name: room.name })}</h2><p>{agent?.title || room.description}</p>
    <p className="rooms-welcome-description">{agent?.instructions || t('roomsInitWelcomeHint')}</p>
    <div className="rooms-welcome-examples">{examples.map((body) => <button type="button" key={body}
      onClick={() => window.dispatchEvent(new CustomEvent('kun-room-example', { detail: { roomId: room.id, body } }))}>{body}</button>)}</div>
    <div className="rooms-welcome-links"><button type="button" onClick={onTeam}>{t('roomsInitTeam')}</button>
      <button type="button" onClick={onProfile}>{t('agentsProfileAndMemory')}</button>
      <button type="button" onClick={() => useChatStore.getState().openSettings('agents')}>{t('roomsInitConfigureModel')}</button></div>
    <small>{t('roomsInitNoCalls')}</small>
  </section>
}

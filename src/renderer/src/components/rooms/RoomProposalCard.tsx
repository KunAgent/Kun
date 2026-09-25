import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileCheck2 } from 'lucide-react'
import type {
  AgentIdentity,
  Room,
  RoomMember,
  RoomMessage,
  RoomProposalEntry,
  RoomProposalResultRef
} from '@shared/rooms-api'
import { RoomPopover } from './RoomPopover'
import { RoomMemberEditor } from './RoomMemberEditor'
import { AgentProfileForm } from './AgentProfileForm'
import { agentMember, agentPath } from './agent-client'
import {
  roomsClient,
  roomsRequest,
  type RoomPresetCatalog
} from './rooms-client'
import { subscribeRoomEvents } from './useRoomEvents'
import { roomMentionToken } from './room-mentions'
import './rooms-interactions.css'

const shortHash = (value: string): string => {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash.toString(36)
}

const KIND_LABEL = {
  pin_agreement: 'roomsProposalKind_pin_agreement',
  execution_request: 'roomsProposalKind_execution_request',
  add_member: 'roomsProposalKind_add_member',
  create_agent: 'roomsProposalKind_create_agent'
} as const

/**
 * An agent-drafted action card. Agents can only draft proposals; every
 * adoption below performs the real mutation through the user's own request
 * and then resolves the card with the durable result reference.
 */
export function RoomProposalCard({ room, message }: { room: Room; message: RoomMessage }) {
  const { t } = useTranslation('common')
  const proposalId = message.proposalId
  const [proposal, setProposal] = useState<RoomProposalEntry>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState(false)
  const armedAt = useRef<string | null>(null)
  const busyRef = useRef(false)
  const latest = useRef<{ proposal?: RoomProposalEntry }>({})
  latest.current.proposal = proposal

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!proposalId) return
    try {
      setProposal(await roomsClient.getRoomProposal(room.id, proposalId, signal))
      setError('')
    } catch (cause) {
      if (!signal?.aborted) setError(String(cause))
    }
  }, [room.id, proposalId])

  const runBusy = useCallback(async (task: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      await task()
    } catch (cause) {
      setError(String(cause))
      await refresh()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [refresh])

  const resolve = useCallback((input: {
    decision: 'committed' | 'dismissed'
    resultRef?: RoomProposalResultRef
  }) => runBusy(async () => {
    const current = latest.current.proposal
    if (!current) return
    setProposal(await roomsClient.resolveRoomProposal(room.id, current, input))
  }), [room.id, runBusy])

  const adoptExecutionMessage = useCallback(async (messageId: string) => {
    const current = latest.current.proposal
    const since = armedAt.current
    if (!current || current.status !== 'open' || !since || busyRef.current) return
    let sent: RoomMessage
    try {
      sent = (await roomsClient.message(room.id, messageId)).message
    } catch {
      return
    }
    if (sent.authorKind !== 'user' || Date.parse(sent.createdAt) < Date.parse(since)) return
    armedAt.current = null
    setArmed(false)
    await resolve({ decision: 'committed', resultRef: { kind: 'message', id: sent.id } })
  }, [room.id, resolve])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    const off = subscribeRoomEvents((event) => {
      if (event.roomId !== room.id) return
      const payload = event.payload as {
        proposalId?: string
        messageId?: string
        id?: string
      } | undefined
      if (event.kind === 'room.proposal.updated' &&
        (payload?.proposalId === proposalId || payload?.messageId === message.id)) {
        void refresh()
      } else if (event.kind === 'message.created' && payload?.id) {
        void adoptExecutionMessage(payload.id)
      }
    })
    return () => {
      controller.abort()
      off()
    }
  }, [room.id, proposalId, message.id, refresh, adoptExecutionMessage])

  useEffect(() => {
    if (proposal && proposal.status !== 'open' && armedAt.current) {
      armedAt.current = null
      setArmed(false)
    }
  }, [proposal])

  const adoptPin = (text: string) => runBusy(async () => {
    const current = latest.current.proposal
    if (!current) return
    // Deterministic request ids replay the pin and edit on a retry.
    const { rule } = await roomsClient.pinMessage(
      room.id, current.messageId, `${current.proposalId}-pin`)
    const body = text.trim()
    if (body && body !== rule.body) {
      await roomsClient.updateRule(
        room.id,
        { ...rule, revision: rule.revision ?? 0 },
        { body },
        `${current.proposalId}-pin-${shortHash(body)}`
      )
    }
    setProposal(await roomsClient.resolveRoomProposal(room.id, current, {
      decision: 'committed',
      resultRef: { kind: 'rule', id: rule.id }
    }))
  })

  const adoptExecution = () => {
    const current = latest.current.proposal
    if (!current || current.payload.kind !== 'execution_request') return
    const payload = current.payload
    const mentions = payload.memberIds.map((id) =>
      roomMentionToken(
        id,
        room.members.find((member) => member.id === id)?.displayName ?? id
      )
    )
    window.dispatchEvent(new CustomEvent('kun-room-proposal-draft', {
      detail: {
        roomId: room.id,
        body: (mentions.length ? mentions.join(' ') + '\n' : '') + payload.goal,
        mentions: payload.memberIds,
        repositoryId: payload.repositoryId,
        rootRequestId: current.rootRequestId,
        intent: 'execute'
      }
    }))
    armedAt.current = new Date().toISOString()
    setArmed(true)
  }

  const adoptMember = (draft: RoomMember) => runBusy(async () => {
    const current = latest.current.proposal
    if (!current) return
    await roomsClient.update(room, { members: [...room.members, draft] })
    setProposal(await roomsClient.resolveRoomProposal(room.id, current, {
      decision: 'committed',
      resultRef: { kind: 'room', id: room.id }
    }))
  })

  const adoptAgent = (agent: AgentIdentity) => runBusy(async () => {
    const current = latest.current.proposal
    if (!current) return
    setProposal(await roomsClient.resolveRoomProposal(room.id, current, {
      decision: 'committed',
      resultRef: { kind: 'agent', id: agent.id }
    }))
  })

  if (!proposalId) return null
  const author = proposal
    ? room.members.find((member) => member.id === proposal.authorMemberId)?.displayName ??
      message.authorLabelSnapshot
    : message.authorLabelSnapshot
  return (
    <section className="rooms-proposal" aria-label={t('roomsProposal')}>
      <header className="rooms-proposal-head">
        <FileCheck2 size={15} aria-hidden="true" />
        <strong>{proposal ? t(KIND_LABEL[proposal.payload.kind]) : t('roomsProposal')}</strong>
        <span className={`rooms-proposal-status is-${proposal?.status ?? 'open'}`}>
          {proposal ? t('roomsProposalStatus_' + proposal.status) : t('roomsLoading')}
        </span>
      </header>
      <p className="rooms-proposal-author">{t('roomsProposalBy', { name: author })}</p>
      {proposal ? <ProposalPayload room={room} proposal={proposal} /> : null}
      {proposal?.rationale ? (
        <p className="rooms-proposal-rationale">
          <strong>{t('roomsProposalRationale')}</strong> {proposal.rationale}
        </p>
      ) : null}
      {proposal?.status === 'open' ? (
        <p className="rooms-proposal-hint">{t('roomsProposalConfirm')}</p>
      ) : null}
      {proposal?.status === 'withdrawn' ? (
        <p className="rooms-proposal-hint">
          {t(proposal.withdrawnReason === 'topic_stopped'
            ? 'roomsProposalWithdrawnTopic'
            : 'roomsProposalWithdrawnRun')}
        </p>
      ) : null}
      {proposal?.status === 'committed' && proposal.resultRef ? (
        <p className="rooms-proposal-result">
          {t('roomsProposalCommitted_' + proposal.payload.kind)}
        </p>
      ) : null}
      {proposal?.status === 'open' && !room.archivedAt ? (
        <ProposalActions
          room={room}
          proposal={proposal}
          busy={busy}
          armed={armed}
          onPin={adoptPin}
          onExecution={adoptExecution}
          onMember={adoptMember}
          onAgent={adoptAgent}
          onDismiss={() => void resolve({ decision: 'dismissed' })}
        />
      ) : null}
      {error ? <p role="alert" className="rooms-interaction-error">{error}</p> : null}
    </section>
  )
}

function ProposalPayload({ room, proposal }: { room: Room; proposal: RoomProposalEntry }) {
  const { t } = useTranslation('common')
  const payload = proposal.payload
  switch (payload.kind) {
    case 'pin_agreement':
      return <p className="rooms-proposal-text">{payload.body}</p>
    case 'execution_request': {
      const members = payload.memberIds
        .map((id) => room.members.find((member) => member.id === id)?.displayName ?? id)
        .join(', ')
      const repository = payload.repositoryId
        ? room.repositories.find((item) => item.id === payload.repositoryId)?.displayName ??
          payload.repositoryId
        : ''
      return (
        <dl className="rooms-proposal-fields">
          <div>
            <dt>{t('roomsProposalGoal')}</dt>
            <dd className="rooms-proposal-text">{payload.goal}</dd>
          </div>
          {members ? (
            <div>
              <dt>{t('roomsProposalMembers')}</dt>
              <dd>{members}</dd>
            </div>
          ) : null}
          {repository ? (
            <div>
              <dt>{t('roomsProposalRepository')}</dt>
              <dd>{repository}</dd>
            </div>
          ) : null}
        </dl>
      )
    }
    case 'add_member':
      return (
        <dl className="rooms-proposal-fields">
          <div>
            <dt>{t('roomsProposalAgent')}</dt>
            <dd>{payload.participantAgentId}</dd>
          </div>
          {payload.roleNotes ? (
            <div>
              <dt>{t('roomsProposalRoleNotes')}</dt>
              <dd className="rooms-proposal-text">{payload.roleNotes}</dd>
            </div>
          ) : null}
        </dl>
      )
    case 'create_agent':
      return (
        <dl className="rooms-proposal-fields">
          <div>
            <dt>{t('agentsName')}</dt>
            <dd>{payload.name}</dd>
          </div>
          {payload.title ? (
            <div>
              <dt>{t('agentsTitle')}</dt>
              <dd>{payload.title}</dd>
            </div>
          ) : null}
          <div>
            <dt>{t('agentsInstructions')}</dt>
            <dd className="rooms-proposal-text">{payload.instructions}</dd>
          </div>
        </dl>
      )
  }
}

function ProposalActions({
  room,
  proposal,
  busy,
  armed,
  onPin,
  onExecution,
  onMember,
  onAgent,
  onDismiss
}: {
  room: Room
  proposal: RoomProposalEntry
  busy: boolean
  armed: boolean
  onPin: (text: string) => Promise<void>
  onExecution: () => void
  onMember: (member: RoomMember) => Promise<void>
  onAgent: (agent: AgentIdentity) => Promise<void>
  onDismiss: () => void
}) {
  const { t } = useTranslation('common')
  const payload = proposal.payload
  return (
    <div className="rooms-proposal-actions">
      {payload.kind === 'pin_agreement' ? (
        <PinAdoption text={payload.body} busy={busy} onAdopt={onPin} />
      ) : null}
      {payload.kind === 'execution_request' ? (
        <button
          type="button"
          className="rooms-proposal-primary"
          disabled={busy}
          onClick={onExecution}
        >
          {t(armed ? 'roomsProposalArmed' : 'roomsProposalAdoptExecute')}
        </button>
      ) : null}
      {payload.kind === 'add_member' ? (
        <RoomPopover
          label={t('roomsProposalAdoptAddMember')}
          className="rooms-proposal-primary"
          disabled={busy}
          width={400}
          trigger={t('roomsProposalAdoptAddMember')}
        >
          {(close) => (
            <MemberAdoptionPanel
              room={room}
              agentId={payload.participantAgentId}
              roleNotes={payload.roleNotes}
              onAdopt={onMember}
              onDone={close}
            />
          )}
        </RoomPopover>
      ) : null}
      {payload.kind === 'create_agent' ? (
        <RoomPopover
          label={t('roomsProposalAdoptCreateAgent')}
          className="rooms-proposal-primary"
          disabled={busy}
          width={400}
          trigger={t('roomsProposalAdoptCreateAgent')}
        >
          {(close) => (
            <AgentProfileForm
              agent={null}
              draft={{
                name: payload.name,
                title: payload.title,
                instructions: payload.instructions
              }}
              onSaved={(agent) => {
                close()
                void onAgent(agent)
              }}
            />
          )}
        </RoomPopover>
      ) : null}
      <button
        type="button"
        className="rooms-proposal-dismiss"
        disabled={busy}
        onClick={onDismiss}
      >
        {t('roomsProposalDismiss')}
      </button>
    </div>
  )
}

function PinAdoption({ text, busy, onAdopt }: {
  text: string
  busy: boolean
  onAdopt: (text: string) => Promise<void>
}) {
  const { t } = useTranslation('common')
  const [draft, setDraft] = useState(text)
  return (
    <div className="rooms-proposal-pin">
      <label className="rooms-proposal-pin-field">
        {t('roomsProposalAgreementText')}
        <textarea
          rows={4}
          maxLength={64000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="rooms-proposal-primary"
        disabled={busy || !draft.trim()}
        onClick={() => void onAdopt(draft)}
      >
        {t('roomsProposalAdoptPin')}
      </button>
    </div>
  )
}

function MemberAdoptionPanel({ room, agentId, roleNotes, onAdopt, onDone }: {
  room: Room
  agentId: string
  roleNotes: string
  onAdopt: (member: RoomMember) => Promise<void>
  onDone: () => void
}) {
  const { t } = useTranslation('common')
  const [agent, setAgent] = useState<AgentIdentity>()
  const [catalog, setCatalog] = useState<RoomPresetCatalog>()
  const [member, setMember] = useState<RoomMember>()
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let active = true
    setLoadError('')
    void Promise.all([
      roomsRequest<{ agent: AgentIdentity }>(agentPath(agentId)),
      roomsClient.presets()
    ]).then(([agentResult, presetResult]) => {
      if (!active) return
      setAgent(agentResult.agent)
      setCatalog(presetResult)
      setMember((current) => current ?? { ...agentMember(agentResult.agent), roleNotes })
    }).catch((cause) => {
      if (active) setLoadError(String(cause))
    })
    return () => {
      active = false
    }
  }, [agentId, roleNotes])
  return (
    <div className="rooms-proposal-member">
      {loadError ? <p role="alert" className="rooms-interaction-error">{loadError}</p> : null}
      {!agent || !catalog || !member ? (
        loadError ? null : <p className="rooms-proposal-hint">{t('roomsLoading')}</p>
      ) : (
        <RoomMemberEditor
          member={member}
          members={room.members}
          repositories={room.repositories}
          catalog={catalog}
          defaultMemberId={room.defaultMemberId}
          hasActiveTasks={false}
          onChange={(patch) =>
            setMember((current) => (current ? { ...current, ...patch } : current))
          }
        />
      )}
      {agent && member ? (
        <button
          type="button"
          className="rooms-proposal-primary"
          disabled={saving}
          onClick={() => {
            setSaving(true)
            void onAdopt(member).finally(() => {
              setSaving(false)
              onDone()
            })
          }}
        >
          {t('roomsProposalAdoptAddMember')}
        </button>
      ) : null}
    </div>
  )
}

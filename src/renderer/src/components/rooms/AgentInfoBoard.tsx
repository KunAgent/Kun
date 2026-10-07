import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Cpu, Eraser, FolderOpen, SquarePen, Trash2, UserX } from 'lucide-react'
import type { AgentDirectActivity, AgentIdentity, Room } from '@shared/rooms-api'
import { RoomAvatar } from './RoomAvatar'
import { CodingAgentEngineCard } from './RoomCodingAgentParts'
import type { AgentModels } from './AgentModelSettings'
import type { ConversationRemoval } from './agent-chat-removal'
import { agentConversationStatus, workspaceName } from './conversation-info'
import {
  InfoDangerRow, InfoModelCard, InfoPersona, InfoQuickActions, InfoSection, InfoStatus, type InfoModelSource
} from './ConversationInfoParts'

/**
 * The private chat's info board: who the Agent is, which models answer, where
 * it works, and the recoverable removals at the bottom.
 */
export function AgentInfoBoard({ room, agent, models, activity, onEditProfile, onModels, onNewContext, onWorkspace, onRemove }: {
  room: Room
  agent: AgentIdentity | null
  models: AgentModels | null
  activity: AgentDirectActivity | null
  onEditProfile: () => void
  onModels: () => void
  onNewContext: () => void
  onWorkspace: () => void
  onRemove: (removal: ConversationRemoval) => void
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const member = room.members[0]
  const status = agentConversationStatus(agent, activity)
  const archived = status === 'archived'
  const workspace = activity?.workspace.path ?? room.privateWorkspace
  const role = agent?.defaultRole ?? member.role
  const created = agent ? new Date(agent.createdAt).toLocaleDateString(i18n.language, { year: 'numeric', month: 'long', day: 'numeric' }) : ''
  const onOff = (value: boolean | undefined) => value === undefined ? '—' : t(value ? 'conversationInfoOn' : 'conversationInfoOff')
  return <div className="conversation-info" data-conversation-info="agent">
    <section className="conversation-info-hero">
      <span className="conversation-info-avatar" data-status={status}>
        <RoomAvatar member={member} label={member.displayName} size={72} />
      </span>
      <h2>{agent?.name ?? member.displayName}</h2>
      {agent?.title ? <p>{agent.title}</p> : null}
      <InfoStatus status={status} label={t('conversationStatus_' + status)} />
      <InfoQuickActions actions={[
        { id: 'profile', icon: SquarePen, label: t('conversationInfoEditProfile'), onClick: onEditProfile },
        ...(agent?.executor ? [] : [{ id: 'models', icon: Cpu, label: t('conversationInfoChangeModel'), onClick: onModels, disabled: archived }]),
        { id: 'context', icon: Eraser, label: t('conversationInfoNewContext'), onClick: onNewContext, disabled: archived }
      ]} />
    </section>
    <InfoSection title={t('conversationInfoModels')}>
      {agent?.executor ? <CodingAgentEngineCard agent={agent} /> : <div className="conversation-info-models">
        <InfoModelCard label={t('conversationInfoMainModel')} binding={models?.main} available={models?.mainAvailable}
          source={models?.mainSource as InfoModelSource | undefined} verifiedAt={models?.mainVerifiedAt} options={models?.options} />
        <InfoModelCard compact label={t('conversationInfoFastModel')} binding={models?.fast} available={models?.fastAvailable}
          source={models?.fastSource as InfoModelSource | undefined} verifiedAt={models?.fastVerifiedAt} options={models?.options} />
      </div>}
    </InfoSection>
    <InfoSection title={t('conversationInfoWorkspace')} action={<button type="button" className="conversation-info-link"
      data-info-action="workspace" disabled={archived} onClick={onWorkspace}>{t('conversationInfoChangeWorkspace')}</button>}>
      <div className="conversation-info-workspace" title={workspace}>
        <FolderOpen size={16} aria-hidden="true" />
        <span><strong>{room.privateWorkspace ? workspaceName(workspace) : t('agentPrivateWorkspace')}</strong>
          {workspace ? <small>{workspace}</small> : null}</span>
      </div>
    </InfoSection>
    <InfoSection title={t('conversationInfoAbout')}>
      <dl className="conversation-info-facts">
        <div><dt>{t('conversationInfoRole')}</dt><dd>{t('rooms' + role[0].toUpperCase() + role.slice(1))}</dd></div>
        <div><dt>{t('conversationInfoMemoryRead')}</dt><dd>{onOff(agent?.memory.readEnabled)}</dd></div>
        <div><dt>{t('conversationInfoMemoryCapture')}</dt><dd>{onOff(agent?.memory.captureEnabled)}</dd></div>
        {created ? <div><dt>{t('conversationInfoCreated')}</dt><dd>{created}</dd></div> : null}
      </dl>
      <h4 className="conversation-info-subheading">{t('conversationInfoInstructions')}</h4>
      <InfoPersona text={agent?.instructions} empty={t('conversationInfoNoInstructions')} />
    </InfoSection>
    <InfoSection title={t('conversationInfoManage')} danger>
      <InfoDangerRow id="conversation" icon={Trash2} label={t('conversationDeleteChat')}
        hint={t('conversationInfoDeleteChatHint')} onClick={() => onRemove('conversation')} />
      {member.participantAgentId ? <InfoDangerRow id="agent" icon={UserX} label={t('conversationDeleteAgent')}
        hint={t('conversationInfoDeleteAgentHint')} onClick={() => onRemove('agent')} /> : null}
    </InfoSection>
  </div>
}

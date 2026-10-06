import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { AgentDirectory } from './AgentDirectory'
import { AgentProfileForm } from './AgentProfileForm'
import { RoomModal } from './RoomModal'
import { RoomNewChat } from './RoomNewChat'
import { openAgentConversation, openAgentConversationRoom } from './agent-chat-navigation'
import { agentChatOriginIsCurrent, closeAgentChatDialog, useAgentChatPicker } from './agent-chat-picker'

function switchDialog(dialog: 'profile'): void {
  // A new serial keeps the picker's own close callback from dismissing the next step.
  useAgentChatPicker.setState((state) => ({ dialog, serial: state.serial + 1 }))
}

/** Hosts the Code recipient picker, Agent creation form and Agent directory. */
export function AgentChatPickerHost(): ReactElement | null {
  const { t } = useTranslation('common')
  const { dialog, group, origin, serial } = useAgentChatPicker()
  if (!dialog) return null
  const close = (): void => closeAgentChatDialog(serial)
  const stillHere = (): boolean => useAgentChatPicker.getState().serial === serial && agentChatOriginIsCurrent(origin)
  const openAgent = (agentId: string): void => {
    close()
    void openAgentConversation(agentId).catch(() => undefined)
  }
  if (dialog === 'directory') {
    return <RoomModal title={t('agentDirectoryTitle')} onClose={close}>
      <div className="agent-chat-directory-dialog">
        <AgentDirectory onOpen={openAgent} onDetails={openAgent} onCreate={() => switchDialog('profile')} />
      </div>
    </RoomModal>
  }
  if (dialog === 'profile') {
    return <RoomModal title={t('agentsCreate')} onClose={close}>
      <AgentProfileForm agent={null} onSaved={(agent) => {
        const shouldOpen = stillHere()
        close()
        if (shouldOpen) void openAgentConversation(agent.id).catch(() => undefined)
      }} />
    </RoomModal>
  }
  return <RoomNewChat key={serial} selectionMode="all" initialGroup={group} onClose={close}
    onOpen={(roomId) => { if (stillHere()) openAgentConversationRoom(roomId) }}
    onAgent={openAgentConversation} onFill={() => switchDialog('profile')} />
}

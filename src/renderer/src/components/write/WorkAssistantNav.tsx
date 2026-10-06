import { FolderOpen, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { revealWorkAssistant } from '../../write/work-assistant-scope'
import { useWorkAssistantNavigation } from '../../write/work-assistant-navigation'
import { WorkAssistantConversations } from './WorkAssistantConversations'
import { SidebarCommandRow } from '../sidebar/SidebarPrimitives'

/** Same primary entry on both document and paper Work sidebars. */
export function WorkAssistantNav({ showWorkspace = false }: { showWorkspace?: boolean }) {
  const { t } = useTranslation('common')
  const surface = useWorkAssistantNavigation((state) => state.surface)
  return <div className="ds-no-drag" data-testid="work-assistant-navigation">
    <SidebarCommandRow icon={<MessageSquare className="h-4 w-4" />} label={t('writeAssistant')}
      active={surface === 'assistant'} onClick={revealWorkAssistant} />
    {showWorkspace ? <SidebarCommandRow icon={<FolderOpen className="h-4 w-4" />}
      label={t('workAssistantDocuments', { defaultValue: 'Documents' })}
      active={surface === 'workspace'} onClick={() => useWorkAssistantNavigation.getState().openWorkspace()} /> : null}
    {surface === 'assistant' ? <WorkAssistantConversations /> : null}
  </div>
}

import type { ReactElement } from 'react'
import { Blocks, Bot, FileDiff, Gauge, History, ListTree, Quote } from 'lucide-react'
import type { WriteRightPanelId } from '../../write/write-right-panel-state'
import { WriteAssistantSparkleIcon } from './WriteAssistantIcons'

const LABEL_KEYS: Record<WriteRightPanelId, string> = {
  assistant: 'writeAssistant',
  outline: 'workRailOutline',
  review: 'workRailReview',
  references: 'workRailReferences',
  history: 'workRailHistory',
  subagents: 'rightPanelSubagents',
  mcpSkills: 'rightPanelMcpSkills',
  usage: 'rightPanelProviderQuotas'
}

export function writeRightPanelLabelKey(id: WriteRightPanelId): string {
  return LABEL_KEYS[id]
}

/** Rail and panel-header glyph for each Work tool (17px, 1.75 stroke). */
export function WriteRightPanelIcon({
  id,
  className = 'h-[17px] w-[17px]'
}: {
  id: WriteRightPanelId
  className?: string
}): ReactElement {
  const props = { className, strokeWidth: 1.75, 'aria-hidden': true as const }
  switch (id) {
    case 'assistant':
      return <WriteAssistantSparkleIcon className={className} />
    case 'outline':
      return <ListTree {...props} />
    case 'review':
      return <FileDiff {...props} />
    case 'references':
      return <Quote {...props} />
    case 'history':
      return <History {...props} />
    case 'subagents':
      return <Bot {...props} />
    case 'mcpSkills':
      return <Blocks {...props} />
    case 'usage':
      return <Gauge {...props} />
  }
}

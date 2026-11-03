import type { MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { SquareTerminal } from 'lucide-react'
import type { ChatBlock } from '../../agent/types'
import { openTerminal } from '../terminal/terminal-open'
import { isBackgroundShellCommandBlock } from './message-timeline-tools'

function metaString(meta: Record<string, unknown> | undefined, key: string): string {
  const value = meta?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Command rows link to the terminal: a background shell opens its live view
 * in the dock; a finished command can be run again in a terminal tab.
 */
export function ToolTerminalButton({ block, threadId }: { block: ChatBlock; threadId?: string | null }): ReactElement | null {
  const { t } = useTranslation('common')
  if (block.kind !== 'tool' || block.toolKind !== 'command_execution') return null
  const command = metaString(block.meta, 'command')
  if (!command) return null
  const background = isBackgroundShellCommandBlock(block)
  if (!background && block.status === 'running') return null
  const label = background ? t('termDockViewInTerminal') : t('termDockRerunInTerminal')
  const handleClick = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    if (background) {
      openTerminal({ kunProcess: { id: metaString(block.meta, 'session_id'), command, threadId: threadId ?? '' } })
      return
    }
    const cwd = metaString(block.meta, 'cwd') || metaString(block.meta, 'workdir')
    openTerminal({ command, title: command.length > 40 ? `${command.slice(0, 39)}…` : command, ...(cwd ? { cwd } : {}) })
  }
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={handleClick}
      className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover/70 hover:text-ds-ink"
    >
      <SquareTerminal className="h-3.5 w-3.5" strokeWidth={1.9} />
    </button>
  )
}

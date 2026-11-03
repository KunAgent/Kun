import type { ReactElement } from 'react'
import { Terminal } from 'lucide-react'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { settingsButtonClass } from '../settings-button'
import { setupLoginCommand } from './agent-center-actions'

type T = (key: string, options?: Record<string, unknown>) => string

/**
 * Sign-in for an Agent that uses its own account. The command is prefilled
 * into a Kun terminal tab for the user to review and run; it is never run
 * for them. Shown during setup and on the Connection tab, not only after a
 * check reported the account as signed out.
 */
export function AgentLoginRow({ row, platform, onSetupCommand, t }: {
  row: AdeHarnessRow
  platform: string
  onSetupCommand?: (harnessId: string, command: string, title: string) => void
  t: T
}): ReactElement | null {
  const { definition, status } = row
  const login = definition.builtin
    ? setupLoginCommand(definition.setup, status.installed === 'yes' ? status.resolvedCommand : undefined, platform)
    : null
  if (!login || !onSetupCommand) return null
  return <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-3 py-3" data-agent-login={definition.id}>
    <div className="min-w-0 flex-1 basis-64">
      <div className="text-[13px] font-medium text-ds-ink">{t('agentCenter.login.title')}</div>
      <p className="mt-0.5 text-[12px] leading-[1.45] text-ds-muted">{t('agentCenter.login.desc', { name: definition.displayName })}</p>
      {login.note ? <p className="mt-0.5 text-[11.5px] text-ds-faint">{login.note}</p> : null}
    </div>
    <button type="button" data-agent-setup-login onClick={() => onSetupCommand(definition.id, login.command, definition.displayName)}
      className={settingsButtonClass({ size: 'compact', className: 'shrink-0' })}>
      <Terminal aria-hidden className="h-3.5 w-3.5" strokeWidth={1.9} />
      {t('agentCenter.next.login')}
    </button>
  </div>
}

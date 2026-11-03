import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import { AgentIcon } from '../agent-icon'
import { agentHarnessIdForProviderKind } from '../../lib/kun-model-provider-groups'
import { harnessRowAvailable, useHarnessStore } from '../../store/harness-store'

type Props = {
  /** Provider groups the Kun model list hides because an Agent runs their turns. */
  groups: readonly ModelProviderModelGroup[]
  needsConfirm: (harnessId: string) => boolean
  onSwitch: (harnessId: string) => void
  onManage: (harnessId: string) => void
  close: () => void
}

/**
 * Subscriptions such as Cursor run whole turns in their own Agent, so Kun's
 * model list cannot offer them. Name them here with the way to reach them
 * instead of dropping the provider silently.
 */
export function ComposerAgentOnlyProviders({ groups, needsConfirm, onSwitch, onManage, close }: Props): ReactElement | null {
  const { t } = useTranslation('common')
  const rows = useHarnessStore((state) => state.rows)
  const [pending, setPending] = useState<string | null>(null)
  const entries = groups.flatMap((group) => {
    const harnessId = agentHarnessIdForProviderKind(group.kind)
    if (!harnessId) return []
    const row = rows.find((entry) => entry.definition.id === harnessId)
    return [{ group, harnessId, agent: row?.definition.displayName ?? harnessId, available: Boolean(row && harnessRowAvailable(row)) }]
  })
  if (entries.length === 0) return null
  const switchTo = (harnessId: string): void => {
    close()
    onSwitch(harnessId)
  }
  return (
    <div className="px-2.5 py-2 text-[11px] text-ds-muted" data-composer-agent-only-providers>
      <p className="px-1 font-semibold text-ds-faint">{t('composerAgentOnlyProviders.title')}</p>
      <p className="mb-1 px-1 leading-4 text-ds-faint">{t('composerAgentOnlyProviders.hint')}</p>
      {entries.map(({ group, harnessId, agent, available }) => (
        <div key={group.providerId} className="flex items-center gap-2 rounded-lg px-1 py-1.5"
          data-agent-only-provider={group.providerId} data-harness-id={harnessId}>
          <AgentIcon harnessId={harnessId} size={16} className="shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium text-ds-ink">{group.label}</span>
            <span className="block truncate leading-4 text-ds-faint">
              {pending === harnessId ? t('adeHarnessPicker.switchConfirmTitle', { name: agent })
                : t(available ? 'composerAgentOnlyProviders.runsIn' : 'composerAgentOnlyProviders.notEnabled', { agent })}
            </span>
          </span>
          {pending === harnessId ? (
            <>
              <button type="button" onClick={() => setPending(null)} data-agent-only-cancel
                className="shrink-0 rounded-md px-2 py-1 text-ds-muted hover:bg-ds-hover">{t('cancel')}</button>
              <button type="button" onClick={() => switchTo(harnessId)} data-agent-only-confirm
                className="shrink-0 rounded-md bg-accent px-2 py-1 text-white">{t('adeHarnessPicker.switchConfirmYes')}</button>
            </>
          ) : available ? (
            <button type="button" data-agent-only-switch={harnessId}
              onClick={() => needsConfirm(harnessId) ? setPending(harnessId) : switchTo(harnessId)}
              className="shrink-0 rounded-md px-2 py-1 font-medium text-accent hover:bg-ds-hover">
              {t('composerAgentOnlyProviders.switch', { agent })}
            </button>
          ) : (
            <button type="button" data-agent-only-enable={harnessId}
              onClick={() => { close(); onManage(harnessId) }}
              className="shrink-0 rounded-md px-2 py-1 font-medium text-accent hover:bg-ds-hover">
              {t('composerAgentOnlyProviders.enable', { agent })}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

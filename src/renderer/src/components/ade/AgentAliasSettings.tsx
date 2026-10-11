import { useTranslation } from 'react-i18next'
import type { HarnessGatewayBinding } from '../../../../../kun/src/contracts/harness-gateway-binding.js'
import type { AdeHarnessAliasModelGroup } from '@shared/ade-harnesses'
import { AgentSettingsSelect } from './AgentSettingsSelect'

export function AgentAliasSettings({ binding, aliases, supportsSmall, change }: {
  binding: HarnessGatewayBinding; aliases: AdeHarnessAliasModelGroup[]; supportsSmall: boolean;
  change(binding: HarnessGatewayBinding): void
}) {
  const { t } = useTranslation('common')
  const main = aliases.find((alias) => alias.routeId === binding.main.routeId)
  const accounts = (role: 'main' | 'small') => {
    const selection = binding[role]
    if (!selection) return null
    const current = aliases.find((alias) => alias.routeId === selection.routeId)
    return <div className="space-y-1">
      {[...new Set([...selection.allowedConnectionIds, ...(current?.connectionIds ?? [])])].map((id) =>
        <label className="flex items-start gap-2 break-all" key={id}><input type="checkbox"
          checked={selection.allowedConnectionIds.includes(id)}
          disabled={selection.allowedConnectionIds.length === 1 && selection.allowedConnectionIds.includes(id)}
          onChange={(event) => change({ ...binding, [role]: { ...selection, allowedConnectionIds: event.target.checked
            ? [...selection.allowedConnectionIds, id] : selection.allowedConnectionIds.filter((value) => value !== id) } })} />
          <span className="font-mono">{id}</span>
        </label>)}
    </div>
  }
  return <div className="space-y-2 rounded-lg border border-ds-border-muted p-3 text-[12px]">
    <p className="text-ds-muted">{t('agentEnablement.aliasScopeHint')}</p>
    <p>{t('agentEnablement.aliasAccounts', { count: binding.main.allowedConnectionIds.length })}</p>
    {accounts('main')}
    <button type="button" disabled={!main} className="text-ds-muted underline" onClick={() => {
      if (main) change({ ...binding, main: { ...binding.main, allowedConnectionIds: main.connectionIds } })
    }}>{t('agentEnablement.aliasApproveAccounts')}</button>
    {supportsSmall ? <AgentSettingsSelect label={t('agentEnablement.smallAlias')} value={binding.small?.routeId ?? ''}
      options={[{ value: '', label: t('agentEnablement.smallAliasSame') }, ...aliases.filter((alias) => alias.routeId !== binding.main.routeId).map((alias) => ({ value: alias.routeId, label: alias.label }))]}
      onChange={(value) => {
        const alias = aliases.find((entry) => entry.routeId === value)
        change({ ...binding, small: alias ? { routeId: alias.routeId, allowedConnectionIds: alias.connectionIds } : undefined })
      }} /> : <p className="text-ds-muted">{t('agentEnablement.smallAliasUnsupported')}</p>}
    {supportsSmall ? accounts('small') : null}
  </div>
}

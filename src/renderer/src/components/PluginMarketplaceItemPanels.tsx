import type { ReactElement } from 'react'
import { Check, Info, Loader2, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { BUILTIN_GITHUB_MCP_SERVER_ID } from '@shared/github-mcp'
import {
  PERMISSION_LABELS,
  isAllowedDocsUrl,
  mcpServerConfigFromText,
  mcpServerEnabledFromConfig,
  normalizeSkillId,
  storageKey,
  type MarketplaceItem,
  type PluginKind
} from './plugin-marketplace-config'
import {
  itemDescription,
  itemTitle
} from './plugin-marketplace-catalog'

function marketplaceSourceTone(tone: MarketplaceItem['statusTone']): string {
  switch (tone) {
    case 'success':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200'
    case 'warning':
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-200'
    case 'error':
      return 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300'
    case 'default':
    default:
      return 'bg-ds-subtle text-ds-muted'
  }
}


export function OAuthConnectorPreviewDialog({
  item,
  onClose,
  onConfirm,
  t
}: {
  item: MarketplaceItem
  onClose: () => void
  onConfirm: () => void
  t: (key: string, values?: Record<string, unknown>) => string
}): ReactElement {
  const oauth = item.oauth
  const title = itemTitle(item, t)
  const openDocs = (): void => {
    if (!oauth || typeof window.kunGui?.openExternal !== 'function') return
    // Only open allowlisted https docs origins; ignore anything else so a
    // malformed or unexpected docsUrl can never reach the OS link handler.
    if (!isAllowedDocsUrl(oauth.docsUrl)) return
    void window.kunGui.openExternal(oauth.docsUrl).catch(() => undefined)
  }

  if (!oauth) return <></>

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-8 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t('pluginOAuthPreviewTitle', { name: title })}
        className="max-h-full w-full max-w-2xl overflow-y-auto rounded-3xl border border-ds-border bg-ds-card p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-ds-subtle text-ds-ink">
              <Info className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <h2 className="text-[18px] font-semibold text-ds-ink">
                {t('pluginOAuthPreviewTitle', { name: title })}
              </h2>
              <p className="mt-1 text-[13px] leading-5 text-ds-muted">
                {t('pluginOAuthPreviewDesc')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('pluginOAuthClose')}
          >
            <span aria-hidden="true" className="text-[18px] leading-none">x</span>
          </button>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-ds-border bg-ds-main/35 p-4">
            <div className="text-[13px] font-semibold text-ds-ink">{t('pluginOAuthPermissionsTitle')}</div>
            <ul className="mt-3 grid gap-2 text-[13px] leading-5 text-ds-muted">
              {oauth.permissionKeys.map((key) => (
                <li key={key} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ds-muted/70" />
                  <span>{t(key)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-ds-border bg-ds-main/35 p-4">
            <div className="text-[13px] font-semibold text-ds-ink">{t('pluginOAuthSetupTitle')}</div>
            <ol className="mt-3 grid gap-2 text-[13px] leading-5 text-ds-muted">
              {oauth.setupKeys.map((key, index) => (
                <li key={key} className="flex gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ds-subtle text-[11px] font-semibold text-ds-ink">
                    {index + 1}
                  </span>
                  <span>{t(key)}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {oauth.noteKey ? (
          <div className="mt-4 rounded-2xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-[13px] leading-5 text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/25 dark:text-amber-200">
            {t(oauth.noteKey)}
          </div>
        ) : null}

        <div className="mt-5 rounded-2xl border border-ds-border bg-ds-main/35 p-4">
          <div className="text-[13px] font-semibold text-ds-ink">{t('pluginOAuthConfigPreviewTitle')}</div>
          <pre className="mt-3 max-h-52 overflow-auto rounded-xl bg-ds-sidebar/70 p-3 text-[12px] leading-5 text-ds-muted">
            {item.mcpConfig ? JSON.stringify(item.mcpConfig(''), null, 2) : '{}'}
          </pre>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={openDocs}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-ds-border bg-ds-card px-4 py-2 text-[13px] font-semibold text-ds-ink transition hover:bg-ds-hover"
          >
            {t('pluginOAuthOpenDocs')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-xl bg-ds-subtle px-4 py-2 text-[13px] font-semibold text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          >
            {t('pluginOAuthCancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex items-center justify-center rounded-xl bg-ds-userbubble px-4 py-2 text-[13px] font-semibold text-ds-userbubbleFg shadow-sm transition hover:opacity-90"
          >
            {t('pluginOAuthInstall')}
          </button>
        </div>
      </section>
    </div>
  )
}

export function PluginSection({
  title,
  emptyText,
  items,
  busyId,
  isInstalled,
  onAdd,
  disabledSkillIds = [],
  skillToggleBusyId = null,
  onToggleSkillEnabled,
  mcpConfigText = '',
  mcpToggleBusyId = null,
  onToggleMcpEnabled,
  t
}: {
  title: string
  emptyText: string
  items: MarketplaceItem[]
  busyId: string | null
  isInstalled: (item: Pick<MarketplaceItem, 'kind' | 'id'> & Partial<Pick<MarketplaceItem, 'group' | 'serverIds'>>) => boolean
  onAdd: (item: MarketplaceItem) => Promise<void>
  disabledSkillIds?: string[]
  skillToggleBusyId?: string | null
  onToggleSkillEnabled?: (id: string, enabled: boolean) => Promise<void>
  mcpConfigText?: string
  mcpToggleBusyId?: string | null
  onToggleMcpEnabled?: (id: string, enabled: boolean) => Promise<void>
  t: (key: string, values?: Record<string, unknown>) => string
}): ReactElement {
  return (
    <section className="mt-8">
      <h2 className="border-b border-ds-border-muted pb-3 text-[20px] font-semibold text-ds-ink">
        {title}
      </h2>
      {items.length === 0 ? (
        <div className="py-8 text-[14px] text-ds-faint">{emptyText}</div>
      ) : (
        <div className="grid gap-x-14 md:grid-cols-2">
          {items.map((item) => {
            const itemKey = storageKey(item.kind, item.id)
            const installed = isInstalled(item)
            const busy = busyId === itemKey
            const normalizedSkillId = normalizeSkillId(item.id)
            const skillDisabled = item.kind === 'skill' && disabledSkillIds.includes(normalizedSkillId)
            const canToggleSkill = item.kind === 'skill' && item.group === 'personal' && onToggleSkillEnabled
            const toggleBusy = skillToggleBusyId === normalizedSkillId
            const mcpConfig = item.kind === 'mcp' ? mcpServerConfigFromText(mcpConfigText, item.id) : undefined
            const mcpDisabled = item.kind === 'mcp' && !item.systemManaged && !mcpServerEnabledFromConfig(mcpConfig)
            const canToggleMcp = item.kind === 'mcp' && item.group === 'personal' && !!mcpConfig && onToggleMcpEnabled
            const mcpBusy = mcpToggleBusyId === item.id
            const isManagedGitHub = item.kind === 'mcp' &&
              item.systemManaged === true && item.id === BUILTIN_GITHUB_MCP_SERVER_ID
            return (
              <div
                key={itemKey}
                className="flex min-h-[92px] items-center gap-5 border-b border-ds-border-muted py-5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[17px] font-semibold text-ds-ink">
                      {itemTitle(item, t)}
                    </span>
                    {item.sourceLabel ? (
                      <span
                        className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${marketplaceSourceTone(item.statusTone)}`}
                      >
                        {item.sourceLabel}
                      </span>
                    ) : null}
                    {skillDisabled ? (
                      <span className="shrink-0 rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-200">
                        {t('pluginSkillStatusDisabled')}
                      </span>
                    ) : null}
                    {mcpDisabled ? (
                      <span className="shrink-0 rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-200">
                        {t('pluginMcpStatusDisabled')}
                      </span>
                    ) : null}
                    {item.oauth ? (
                      <span className="shrink-0 rounded-md bg-sky-500/15 px-2 py-0.5 text-[11px] font-semibold text-sky-700 dark:text-sky-200">
                        {t('pluginOAuthBadge')}
                      </span>
                    ) : null}
                    {item.supplyChain?.permissions.length ? (
                      <span className="shrink-0 rounded-md bg-ds-subtle px-2 py-0.5 text-[11px] font-semibold text-ds-muted">
                        {item.supplyChain.permissions.map((permission) => PERMISSION_LABELS[permission]).join(' / ')}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[14px] leading-5 text-ds-muted">
                    {itemDescription(item, t)}
                  </p>
                  {item.detail && item.detail !== itemDescription(item, t) ? (
                    <p className="mt-0.5 truncate font-mono text-[12px] text-ds-faint" title={item.detail}>
                      {item.detail}
                    </p>
                  ) : null}
                </div>
                {isManagedGitHub ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onAdd(item)}
                    className="inline-flex h-9 shrink-0 items-center justify-center rounded-xl bg-ds-subtle px-3 text-[12px] font-semibold text-ds-ink transition hover:bg-ds-hover disabled:opacity-60"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('pluginGithubManageButton')}
                  </button>
                ) : canToggleSkill ? (
                  <button
                    type="button"
                    disabled={toggleBusy}
                    onClick={() => void onToggleSkillEnabled(item.id, skillDisabled)}
                    title={skillDisabled ? t('pluginSkillEnable') : t('pluginSkillDisable')}
                    className={`inline-flex h-9 shrink-0 items-center justify-center rounded-xl px-3 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      skillDisabled
                        ? 'bg-ds-subtle text-ds-ink hover:bg-ds-hover'
                        : 'bg-ds-skill-soft text-ds-skill hover:opacity-85'
                    }`}
                  >
                    {toggleBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                    ) : skillDisabled ? (
                      t('pluginSkillEnable')
                    ) : (
                      t('pluginSkillDisable')
                    )}
                  </button>
                ) : canToggleMcp ? (
                  <button
                    type="button"
                    disabled={mcpBusy}
                    onClick={() => void onToggleMcpEnabled(item.id, mcpDisabled)}
                    title={mcpDisabled ? t('pluginMcpEnable') : t('pluginMcpDisable')}
                    className={`inline-flex h-9 shrink-0 items-center justify-center rounded-xl px-3 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      mcpDisabled
                        ? 'bg-ds-subtle text-ds-ink hover:bg-ds-hover'
                        : 'bg-ds-subtle text-ds-muted hover:bg-ds-hover'
                    }`}
                  >
                    {mcpBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                    ) : mcpDisabled ? (
                      t('pluginMcpEnable')
                    ) : (
                      t('pluginMcpDisable')
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={installed || busy}
                    onClick={() => void onAdd(item)}
                    title={installed ? t('pluginAdded') : t('pluginAdd')}
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition ${
                      installed
                        ? 'text-ds-faint'
                        : 'bg-ds-subtle text-ds-ink hover:bg-ds-hover disabled:opacity-60'
                    }`}
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                    ) : installed ? (
                      <Check className="h-4 w-4" strokeWidth={2} />
                    ) : (
                      <Plus className="h-4 w-4" strokeWidth={2} />
                    )}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

export function CustomPluginPanel({
  activeKind,
  customName,
  customDescription,
  customCommand,
  customArgs,
  customConfig,
  customSkillBody,
  busy,
  onNameChange,
  onDescriptionChange,
  onCommandChange,
  onArgsChange,
  onConfigChange,
  onSkillBodyChange,
  onAdd
}: {
  activeKind: PluginKind
  customName: string
  customDescription: string
  customCommand: string
  customArgs: string
  customConfig: string
  customSkillBody: string
  busy: boolean
  onNameChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onCommandChange: (value: string) => void
  onArgsChange: (value: string) => void
  onConfigChange: (value: string) => void
  onSkillBodyChange: (value: string) => void
  onAdd: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <section className="mt-6 rounded-2xl border border-ds-border bg-ds-card/95 p-4 shadow-sm">
      <div className="grid gap-3 md:grid-cols-2">
        <input
          value={customName}
          onChange={(event) => onNameChange(event.target.value)}
          className="h-10 rounded-xl border border-ds-border bg-ds-main/45 px-3 text-[14px] text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
          placeholder={t('pluginCustomName')}
        />
        <input
          value={customDescription}
          onChange={(event) => onDescriptionChange(event.target.value)}
          className="h-10 rounded-xl border border-ds-border bg-ds-main/45 px-3 text-[14px] text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
          placeholder={t('pluginCustomDescription')}
        />
      </div>
      {activeKind === 'mcp' ? (
        <div className="mt-3 grid gap-3">
          <div className="grid gap-3 md:grid-cols-2">
            <input
              value={customCommand}
              onChange={(event) => onCommandChange(event.target.value)}
              className="h-10 rounded-xl border border-ds-border bg-ds-main/45 px-3 text-[14px] text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
              placeholder={t('pluginCustomCommand')}
            />
            <textarea
              value={customArgs}
              onChange={(event) => onArgsChange(event.target.value)}
              className="min-h-[80px] rounded-xl border border-ds-border bg-ds-main/45 px-3 py-2 font-mono text-[13px] leading-5 text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
              placeholder={t('pluginCustomArgs')}
              spellCheck={false}
            />
          </div>
          <textarea
            value={customConfig}
            onChange={(event) => onConfigChange(event.target.value)}
            className="min-h-[120px] rounded-xl border border-ds-border bg-ds-main/45 px-3 py-2 font-mono text-[13px] leading-5 text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
            placeholder={t('pluginCustomMcpConfig')}
            spellCheck={false}
          />
        </div>
      ) : (
        <textarea
          value={customSkillBody}
          onChange={(event) => onSkillBodyChange(event.target.value)}
          className="mt-3 min-h-[140px] w-full rounded-xl border border-ds-border bg-ds-main/45 px-3 py-2 font-mono text-[13px] leading-5 text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
          placeholder={t('pluginCustomSkillBody')}
          spellCheck={false}
        />
      )}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onAdd}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-ds-userbubble px-4 py-2 text-[13px] font-semibold text-ds-userbubbleFg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Plus className="h-4 w-4" strokeWidth={2} />}
          {t('pluginAddCustom')}
        </button>
      </div>
    </section>
  )
}

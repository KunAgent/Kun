import type { ReactElement } from 'react'
import { Info, Loader2, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  isAllowedDocsUrl,
  type MarketplaceItem,
  type PluginKind
} from './plugin-marketplace-config'
import { itemTitle } from './plugin-marketplace-catalog'

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

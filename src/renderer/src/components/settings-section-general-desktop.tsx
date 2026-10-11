import { settingsButtonClass } from './settings-button'
import type { CliInstallAction, CliInstallStatus } from '@shared/cli-install'
import { FolderOpen, Loader2, RefreshCw } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import { SettingRow, SettingsCard, SettingsReveal, Toggle } from './settings-controls'
import { terminalCommandCopy } from './terminal-command-copy'

/** Installs the `kun` shell command; lives on the Terminal page. */
export function CliCommandSettingsCard({ locale }: { locale: string }): ReactElement {
  const zh = locale.toLowerCase().startsWith('zh')
  const [status, setStatus] = useState<CliInstallStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const refresh = (): void => {
    void window.kunGui.cliInstallStatus().then(setStatus).catch((error) => {
      setMessage(error instanceof Error ? error.message : String(error))
    })
  }
  useEffect(refresh, [])
  const act = (action: CliInstallAction): void => {
    setBusy(true)
    setMessage('')
    void window.kunGui.cliInstallAction(action).then((result) => {
      setStatus(result.status)
      setMessage(result.message ?? (result.ok
        ? (zh ? '终端命令已更新。请新开一个终端后输入 kun。' : 'Terminal command updated. Open a new terminal and run kun.')
        : (zh ? '终端命令更新失败。' : 'Could not update the terminal command.')))
    }).finally(() => setBusy(false))
  }
  const copy = terminalCommandCopy(locale, status?.state)
  return (
    <SettingsCard title={zh ? '终端命令' : 'Terminal command'}>
      <SettingRow
        title="kun"
        description={copy.description}
        wideControl
        control={
          <div className="flex flex-wrap items-center gap-2">
            <button aria-busy={Boolean(busy)} className={settingsButtonClass()}
              type="button"
              disabled={busy || status?.state === 'installed' || status?.state === 'conflict'}
              onClick={() => act(status?.state === 'stale' ? 'repair' : 'install')}
            >
              {busy ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : null}
              {copy.primaryAction}
            </button>
            <button className={settingsButtonClass({ variant: 'danger' })}
              type="button"
              disabled={busy || status?.state === 'not-installed' || status?.state === 'conflict'}
              onClick={() => act('uninstall')}
            >
              {copy.removeAction}
            </button>
            <button className={settingsButtonClass({ variant: 'ghost', size: 'icon' })} type="button" disabled={busy} onClick={refresh} aria-label={zh ? '刷新' : 'Refresh'} title={zh ? '刷新' : 'Refresh'}>
              <RefreshCw className="h-4 w-4" />
            </button>
            {status?.commandPath ? <code className="break-all text-[11px] text-ds-faint">{status.commandPath}</code> : null}
            {message ? <div className="w-full text-[12px] text-ds-muted">{message}</div> : null}
          </div>
        }
      />
    </SettingsCard>
  )
}

/** Start-up and window behaviour; part of the General page. */
export function DesktopBehaviorSettingsCard({ view }: { view: Record<string, any> }): ReactElement {
  const { t, update, desktopBehavior, openAtLoginSupported, startMinimizedSupported, systemTitleBarSupported } = view
  return (
    <SettingsCard title={t('settingsIaStartupCard')} description={t('settingsIaStartupCardDesc')}>
      <SettingRow
        title={t('desktopOpenAtLogin')}
        description={openAtLoginSupported ? t('desktopOpenAtLoginDesc') : t('desktopOpenAtLoginUnsupportedDesc')}
        control={
          <Toggle
            checked={desktopBehavior.openAtLogin}
            disabled={!openAtLoginSupported}
            onChange={(v) =>
              update({
                appBehavior: {
                  openAtLogin: v,
                  startMinimized: v ? desktopBehavior.startMinimized : false
                }
              })
            }
          />
        }
      />
      <SettingsReveal open={desktopBehavior.openAtLogin === true && startMinimizedSupported}>
        <SettingRow
          title={t('desktopStartMinimized')}
          description={t('desktopStartMinimizedDesc')}
          control={
            <Toggle
              checked={desktopBehavior.startMinimized}
              onChange={(v) => update({ appBehavior: { startMinimized: v } })}
            />
          }
        />
      </SettingsReveal>
      <SettingRow
        title={t('desktopKeepAwake')}
        description={t('desktopKeepAwakeDesc')}
        control={
          <Toggle
            checked={desktopBehavior.keepAwake === true}
            ariaLabel={t('desktopKeepAwake')}
            onChange={(v) => update({ appBehavior: { keepAwake: v } })}
          />
        }
      />
      <SettingRow
        title={t('desktopCloseAction')}
        description={t('desktopCloseActionDesc')}
        control={<span className="text-[13px] text-ds-muted">{t('desktopCloseAction_quit')}</span>}
      />
      {systemTitleBarSupported ? (
        <SettingRow
          title={t('desktopUseSystemTitleBar')}
          description={t('desktopUseSystemTitleBarDesc')}
          control={
            <Toggle
              checked={desktopBehavior.useSystemTitleBar === true}
              onChange={(v) => update({ appBehavior: { useSystemTitleBar: v } })}
            />
          }
        />
      ) : null}
    </SettingsCard>
  )
}

/** Local error log; part of the Diagnostics page. */
export function LocalLogSettingsCard({ view }: { view: Record<string, any> }): ReactElement {
  const { t, form, update, selectControlClass, logPath, logDirOpenError, setLogDirOpenError, compactHomePath } = view
  return (
    <SettingsCard title={t('logTitle')} description={t('logEnabledDesc')}>
      <SettingRow
        title={t('logEnabled')}
        description={t('logEnabledDesc')}
        control={
          <Toggle
            checked={form.log.enabled}
            onChange={(v) => update({ log: { enabled: v } })}
          />
        }
      />
      <SettingsReveal open={form.log.enabled === true}>
        <SettingRow
          title={t('logRetention')}
          description={t('logRetentionDesc')}
          control={
            <select
              className={selectControlClass}
              value={form.log.retentionDays}
              onChange={(e) => update({ log: { retentionDays: Number(e.target.value) } })}
            >
              <option value={1}>{t('logRetentionOne')}</option>
              <option value={2}>{t('logRetentionTwo')}</option>
              <option value={3}>{t('logRetentionThree')}</option>
              <option value={5}>{t('logRetentionFive')}</option>
              <option value={7}>{t('logRetentionSeven')}</option>
            </select>
          }
        />
      </SettingsReveal>
      <SettingRow
        title={t('logDir')}
        description={t('logDirDesc')}
        wideControl
        control={
          <div className="flex w-full min-w-0 flex-col items-start gap-2">
            {logPath ? (
              <code className="block w-full max-w-full break-all rounded-xl border border-ds-border-muted bg-ds-main/60 px-3 py-2 font-mono text-[12px] text-ds-ink">
                {compactHomePath(logPath)}
              </code>
            ) : (
              <span className="text-[13px] text-ds-faint">…</span>
            )}
            <button className={settingsButtonClass()}
              type="button"
              disabled={typeof window.kunGui?.openLogDir !== 'function'}
              onClick={async () => {
                if (typeof window.kunGui?.openLogDir !== 'function') return
                setLogDirOpenError(null)
                try {
                  const result = await window.kunGui.openLogDir()
                  if (!result.ok) setLogDirOpenError(result.message ?? 'Unknown error')
                } catch (e) {
                  setLogDirOpenError(e instanceof Error ? e.message : String(e))
                }
              }}
            >
              <FolderOpen className="h-4 w-4" />
              {t('logDirOpen')}
            </button>
            {logDirOpenError ? (
              <p className="text-[12px] text-red-700 dark:text-red-300">
                {logDirOpenError}
              </p>
            ) : null}
          </div>
        }
      />
    </SettingsCard>
  )
}

import { useState, type ReactElement } from 'react'
import {
  validateClawImTelegramProxy,
  type ClawImAgentProfileV1,
  type ClawImPlatformCredentialV1,
  type ClawImTelegramProxyV1,
  type ClawModel
} from '@shared/app-settings'
import type { ClawImTelegramConnectErrorCode } from '@shared/kun-gui-api'
import { SettingsCard, Toggle } from './settings-controls'

type Translate = (key: string, values?: Record<string, unknown>) => string

export type AddClawChannelFn = (
  provider: 'telegram',
  agentProfile: ClawImAgentProfileV1,
  platformCredential: ClawImPlatformCredentialV1,
  options: {
    model: ClawModel
    enabled: boolean
    im: { enabled?: boolean }
    preserveRoute?: boolean
  }
) => Promise<void>

export function clawTextInputClass(extra = ''): string {
  return `w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 ${extra}`
}

function surfaceButtonClass(extra = ''): string {
  return `inline-flex items-center justify-center gap-2 rounded-xl border border-ds-border bg-ds-card px-4 py-2 text-[13px] font-semibold text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55 ${extra}`
}

function translateTelegramError(
  t: Translate,
  code: ClawImTelegramConnectErrorCode | undefined,
  fallback: string
): string {
  switch (code) {
    case 'invalid_format':
      return t('connectPhoneTelegramErrorInvalidFormat')
    case 'invalid_proxy':
      return t('connectPhoneTelegramErrorInvalidProxy')
    case 'rejected':
      return t('connectPhoneTelegramErrorRejected')
    case 'network':
      return t('connectPhoneTelegramErrorNetwork')
    case 'unknown':
      return t('connectPhoneTelegramErrorUnknown')
    default:
      return fallback
  }
}

export function TelegramConnectCard({
  t,
  tCommon,
  addClawChannel
}: {
  t: Translate
  tCommon: Translate
  addClawChannel: AddClawChannelFn
}): ReactElement {
  const [botToken, setBotToken] = useState('')
  const [allowedChatIds, setAllowedChatIds] = useState('')
  const [proxyEnabled, setProxyEnabled] = useState(false)
  const [proxyUrl, setProxyUrl] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')

  const handleConnect = async (): Promise<void> => {
    const trimmedToken = botToken.trim()
    if (!trimmedToken) {
      setError(tCommon('connectPhoneTelegramTokenRequired'))
      return
    }
    const proxy: ClawImTelegramProxyV1 = { enabled: proxyEnabled, url: proxyUrl.trim() }
    const proxyValidation = validateClawImTelegramProxy(proxy)
    if (!proxyValidation.ok) {
      setError(tCommon('connectPhoneTelegramErrorInvalidProxy'))
      return
    }
    if (connecting) return
    setError('')
    setConnecting(true)
    try {
      const result = await window.kunGui.connectTelegramBot(
        trimmedToken,
        allowedChatIds.trim() || undefined,
        proxyValidation.proxy
      )
      if (!result.ok) {
        setError(translateTelegramError(tCommon, result.code, result.message))
        return
      }
      await addClawChannel(
        'telegram',
        { name: 'telegram agent', description: '', identity: '', personality: '', userContext: '', replyRules: '' },
        {
          kind: 'telegram',
          botToken: trimmedToken,
          allowedChatIds: allowedChatIds.trim(),
          ...(result.botUsername ? { botUsername: result.botUsername } : {}),
          proxy: proxyValidation.proxy,
          createdAt: new Date().toISOString()
        },
        { model: 'auto', enabled: true, im: { enabled: true }, preserveRoute: true }
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.startsWith('Invalid payload for claw:im-install:telegram-token')) {
        setError(tCommon('connectPhoneTelegramErrorPayload'))
      } else {
        setError(message)
      }
    } finally {
      setConnecting(false)
    }
  }

  return (
    <SettingsCard title={t('clawTelegramConnectTitle')}>
      <div className="space-y-4 px-1">
        <p className="text-[13px] leading-6 text-ds-muted">
          {t('clawTelegramConnectDesc')}
        </p>
        <ol className="grid gap-1.5 text-[13px] leading-6 text-ds-muted">
          <li className="flex gap-2">
            <span className="shrink-0 font-semibold text-ds-faint">1.</span>
            <span>{t('clawTelegramConnectStep1')}</span>
          </li>
          <li className="flex gap-2">
            <span className="shrink-0 font-semibold text-ds-faint">2.</span>
            <span>{t('clawTelegramConnectStep2')}</span>
          </li>
          <li className="flex gap-2">
            <span className="shrink-0 font-semibold text-ds-faint">3.</span>
            <span>{t('clawTelegramConnectStep3')}</span>
          </li>
          <li className="flex gap-2">
            <span className="shrink-0 font-semibold text-ds-faint">4.</span>
            <span>{t('clawTelegramConnectStep4')}</span>
          </li>
        </ol>
        <label className="block min-w-0">
          <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
            {tCommon('connectPhoneTelegramBotTokenLabel')}
          </span>
          <input
            type="password"
            value={botToken}
            onChange={(event) => setBotToken(event.target.value)}
            placeholder={tCommon('connectPhoneTelegramBotTokenPlaceholder')}
            disabled={connecting}
            className={clawTextInputClass()}
          />
        </label>
        <label className="block min-w-0">
          <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
            {tCommon('connectPhoneTelegramAllowedChatsLabel')}
          </span>
          <input
            type="text"
            value={allowedChatIds}
            onChange={(event) => setAllowedChatIds(event.target.value)}
            placeholder={tCommon('connectPhoneTelegramAllowedChatsPlaceholder')}
            disabled={connecting}
            className={clawTextInputClass()}
          />
          <span className="mt-1.5 block text-[12px] leading-5 text-ds-faint">
            {tCommon('connectPhoneTelegramAllowedChatsHint')}
          </span>
        </label>
        <div className="rounded-xl border border-ds-border-muted bg-ds-card/55 px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-ds-muted">
                {tCommon('connectPhoneTelegramProxyEnabledLabel')}
              </div>
              <div className="mt-1 text-[12px] leading-5 text-ds-faint">
                {tCommon('connectPhoneTelegramProxyEnabledHint')}
              </div>
            </div>
            <Toggle
              checked={proxyEnabled}
              onChange={setProxyEnabled}
              disabled={connecting}
              ariaLabel={tCommon('connectPhoneTelegramProxyEnabledLabel')}
            />
          </div>
          <label className="mt-3 block min-w-0">
            <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
              {tCommon('connectPhoneTelegramProxyUrlLabel')}
            </span>
            <input
              type="password"
              value={proxyUrl}
              onChange={(event) => setProxyUrl(event.target.value)}
              placeholder={tCommon('connectPhoneTelegramProxyUrlPlaceholder')}
              disabled={connecting}
              className={clawTextInputClass()}
            />
            <span className="mt-1.5 block text-[12px] leading-5 text-ds-faint">
              {tCommon('connectPhoneTelegramProxyUrlHint')}
            </span>
          </label>
        </div>
        <button aria-busy={connecting} data-settings-action="primary" data-settings-size="default"
          type="button"
          onClick={() => void handleConnect()}
          disabled={connecting}
          className={surfaceButtonClass('min-h-[38px]')}
        >
          {connecting ? tCommon('connectPhoneTelegramConnecting') : tCommon('connectPhoneTelegramConnect')}
        </button>
        {error ? (
          <p className="rounded-xl bg-red-500/10 px-3 py-2 text-[13px] leading-5 text-red-600 dark:text-red-300">
            {error}
          </p>
        ) : null}
      </div>
    </SettingsCard>
  )
}

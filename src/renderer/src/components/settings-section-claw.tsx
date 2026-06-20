import type { ReactElement } from 'react'
import { useState } from 'react'
import {
  type AppSettingsPatch,
  type AppSettingsV1,
  type ClawImAgentProfileV1,
  type ClawImChannelV1,
  type ClawImPlatformCredentialV1,
  type ClawModel
} from '@shared/app-settings'
import type { ClawImTelegramConnectErrorCode } from '@shared/kun-gui-api'
import { AdvancedSettingsDisclosure, InlineNoticeView, SettingsCard, SettingRow, Toggle } from './settings-controls'
import { clawModelSelectOptions } from '../lib/claw-model-options'

type AddClawChannelFn = (
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

type ClawSettingsContext = {
  t: (key: string, values?: Record<string, unknown>) => string
  tCommon: (key: string, values?: Record<string, unknown>) => string
  form: AppSettingsV1
  update: (partial: AppSettingsPatch) => void
  selectControlClass: string
  compactHomePath: (path: string) => string
  expandHomePath: (path: string) => string
  pickClawWorkspace: () => Promise<void>
  resetClawWorkspaceToDefault: () => void
  clawWorkspacePickerError: string | null
  addClawChannel: AddClawChannelFn
}

type ClawAgentProfileField = keyof ClawImAgentProfileV1

const profileFields: Array<{
  key: ClawAgentProfileField
  labelKey: string
  placeholderKey: string
  rows: number
}> = [
  { key: 'description', labelKey: 'clawManageAgentDescription', placeholderKey: 'clawManageAgentDescriptionPlaceholder', rows: 2 },
  { key: 'identity', labelKey: 'clawManageAgentIdentity', placeholderKey: 'clawManageAgentIdentityPlaceholder', rows: 4 },
  { key: 'personality', labelKey: 'clawManageAgentPersonality', placeholderKey: 'clawManageAgentPersonalityPlaceholder', rows: 3 },
  { key: 'userContext', labelKey: 'clawManageAgentUserContext', placeholderKey: 'clawManageAgentUserContextPlaceholder', rows: 3 },
  { key: 'replyRules', labelKey: 'clawManageAgentReplyRules', placeholderKey: 'clawManageAgentReplyRulesPlaceholder', rows: 4 }
]

function textInputClass(extra = ''): string {
  return `w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 ${extra}`
}

function surfaceButtonClass(extra = ''): string {
  return `inline-flex items-center justify-center gap-2 rounded-xl border border-ds-border bg-ds-card px-4 py-2 text-[13px] font-semibold text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55 ${extra}`
}

function translateTelegramError(
  t: (key: string) => string,
  code: ClawImTelegramConnectErrorCode | undefined,
  fallback: string
): string {
  switch (code) {
    case 'invalid_format':
      return t('connectPhoneTelegramErrorInvalidFormat')
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

function updateChannels(
  form: AppSettingsV1,
  update: (partial: AppSettingsPatch) => void,
  mapper: (channel: ClawImChannelV1) => ClawImChannelV1
): void {
  update({ claw: { channels: form.claw.channels.map(mapper) } })
}

function updateChannel(
  form: AppSettingsV1,
  update: (partial: AppSettingsPatch) => void,
  channelId: string,
  patch: Partial<ClawImChannelV1>
): void {
  const now = new Date().toISOString()
  updateChannels(form, update, (channel) =>
    channel.id === channelId ? { ...channel, ...patch, updatedAt: now } : channel
  )
}

function updateChannelProfile(
  form: AppSettingsV1,
  update: (partial: AppSettingsPatch) => void,
  channel: ClawImChannelV1,
  patch: Partial<ClawImAgentProfileV1>
): void {
  const nextProfile = {
    ...channel.agentProfile,
    ...patch
  }
  updateChannel(form, update, channel.id, {
    label: nextProfile.name.trim() || channel.label,
    agentProfile: nextProfile
  })
}

function channelEffectiveWorkspace(form: AppSettingsV1, channel: ClawImChannelV1): string {
  return channel.workspaceRoot.trim() || form.claw.im.workspaceRoot.trim() || form.workspaceRoot
}

function updateTelegramCredential(
  form: AppSettingsV1,
  update: (partial: AppSettingsPatch) => void,
  channelId: string,
  botToken: string,
  allowedChatIds: string
): void {
  const now = new Date().toISOString()
  updateChannels(form, update, (channel) => {
    if (channel.id !== channelId) return channel
    const prev = channel.platformCredential
    if (!prev || prev.kind !== 'telegram') return channel
    return {
      ...channel,
      updatedAt: now,
      platformCredential: { ...prev, botToken, allowedChatIds }
    }
  })
}

function TelegramConnectCard({
  t,
  tCommon,
  addClawChannel
}: {
  t: ClawSettingsContext['t']
  tCommon: ClawSettingsContext['tCommon']
  addClawChannel: AddClawChannelFn
}): ReactElement {
  const [botToken, setBotToken] = useState('')
  const [allowedChatIds, setAllowedChatIds] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')

  const handleConnect = async (): Promise<void> => {
    const trimmedToken = botToken.trim()
    if (!trimmedToken) {
      setError(tCommon('connectPhoneTelegramTokenRequired'))
      return
    }
    if (connecting) return
    setError('')
    setConnecting(true)
    try {
      const result = await window.kunGui.connectTelegramBot(
        trimmedToken,
        allowedChatIds.trim() || undefined
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
          createdAt: new Date().toISOString()
        },
        { model: 'auto', enabled: true, im: { enabled: true }, preserveRoute: true }
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.startsWith('Invalid payload for claw:im-install:telegram-token')) {
        setError(tCommon('connectPhoneTelegramErrorPayload'))
      } else {
        setError(msg)
      }
    } finally {
      setConnecting(false)
    }
  }

  return (
    <SettingsCard title={t('clawTelegramConnectTitle')} className="mt-6">
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
            onChange={(e) => setBotToken(e.target.value)}
            placeholder={tCommon('connectPhoneTelegramBotTokenPlaceholder')}
            disabled={connecting}
            className={textInputClass()}
          />
        </label>
        <label className="block min-w-0">
          <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
            {tCommon('connectPhoneTelegramAllowedChatsLabel')}
          </span>
          <input
            type="text"
            value={allowedChatIds}
            onChange={(e) => setAllowedChatIds(e.target.value)}
            placeholder={tCommon('connectPhoneTelegramAllowedChatsPlaceholder')}
            disabled={connecting}
            className={textInputClass()}
          />
          <span className="mt-1.5 block text-[12px] leading-5 text-ds-faint">
            {tCommon('connectPhoneTelegramAllowedChatsHint')}
          </span>
        </label>
        <button
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

export function ClawSettingsSection({ ctx }: { ctx: ClawSettingsContext }): ReactElement {
  const {
    t,
    tCommon,
    form,
    update,
    selectControlClass,
    compactHomePath,
    expandHomePath,
    pickClawWorkspace,
    resetClawWorkspaceToDefault,
    clawWorkspacePickerError,
    addClawChannel
  } = ctx
  const hasTelegramChannel = form.claw.channels.some((channel) => channel.provider === 'telegram')

  return (
    <>
      <SettingsCard title={t('clawRuntime')}>
        <SettingRow
          title={t('clawEnabled')}
          description={t('clawEnabledDesc')}
          control={
            <Toggle
              checked={form.claw.enabled}
              onChange={(value) => update({ claw: { enabled: value } })}
            />
          }
        />
        <SettingRow
          title={t('clawDefaultWorkspace')}
          description={t('clawDefaultWorkspaceDesc')}
          control={
            <div className="w-full min-w-[200px] md:max-w-xl">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  className={textInputClass()}
                  value={compactHomePath(form.claw.im.workspaceRoot)}
                  onChange={(e) =>
                    update({
                      claw: {
                        im: {
                          workspaceRoot: expandHomePath(e.target.value)
                        }
                      }
                    })
                  }
                  placeholder={t('clawDefaultWorkspacePlaceholder', { path: compactHomePath(form.workspaceRoot) })}
                />
                <button
                  type="button"
                  onClick={resetClawWorkspaceToDefault}
                  className="shrink-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                >
                  {t('clawDefaultWorkspaceReset')}
                </button>
                <button
                  type="button"
                  onClick={() => void pickClawWorkspace()}
                  className="shrink-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                >
                  {t('browse')}
                </button>
              </div>
              {clawWorkspacePickerError ? (
                <p className="mt-2 text-[13px] leading-5 text-amber-700 dark:text-amber-300">
                  {clawWorkspacePickerError}
                </p>
              ) : null}
            </div>
          }
        />
      </SettingsCard>

      {!hasTelegramChannel ? (
        <TelegramConnectCard t={t} tCommon={tCommon} addClawChannel={addClawChannel} />
      ) : null}

      <SettingsCard title={t('clawManageAgents')} className="mt-6">
        {form.claw.channels.length === 0 ? (
          <div className="px-3 py-4 text-[13px] leading-6 text-ds-muted">
            {t('clawManageAgentsEmpty')}
          </div>
        ) : (
          form.claw.channels.map((channel) => {
            const name = channel.agentProfile.name.trim() || channel.label
            const providerLabel = channel.provider === 'telegram'
              ? 'Telegram'
              : channel.provider === 'weixin' ? 'WeChat' : 'Feishu / Lark'
            const tgCredential = channel.provider === 'telegram' && channel.platformCredential?.kind === 'telegram'
              ? channel.platformCredential
              : null
            return (
              <div key={channel.id} className="px-3 py-4">
                <AdvancedSettingsDisclosure
                  title={name}
                  description={t('clawManageAgentMeta', {
                    provider: providerLabel,
                    model: channel.model,
                    workspace: compactHomePath(channelEffectiveWorkspace(form, channel))
                  })}
                >
                  <div className="grid gap-4 px-4 py-4">
                    <div className="flex flex-col gap-3 rounded-xl border border-ds-border-muted bg-ds-card/55 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-ds-ink">{providerLabel}</div>
                        <div className="mt-1 text-[12px] leading-5 text-ds-faint">
                          {channel.enabled ? t('clawManageAgentEnabled') : t('clawManageAgentDisabled')}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-[12px] font-medium text-ds-muted">
                          {channel.enabled ? t('clawManageAgentEnabled') : t('clawManageAgentDisabled')}
                        </span>
                        <Toggle
                          checked={channel.enabled}
                          onChange={(value) => updateChannel(form, update, channel.id, { enabled: value })}
                        />
                      </div>
                    </div>

                    {channel.provider === 'feishu' ? (
                      <SettingRow
                        title={t('clawFeishuStream')}
                        description={t('clawFeishuStreamDesc')}
                        control={
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] font-medium text-ds-muted">
                              {channel.feishuStream === true
                                ? t('clawManageAgentEnabled')
                                : t('clawManageAgentDisabled')}
                            </span>
                            <Toggle
                              checked={channel.feishuStream === true}
                              onChange={(value) => updateChannel(form, update, channel.id, { feishuStream: value })}
                            />
                          </div>
                        }
                      />
                    ) : null}

                    {tgCredential ? (
                      <div className="rounded-xl border border-ds-border-muted bg-ds-card/70 p-4">
                        <div className="text-[12px] font-semibold text-ds-muted">
                          {t('clawTelegramCredentialTitle')}
                        </div>
                        <div className="mt-3 grid gap-3">
                          <label className="block min-w-0">
                            <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
                              {tCommon('connectPhoneTelegramBotTokenLabel')}
                            </span>
                            <input
                              type="password"
                              className={textInputClass()}
                              value={tgCredential.botToken}
                              onChange={(e) =>
                                updateTelegramCredential(form, update, channel.id, e.target.value, tgCredential.allowedChatIds)}
                              placeholder={tCommon('connectPhoneTelegramBotTokenPlaceholder')}
                            />
                          </label>
                          <label className="block min-w-0">
                            <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
                              {tCommon('connectPhoneTelegramAllowedChatsLabel')}
                            </span>
                            <input
                              type="text"
                              className={textInputClass()}
                              value={tgCredential.allowedChatIds}
                              onChange={(e) =>
                                updateTelegramCredential(form, update, channel.id, tgCredential.botToken, e.target.value)}
                              placeholder={tCommon('connectPhoneTelegramAllowedChatsPlaceholder')}
                            />
                            <span className="mt-1.5 block text-[12px] leading-5 text-ds-faint">
                              {tCommon('connectPhoneTelegramAllowedChatsHint')}
                            </span>
                          </label>
                        </div>
                        <div className="mt-3">
                          <InlineNoticeView
                            notice={{
                              tone: 'info',
                              message: t('clawTelegramConnectedHint', {
                                bot: tgCredential.botUsername ? `@${tgCredential.botUsername}` : 'Telegram Bot'
                              })
                            }}
                          />
                        </div>
                      </div>
                    ) : null}

                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="block min-w-0">
                        <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
                          {t('clawManageAgentName')}
                        </span>
                        <input
                          className={textInputClass()}
                          value={channel.agentProfile.name}
                          onChange={(e) => updateChannelProfile(form, update, channel, { name: e.target.value })}
                          placeholder={t('clawManageAgentNamePlaceholder')}
                        />
                      </label>
                      <label className="block min-w-0">
                        <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
                          {t('clawModel')}
                        </span>
                        <select
                          className={selectControlClass}
                          value={channel.model}
                          onChange={(e) => updateChannel(form, update, channel.id, { model: e.target.value as ClawModel })}
                        >
                          {clawModelSelectOptions(form, channel.model).map((model) => (
                            <option key={model} value={model}>{model}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block min-w-0 md:col-span-2">
                        <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
                          {t('clawWorkspaceOverride')}
                        </span>
                        <input
                          className={textInputClass()}
                          value={compactHomePath(channel.workspaceRoot)}
                          onChange={(e) =>
                            updateChannel(form, update, channel.id, { workspaceRoot: expandHomePath(e.target.value) })}
                          placeholder={t('clawWorkspaceInherit', {
                            path: compactHomePath(form.claw.im.workspaceRoot.trim() || form.workspaceRoot)
                          })}
                        />
                      </label>
                    </div>

                    <div className="grid gap-3">
                      {profileFields.map((field) => (
                        <label key={field.key} className="block min-w-0">
                          <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
                            {t(field.labelKey)}
                          </span>
                          <textarea
                            className={textInputClass('resize-y leading-5')}
                            rows={field.rows}
                            value={channel.agentProfile[field.key]}
                            onChange={(e) => updateChannelProfile(form, update, channel, { [field.key]: e.target.value })}
                            placeholder={t(field.placeholderKey)}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                </AdvancedSettingsDisclosure>
              </div>
            )
          })
        )}
      </SettingsCard>
    </>
  )
}

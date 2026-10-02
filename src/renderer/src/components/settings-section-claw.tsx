import { settingsButtonClass } from './settings-button'
import type { ReactElement } from 'react'
import { useState } from 'react'
import { Bot, MessageSquare, Settings } from 'lucide-react'
import {
  validateClawImTelegramProxy,
  type AppSettingsPatch,
  type AppSettingsV1,
  type ClawImAgentProfileV1,
  type ClawImChannelV1,
  type ClawImTelegramPlatformCredentialV1,
  type ClawModel
} from '@shared/app-settings'
import {
  AdvancedSettingsDisclosure,
  InlineNoticeView,
  SettingsCard,
  SettingsTabPanel,
  SettingsTabs,
  SettingRow,
  Toggle
} from './settings-controls'
import { clawModelSelectOptions } from '../lib/claw-model-options'
import {
  TelegramConnectCard,
  clawTextInputClass as textInputClass,
  type AddClawChannelFn
} from './settings-section-claw-telegram'

type ClawSettingsTab = 'runtime' | 'channels' | 'agents'

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
  patch: Partial<Pick<ClawImTelegramPlatformCredentialV1, 'botToken' | 'allowedChatIds' | 'proxy'>>
): void {
  const now = new Date().toISOString()
  updateChannels(form, update, (channel) => {
    if (channel.id !== channelId) return channel
    const prev = channel.platformCredential
    if (!prev || prev.kind !== 'telegram') return channel
    return {
      ...channel,
      updatedAt: now,
      platformCredential: { ...prev, ...patch }
    }
  })
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
  const [activeTab, setActiveTab] = useState<ClawSettingsTab>('runtime')
  const telegramChannel = form.claw.channels.find((channel) => channel.provider === 'telegram')
  const hasTelegramChannel = Boolean(telegramChannel)
  const telegramBotName =
    telegramChannel?.platformCredential?.kind === 'telegram' &&
    telegramChannel.platformCredential.botUsername
      ? `@${telegramChannel.platformCredential.botUsername}`
      : 'Telegram Bot'
  const tabs = [
    { id: 'runtime', label: t('clawRuntime'), icon: Settings },
    { id: 'channels', label: t('clawTelegramConnectTitle'), icon: MessageSquare },
    { id: 'agents', label: t('clawManageAgents'), icon: Bot }
  ] as const

  return (
    <>
      <SettingsTabs
        baseId="claw-settings"
        ariaLabel={t('claw')}
        items={tabs}
        value={activeTab}
        onChange={setActiveTab}
      />

      <SettingsTabPanel
        baseId="claw-settings"
        tabId="runtime"
        active={activeTab === 'runtime'}
      >
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
                  className={settingsButtonClass({ className: 'shrink-0' })}
                >
                  {t('clawDefaultWorkspaceReset')}
                </button>
                <button
                  type="button"
                  onClick={() => void pickClawWorkspace()}
                  className={settingsButtonClass({ className: 'shrink-0' })}
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
        <SettingRow
          title={tCommon('clawRecentThreadListLimit')}
          description={tCommon('clawRecentThreadListLimitDesc')}
          control={
            <input
              type="number"
              min={1}
              max={50}
              step={1}
              className={textInputClass('max-w-[120px]')}
              value={form.claw.im.recentThreadListLimit}
              onChange={(e) =>
                update({
                  claw: {
                    im: {
                      recentThreadListLimit: Number(e.target.value)
                    }
                  }
                })
              }
            />
          }
        />
        </SettingsCard>
      </SettingsTabPanel>

      <SettingsTabPanel
        baseId="claw-settings"
        tabId="channels"
        active={activeTab === 'channels'}
      >
        {!hasTelegramChannel ? (
          <TelegramConnectCard t={t} tCommon={tCommon} addClawChannel={addClawChannel} />
        ) : (
          <SettingsCard title={t('clawTelegramCredentialTitle')}>
            <div className="px-4 py-4">
              <InlineNoticeView
                notice={{
                  tone: 'info',
                  message: t('clawTelegramConnectedHint', { bot: telegramBotName })
                }}
              />
            </div>
          </SettingsCard>
        )}
      </SettingsTabPanel>

      <SettingsTabPanel
        baseId="claw-settings"
        tabId="agents"
        active={activeTab === 'agents'}
      >
        <SettingsCard title={t('clawManageAgents')}>
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
                                updateTelegramCredential(form, update, channel.id, { botToken: e.target.value })}
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
                                updateTelegramCredential(form, update, channel.id, { allowedChatIds: e.target.value })}
                              placeholder={tCommon('connectPhoneTelegramAllowedChatsPlaceholder')}
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
                                checked={tgCredential.proxy?.enabled === true}
                                onChange={(enabled) => updateTelegramCredential(form, update, channel.id, {
                                  proxy: {
                                    enabled,
                                    url: tgCredential.proxy?.url ?? ''
                                  }
                                })}
                                disabled={!validateClawImTelegramProxy({
                                  enabled: true,
                                  url: tgCredential.proxy?.url ?? ''
                                }).ok && tgCredential.proxy?.enabled !== true}
                                ariaLabel={tCommon('connectPhoneTelegramProxyEnabledLabel')}
                              />
                            </div>
                            <label className="mt-3 block min-w-0">
                              <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
                                {tCommon('connectPhoneTelegramProxyUrlLabel')}
                              </span>
                              <input
                                type="password"
                                className={textInputClass()}
                                value={tgCredential.proxy?.url ?? ''}
                                onChange={(e) => updateTelegramCredential(form, update, channel.id, {
                                  proxy: {
                                    enabled: tgCredential.proxy?.enabled === true,
                                    url: e.target.value
                                  }
                                })}
                                placeholder={tCommon('connectPhoneTelegramProxyUrlPlaceholder')}
                              />
                              <span className="mt-1.5 block text-[12px] leading-5 text-ds-faint">
                                {tCommon('connectPhoneTelegramProxyUrlHint')}
                              </span>
                            </label>
                          </div>
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
      </SettingsTabPanel>
    </>
  )
}

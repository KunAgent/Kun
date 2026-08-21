import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  CheckCircle2,
  Loader2,
  LogOut,
  MessageSquare,
  Plus,
  QrCode,
  RefreshCw,
  Settings
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ClawImChannelV1 } from '@shared/app-settings'
import type { ClawImInstallPollResult, ClawImInstallQrResult } from '@shared/kun-gui-api'
import { confirmDialog } from '../../lib/confirm-dialog'
import {
  type ClawInstallQrState,
  type ClawInstallTarget,
  clawInstallTargetLabel,
  formatClawInstallError
} from './SidebarClawDialogHelpers'
import { ClawProviderLogo } from './SidebarClaw'
import {
  CONNECT_PHONE_TARGETS,
  INITIAL_QR_STATE,
  connectPhoneInstallRequestOptions,
  connectPhoneProviderForTarget,
  connectPhoneTargetIcon,
  connectPhoneTopTargetLabel,
  createConnectPhoneAgentProfile,
  createConnectPhoneChannelOptions,
  createConnectPhoneCredential,
  formatConnectPhoneUserCode,
  hasClawPhoneChannel,
  surfaceButtonClass,
  type AddClawPhoneChannel
} from './connect-phone-support'

export function ConnectPhoneSidebarPanel({
  channels,
  initialTarget = 'feishu',
  onAddProvider,
  onDisconnect,
  onOpenSettings
}: {
  channels: ClawImChannelV1[]
  initialTarget?: ClawInstallTarget
  onAddProvider: AddClawPhoneChannel
  onDisconnect: (channelId: string) => Promise<void>
  onOpenSettings: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [target, setTarget] = useState<ClawInstallTarget>(initialTarget)
  const [installQr, setInstallQr] = useState<ClawInstallQrState>(INITIAL_QR_STATE)
  const [saving, setSaving] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [disconnectError, setDisconnectError] = useState('')
  const installPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const installCountdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const installRequestInFlightRef = useRef(false)
  const installAttemptRef = useRef(0)
  const targetProvider = connectPhoneProviderForTarget(target)
  const connectedChannel = channels.find((channel) => channel.provider === targetProvider) ?? null
  const hasExistingChannel = Boolean(connectedChannel)
  const displayUserCode = targetProvider === 'weixin'
    ? ''
    : formatConnectPhoneUserCode(installQr.userCode, installQr.deviceCode)
  const installQrIsImage = installQr.url.startsWith('data:image/')
  const sortedChannels = useMemo(
    () => [...channels].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    [channels]
  )
  const firstAvailableTarget = CONNECT_PHONE_TARGETS.find(
    (item) => !hasClawPhoneChannel(channels, connectPhoneProviderForTarget(item))
  ) ?? null

  const clearInstallTimers = useCallback((): void => {
    if (installPollTimerRef.current) {
      clearInterval(installPollTimerRef.current)
      installPollTimerRef.current = null
    }
    if (installCountdownTimerRef.current) {
      clearInterval(installCountdownTimerRef.current)
      installCountdownTimerRef.current = null
    }
  }, [])

  const cancelInstallAttempt = useCallback((): void => {
    installAttemptRef.current += 1
    installRequestInFlightRef.current = false
    clearInstallTimers()
  }, [clearInstallTimers])

  useEffect(() => {
    setTarget(initialTarget)
  }, [initialTarget])

  useEffect(() => {
    return cancelInstallAttempt
  }, [cancelInstallAttempt])

  useEffect(() => {
    cancelInstallAttempt()
    setSaving(false)
    setInstallQr(INITIAL_QR_STATE)
    setDisconnectError('')
  }, [cancelInstallAttempt, target])

  useEffect(() => {
    if (!hasExistingChannel) return
    cancelInstallAttempt()
    setSaving(false)
    setInstallQr(INITIAL_QR_STATE)
  }, [cancelInstallAttempt, hasExistingChannel])

  const addConnectedChannel = async (
    poll: Extract<ClawImInstallPollResult, { done: true }>
  ): Promise<void> => {
    const provider = poll.kind
    if (hasClawPhoneChannel(channels, provider)) {
      setInstallQr({
        ...INITIAL_QR_STATE,
        status: 'error',
        error: t('connectPhoneProviderAlreadyConnected', {
          provider: provider === 'weixin' ? clawInstallTargetLabel(t, 'weixin') : 'Feishu / Lark'
        })
      })
      return
    }
    setSaving(true)
    try {
      await onAddProvider(
        provider,
        createConnectPhoneAgentProfile(),
        createConnectPhoneCredential(poll),
        {
          ...createConnectPhoneChannelOptions(provider),
          preserveRoute: true
        }
      )
    } catch (error) {
      setInstallQr((current) => ({
        ...current,
        status: 'error',
        error: formatClawInstallError(error instanceof Error ? error.message : String(error), t)
      }))
    } finally {
      setSaving(false)
    }
  }

  const startOfficialInstallQr = async (): Promise<void> => {
    if (target === 'telegram') return
    if (hasExistingChannel) {
      setInstallQr({
        ...INITIAL_QR_STATE,
        status: 'error',
        error: t('connectPhoneProviderAlreadyConnected', {
          provider: targetProvider === 'weixin' ? clawInstallTargetLabel(t, 'weixin') : 'Feishu / Lark'
        })
      })
      return
    }
    if (
      saving ||
      installRequestInFlightRef.current ||
      installQr.status === 'loading' ||
      installQr.status === 'showing'
    ) {
      return
    }
    if (
      typeof window === 'undefined' ||
      typeof window.kunGui?.startClawImInstallQr !== 'function'
    ) {
      setInstallQr({
        ...INITIAL_QR_STATE,
        status: 'error',
        error: t('clawAddImOfficialQrUnavailable')
      })
      return
    }

    clearInstallTimers()
    const installAttempt = installAttemptRef.current + 1
    installAttemptRef.current = installAttempt
    installRequestInFlightRef.current = true
    setSaving(false)
    setInstallQr({ ...INITIAL_QR_STATE, status: 'loading' })
    const request = connectPhoneInstallRequestOptions(target)
    let result: ClawImInstallQrResult
    try {
      result = await window.kunGui.startClawImInstallQr(request.provider, request.options)
    } catch (error) {
      if (installAttempt !== installAttemptRef.current) return
      setInstallQr({
        ...INITIAL_QR_STATE,
        status: 'error',
        error: formatClawInstallError(error instanceof Error ? error.message : String(error), t)
      })
      return
    } finally {
      if (installAttempt === installAttemptRef.current) {
        installRequestInFlightRef.current = false
      }
    }
    if (installAttempt !== installAttemptRef.current) return
    if (!result.ok) {
      setInstallQr({
        ...INITIAL_QR_STATE,
        status: 'error',
        error: formatClawInstallError(result.message, t)
      })
      return
    }

    setInstallQr({
      status: 'showing',
      url: result.url,
      deviceCode: result.deviceCode,
      userCode: result.userCode,
      timeLeft: result.expireIn,
      error: ''
    })
    installCountdownTimerRef.current = setInterval(() => {
      setInstallQr((current) => {
        if (current.status !== 'showing') return current
        if (current.timeLeft <= 1) {
          installAttemptRef.current += 1
          clearInstallTimers()
          return {
            ...current,
            status: 'error',
            timeLeft: 0,
            error: t('clawAddImOfficialQrExpired')
          }
        }
        return { ...current, timeLeft: current.timeLeft - 1 }
      })
    }, 1000)
    const waitForInstall = async (): Promise<void> => {
      try {
        if (
          typeof window === 'undefined' ||
          typeof window.kunGui?.pollClawImInstall !== 'function'
        ) {
          throw new Error(t('clawAddImOfficialQrUnavailable'))
        }
        const poll = await window.kunGui.pollClawImInstall(request.provider, result.deviceCode)
        if (installAttempt !== installAttemptRef.current) return
        if (poll.done) {
          clearInstallTimers()
          setInstallQr((current) => ({
            ...current,
            status: 'success',
            error: '',
            timeLeft: 0
          }))
          await addConnectedChannel(poll)
          return
        }
        if (poll.error) {
          installAttemptRef.current += 1
          clearInstallTimers()
          setInstallQr((current) => ({
            ...current,
            status: 'error',
            error: formatClawInstallError(poll.error ?? t('clawAddImOfficialQrFailed'), t)
          }))
        }
      } catch (error) {
        if (installAttempt !== installAttemptRef.current) return
        installAttemptRef.current += 1
        clearInstallTimers()
        setInstallQr((current) => ({
          ...current,
          status: 'error',
          error: formatClawInstallError(error instanceof Error ? error.message : String(error), t)
        }))
      }
    }
    if (request.provider === 'weixin') {
      void waitForInstall()
    } else {
      installPollTimerRef.current = setInterval(() => {
        void waitForInstall()
      }, Math.max(result.interval, 3) * 1000)
    }
  }

  const disconnectChannel = async (): Promise<void> => {
    if (!connectedChannel || disconnecting) return
    const confirmed = await confirmDialog(
      t('connectPhoneDisconnectConfirm', { name: connectedChannel.label })
    )
    if (!confirmed) return

    setDisconnectError('')
    setDisconnecting(true)
    try {
      await onDisconnect(connectedChannel.id)
    } catch (error) {
      setDisconnectError(error instanceof Error ? error.message : String(error))
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div className="ds-no-drag flex min-h-0 flex-1 flex-col gap-3 px-2 pt-2">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-[#9aa5b5] dark:text-white/35">
            {t('clawSidebarIm')}
          </span>
          <span className="flex items-center gap-1">
            <button
              type="button"
              disabled={!firstAvailableTarget}
              onClick={() => {
                if (firstAvailableTarget) setTarget(firstAvailableTarget)
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={t('clawAddIm')}
              title={t('clawAddIm')}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
              aria-label={t('clawSettings')}
              title={t('clawSettings')}
            >
              <Settings className="h-3.5 w-3.5" strokeWidth={1.9} />
            </button>
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-0.5 pb-2">
          {sortedChannels.length === 0 ? (
            <div className="mx-1 rounded-[14px] border border-dashed border-ds-border-muted bg-ds-main/35 px-3 py-4">
              <p className="text-[13.5px] font-medium text-ds-muted">{t('clawNoImTitle')}</p>
              <p className="mt-1 text-[12px] leading-5 text-ds-faint">
                {t('clawNoImSub')}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {sortedChannels.map((channel) => {
                const providerTarget: ClawInstallTarget =
                  channel.provider === 'telegram' ? 'telegram'
                    : channel.provider === 'weixin' ? 'weixin' : 'feishu'
                const active = channel.provider === targetProvider
                const disabled = !channel.enabled
                const sortedConversations = [...channel.conversations].sort(
                  (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
                )
                const latestConversation = sortedConversations[0] ?? null
                const providerLabel = channel.provider === 'telegram' ? 'Telegram'
                  : channel.provider === 'weixin' ? 'WeChat' : 'Feishu / Lark'
                const secondaryLabel = latestConversation?.senderName.trim()
                  || latestConversation?.chatId.trim()
                  || `${providerLabel} · ${channel.model}`
                return (
                  <button
                    key={channel.id}
                    type="button"
                    onClick={() => setTarget(providerTarget)}
                    className={`group flex min-h-[64px] w-full items-center gap-2 rounded-[12px] border px-2.5 py-2 text-left transition ${
                      active
                        ? 'border-accent/20 bg-accent/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.62)]'
                        : 'border-transparent hover:border-ds-border hover:bg-ds-hover/70'
                    } ${disabled ? 'opacity-55' : ''}`}
                    title={disabled ? t('clawImDisabledSidebar') : channel.label}
                  >
                    <MessageSquare className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.75} />
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-ds-card/75">
                      <ClawProviderLogo provider={channel.provider} className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-ds-ink">
                        {channel.label}
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] text-ds-faint">
                        {secondaryLabel}
                      </span>
                    </span>
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        disabled ? 'bg-ds-faint' : 'bg-emerald-400'
                      }`}
                    />
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="mx-1 shrink-0 border-t border-ds-border-muted/70 pt-3">
        <div className="mb-3 flex items-center gap-2 px-1 text-[12px] font-semibold text-[#9aa5b5] dark:text-white/40">
          <ClawProviderLogo provider={targetProvider} className="h-4 w-4" />
          <span>{t('claw')}</span>
        </div>

        <div className="grid grid-cols-4 gap-1 rounded-[14px] border border-ds-border bg-ds-card p-1 shadow-sm">
          {CONNECT_PHONE_TARGETS.map((item) => {
            const active = target === item
            const provider = connectPhoneProviderForTarget(item)
            return (
              <button
                key={item}
                type="button"
                onClick={() => setTarget(item)}
                className={`inline-flex min-h-[32px] min-w-0 items-center justify-center gap-1.5 rounded-[10px] px-2 text-[10.5px] font-semibold whitespace-nowrap transition ${
                  active
                    ? 'bg-accent/10 text-accent'
                    : 'text-ds-faint hover:bg-ds-hover hover:text-ds-ink'
                }`}
                aria-pressed={active}
              >
                {connectPhoneTargetIcon(provider, 'h-3.5 w-3.5')}
                {connectPhoneTopTargetLabel(t, item)}
              </button>
            )
          })}
        </div>

        {connectedChannel ? (
          <div className="mt-3 rounded-[14px] border border-ds-border bg-ds-card px-3 py-3 shadow-sm">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-emerald-500/12 text-emerald-600 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-ds-ink">
                  {connectedChannel.label}
                </span>
                <span className="mt-1 block truncate text-[12px] text-ds-faint">
                  {connectedChannel.enabled
                    ? t('clawManageImConnected')
                    : t('clawImDisabledSidebar')}
                </span>
              </span>
            </div>
            <div className="mt-3 grid gap-2">
              {!connectedChannel.enabled ? (
                <div className="rounded-[8px] bg-amber-500/10 px-2.5 py-2 text-[12px] leading-5 text-amber-800 dark:text-amber-200">
                  {t('connectPhoneDisabledConnectionHint')}
                </div>
              ) : null}
              <button
                type="button"
                onClick={onOpenSettings}
                className="inline-flex min-h-[30px] w-full items-center justify-center gap-1.5 rounded-[8px] border border-ds-border bg-ds-main/55 px-2.5 py-1.5 text-[12.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
              >
                <Settings className="h-3.5 w-3.5" strokeWidth={1.8} />
                {t('clawSettings')}
              </button>
              <button
                type="button"
                onClick={() => void disconnectChannel()}
                disabled={disconnecting}
                className="inline-flex min-h-[30px] w-full items-center justify-center gap-1.5 rounded-[8px] border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[12.5px] font-medium text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-200 dark:hover:bg-rose-500/15"
              >
                {disconnecting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
                ) : (
                  <LogOut className="h-3.5 w-3.5" strokeWidth={1.8} />
                )}
                {disconnecting ? t('connectPhoneDisconnecting') : t('connectPhoneDisconnect')}
              </button>
            </div>
            {disconnectError ? (
              <div className="mt-2 rounded-[8px] bg-red-500/10 px-2.5 py-2 text-[12px] leading-relaxed text-red-600 dark:text-red-300">
                {disconnectError}
              </div>
            ) : null}
          </div>
        ) : (
          target === 'telegram' ? (
            <div className="mt-3 flex flex-col items-center rounded-[14px] border border-ds-border bg-ds-card px-3 py-4 shadow-sm">
              <span className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-[#26A5E4]/10">
                <ClawProviderLogo provider="telegram" className="h-6 w-6" />
              </span>
              <div className="mt-3 text-center text-[12.5px] font-semibold text-ds-ink">
                {t('connectPhoneTelegramSetupTitle')}
              </div>
              <p className="mt-1.5 max-w-[240px] text-center text-[11.5px] leading-5 text-ds-faint">
                {t('connectPhoneTelegramSetupHint')}
              </p>
              <button
                type="button"
                onClick={onOpenSettings}
                className={surfaceButtonClass('mt-3 min-h-[30px] w-full rounded-[8px] px-2.5 py-1.5 text-[12px]')}
              >
                <Settings className="h-3.5 w-3.5" strokeWidth={1.8} />
                {t('connectPhoneTelegramGoSettings')}
              </button>
            </div>
          ) : (
            <div className="mt-3 flex flex-col items-center rounded-[14px] border border-ds-border bg-ds-card px-3 py-4 shadow-sm">
              <div className="flex h-[156px] w-full items-center justify-center rounded-[10px] border border-[#ececea] bg-white p-2">
                {installQr.status === 'idle' ? (
                  <div className="grid justify-items-center gap-3">
                    <div className="flex h-14 w-14 items-center justify-center rounded-[14px] bg-[#f3f4f2] text-[#9aa2ad]">
                      <QrCode className="h-7 w-7" strokeWidth={1.7} />
                    </div>
                    <button
                      type="button"
                      onClick={() => void startOfficialInstallQr()}
                      className={surfaceButtonClass('min-h-[32px] rounded-[8px] px-3 py-1.5 text-[12px]')}
                    >
                      {t('connectPhoneGenerateQr')}
                    </button>
                  </div>
                ) : null}

                {installQr.status === 'loading' ? (
                  <div className="grid justify-items-center gap-2 text-ds-faint">
                    <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2} />
                    <span className="text-[12px]">{t('connectPhoneQrLoading')}</span>
                  </div>
                ) : null}

                {installQr.url && installQr.status !== 'loading' ? (
                  installQrIsImage ? (
                    <img
                      src={installQr.url}
                      alt={t('connectPhoneGenerateQr')}
                      className="h-[136px] w-[136px] object-contain"
                    />
                  ) : (
                    <QRCodeSVG value={installQr.url} size={136} marginSize={1} />
                  )
                ) : null}
              </div>

              {installQr.status === 'showing' ? (
                <div className="mt-3 text-center text-[12px] text-[#8d95a1]">
                  {t('clawAddImOfficialQrTimeLeft', { seconds: installQr.timeLeft })}
                </div>
              ) : null}

              {installQr.status === 'success' ? (
                <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-[12px] font-semibold text-emerald-600 dark:text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                  {saving ? t('connectPhoneBinding') : t('clawAddImOfficialQrSuccess')}
                </div>
              ) : null}

              {installQr.status === 'error' ? (
                <div className="mt-3 grid justify-items-center gap-2">
                  <div className="max-w-[220px] text-center text-[12px] leading-5 text-red-600 dark:text-red-300">
                    {installQr.error || t('clawAddImOfficialQrFailed')}
                  </div>
                  {!hasExistingChannel ? (
                    <button
                      type="button"
                      onClick={() => void startOfficialInstallQr()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-2.5 py-1.5 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                    >
                      <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
                      {t('clawAddImOfficialQrRetry')}
                    </button>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-4 text-center text-[12px] leading-5 text-[#8d95a1]">
                <div className="inline-flex items-center justify-center gap-1.5 font-medium text-[#68707c] dark:text-white/55">
                  <ClawProviderLogo provider={targetProvider} className="h-4 w-4" />
                  {clawInstallTargetLabel(t, target)}
                </div>
                <div className="mt-1">{t('connectPhoneAutoBindHint')}</div>
                {displayUserCode ? (
                  <div className="mt-2 font-mono text-[13px] tracking-normal text-ds-ink">
                    {t('connectPhoneUserCode', { code: displayUserCode })}
                  </div>
                ) : null}
              </div>
            </div>
          )
        )}
      </div>
    </div>
  )
}

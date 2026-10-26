import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  AtSign,
  Battery,
  CheckCircle2,
  ChevronLeft,
  Image as ImageIcon,
  Loader2,
  LogOut,
  Maximize2,
  MessageSquare,
  Mic,
  MoreHorizontal,
  Plus,
  PlusCircle,
  QrCode,
  RefreshCw,
  Send,
  Settings,
  Smile,
  Wifi
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  ClawImAgentProfileV1,
  ClawImChannelV1,
  ClawImPlatformCredentialV1,
  ClawImProvider,
  ClawImSettingsV1,
  ClawModel
} from '@shared/app-settings'
import type { ClawImInstallPollResult, ClawImInstallQrResult } from '@shared/kun-gui-api'
import { confirmDialog } from '../../lib/confirm-dialog'
import {
  type ClawInstallQrState,
  type ClawInstallTarget,
  clawInstallTargetLabel,
  formatClawInstallError
} from './SidebarClawDialogHelpers'
import { ClawProviderLogo } from './SidebarClaw'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'

export { ConnectPhoneSidebarPanel } from './ConnectPhoneSidebarPanel'
export {
  connectPhoneInstallRequestOptions,
  connectPhoneProviderForTarget,
  createConnectPhoneAgentProfile,
  createConnectPhoneChannelOptions,
  createConnectPhoneCredential,
  createTelegramCredential,
  formatConnectPhoneUserCode,
  hasClawPhoneChannel,
  hasEnabledClawPhoneChannel
} from './connect-phone-support'
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
  hasEnabledClawPhoneChannel,
  surfaceButtonClass,
  type Props
} from './connect-phone-support'

export function ConnectPhoneView({
  channels,
  onAddProvider,
  leftSidebarCollapsed,
  onToggleSidebar
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [target, setTarget] = useState<ClawInstallTarget>('feishu')
  const [installQr, setInstallQr] = useState<ClawInstallQrState>(INITIAL_QR_STATE)
  const [saving, setSaving] = useState(false)
  const installPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const installCountdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const installRequestInFlightRef = useRef(false)
  const installAttemptRef = useRef(0)
  const targetProvider = connectPhoneProviderForTarget(target)
  const hasExistingChannel = hasClawPhoneChannel(channels, targetProvider)

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
    return cancelInstallAttempt
  }, [cancelInstallAttempt])

  useEffect(() => {
    cancelInstallAttempt()
    setSaving(false)
    setInstallQr(INITIAL_QR_STATE)
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
        createConnectPhoneChannelOptions(provider)
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

  const hasDisabledChannels = hasExistingChannel && !hasEnabledClawPhoneChannel(channels, targetProvider)
  const displayUserCode = targetProvider === 'weixin'
    ? ''
    : formatConnectPhoneUserCode(installQr.userCode, installQr.deviceCode)
  const installQrIsImage = installQr.url.startsWith('data:image/')

  return (
    <section className="ds-no-drag relative flex min-h-0 flex-1 overflow-hidden bg-transparent">
      {leftSidebarCollapsed ? (
        <div className="ds-window-controls-collapsed-titlebar-anchor absolute top-4 z-20">
          <SidebarTitlebarToggleButton
            onClick={onToggleSidebar}
            title={t('sidebarExpand')}
            ariaLabel={t('sidebarExpand')}
          />
        </div>
      ) : null}

      <div className="grid min-h-0 w-full grid-cols-1 gap-8 px-5 py-4 lg:grid-cols-[minmax(520px,1fr)_minmax(430px,0.76fr)] lg:px-4">
        <div className="flex min-h-0 items-center justify-center pb-4 pt-2">
          <div className="w-full max-w-[560px] text-center">
            <h1 className="text-[28px] font-semibold tracking-normal text-ds-ink">
              {t('connectPhoneTitle')}
            </h1>
            <p className="mx-auto mt-2 max-w-[460px] text-[14px] leading-6 text-[#9299a3] dark:text-white/40">
              {t('connectPhoneSubtitle')}
            </p>

            <div className="mx-auto mt-7 grid w-full max-w-[760px] grid-cols-4 gap-2 rounded-full bg-[#f0f1ef] p-2 shadow-inner dark:bg-white/[0.08]">
              {CONNECT_PHONE_TARGETS.map((item) => {
                const active = target === item
                const provider = connectPhoneProviderForTarget(item)
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setTarget(item)}
                    className={`inline-flex h-10 w-full min-w-0 items-center justify-center gap-2.5 rounded-full px-4 text-[13px] font-semibold whitespace-nowrap transition ${
                      active
                        ? 'bg-white text-ds-ink shadow-sm dark:bg-white/[0.14] dark:text-white'
                        : 'text-[#727985] hover:text-ds-ink dark:hover:text-white'
                    }`}
                    aria-pressed={active}
                  >
                  {connectPhoneTargetIcon(provider, 'h-4 w-4')}
                  {connectPhoneTopTargetLabel(t, item)}
                </button>
              )
            })}
            </div>

            {target === 'telegram' ? (
              <div className="mx-auto mt-9 flex w-full max-w-[400px] flex-col items-center rounded-[22px] border-0 bg-white p-6 shadow-[var(--kun-shadow-rest)]">
                <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-[#26A5E4]/10">
                  <ClawProviderLogo provider="telegram" className="h-8 w-8" />
                </span>
                <div className="mt-4 text-center text-[15px] font-semibold text-ds-ink">
                  {t('connectPhoneTelegramSetupTitle')}
                </div>
                <p className="mt-2 max-w-[320px] text-center text-[13px] leading-6 text-ds-faint">
                  {t('connectPhoneTelegramSetupHint')}
                </p>
                <ol className="mt-3 grid max-w-[320px] gap-1.5 text-left text-[12.5px] leading-5 text-ds-muted">
                  <li className="flex gap-2">
                    <span className="shrink-0 font-semibold text-ds-faint">1.</span>
                    <span>{t('connectPhoneTelegramStep1')}</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="shrink-0 font-semibold text-ds-faint">2.</span>
                    <span>{t('connectPhoneTelegramStep2')}</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="shrink-0 font-semibold text-ds-faint">3.</span>
                    <span>{t('connectPhoneTelegramStep3')}</span>
                  </li>
                </ol>
              </div>
            ) : (
              <>
                <div className="mx-auto mt-9 flex h-[226px] w-[226px] flex-col items-center justify-center rounded-[22px] border-0 bg-white p-3 shadow-[var(--kun-shadow-rest)]">
                  {installQr.status === 'idle' ? (
                    <div className="grid justify-items-center gap-4">
                      <div className="flex h-20 w-20 items-center justify-center rounded-[18px] bg-[#f3f4f2] text-[#9aa2ad]">
                        <QrCode className="h-9 w-9" strokeWidth={1.7} />
                      </div>
                      <button
                        type="button"
                        onClick={() => void startOfficialInstallQr()}
                        disabled={hasExistingChannel}
                        className={surfaceButtonClass('min-h-[36px] px-3.5')}
                      >
                        {t('connectPhoneGenerateQr')}
                      </button>
                    </div>
                  ) : null}

                  {installQr.status === 'loading' ? (
                    <div className="grid justify-items-center gap-2 text-ds-faint">
                      <Loader2 className="h-6 w-6 animate-spin" strokeWidth={2} />
                      <span className="text-[12px]">{t('connectPhoneQrLoading')}</span>
                    </div>
                  ) : null}

                  {installQr.url && installQr.status !== 'loading' ? (
                    installQrIsImage ? (
                      <img
                        src={installQr.url}
                        alt={t('connectPhoneGenerateQr')}
                        className="h-[204px] w-[204px] object-contain"
                      />
                    ) : (
                      <QRCodeSVG value={installQr.url} size={204} marginSize={1} />
                    )
                  ) : null}

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
                </div>

                <div className="mt-4 text-center text-[12.5px] leading-5 text-[#a1a7af]">
                  <div className="inline-flex items-center justify-center gap-1.5 font-medium text-[#68707c] dark:text-white/55">
                    <ClawProviderLogo provider={targetProvider} className="h-4 w-4" />
                    {t(targetProvider === 'weixin' ? 'connectPhoneScanHintWeixin' : 'connectPhoneScanHint')}
                  </div>
                  <div className="mt-1">{t('connectPhoneAutoBindHint')}</div>
                  {displayUserCode ? (
                    <div className="mt-3 font-mono text-[13px] tracking-normal text-ds-ink">
                      {t('connectPhoneUserCode', { code: displayUserCode })}
                    </div>
                  ) : null}
                  {hasDisabledChannels ? (
                    <div className="mt-1">{t('connectPhoneDisabledConnectionHint')}</div>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="hidden min-h-0 items-stretch justify-center lg:flex">
          <div className="flex h-full max-h-[860px] w-full items-center justify-center rounded-[24px] border border-white/70 bg-[#98cef0] px-8 py-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_22px_48px_rgba(71,117,151,0.12)]">
            <div className="relative aspect-[0.54] h-[min(80vh,720px)] min-h-[560px] rounded-[48px] border-[7px] border-[#151718] bg-[#151718] shadow-[0_26px_52px_rgba(26,38,50,0.22)]">
              <div className="absolute -left-[11px] top-[156px] h-10 w-[5px] rounded-l-full bg-[#25282c]" />
              <div className="absolute -left-[11px] top-[216px] h-12 w-[5px] rounded-l-full bg-[#25282c]" />
              <div className="absolute -right-[11px] top-[210px] h-20 w-[5px] rounded-r-full bg-[#25282c]" />
              <div className="absolute left-1/2 top-[13px] z-20 h-[30px] w-[92px] -translate-x-1/2 rounded-full bg-black" />
              <div className="absolute right-[74px] top-[20px] z-30 h-3 w-3 rounded-full bg-[#151a1f]" />
              <div className="flex h-full flex-col overflow-hidden rounded-[40px] bg-[#fffefa]">
                <div className="flex h-[54px] shrink-0 items-end justify-between px-6 pb-2 text-[#111827]">
                  <span className="text-[13px] font-semibold">9:41</span>
                  <span className="flex items-center gap-1.5">
                    <Wifi className="h-4 w-4" strokeWidth={2} />
                    <Battery className="h-4 w-4" strokeWidth={2} />
                  </span>
                </div>
                <div className="relative flex h-12 shrink-0 items-center justify-between border-b border-[#f0f1ef] px-4 text-[#111827]">
                  <ChevronLeft className="h-6 w-6" strokeWidth={1.8} />
                  <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1.5 text-[14px] font-semibold">
                    <span>kun</span>
                    <span className="rounded-[4px] bg-[#eee7ff] px-1.5 py-0.5 text-[10px] font-semibold text-[#8b5cf6]">AI</span>
                  </div>
                  <MoreHorizontal className="h-5 w-5" strokeWidth={2} />
                </div>
                <div className="min-h-0 flex-1 bg-[#fffefa] px-5 pt-6">
                  <div className="ml-auto flex max-w-[248px] items-start gap-2">
                    <div className="rounded-[8px] bg-[#d6ebfb] px-4 py-3 text-left text-[13px] font-medium leading-5 text-[#1f2937]">
                      {t('connectPhonePreviewUser')}
                    </div>
                    <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f6d75d] text-[12px] font-bold text-[#695000]">
                      K
                    </div>
                  </div>
                  <div className="mt-5 flex max-w-[274px] items-start gap-2">
                    <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#dbeafe] bg-[#f1f7fd] text-[12px] font-bold text-[#2563eb]">
                      K
                    </span>
                    <div className="overflow-hidden rounded-[8px] border border-[#dfe6e9] bg-[#fffefa] text-left shadow-sm">
                      <div className="flex items-center gap-2 bg-[#d2f5db] px-3 py-2">
                        <span className="text-[12px] font-semibold text-[#15803d]">kun</span>
                        <span className="rounded-[4px] bg-[#bff0cf] px-1.5 py-0.5 text-[10px] font-semibold text-[#15803d]">
                          {t('connectPhonePreviewDone')}
                        </span>
                      </div>
                      <div className="px-3 py-3 text-[13px] font-medium leading-5 text-[#3f4147]">
                        {t('connectPhonePreviewAssistant')}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="shrink-0 bg-[#f3f4f2] px-3 pb-3 pt-2">
                  <div className="mb-2 flex h-10 items-center gap-2 rounded-[7px] bg-[#fffefa] px-3 text-[13px] text-[#a3a3a3] shadow-sm">
                    <span className="flex-1">{t('connectPhonePreviewInput')}</span>
                    <Maximize2 className="h-4 w-4 text-[#777]" strokeWidth={1.8} />
                  </div>
                  <div className="flex h-8 items-center justify-between px-1 text-[#70757a]">
                    <Smile className="h-5 w-5" strokeWidth={1.8} />
                    <AtSign className="h-5 w-5" strokeWidth={1.8} />
                    <Mic className="h-5 w-5" strokeWidth={1.8} />
                    <ImageIcon className="h-5 w-5" strokeWidth={1.8} />
                    <span className="text-[15px] font-semibold">Aa</span>
                    <PlusCircle className="h-5 w-5" strokeWidth={1.8} />
                  </div>
                  <div className="mx-auto mt-2 h-1 w-24 rounded-full bg-black" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

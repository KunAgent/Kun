import type { ReactElement } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Command,
  Copy,
  LayoutGrid,
  Loader2,
  MessageSquare,
  type LucideIcon,
  Eye,
  EyeOff,
  Plus,
  QrCode,
  RadioTower,
  RefreshCw,
  Settings,
  X
} from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import { useChatStore, type SettingsRouteSection } from '../../store/chat-store'
import type {
  ClawImAgentProfileV1,
  ClawImChannelV1,
  ClawImPlatformCredentialV1,
  ClawImProvider,
  ClawModel,
  ClawRunMode
} from '@shared/app-settings'
import {
  ClawProviderLogo,
  clawProviderDisplayLabel,
  ClawSidebarContent
} from './SidebarClaw'
import {
  CLAW_ADD_PROVIDER_OPTIONS,
  CLAW_AGENT_TABS,
  CLAW_DIALOG_STEPS,
  clawConnectionHintKey,
  clawConnectionListLabelKey,
  clawConnectionModeLabelKey,
  clawConnectionStatusKey,
  clawCredentialLabelKey,
  clawDefaultAgentName,
  clawDefaultChannelWorkspacePreview,
  ClawAddImDialogProps,
  ClawConnectionMode,
  ClawDialogStep,
  ClawImDialogMode,
  ClawInstallQrState,
  ClawInstallTarget,
  ClawManageStage,
  copyTextFallback,
  isOfficialInstallProvider,
  clawInstallTargetLabel,
  clawPayloadQrTitleKey
} from './SidebarClawDialogHelpers'
import { SidebarProjectsSection } from './SidebarProjectsSection'

type Props = {
  threads: NormalizedThread[]
  activeThreadId: string | null
  activeView: 'chat' | 'claw'
  pluginsActive: boolean
  runtimeReady: boolean
  onSelectThread: (id: string) => void
  onDeleteThread: (id: string) => Promise<void>
  onNewChat: () => void
  onNewChatInWorkspace: (workspaceRoot: string) => void
  onOpenSettings: (section?: SettingsRouteSection) => void
  onOpenPlugins: () => void
  onCodeOpen: () => void
  onClawOpen: () => void
}

export function Sidebar({
  threads,
  activeThreadId,
  activeView,
  pluginsActive,
  runtimeReady,
  onSelectThread,
  onDeleteThread,
  onNewChat,
  onNewChatInWorkspace,
  onOpenSettings,
  onOpenPlugins,
  onCodeOpen,
  onClawOpen
}: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const chooseWorkspace = useChatStore((s) => s.chooseWorkspace)
  const deleteWorkspace = useChatStore((s) => s.deleteWorkspace)
  const busy = useChatStore((s) => s.busy)
  const watchTurnCompletion = useChatStore((s) => s.watchTurnCompletion)
  const unreadThreadIds = useChatStore((s) => s.unreadThreadIds)
  const clawChannels = useChatStore((s) => s.clawChannels)
  const activeClawChannelId = useChatStore((s) => s.activeClawChannelId)
  const selectClawChannel = useChatStore((s) => s.selectClawChannel)
  const addClawChannel = useChatStore((s) => s.addClawChannel)
  const resetClawChannelSession = useChatStore((s) => s.resetClawChannelSession)

  const [appVersion, setAppVersion] = useState('')
  const [imDialogMode, setImDialogMode] = useState<ClawImDialogMode | null>(null)

  const activeClawChannel = useMemo(
    () => clawChannels.find((channel) => channel.id === activeClawChannelId) ?? clawChannels[0] ?? null,
    [clawChannels, activeClawChannelId]
  )

  useEffect(() => {
    let cancelled = false
    if (typeof window.dsGui?.getAppVersion !== 'function') return
    void window.dsGui.getAppVersion().then((version) => {
      if (!cancelled) setAppVersion(version)
    }).catch(() => {
      if (!cancelled) setAppVersion('')
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
    <aside className="ds-drag ds-sidebar-shell ds-frosted relative flex h-full w-full shrink-0 flex-col px-3 pb-3">
      <div className="shrink-0 px-1 pb-2 pt-3">
        <div aria-hidden className="ds-titlebar-safe-block" />
        <div className="flex min-h-8 items-center justify-center px-1 pt-1">
          <div className="truncate text-center text-[17px] font-medium tracking-[-0.025em] text-ds-ink">
            {t('appName')}
          </div>
        </div>
        <div className="mx-1 mt-4 border-t border-ds-border-muted/20" />
      </div>

      <div className="ds-no-drag flex flex-col px-1">
        <div className="mb-4 rounded-[22px] border border-ds-border-muted/40 bg-ds-elevated/72 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.48)] backdrop-blur">
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={onCodeOpen}
              className={`rounded-[18px] px-3 py-2.5 text-center text-[14px] font-semibold transition ${
                activeView === 'chat'
                  ? 'bg-white text-accent shadow-[0_10px_24px_rgba(15,23,42,0.08)] ring-1 ring-[rgba(0,136,255,0.10)]'
                  : 'text-ds-muted hover:bg-white/55 hover:text-ds-ink'
              }`}
            >
              {t('code')}
            </button>
            <button
              type="button"
              onClick={onClawOpen}
              className={`rounded-[18px] px-3 py-2.5 text-center text-[14px] font-semibold transition ${
                activeView === 'claw'
                  ? 'bg-white text-accent shadow-[0_10px_24px_rgba(15,23,42,0.08)] ring-1 ring-[rgba(0,136,255,0.10)]'
                  : 'text-ds-muted hover:bg-white/55 hover:text-ds-ink'
              }`}
            >
              {t('claw')}
            </button>
          </div>
        </div>

        {activeView !== 'claw' ? (
        <SidebarLink
          icon={<Plus className="h-4 w-4" strokeWidth={2} />}
          label={t('newAgent')}
          onClick={runtimeReady ? onNewChat : undefined}
          disabled={!runtimeReady}
          disabledHint={t('runtimeActionNeedsConnection')}
          shortcut="⌘N"
          variant="flat-accent"
        />
        ) : null}
        <SidebarLink
          icon={<LayoutGrid className="h-4 w-4" strokeWidth={1.75} />}
          label={t('plugins')}
          onClick={onOpenPlugins}
          active={pluginsActive}
        />
      </div>

      <div className="ds-no-drag mx-1 my-3" />

      {activeView === 'claw' ? (
        <ClawSidebarContent
          channels={clawChannels}
          activeChannelId={activeClawChannelId}
          activeThreadId={activeThreadId}
          runtimeReady={runtimeReady}
          onSelectChannel={(channelId) => void selectClawChannel(channelId)}
          onAddChannel={() => setImDialogMode('add')}
          onResetChannel={(channelId) => void resetClawChannelSession(channelId)}
          onOpenSettings={() => setImDialogMode('edit')}
          t={t}
        />
      ) : (
      <SidebarProjectsSection
        threads={threads}
        activeView={activeView}
        activeThreadId={activeThreadId}
        runtimeReady={runtimeReady}
        workspaceRoot={workspaceRoot}
        busy={busy}
        watchTurnCompletion={watchTurnCompletion}
        unreadThreadIds={unreadThreadIds}
        locale={i18n.language}
        onPickWorkspace={() => void chooseWorkspace()}
        onRemoveWorkspace={deleteWorkspace}
        onCreateThreadInWorkspace={onNewChatInWorkspace}
        onSelectThread={onSelectThread}
        onDeleteThread={onDeleteThread}
        t={t}
      />
      )}

      <div className="ds-no-drag mt-2 border-t border-ds-border-muted/20 px-1 pt-3">
        <SidebarLink
          icon={<Settings className="h-4 w-4" strokeWidth={1.75} />}
          label={t('settings')}
          onClick={() => onOpenSettings('general')}
          variant="footer"
          trailing={appVersion ? <span className="text-[12px] text-ds-faint">v{appVersion}</span> : undefined}
        />
      </div>

    </aside>

    {imDialogMode ? (
      <ClawAddImDialog
        mode={imDialogMode}
        initialProvider={activeClawChannel?.provider}
        initialChannelId={imDialogMode === 'edit' ? activeClawChannel?.id : undefined}
        channels={clawChannels}
        onClose={() => setImDialogMode(null)}
        onAddProvider={(provider, agentProfile, platformCredential, options) =>
          addClawChannel(provider, agentProfile, platformCredential, options)
        }
        t={t}
      />
    ) : null}
    </>
  )
}

type SidebarLinkProps = {
  icon: ReactElement
  label: string
  onClick?: () => void
  disabled?: boolean
  disabledHint?: string
  shortcut?: string
  variant?: 'flat' | 'flat-accent' | 'footer'
  trailing?: ReactElement
  active?: boolean
}

function ClawAddImDialog({
  mode,
  initialProvider,
  initialChannelId,
  channels,
  onClose,
  onAddProvider,
  t
}: ClawAddImDialogProps): ReactElement {
  const configuredProviders = useMemo(
    () => new Set(channels.map((channel) => channel.provider)),
    [channels]
  )
  const editableChannels = useMemo(
    () => [...channels].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    [channels]
  )
  const visibleProviderOptions = CLAW_ADD_PROVIDER_OPTIONS
  const fallbackEditChannelId =
    (initialChannelId && editableChannels.some((channel) => channel.id === initialChannelId)
      ? initialChannelId
      : editableChannels[0]?.id) ?? ''
  const [selectedChannelId, setSelectedChannelId] = useState(fallbackEditChannelId)
  const [manageStage, setManageStage] = useState<ClawManageStage>('select')
  const fallbackProvider =
    (initialProvider && visibleProviderOptions.some((option) => option.id === initialProvider)
      ? initialProvider
      : visibleProviderOptions[0]?.id) ?? CLAW_ADD_PROVIDER_OPTIONS[0].id
  const [provider, setProvider] = useState<ClawImProvider>(fallbackProvider)
  const existingChannel = useMemo(
    () => (mode === 'edit'
      ? editableChannels.find((channel) => channel.id === selectedChannelId) ?? null
      : null),
    [editableChannels, mode, selectedChannelId]
  )
  const effectiveProvider = mode === 'edit'
    ? existingChannel?.provider ?? fallbackProvider
    : provider
  const selectedOption =
    visibleProviderOptions.find((option) => option.id === effectiveProvider)
    ?? CLAW_ADD_PROVIDER_OPTIONS.find((option) => option.id === effectiveProvider)
    ?? CLAW_ADD_PROVIDER_OPTIONS[0]
  const selectedCredentialHints = selectedOption.credentialHints ?? []
  const officialInstallProvider = isOfficialInstallProvider(effectiveProvider) &&
    selectedOption.connectionMode === 'official-install-qr'
    ? effectiveProvider
    : null
  const [endpoint, setEndpoint] = useState('http://127.0.0.1:8787/claw/im')
  const [imPort, setImPort] = useState(8787)
  const [imPath, setImPath] = useState('/claw/im')
  const [secret, setSecret] = useState('')
  const [imEnabled, setImEnabled] = useState(true)
  const [responseTimeoutSec, setResponseTimeoutSec] = useState(120)
  const [runMode, setRunMode] = useState<ClawRunMode>('agent')
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [installQr, setInstallQr] = useState<ClawInstallQrState>({
    status: 'idle',
    url: '',
    deviceCode: '',
    timeLeft: 0,
    error: ''
  })
  const [platformCredential, setPlatformCredential] = useState<ClawImPlatformCredentialV1 | undefined>()
  const installPollTimerRef = useRef<ReturnType<typeof window.setInterval> | null>(null)
  const installCountdownTimerRef = useRef<ReturnType<typeof window.setInterval> | null>(null)
  const [activeStep, setActiveStep] = useState<ClawDialogStep>('defaults')
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(false)
  const [officialInstallTarget, setOfficialInstallTarget] = useState<ClawInstallTarget>('feishu')
  const [channelModel, setChannelModel] = useState<ClawModel>('auto')
  const [channelWorkspaceRoot, setChannelWorkspaceRoot] = useState('')
  const [channelEnabled, setChannelEnabled] = useState(true)
  const [showSecret, setShowSecret] = useState(false)
  const [agentProfile, setAgentProfile] = useState<ClawImAgentProfileV1>(() => ({
    name: clawDefaultAgentName('feishu'),
    description: '',
    identity: '',
    personality: '',
    userContext: '',
    replyRules: ''
  }))
  const noVisibleProvider = visibleProviderOptions.length === 0
  const noEditableChannel = mode === 'edit' && editableChannels.length === 0

  useEffect(() => {
    if (mode === 'edit') {
      setSelectedChannelId(fallbackEditChannelId)
      setManageStage('select')
      return
    }
    setManageStage('configure')
    setProvider(fallbackProvider)
  }, [fallbackEditChannelId, fallbackProvider, mode])

  const updateAgentProfile = (
    patch: Partial<ClawImAgentProfileV1>
  ): void => {
    setAgentProfile((profile) => ({ ...profile, ...patch }))
  }

  const clearInstallTimers = (): void => {
    if (installPollTimerRef.current) {
      window.clearInterval(installPollTimerRef.current)
      installPollTimerRef.current = null
    }
    if (installCountdownTimerRef.current) {
      window.clearInterval(installCountdownTimerRef.current)
      installCountdownTimerRef.current = null
    }
  }

  useEffect(() => {
    clearInstallTimers()
    setInstallQr({ status: 'idle', url: '', deviceCode: '', timeLeft: 0, error: '' })
    setError(null)
    setActiveStep('defaults')
    setAdvancedSettingsOpen(false)
    if (existingChannel) {
      const target = existingChannel.platformCredential?.domain === 'lark' ? 'lark' : 'feishu'
      setOfficialInstallTarget(target)
      setChannelModel(existingChannel.model)
      setChannelWorkspaceRoot(existingChannel.workspaceRoot || '')
      setChannelEnabled(existingChannel.enabled)
      setAgentProfile({
        name: existingChannel.agentProfile.name || existingChannel.label || clawDefaultAgentName(target),
        description: existingChannel.agentProfile.description || '',
        identity: existingChannel.agentProfile.identity || '',
        personality: existingChannel.agentProfile.personality || '',
        userContext: existingChannel.agentProfile.userContext || '',
        replyRules: existingChannel.agentProfile.replyRules || ''
      })
      setPlatformCredential(existingChannel.platformCredential)
    } else {
      setOfficialInstallTarget('feishu')
      setChannelModel('auto')
      setChannelWorkspaceRoot('')
      setChannelEnabled(true)
      setAgentProfile({
        name: clawDefaultAgentName('feishu'),
        description: '',
        identity: '',
        personality: '',
        userContext: '',
        replyRules: ''
      })
      setPlatformCredential(undefined)
    }
    return clearInstallTimers
  }, [existingChannel, provider])

  useEffect(() => {
    let cancelled = false
    if (typeof window.dsGui?.getSettings !== 'function') return
    setLoadingConfig(true)
    void window.dsGui
      .getSettings()
      .then((settings) => {
        if (cancelled) return
        const path = settings.claw.im.path.startsWith('/')
          ? settings.claw.im.path
          : `/${settings.claw.im.path}`
        setImEnabled(settings.claw.im.enabled)
        setImPort(settings.claw.im.port)
        setImPath(path)
        setEndpoint(`http://127.0.0.1:${settings.claw.im.port}${path}`)
        setSecret(settings.claw.im.secret.trim())
        setResponseTimeoutSec(Math.round(settings.claw.im.responseTimeoutMs / 1000))
        setRunMode(settings.claw.im.mode)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoadingConfig(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const providerConfigured = configuredProviders.has(effectiveProvider)
  const resolvedPlatformCredential = platformCredential ?? existingChannel?.platformCredential
  const defaultWorkspacePreview = useMemo(
    () => clawDefaultChannelWorkspacePreview(
      effectiveProvider,
      officialInstallTarget,
      resolvedPlatformCredential,
      existingChannel?.id
    ),
    [effectiveProvider, existingChannel?.id, officialInstallTarget, resolvedPlatformCredential]
  )
  const bindingPayload = useMemo(() => {
    const payload: Record<string, unknown> = {
      kind: 'deepseek-gui.claw-im',
      provider: effectiveProvider,
      endpoint,
      method: 'POST',
      connection: {
        mode: selectedOption.connectionMode,
        domain: officialInstallTarget,
        nativeQr: false,
        officialInstallQr: selectedOption.connectionMode === 'official-install-qr',
        credentialHints: selectedOption.credentialHints ?? []
      },
      agent: {
        name: agentProfile.name.trim(),
        description: agentProfile.description.trim()
      },
      body: {
        provider: effectiveProvider,
        text: '<message>',
        sender: '<sender>'
      }
    }
    if (existingChannel?.id) payload.channelId = existingChannel.id
    if (secret) payload.secret = secret
    return JSON.stringify(payload)
  }, [
    agentProfile.description,
    agentProfile.name,
    endpoint,
    existingChannel?.id,
    effectiveProvider,
    officialInstallTarget,
    secret,
    selectedOption.connectionMode,
    selectedOption.credentialHints
  ])
  const qrValue = selectedOption.connectionMode === 'official-install-qr' && installQr.url
    ? installQr.url
    : bindingPayload

  const startOfficialInstallQr = async (): Promise<void> => {
    if (!officialInstallProvider) return
    if (typeof window.dsGui?.startClawImInstallQr !== 'function') {
      setInstallQr({
        status: 'error',
        url: '',
        deviceCode: '',
        timeLeft: 0,
        error: t('clawAddImOfficialQrUnavailable')
      })
      return
    }
    clearInstallTimers()
    setError(null)
    setPlatformCredential(undefined)
    setInstallQr({ status: 'loading', url: '', deviceCode: '', timeLeft: 0, error: '' })
    const result = await window.dsGui.startClawImInstallQr(officialInstallProvider, {
      isLark: officialInstallTarget === 'lark'
    })
    if (!result.ok) {
      setInstallQr({
        status: 'error',
        url: '',
        deviceCode: '',
        timeLeft: 0,
        error: result.message
      })
      return
    }
    setInstallQr({
      status: 'showing',
      url: result.url,
      deviceCode: result.deviceCode,
      timeLeft: result.expireIn,
      error: ''
    })
    installCountdownTimerRef.current = window.setInterval(() => {
      setInstallQr((current) => {
        if (current.status !== 'showing') return current
        if (current.timeLeft <= 1) {
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
    installPollTimerRef.current = window.setInterval(() => {
      void (async () => {
        const poll = await window.dsGui.pollClawImInstall(officialInstallProvider, result.deviceCode)
        if (poll.done) {
          clearInstallTimers()
          setPlatformCredential({
            kind: poll.kind,
            appId: poll.appId,
            appSecret: poll.appSecret,
            domain: poll.domain,
            createdAt: new Date().toISOString()
          })
          setInstallQr((current) => ({
            ...current,
            status: 'success',
            error: '',
            timeLeft: 0
          }))
        } else if (poll.error) {
          clearInstallTimers()
          setInstallQr((current) => ({
            ...current,
            status: 'error',
            error: poll.error ?? t('clawAddImOfficialQrFailed')
          }))
        }
      })()
    }, Math.max(result.interval, 3) * 1000)
  }

  const copyBindingPayload = async (): Promise<void> => {
    try {
      setError(null)
      await navigator.clipboard.writeText(bindingPayload)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch (e) {
      try {
        if (copyTextFallback(bindingPayload)) {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1400)
          return
        }
      } catch {
        // Fall through to the original clipboard error below.
      }
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleAdd = async (): Promise<void> => {
    if (busy) return
    if (noVisibleProvider) return
    if (selectedOption.connectionMode === 'official-install-qr' && !resolvedPlatformCredential) {
      setError(t('clawAddImOfficialCredentialWaiting'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onAddProvider(provider, {
        name: agentProfile.name.trim(),
        description: agentProfile.description.trim(),
        identity: agentProfile.identity,
        personality: agentProfile.personality,
        userContext: agentProfile.userContext,
        replyRules: agentProfile.replyRules
      }, resolvedPlatformCredential, {
        model: channelModel,
        workspaceRoot: channelWorkspaceRoot.trim(),
        enabled: channelEnabled,
        im: {
          enabled: imEnabled,
          port: imPort,
          path: imPath,
          secret: secret.trim(),
          mode: runMode,
          responseTimeoutMs: responseTimeoutSec * 1000
        }
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    if (busy || !existingChannel) return
    if (selectedOption.connectionMode === 'official-install-qr' && !resolvedPlatformCredential) {
      setError(t('clawAddImOfficialCredentialWaiting'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onAddProvider(existingChannel.provider, {
        name: agentProfile.name.trim(),
        description: agentProfile.description.trim(),
        identity: agentProfile.identity,
        personality: agentProfile.personality,
        userContext: agentProfile.userContext,
        replyRules: agentProfile.replyRules
      }, resolvedPlatformCredential, {
        channelId: existingChannel.id,
        model: channelModel,
        workspaceRoot: channelWorkspaceRoot.trim(),
        enabled: channelEnabled,
        im: {
          enabled: imEnabled,
          port: imPort,
          path: imPath,
          secret: secret.trim(),
          mode: runMode,
          responseTimeoutMs: responseTimeoutSec * 1000
        }
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const requiresOfficialInstall = selectedOption.connectionMode === 'official-install-qr'
  const submitDisabled =
    busy || noVisibleProvider || noEditableChannel || (requiresOfficialInstall && !resolvedPlatformCredential)
  const activeStepConfig =
    CLAW_DIALOG_STEPS.find((step) => step.id === activeStep) ?? CLAW_DIALOG_STEPS[0]
  const activeStepIndex = CLAW_DIALOG_STEPS.findIndex((step) => step.id === activeStep)
  const lastStepIndex = CLAW_DIALOG_STEPS.length - 1
  const atLastStep = activeStepIndex >= lastStepIndex
  const navigationDisabled = busy || noVisibleProvider || noEditableChannel
  const credentialStatusText = requiresOfficialInstall
    ? resolvedPlatformCredential
      ? t('clawAddImOfficialCredentialReady')
      : t('clawAddImOfficialCredentialWaiting')
    : secret
      ? t('clawAddImSecretIncluded')
      : t('clawAddImSecretEmpty')

  const dialogTitle = mode === 'edit' ? t('clawManageImTitle') : t('clawAddImTitle')
  const dialogSubtitle = mode === 'edit' ? t('clawManageImSubtitle') : t('clawAddImSubtitle')
  const providerListTitle = mode === 'edit' ? t('clawManageImChooseProvider') : t('clawAddImChooseProvider')
  const showEmptyState = mode === 'edit' ? noEditableChannel : noVisibleProvider
  const isManageSelection = mode === 'edit' && manageStage === 'select'
  const primaryActionLabel = isManageSelection
    ? t('clawManageImEditSelected')
    : atLastStep
    ? mode === 'edit'
      ? busy
        ? t('clawAddImSaving')
        : t('clawAddImSave')
      : busy
        ? t('clawAddImCreating')
        : t('clawAddImCreate')
    : t('clawAddImNextStep')

  const goToPreviousStep = (): void => {
    if (activeStepIndex <= 0) return
    setActiveStep(CLAW_DIALOG_STEPS[activeStepIndex - 1].id)
  }

  const goToNextStep = (): void => {
    if (activeStepIndex >= lastStepIndex) return
    setActiveStep(CLAW_DIALOG_STEPS[activeStepIndex + 1].id)
  }

  const enterManageConfigure = (channelId = selectedChannelId): void => {
    if (!channelId) return
    setSelectedChannelId(channelId)
    setActiveStep('defaults')
    setManageStage('configure')
  }

  const returnToManageSelection = (): void => {
    setManageStage('select')
  }

  const handlePrimaryAction = async (): Promise<void> => {
    if (isManageSelection) {
      enterManageConfigure()
      return
    }
    if (!atLastStep) {
      goToNextStep()
      return
    }
    await (mode === 'edit' ? handleSave() : handleAdd())
  }

  return (
    <div className="ds-no-drag fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4 backdrop-blur-sm">
      <div className="flex max-h-[min(860px,calc(100vh-32px))] w-full max-w-[1080px] flex-col overflow-hidden rounded-[28px] border border-ds-border bg-ds-elevated shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-ds-border-muted/60 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <QrCode className="h-4 w-4 text-accent" strokeWidth={1.9} />
              <h2 className="truncate text-[17px] font-semibold text-ds-ink">
                {dialogTitle}
              </h2>
            </div>
            <p className="mt-1 max-w-[680px] text-[13px] leading-5 text-ds-faint">
              {dialogSubtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('clawAddImClose')}
            title={t('clawAddImClose')}
          >
            <X className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-6">
          <div className="mx-auto w-full max-w-[900px]">
            {showEmptyState ? (
              <div className="rounded-[24px] border border-dashed border-ds-border-muted bg-ds-main/35 p-8 text-center">
                <div className="text-[15px] font-semibold text-ds-ink">
                  {mode === 'edit' ? t('clawManageImEmptyTitle') : t('clawAddImEmptyTitle')}
                </div>
                <p className="mx-auto mt-2 max-w-[420px] text-[13px] leading-6 text-ds-faint">
                  {mode === 'edit' ? t('clawManageImEmptyDesc') : t('clawAddImEmptyDesc')}
                </p>
              </div>
            ) : (
              <>
                {isManageSelection ? (
                  <div className="rounded-[24px] border border-ds-border-muted bg-ds-main/45 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ds-faint">
                          {providerListTitle}
                        </div>
                        <div className="mt-2 text-[15px] font-semibold text-ds-ink">
                          {t('clawManageImSelectTitle')}
                        </div>
                        <p className="mt-1 max-w-[560px] text-[12.5px] leading-5 text-ds-faint">
                          {t('clawManageImSelectDesc')}
                        </p>
                      </div>
                      {loadingConfig ? (
                        <div className="inline-flex items-center gap-2 rounded-full bg-ds-subtle px-3 py-1 text-[12px] text-ds-faint">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                          {t('clawAddImLoading')}
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      {editableChannels.map((channel) => {
                        const active = channel.id === selectedChannelId
                        const option =
                          CLAW_ADD_PROVIDER_OPTIONS.find((item) => item.id === channel.provider)
                          ?? CLAW_ADD_PROVIDER_OPTIONS[0]
                        return (
                          <button
                            key={channel.id}
                            type="button"
                            onClick={() => enterManageConfigure(channel.id)}
                            className={`flex min-h-[82px] min-w-0 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                              active
                                ? 'border-accent/55 bg-accent/10 text-ds-ink shadow-sm ring-2 ring-accent/10'
                                : 'border-ds-border bg-ds-card text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                            }`}
                          >
                            <span
                              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] text-[12px] font-semibold ${option.toneClass}`}
                            >
                              <ClawProviderLogo provider={channel.provider} className="h-6 w-6" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[14px] font-semibold">
                                {channel.label}
                              </span>
                              <span className="mt-0.5 block truncate text-[12px] text-ds-faint">
                                {clawProviderDisplayLabel(channel.provider)} · {channel.model}
                              </span>
                              <span className="mt-1 block truncate text-[11.5px] text-ds-faint">
                                {channel.enabled ? t('clawImEnabled') : t('clawImDisabled')}
                              </span>
                            </span>
                            <ChevronRight className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.9} />
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : null}

                {!isManageSelection ? (
                  <>
                <div className="rounded-[24px] border border-ds-border-muted bg-ds-main/45 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    {mode === 'edit' ? (
                      <div className="flex min-w-0 items-start gap-3">
                        <button
                          type="button"
                          onClick={returnToManageSelection}
                          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-ds-border bg-ds-card text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                          aria-label={t('clawManageImBackToList')}
                          title={t('clawManageImBackToList')}
                        >
                          <ArrowLeft className="h-4 w-4" strokeWidth={1.9} />
                        </button>
                        <div className="min-w-0">
                          <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ds-faint">
                            {t('clawManageImEditing')}
                          </div>
                          <div className="mt-1 truncate text-[15px] font-semibold text-ds-ink">
                            {existingChannel?.label ?? selectedOption.label}
                          </div>
                          <div className="mt-1 truncate text-[12.5px] text-ds-faint">
                            {clawProviderDisplayLabel(effectiveProvider)} · {channelModel}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-[14px] font-semibold ${selectedOption.toneClass}`}
                        >
                          <ClawProviderLogo provider={effectiveProvider} className="h-6 w-6" />
                        </span>
                        <div className="min-w-0">
                          <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ds-faint">
                            {t('clawAddImSetupFlow')}
                          </div>
                          <div className="mt-1 truncate text-[15px] font-semibold text-ds-ink">
                            {selectedOption.label}
                          </div>
                          <div className="mt-1 truncate text-[12.5px] text-ds-faint">
                            {providerConfigured ? t('clawAddImCanAddAnother') : t(clawConnectionStatusKey(selectedOption.connectionMode))}
                          </div>
                        </div>
                      </div>
                    )}
                    {loadingConfig ? (
                      <div className="inline-flex items-center gap-2 rounded-full bg-ds-subtle px-3 py-1 text-[12px] text-ds-faint">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                        {t('clawAddImLoading')}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2">
                    {CLAW_DIALOG_STEPS.map((step, index) => {
                      const Icon = step.icon
                      const active = activeStep === step.id
                      const completed = index < activeStepIndex
                      return (
                        <button
                          key={step.id}
                          type="button"
                          onClick={() => setActiveStep(step.id)}
                          className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[13px] font-medium transition ${
                            active
                              ? 'border-accent/30 bg-accent/10 text-accent'
                              : 'border-ds-border bg-ds-card text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                          }`}
                        >
                          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                            active
                              ? 'bg-accent/15 text-accent'
                              : completed
                                ? 'bg-emerald-500/12 text-emerald-600'
                                : 'bg-ds-subtle text-ds-faint'
                          }`}>
                            {completed ? <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.9} /> : index + 1}
                          </span>
                          <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                          <span>{t(step.labelKey)}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="rounded-[24px] border border-ds-border-muted bg-ds-main/45 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-[14px] font-semibold ${selectedOption.toneClass}`}
                      >
                        <ClawProviderLogo provider={effectiveProvider} className="h-7 w-7" />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-[17px] font-semibold text-ds-ink">
                          {selectedOption.label}
                        </div>
                        <div className="mt-1 text-[12.5px] text-ds-faint">
                          {mode === 'edit'
                            ? t('clawManageImConfiguredStatus')
                            : providerConfigured
                              ? t('clawAddImCanAddAnother')
                              : t(clawConnectionStatusKey(selectedOption.connectionMode))}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-ds-card px-3 py-1 text-[12px] font-medium text-ds-faint">
                        {t('clawAddImStepCounter', {
                          current: activeStepIndex + 1,
                          total: CLAW_DIALOG_STEPS.length
                        })}
                      </span>
                      {loadingConfig ? (
                        <div className="inline-flex items-center gap-2 rounded-full bg-ds-subtle px-3 py-1 text-[12px] text-ds-faint">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                          {t('clawAddImLoading')}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-ds-border bg-ds-card px-3 py-1.5 text-[12px] font-medium text-ds-muted">
                    <span className="text-ds-ink">{t(activeStepConfig.labelKey)}</span>
                    <span>·</span>
                    <span>{t(activeStepConfig.descriptionKey)}</span>
                  </div>

                  {mode === 'edit' ? (
                    <div className="mt-5 grid gap-3 xl:grid-cols-3">
                      <div className="rounded-2xl border border-ds-border-muted bg-ds-card/85 px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ds-faint">
                          {t('clawAddImSummaryConnection')}
                        </div>
                        <div className="mt-2 text-[13px] font-semibold text-ds-ink">
                          {t('clawManageImConnected')}
                        </div>
                        <div className="mt-1 text-[12px] leading-5 text-ds-faint">
                          {t('clawAddImConnectionMethod')}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-ds-border-muted bg-ds-card/85 px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ds-faint">
                          {t('clawAddImSummaryCredentials')}
                        </div>
                        <div className="mt-2 text-[13px] font-semibold text-ds-ink">
                          {requiresOfficialInstall
                            ? resolvedPlatformCredential
                              ? t('clawAddImOfficialQrSuccess')
                              : t('clawAddImGenerateOfficialQr')
                            : t('clawImWebhook')}
                        </div>
                        <div className="mt-1 text-[12px] leading-5 text-ds-faint">
                          {credentialStatusText}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-ds-border-muted bg-ds-card/85 px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ds-faint">
                          {t('clawAddImSummaryEndpoint')}
                        </div>
                        <div className="mt-2 truncate font-mono text-[12.5px] text-ds-ink">
                          {endpoint}
                        </div>
                        <div className="mt-1 text-[12px] leading-5 text-ds-faint">
                          {imEnabled ? t('clawImEnabled') : t('clawImDisabled')}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                {error ? (
                  <div className="mt-5 flex items-start gap-2 rounded-[20px] bg-red-500/10 px-4 py-3 text-[12.5px] leading-5 text-red-600 dark:text-red-300">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} />
                    <span>{error}</span>
                  </div>
                ) : null}

                {activeStep === 'defaults' ? (
                  <div className="mt-5 space-y-4">
                    <div className="rounded-[24px] border border-ds-border-muted bg-ds-main/45 p-5">
                      <div className="text-[13px] font-semibold text-ds-ink">
                        {t('clawAddImProfileBasics')}
                      </div>
                      <p className="mt-1 text-[12.5px] leading-5 text-ds-faint">
                        {t('clawAddImProfileBasicsDesc')}
                      </p>
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <label className="block min-w-0">
                          <span className="text-[12px] font-semibold text-ds-muted">
                            {t('clawAddImAgentName')}
                          </span>
                          <input
                            value={agentProfile.name}
                            onChange={(event) => updateAgentProfile({ name: event.target.value })}
                            placeholder={t('clawAddImAgentNamePlaceholder', {
                              provider: clawInstallTargetLabel(t, officialInstallTarget)
                            })}
                            className="mt-1.5 w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2.5 text-[13px] text-ds-ink outline-none transition focus:border-accent/60"
                          />
                        </label>
                        <label className="block min-w-0">
                          <span className="text-[12px] font-semibold text-ds-muted">
                            {t('clawAddImAgentDescription')}
                          </span>
                          <input
                            value={agentProfile.description}
                            onChange={(event) => updateAgentProfile({ description: event.target.value })}
                            placeholder={t('clawAddImAgentDescriptionPlaceholder')}
                            className="mt-1.5 w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2.5 text-[13px] text-ds-ink outline-none transition focus:border-accent/60"
                          />
                        </label>
                      </div>
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <label className="block min-w-0">
                          <span className="text-[12px] font-semibold text-ds-muted">
                            {t('clawModel')}
                          </span>
                          <select
                            value={channelModel}
                            onChange={(event) => setChannelModel(event.target.value as ClawModel)}
                            className="mt-1.5 w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2.5 text-[13px] text-ds-ink outline-none transition focus:border-accent/60"
                          >
                            <option value="auto">auto</option>
                            <option value="deepseek-v4-pro">deepseek-v4-pro</option>
                            <option value="deepseek-v4-flash">deepseek-v4-flash</option>
                          </select>
                        </label>
                        <label className="block min-w-0">
                          <span className="text-[12px] font-semibold text-ds-muted">
                            {t('clawImConnectionEnabled')}
                          </span>
                          <div className="mt-1.5 flex min-h-[46px] items-center justify-between rounded-xl border border-ds-border bg-ds-card px-3 text-[13px] text-ds-ink">
                            <span>{channelEnabled ? t('clawImEnabled') : t('clawImDisabled')}</span>
                            <button
                              type="button"
                              onClick={() => setChannelEnabled((value) => !value)}
                              className={`relative h-6 w-11 rounded-full transition ${
                                channelEnabled ? 'bg-accent/80' : 'bg-ds-border'
                              }`}
                            >
                              <span
                                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition ${
                                  channelEnabled ? 'left-[22px]' : 'left-0.5'
                                }`}
                              />
                            </button>
                          </div>
                        </label>
                      </div>
                      <label className="mt-4 block min-w-0">
                        <span className="text-[12px] font-semibold text-ds-muted">
                          {t('clawWorkspaceOverride')}
                        </span>
                        <input
                          value={channelWorkspaceRoot}
                          onChange={(event) => setChannelWorkspaceRoot(event.target.value)}
                          placeholder={t('clawWorkspaceOverrideHint')}
                          className="mt-1.5 w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2.5 text-[13px] text-ds-ink outline-none transition focus:border-accent/60"
                        />
                        <span className="mt-1.5 block text-[12px] leading-5 text-ds-faint">
                          {t('clawWorkspaceOverrideDesc')}
                        </span>
                        <span
                          className="mt-1 block break-all rounded-xl border border-ds-border-muted bg-ds-main/55 px-3 py-2 font-mono text-[11.5px] leading-5 text-ds-muted"
                          title={defaultWorkspacePreview}
                        >
                          {defaultWorkspacePreview}
                        </span>
                      </label>
                    </div>
                  </div>
                ) : activeStep === 'prompt' ? (
                  <div className="mt-5 space-y-4">
                    <div className="rounded-[24px] border border-ds-border-muted bg-ds-main/45 p-5">
                      <div className="text-[13px] font-semibold text-ds-ink">
                        {t('clawAddImPersonaTitle')}
                      </div>
                      <p className="mt-1 text-[12.5px] leading-5 text-ds-faint">
                        {t('clawAddImPersonaDesc')}
                      </p>
                      <div className="mt-4 grid gap-4 xl:grid-cols-2">
                        {CLAW_AGENT_TABS.map((tab) => (
                          <label key={tab.id} className="block rounded-2xl border border-ds-border-muted bg-ds-card/80 p-4">
                            <span className="block text-[13px] font-semibold text-ds-ink">
                              {t(tab.labelKey)}
                            </span>
                            <span className="mt-1 block text-[12.5px] leading-5 text-ds-faint">
                              {t(tab.helperKey)}
                            </span>
                            <textarea
                              value={agentProfile[tab.id]}
                              onChange={(event) => updateAgentProfile({ [tab.id]: event.target.value })}
                              placeholder={t(tab.placeholderKey)}
                              className="mt-3 min-h-[170px] w-full resize-y rounded-2xl border border-ds-border bg-ds-main/50 px-4 py-3 text-[13px] leading-6 text-ds-ink outline-none transition focus:border-accent/60"
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-5 space-y-4">
                    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
                      <div className="rounded-[24px] border border-ds-border-muted bg-ds-main/45 p-5">
                        <div className="text-[13px] font-semibold text-ds-ink">
                          {t('clawAddImConnectionMethod')}
                        </div>
                        <p className="mt-1 text-[12.5px] leading-5 text-ds-faint">
                          {t(clawConnectionHintKey(selectedOption.connectionMode))}
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <span className="rounded-full border border-ds-border bg-ds-card px-2.5 py-1 text-[11.5px] font-semibold text-ds-muted">
                            {t(clawConnectionModeLabelKey(selectedOption.connectionMode))}
                          </span>
                          {selectedCredentialHints.map((hint) => (
                            <span
                              key={hint}
                              className="rounded-full bg-ds-card px-2.5 py-1 font-mono text-[11.5px] text-ds-muted"
                            >
                              {t(clawCredentialLabelKey(hint))}
                            </span>
                          ))}
                        </div>
                        {requiresOfficialInstall ? (
                          <div className="mt-4">
                            <div className="text-[12px] font-semibold text-ds-muted">
                              {t('clawAddImInstallTarget')}
                            </div>
                            <p className="mt-1 text-[12px] leading-5 text-ds-faint">
                              {t('clawAddImInstallTargetHint')}
                            </p>
                            <div className="mt-2 inline-flex rounded-xl border border-ds-border bg-ds-card p-1">
                              {(['feishu', 'lark'] as const).map((target) => {
                                const active = officialInstallTarget === target
                                return (
                                  <button
                                    key={target}
                                    type="button"
                                    onClick={() => setOfficialInstallTarget(target)}
                                    className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition ${
                                      active
                                        ? 'bg-accent/12 text-accent'
                                        : 'text-ds-faint hover:bg-ds-hover hover:text-ds-ink'
                                    }`}
                                  >
                                    {clawInstallTargetLabel(t, target)}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        ) : null}
                        <ol className="mt-4 grid gap-2">
                          {selectedOption.guideStepKeys.map((stepKey, index) => (
                            <li key={stepKey} className="flex gap-2 text-[12.5px] leading-5 text-ds-muted">
                              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ds-card text-[11px] font-semibold text-ds-faint">
                                {index + 1}
                              </span>
                              <span className="min-w-0 break-words">{t(stepKey)}</span>
                            </li>
                          ))}
                        </ol>
                        <div className="mt-4 flex items-start gap-2 rounded-xl bg-ds-subtle px-3 py-2 text-[12px] leading-5 text-ds-faint">
                          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                          <span>{requiresOfficialInstall ? t('clawAddImOfficialBindingHint') : t('clawAddImPayloadHint')}</span>
                        </div>
                      </div>

                      <div className="flex flex-col items-center justify-center rounded-[24px] border border-dashed border-ds-border-muted bg-ds-main/45 p-5">
                        {!requiresOfficialInstall ? (
                          <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
                            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-ds-subtle text-accent">
                              <RadioTower className="h-5 w-5" strokeWidth={1.8} />
                            </span>
                            <div className="text-[13px] font-semibold text-ds-ink">
                              {t('clawAddImRelayOnlyTitle')}
                            </div>
                            <p className="max-w-[210px] text-[12px] leading-5 text-ds-faint">
                              {t('clawAddImRelayOnlyHint')}
                            </p>
                          </div>
                        ) : null}
                        {requiresOfficialInstall && installQr.status === 'idle' ? (
                          <button
                            type="button"
                            onClick={() => void startOfficialInstallQr()}
                            className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-ds-userbubble px-4 py-2.5 text-[13px] font-semibold text-ds-userbubbleFg shadow-sm transition hover:opacity-90"
                          >
                            <QrCode className="h-4 w-4" strokeWidth={1.9} />
                            {t('clawAddImGenerateOfficialQr')}
                          </button>
                        ) : null}
                        {requiresOfficialInstall && installQr.status === 'loading' ? (
                          <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 text-ds-faint">
                            <Loader2 className="h-6 w-6 animate-spin" strokeWidth={2} />
                            <span className="text-[12px]">{t('clawAddImGeneratingOfficialQr')}</span>
                          </div>
                        ) : null}
                        {requiresOfficialInstall && installQr.url && installQr.status !== 'loading' ? (
                          <div className="rounded-2xl bg-white p-4 shadow-sm">
                            <QRCodeSVG value={qrValue} size={192} marginSize={1} />
                          </div>
                        ) : null}
                        {requiresOfficialInstall ? (
                          <div className="mt-4 text-center text-[12px] font-medium text-ds-muted">
                            {t(clawPayloadQrTitleKey(selectedOption.connectionMode))}
                          </div>
                        ) : null}
                        {requiresOfficialInstall && installQr.status === 'showing' ? (
                          <div className="mt-1 text-center text-[11.5px] text-ds-faint">
                            {t('clawAddImOfficialQrTimeLeft', { seconds: installQr.timeLeft })}
                          </div>
                        ) : null}
                        {requiresOfficialInstall && installQr.status === 'success' ? (
                          <div className="mt-2 flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11.5px] font-medium text-emerald-600 dark:text-emerald-300">
                            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                            {t('clawAddImOfficialQrSuccess')}
                          </div>
                        ) : null}
                        {requiresOfficialInstall && installQr.status === 'error' ? (
                          <div className="mt-3 grid justify-items-center gap-2">
                            <div className="max-w-[220px] text-center text-[11.5px] leading-4 text-red-600 dark:text-red-300">
                              {installQr.error || t('clawAddImOfficialQrFailed')}
                            </div>
                            <button
                              type="button"
                              onClick={() => void startOfficialInstallQr()}
                              className="rounded-lg border border-ds-border bg-ds-card px-2.5 py-1.5 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                            >
                              {t('clawAddImOfficialQrRetry')}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="rounded-[24px] border border-ds-border-muted bg-ds-main/45 p-5">
                      <button
                        type="button"
                        onClick={() => setAdvancedSettingsOpen((value) => !value)}
                        className="flex w-full items-center justify-between gap-3 rounded-2xl bg-ds-card/75 px-4 py-3 text-left transition hover:bg-ds-card"
                      >
                        <span className="min-w-0">
                          <span className="block text-[13px] font-semibold text-ds-ink">
                            {t('clawAddImAdvancedTitle')}
                          </span>
                          <span className="mt-1 block text-[12.5px] leading-5 text-ds-faint">
                            {t('clawAddImAdvancedDesc')}
                          </span>
                        </span>
                        {advancedSettingsOpen ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.9} />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.9} />
                        )}
                      </button>

                      {advancedSettingsOpen ? (
                        <div className="mt-4 space-y-5">
                          <div className="rounded-[20px] border border-ds-border-muted bg-ds-card/70 p-4">
                            <div className="text-[13px] font-semibold text-ds-ink">
                              {t('clawImWebhook')}
                            </div>
                            <p className="mt-1 text-[12.5px] leading-5 text-ds-faint">
                              {t('clawWebhookEnabledDesc')}
                            </p>
                            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                              <label className="block min-w-0">
                                <span className="text-[12px] font-semibold text-ds-muted">
                                  {t('clawWebhookEnabled')}
                                </span>
                                <div className="mt-1.5 flex min-h-[46px] items-center justify-between rounded-xl border border-ds-border bg-ds-card px-3 text-[13px] text-ds-ink">
                                  <span>{imEnabled ? t('clawImEnabled') : t('clawImDisabled')}</span>
                                  <button
                                    type="button"
                                    onClick={() => setImEnabled((value) => !value)}
                                    className={`relative h-6 w-11 rounded-full transition ${
                                      imEnabled ? 'bg-accent/80' : 'bg-ds-border'
                                    }`}
                                  >
                                    <span
                                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition ${
                                        imEnabled ? 'left-[22px]' : 'left-0.5'
                                      }`}
                                    />
                                  </button>
                                </div>
                              </label>
                              <label className="block min-w-0">
                                <span className="text-[12px] font-semibold text-ds-muted">
                                  {t('clawRunMode')}
                                </span>
                                <select
                                  value={runMode}
                                  onChange={(event) => setRunMode(event.target.value as ClawRunMode)}
                                  className="mt-1.5 w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2.5 text-[13px] text-ds-ink outline-none transition focus:border-accent/60"
                                >
                                  <option value="agent">agent</option>
                                  <option value="plan">plan</option>
                                </select>
                              </label>
                            </div>
                            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                              <label className="block min-w-0">
                                <span className="text-[12px] font-semibold text-ds-muted">
                                  {t('clawWebhookPort')}
                                </span>
                                <input
                                  type="number"
                                  min={1024}
                                  max={65535}
                                  value={imPort}
                                  onChange={(event) => {
                                    const value = Number(event.target.value)
                                    if (Number.isFinite(value)) {
                                      setImPort(value)
                                      const normalizedPath = imPath.startsWith('/') ? imPath : `/${imPath}`
                                      setEndpoint(`http://127.0.0.1:${value}${normalizedPath}`)
                                    }
                                  }}
                                  className="mt-1.5 w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2.5 text-[13px] text-ds-ink outline-none transition focus:border-accent/60"
                                />
                              </label>
                              <label className="block min-w-0">
                                <span className="text-[12px] font-semibold text-ds-muted">
                                  {t('clawWebhookPath')}
                                </span>
                                <input
                                  value={imPath}
                                  onChange={(event) => {
                                    const nextPath = event.target.value
                                    setImPath(nextPath)
                                    const normalizedPath = nextPath.startsWith('/') ? nextPath : `/${nextPath}`
                                    setEndpoint(`http://127.0.0.1:${imPort}${normalizedPath}`)
                                  }}
                                  className="mt-1.5 w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2.5 text-[13px] text-ds-ink outline-none transition focus:border-accent/60"
                                />
                              </label>
                            </div>
                            <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                              <label className="block min-w-0">
                                <span className="text-[12px] font-semibold text-ds-muted">
                                  {t('clawResponseTimeout')}
                                </span>
                                <input
                                  type="number"
                                  min={5}
                                  max={600}
                                  value={responseTimeoutSec}
                                  onChange={(event) => {
                                    const value = Number(event.target.value)
                                    if (Number.isFinite(value)) setResponseTimeoutSec(value)
                                  }}
                                  className="mt-1.5 w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2.5 text-[13px] text-ds-ink outline-none transition focus:border-accent/60"
                                />
                              </label>
                              <label className="block min-w-0">
                                <span className="text-[12px] font-semibold text-ds-muted">
                                  {t('clawWebhookSecret')}
                                </span>
                                <div className="mt-1.5 flex items-center rounded-xl border border-ds-border bg-ds-card">
                                  <input
                                    type={showSecret ? 'text' : 'password'}
                                    value={secret}
                                    onChange={(event) => setSecret(event.target.value)}
                                    className="w-full bg-transparent px-3 py-2.5 text-[13px] text-ds-ink outline-none"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setShowSecret((value) => !value)}
                                    className="mr-2 rounded-md p-1 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                                    aria-label={showSecret ? t('hideSecret') : t('showSecret')}
                                    title={showSecret ? t('hideSecret') : t('showSecret')}
                                  >
                                    {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                  </button>
                                </div>
                              </label>
                            </div>
                          </div>

                          <div className="rounded-[20px] border border-ds-border-muted bg-ds-card/70 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-[13px] font-semibold text-ds-ink">
                                  {t('clawAddImBindingInfo')}
                                </div>
                                <p className="mt-1 text-[12.5px] leading-5 text-ds-faint">
                                  {t('clawAddImPayloadHint')}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => void copyBindingPayload()}
                                className="inline-flex items-center gap-2 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                              >
                                {copied ? (
                                  <CheckCircle2 className="h-4 w-4 text-emerald-500" strokeWidth={1.9} />
                                ) : (
                                  <Copy className="h-4 w-4 text-ds-faint" strokeWidth={1.9} />
                                )}
                                {copied ? t('clawAddImCopied') : t('clawAddImCopyBinding')}
                              </button>
                            </div>
                            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                              <div>
                                <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ds-faint">
                                  {t('clawAddImEndpoint')}
                                </div>
                                <div className="truncate rounded-xl border border-ds-border bg-ds-card px-3 py-2.5 font-mono text-[12.5px] text-ds-ink">
                                  {endpoint}
                                </div>
                                <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ds-faint">
                                  {t('clawAddImPayloadTitle')}
                                </div>
                                <textarea
                                  readOnly
                                  value={bindingPayload}
                                  className="mt-1.5 min-h-[210px] w-full resize-none rounded-2xl border border-ds-border bg-ds-card px-4 py-3 font-mono text-[12px] leading-6 text-ds-ink outline-none"
                                />
                              </div>
                              <div className="space-y-3">
                                <div className="flex items-start gap-2 rounded-xl bg-ds-subtle px-3 py-2 text-[12px] leading-5 text-ds-faint">
                                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                                  <span>{secret ? t('clawAddImSecretIncluded') : t('clawAddImSecretEmpty')}</span>
                                </div>
                                <div className="flex items-start gap-2 rounded-xl bg-ds-subtle px-3 py-2 text-[12px] leading-5 text-ds-faint">
                                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                                  <span>{t('clawWebhookEnabledDesc')}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ds-border-muted/60 px-5 py-4">
          <div className="text-[12px] leading-5 text-ds-faint">
            {isManageSelection
              ? t('clawManageImFooterHint')
              : `${t('clawAddImStepCounter', {
                current: activeStepIndex + 1,
                total: CLAW_DIALOG_STEPS.length
              })} · ${t(activeStepConfig.descriptionKey)}`}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-ds-border bg-ds-card px-4 py-2 text-[13px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink"
            >
              {t('clawAddImCancel')}
            </button>
            {activeStepIndex > 0 ? (
              <button
                type="button"
                onClick={goToPreviousStep}
                disabled={busy}
                className="rounded-xl border border-ds-border bg-ds-card px-4 py-2 text-[13px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('clawAddImPrevStep')}
              </button>
            ) : null}
            <button
              type="button"
              disabled={isManageSelection ? busy || noEditableChannel || !selectedChannelId : atLastStep ? submitDisabled : navigationDisabled}
              onClick={() => void handlePrimaryAction()}
              className="inline-flex min-w-[126px] items-center justify-center gap-2 rounded-xl bg-ds-userbubble px-4 py-2 text-[13px] font-medium text-ds-userbubbleFg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : null}
              {primaryActionLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SidebarLink({
  icon,
  label,
  onClick,
  disabled,
  disabledHint,
  shortcut,
  variant = 'flat',
  trailing,
  active = false
}: SidebarLinkProps): ReactElement {
  const isAccent = variant === 'flat-accent'
  const isFooter = variant === 'footer'
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? disabledHint : undefined}
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-[14px] font-medium transition ${
        disabled
          ? 'cursor-not-allowed text-ds-faint opacity-55'
          : active
            ? 'bg-ds-hover/70 text-ds-ink shadow-sm ring-1 ring-ds-border-muted/50'
          : isFooter
            ? 'text-ds-muted hover:bg-ds-hover/45 hover:text-ds-ink'
            : isAccent
              ? 'border border-ds-border-muted/30 bg-white/[0.02] text-ds-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] hover:bg-white/[0.035] dark:border-white/10 dark:bg-white/[0.02] dark:hover:bg-white/[0.04]'
              : 'text-ds-muted hover:bg-ds-hover/45 hover:text-ds-ink'
      }`}
    >
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] ${
          isAccent
            ? 'text-accent'
            : isFooter
              ? 'text-ds-faint'
              : 'text-ds-muted'
        }`}
      >
        {icon}
      </span>
      <span className="flex-1 truncate text-left">{label}</span>
      {shortcut ? (
        <kbd className="ds-kbd hidden items-center gap-0.5 rounded-md px-1.5 py-0.5 font-mono text-[11.5px] font-medium text-ds-faint sm:inline-flex">
          <Command className="h-2.5 w-2.5" strokeWidth={2} />
          {shortcut.replace('⌘', '')}
        </kbd>
      ) : null}
      {trailing ?? null}
      {isFooter ? <ChevronRight className="h-3.5 w-3.5 text-ds-faint" strokeWidth={1.8} /> : null}
    </button>
  )
}

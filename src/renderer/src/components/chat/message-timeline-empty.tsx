import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bot,
  CircleAlert,
  CornerUpLeft,
  GitBranch,
  GitFork,
  RefreshCw,
  Settings
} from 'lucide-react'
import { resolveChatWelcomeTitle, type ClawImChannelV1 } from '@shared/app-settings'
import { useChatWelcomeMessageSetting } from '../../lib/chat-welcome-message-settings'
import { KunStateFigure } from './AnimatedWorkLogo'
/**
 * Empty / hero states rendered by `MessageTimeline` when there is no
 * turn content yet. Lifted out of the timeline component so the main
 * file can focus on rendering turns and scroll behaviour.
 */

function clawChannelDisplayName(
  channel: ClawImChannelV1 | null,
  fallback: string
): string {
  if (!channel) return fallback
  return (
    channel.agentProfile.name.trim()
    || channel.label.trim()
    || channel.agentProfile.description.trim()
    || fallback
  )
}

function ClawEmptyHero({
  channel,
  onSelectSuggestion
}: {
  channel: ClawImChannelV1 | null
  onSelectSuggestion?: (prompt: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const agentName = clawChannelDisplayName(channel, t('clawEmptyHeroFallbackName'))
  void onSelectSuggestion
  const hasInboundConversation = Boolean(
    channel?.threadId.trim() ||
    channel?.conversations.some((conversation) => conversation.localThreadId.trim()) ||
    channel?.conversations.length ||
    channel?.remoteSession?.chatId?.trim()
  )

  return (
    <div className="ds-no-drag flex justify-center px-4 pb-6 pt-12 md:px-8 md:pt-16">
      <div className="w-full ds-chat-content-max-width rounded-[32px] border border-ds-border-muted bg-ds-card/78 px-8 py-10 text-center shadow-[0_16px_40px_rgba(20,47,95,0.06)] backdrop-blur md:px-12 md:py-14">
        <div className="mx-auto max-w-[720px]">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[24px] border border-ds-border-muted bg-ds-main/55 text-accent">
            <KunStateFigure kind="greet" className="h-14 w-14" />
          </div>

          <h1 className="mt-6 text-[34px] font-semibold tracking-[-0.055em] text-ds-ink md:text-[48px]">
            {t('clawEmptyHeroTitle', { name: agentName })}
          </h1>
          <p className="mt-3 text-[15px] leading-7 text-ds-muted md:text-[16px]">
            {hasInboundConversation ? t('clawEmptyHeroSub') : t('clawEmptyHeroNeedsInbound')}
          </p>
        </div>
      </div>
    </div>
  )
}

function RuntimeWakeHero({
  runtimeError,
  onRetry,
  onOpenSettings
}: {
  runtimeError?: string | null
  onRetry: () => void
  onOpenSettings: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  // When the runtime probe has surfaced a specific error (e.g. port conflict,
  // missing API key, or unhealthy runtime), prefer a clear "cannot connect"
  // title and show the localized error message as the body. Otherwise fall
  // back to the generic "waking" hero. This addresses issue #78, where users
  // saw the "正在唤醒" title and assumed the app was still loading, never
  // noticing the port-conflict detail text below it.
  const trimmedError = runtimeError?.trim() ?? ''
  const hasError = trimmedError.length > 0
  const title = hasError ? t('runtimeErrorHeroTitle') : t('runtimeOfflineHeroTitle')
  const detail = hasError ? trimmedError : t('runtimeOfflineHeroSub')

  return (
    <div className="ds-runtime-wake-hero ds-no-drag mx-auto flex min-h-[min(620px,calc(100dvh-220px))] w-full flex-col items-center justify-center px-6 py-10 text-center">
      <p className="text-[12px] font-medium tracking-[0.02em] text-ds-faint">
        {t('runtimeOfflineHeroKicker')}
      </p>
      <h1 className="mt-2 max-w-[620px] text-[24px] font-medium leading-tight tracking-[-0.02em] text-ds-ink md:text-[28px]">
        {title}
      </h1>
      <p className="mt-3 max-w-[620px] text-[13px] leading-6 text-ds-muted">
        {detail}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          className="ds-chip inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-medium text-ds-ink transition hover:text-ds-ink"
          onClick={onRetry}
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('retryConnection')}
        </button>
        <button
          type="button"
          className="ds-chip-muted inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-medium text-ds-muted transition hover:text-ds-ink"
          onClick={onOpenSettings}
        >
          <Settings className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('openSettings')}
        </button>
      </div>
    </div>
  )
}

function RuntimeHomeStatus({
  runtimeError,
  onRetry,
  onOpenSettings
}: {
  runtimeError?: string | null
  onRetry: () => void
  onOpenSettings: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const trimmedError = runtimeError?.trim() ?? ''
  const hasError = trimmedError.length > 0

  return (
    <div
      data-runtime-home-status
      className="mt-4 flex max-w-[680px] flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-[18px] border border-ds-border-muted bg-ds-card/88 px-4 py-2.5 text-left shadow-[0_8px_24px_rgba(32,55,90,0.05)]"
    >
      <span className="flex min-w-0 items-center gap-2" role="status" aria-live="polite">
        {hasError ? (
          <CircleAlert className="h-4 w-4 shrink-0 text-amber-600" strokeWidth={1.8} />
        ) : (
          <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-accent motion-reduce:animate-none" strokeWidth={1.8} />
        )}
        <span className="min-w-0">
          <span className="block text-[12.5px] font-medium text-ds-ink">
            {hasError ? t('runtimeErrorHeroTitle') : t('runtimeOfflineHeroTitle')}
          </span>
          {hasError ? (
            <span className="block max-w-[460px] text-[11.5px] leading-5 text-ds-muted">
              {trimmedError}
            </span>
          ) : null}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          className="rounded-full px-2.5 py-1 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          onClick={onRetry}
        >
          {t('retryConnection')}
        </button>
        <button
          type="button"
          className="rounded-full px-2.5 py-1 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          onClick={onOpenSettings}
        >
          {t('openSettings')}
        </button>
      </span>
    </div>
  )
}

function ChatEmptyHero({
  runtimeReady,
  runtimeError,
  onRetry,
  onOpenSettings
}: {
  runtimeReady: boolean
  runtimeError?: string | null
  onRetry: () => void
  onOpenSettings: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const customWelcome = useChatWelcomeMessageSetting()
  const title = resolveChatWelcomeTitle(customWelcome, t('emptyHeroTitle'))

  return (
    <div className="ds-chat-empty-hero ds-no-drag mx-auto flex min-h-[clamp(190px,23vh,240px)] w-full items-center justify-center px-6 pb-3 pt-6 text-center">
      <div
        data-home-hero-content
        className="flex max-w-[720px] flex-col items-center"
      >
        <h1
          id="chat-empty-hero-title"
          className="max-w-[620px] text-[24px] font-medium leading-tight tracking-[-0.025em] text-ds-ink sm:text-[28px]"
        >
          {title}
        </h1>
        <p className="mt-3 max-w-[680px] text-[13px] leading-6 text-ds-muted">
          {t('unifiedTaskHeroSub')}
        </p>
        {!runtimeReady ? (
          <RuntimeHomeStatus
            runtimeError={runtimeError}
            onRetry={onRetry}
            onOpenSettings={onOpenSettings}
          />
        ) : null}
      </div>
    </div>
  )
}

export function MessageTimelineEmptyHero({
  route,
  ready,
  hasWorkspace,
  runtimeError,
  activeClawChannel,
  onPickWorkspace,
  onRetry,
  onOpenSettings,
  onSelectSuggestion
}: {
  route: 'chat' | 'claw'
  ready: boolean
  hasWorkspace: boolean
  runtimeError?: string | null
  activeClawChannel: ClawImChannelV1 | null
  onPickWorkspace: () => void
  onRetry: () => void
  onOpenSettings: () => void
  onSelectSuggestion?: (prompt: string) => void
  focusModeEnabled?: boolean
}): ReactElement {
  const { t } = useTranslation('common')

  if (!ready && route === 'claw') {
    return <RuntimeWakeHero runtimeError={runtimeError} onRetry={onRetry} onOpenSettings={onOpenSettings} />
  }

  if (!hasWorkspace) {
    return (
      <div className="ds-no-drag flex flex-col items-center justify-center px-6 py-24 text-center">
        <KunStateFigure kind="sit" className="mb-4 h-16 w-16" />
        <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-ds-ink">
          {t('selectWorkspace')}
        </h1>
        <p className="mt-2 max-w-sm text-[14.5px] leading-6 text-ds-muted">
          {t('emptyHeroSubNoWorkspace')}
        </p>
        <button
          type="button"
          className="ds-chip mt-5 rounded-full px-5 py-2.5 text-[13px] font-medium text-ds-ink transition hover:text-ds-ink"
          onClick={onPickWorkspace}
        >
          {t('selectWorkspace')}
        </button>
      </div>
    )
  }

  if (route === 'claw') {
    return (
      <ClawEmptyHero
        channel={activeClawChannel}
        onSelectSuggestion={onSelectSuggestion}
      />
    )
  }

  return (
    <ChatEmptyHero
      runtimeReady={ready}
      runtimeError={runtimeError}
      onRetry={onRetry}
      onOpenSettings={onOpenSettings}
    />
  )
}

export function ThreadForkBanner({ parentTitle }: { parentTitle: string }): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="rounded-[18px] border border-accent/16 bg-accent/7 px-4 py-3 text-ds-muted shadow-[0_14px_36px_rgba(59,130,216,0.05)]">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] bg-accent/12 text-accent">
          <GitFork className="h-4 w-4" strokeWidth={1.85} />
        </span>
        <span className="min-w-0">
          <span className="block text-[13.5px] font-semibold text-ds-ink">
            {t('threadForkBannerTitle')}
          </span>
          <span className="mt-1 block text-[12.5px] leading-5 text-ds-muted">
            {parentTitle
              ? t('threadForkBannerSub', { title: parentTitle })
              : t('threadForkBannerSubUnknown')}
          </span>
        </span>
      </div>
    </div>
  )
}

/**
 * Bar shown where the composer normally sits when viewing a subagent's own
 * (`relation: 'side'`) session. The subagent runs autonomously, so there is no
 * input box — only a way back to the parent conversation that delegated it.
 * These threads are hidden from the sidebar, so this is the route home.
 */
export function SubagentReturnBar({
  parentTitle,
  onBack,
  variant = 'subagent'
}: {
  parentTitle: string
  onBack: () => void
  /** Explore child sessions get stronger "process / back to main" copy. */
  variant?: 'explore' | 'subagent'
}): ReactElement {
  const { t } = useTranslation('common')
  const isExplore = variant === 'explore'
  return (
    <button
      type="button"
      onClick={onBack}
      data-testid="subagent-return-bar"
      data-variant={variant}
      className="group ds-chat-content-max-width flex w-full items-center gap-3 rounded-[16px] border border-accent/16 bg-accent/7 px-4 py-3 text-left text-ds-muted shadow-[0_14px_36px_rgba(59,130,216,0.05)] transition hover:bg-accent/12"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] bg-accent/12 text-accent">
        <Bot className="h-4 w-4" strokeWidth={1.85} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold text-ds-ink">
          {isExplore
            ? t('exploreSessionBannerTitle', { defaultValue: 'Viewing explore process' })
            : t('subagentSessionBannerTitle')}
        </span>
        <span className="mt-1 block truncate text-[12.5px] leading-5 text-ds-muted">
          {parentTitle
            ? (isExplore
              ? t('exploreSessionBannerSub', {
                title: parentTitle,
                defaultValue: 'Exploring for “{{title}}”. Return to the main chat anytime.'
              })
              : t('subagentSessionBannerSub', { title: parentTitle }))
            : (isExplore
              ? t('exploreSessionBannerSubUnknown', {
                defaultValue: 'Exploring in a side session. Return to the main chat anytime.'
              })
              : t('subagentSessionBannerSubUnknown'))}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5 rounded-[10px] bg-accent/10 px-2.5 py-1.5 text-[12px] font-semibold text-accent transition group-hover:bg-accent/15">
        <CornerUpLeft className="h-3.5 w-3.5" strokeWidth={2} />
        {isExplore
          ? t('exploreSessionBannerBack', { defaultValue: 'Back to main chat' })
          : t('subagentSessionBannerBack')}
      </span>
    </button>
  )
}

export type GraphChildSessionContext = {
  runTitle: string
  nodeTitle: string
  attemptNumber: number
  agentName: string
  statusLabel: string
  activityLabel: string
  elapsedLabel: string
  observerStatus: 'connecting' | 'live' | 'reconnecting' | 'stopped'
}

export function GraphChildSessionBar({
  context,
  onBack
}: {
  context: GraphChildSessionContext
  onBack: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div
      className="ds-no-drag flex shrink-0 items-center gap-3 border-b border-ds-border-muted bg-ds-card/92 px-4 py-2 backdrop-blur-xl"
      role="status"
      aria-live="polite"
      data-graph-child-session-bar
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-200">
        <GitBranch className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-ds-faint">
          <span className="shrink-0">{t('graphBreadcrumbMain')}</span>
          <span aria-hidden>›</span>
          <span className="max-w-[180px] truncate">{context.runTitle}</span>
          <span aria-hidden>›</span>
          <span className="max-w-[180px] truncate font-semibold text-ds-muted">
            {context.nodeTitle}
          </span>
          <span aria-hidden>›</span>
          <span className="shrink-0">
            {t('graphBreadcrumbAttempt', { number: context.attemptNumber })}
          </span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px]">
          <span className="shrink-0 font-semibold text-ds-ink">{context.statusLabel}</span>
          <span className="min-w-0 truncate text-ds-muted">
            {context.agentName} · {context.activityLabel}
          </span>
          {context.elapsedLabel ? (
            <span className="shrink-0 tabular-nums text-ds-faint">{context.elapsedLabel}</span>
          ) : null}
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] ${
              context.observerStatus === 'live'
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
                : 'bg-amber-500/10 text-amber-700 dark:text-amber-200'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${
              context.observerStatus === 'live'
                ? 'ds-subagent-dot-pulse bg-emerald-500'
                : 'bg-amber-500'
            }`} />
            {t(`graphObserver_${context.observerStatus}`)}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onBack}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-accent/20 bg-accent/8 px-2.5 text-[10px] font-semibold text-accent transition hover:bg-accent/12"
      >
        <CornerUpLeft className="h-3.5 w-3.5" />
        {t('graphReturnToGraph')}
      </button>
    </div>
  )
}

export function ThreadForkPoint({ parentTitle }: { parentTitle: string }): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="flex items-center gap-3 py-1 text-[12px] font-medium text-ds-faint">
      <span className="h-px min-w-6 flex-1 bg-ds-border-muted" />
      <span
        className="inline-flex max-w-[min(100%,420px)] items-center gap-1.5 rounded-full border border-accent/16 bg-ds-card/78 px-3 py-1.5 text-accent shadow-sm"
        title={parentTitle ? t('threadForkPointFrom', { title: parentTitle }) : t('threadForkPoint')}
      >
        <GitFork className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        <span className="truncate">
          {parentTitle ? t('threadForkPointFrom', { title: parentTitle }) : t('threadForkPoint')}
        </span>
      </span>
      <span className="h-px min-w-6 flex-1 bg-ds-border-muted" />
    </div>
  )
}

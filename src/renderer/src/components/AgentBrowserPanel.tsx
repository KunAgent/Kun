import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Hand,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Square,
  Trash2
} from 'lucide-react'
import type { BrowserUseViewState } from '@shared/browser-use'

function emptyState(): BrowserUseViewState {
  return {
    contractVersion: 1,
    capabilityStatus: 'disabled',
    lifecycle: 'closed',
    controlOwner: 'agent',
    visible: false,
    mounted: false,
    mode: 'public',
    tabs: [],
    updatedAt: new Date(0).toISOString()
  }
}

export function AgentBrowserPanel({
  threadId,
  active,
  onTitleChange,
  variant = 'full'
}: {
  threadId: string | null
  active: boolean
  onTitleChange?: (title: string) => void
  variant?: 'full' | 'pip'
}): ReactElement {
  const { t } = useTranslation('common')
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState<BrowserUseViewState>(emptyState)
  const [operationError, setOperationError] = useState<string>()
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0]
  const pendingConsent = state.pendingOriginConsent ?? state.pendingActionConsent
  const compact = variant === 'pip'
  const shouldMountView = Boolean(
    threadId &&
    active &&
    state.sessionId &&
    activeTab &&
    !pendingConsent
  )

  useEffect(() => {
    setState(emptyState())
    setOperationError(undefined)
    if (!threadId) return
    let live = true
    void window.kunGui.getBrowserUseState(threadId)
      .then((next) => {
        if (live) setState(next)
      })
      .catch((error) => {
        if (live) setOperationError(error instanceof Error ? error.message : String(error))
      })
    const unsubscribe = window.kunGui.onBrowserUseState((next) => {
      if (next.threadId === threadId) setState(next)
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [threadId])

  const mount = useCallback(async (
    visible: boolean,
    supervisionActive = active
  ): Promise<BrowserUseViewState | undefined> => {
    const element = hostRef.current
    if (!threadId || !element || !state.sessionId) return undefined
    const rect = element.getBoundingClientRect()
    const next = await window.kunGui.mountBrowserUse({
      threadId,
      visible,
      supervisionActive,
      bounds: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      }
    })
    setState(next)
    return next
  }, [active, state.sessionId, threadId])

  useLayoutEffect(() => {
    const element = hostRef.current
    if (!element || !threadId || !state.sessionId) return
    let disposed = false
    const sync = (): void => {
      if (disposed) return
      void mount(shouldMountView).catch((error) => {
        if (!disposed) setOperationError(error instanceof Error ? error.message : String(error))
      })
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(element)
    window.addEventListener('resize', sync)
    return () => {
      disposed = true
      observer.disconnect()
      window.removeEventListener('resize', sync)
      void mount(false, false).catch(() => undefined)
    }
  }, [mount, shouldMountView, state.sessionId, threadId])

  useEffect(() => {
    const title = activeTab?.title?.trim() || t('browserUseAgentMode')
    onTitleChange?.(title)
  }, [activeTab?.title, onTitleChange, t])

  const run = async (
    operation: () => Promise<BrowserUseViewState>
  ): Promise<void> => {
    setOperationError(undefined)
    try {
      setState(await operation())
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error))
    }
  }

  const decideOrigin = (decision: 'allow-once' | 'deny'): void => {
    const request = state.pendingOriginConsent
    if (!threadId || !request) return
    void run(() => window.kunGui.decideBrowserUseOrigin({
      threadId,
      requestId: request.id,
      decision
    }))
  }

  const decideAction = (decision: 'allow-once' | 'deny'): void => {
    const request = state.pendingActionConsent
    if (!threadId || !request) return
    void run(() => window.kunGui.decideBrowserUseAction({
      threadId,
      requestId: request.id,
      decision
    }))
  }

  const navigate = (command: 'back' | 'forward' | 'reload'): void => {
    if (!threadId) return
    void run(() => window.kunGui.navigateBrowserUse({ threadId, command }))
  }

  const toggleControl = (): void => {
    if (!threadId) return
    void run(() => window.kunGui.setBrowserUseControl({
      threadId,
      controlOwner: state.controlOwner === 'agent' ? 'manual' : 'agent'
    }))
  }

  const statusTone = state.lifecycle === 'error' || state.capabilityStatus === 'unavailable'
    ? 'text-red-600 dark:text-red-300'
    : state.controlOwner === 'manual'
      ? 'text-amber-600 dark:text-amber-300'
      : 'text-emerald-600 dark:text-emerald-300'

  return (
    <aside
      data-browser-use-variant={variant}
      className="ds-sidebar-surface flex h-full min-h-0 flex-col"
    >
      {!compact ? (
        <>
          <div className="ds-sidebar-surface-chrome flex min-h-12 shrink-0 items-center gap-2 border-b border-ds-border-muted px-3">
            <div className="flex shrink-0 items-center gap-1 rounded-full bg-ds-surface-subtle p-0.5 dark:bg-white/[0.08]">
              <button
                type="button"
                onClick={() => navigate('back')}
                disabled={!activeTab?.canGoBack}
                aria-label={t('browserBack')}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ds-faint hover:bg-ds-hover disabled:opacity-30"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => navigate('forward')}
                disabled={!activeTab?.canGoForward}
                aria-label={t('browserForward')}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ds-faint hover:bg-ds-hover disabled:opacity-30"
              >
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => navigate('reload')}
                disabled={!activeTab}
                aria-label={t('browserReload')}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ds-faint hover:bg-ds-hover disabled:opacity-30"
              >
                {activeTab?.loading
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <RefreshCw className="h-3.5 w-3.5" />}
              </button>
            </div>

            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-semibold text-ds-ink">
                {activeTab?.title || t('browserUseWaitingForAgent')}
              </div>
              <div className="truncate text-[10.5px] text-ds-faint">
                {activeTab?.origin || t('browserUseTemporaryAnonymous')}
              </div>
            </div>

            <div className={`flex shrink-0 items-center gap-1 text-[10.5px] font-semibold ${statusTone}`}>
              {state.controlOwner === 'manual'
                ? <Hand className="h-3.5 w-3.5" />
                : <ShieldCheck className="h-3.5 w-3.5" />}
              {state.controlOwner === 'manual'
                ? t('browserUseManualControl')
                : t('browserUseAgentControl')}
            </div>
          </div>

          <div className="ds-sidebar-surface-chrome flex shrink-0 flex-wrap items-center gap-1.5 border-b border-ds-border-muted px-3 py-2">
            <span className="rounded-full border border-ds-border-muted bg-ds-card px-2 py-1 text-[10px] font-semibold text-ds-muted">
              {state.mode === 'public' ? t('browserUsePublicMode') : t('browserUseLocalMode')}
            </span>
            {state.budget ? (
              <span className="text-[10px] text-ds-faint">
                {t('browserUseBudget', {
                  observations: state.budget.observationRemaining,
                  interactions: state.budget.interactionRemaining
                })}
              </span>
            ) : null}
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={toggleControl}
                disabled={!state.sessionId}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-ds-border-muted bg-ds-card px-2 text-[10.5px] font-semibold text-ds-muted hover:text-ds-ink disabled:opacity-35"
              >
                {state.controlOwner === 'agent'
                  ? <Hand className="h-3 w-3" />
                  : <Bot className="h-3 w-3" />}
                {state.controlOwner === 'agent'
                  ? t('browserUseTakeControl')
                  : t('browserUseReturnControl')}
              </button>
              <button
                type="button"
                onClick={() => threadId && void run(() => window.kunGui.stopBrowserUse(threadId))}
                disabled={!state.sessionId}
                className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10.5px] font-semibold text-red-600 hover:bg-red-500/10 disabled:opacity-35"
              >
                <Square className="h-3 w-3" />
                {t('browserUseStop')}
              </button>
              <button
                type="button"
                onClick={() => threadId && void run(() => window.kunGui.clearBrowserUse(threadId))}
                disabled={!state.sessionId}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ds-faint hover:bg-red-500/10 hover:text-red-600 disabled:opacity-35"
                aria-label={t('browserUseClear')}
                title={t('browserUseClear')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </>
      ) : null}

      {operationError || state.reason || (activeTab?.loading === false && state.lifecycle === 'error') ? (
        <div className={`shrink-0 border-b border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-200 ${
          compact ? 'px-2.5 py-1.5 text-[10px]' : 'px-3 py-2 text-[11px]'
        }`}>
          {operationError || state.reason || t('browserUseUnavailable')}
        </div>
      ) : null}

      <div ref={hostRef} className="ds-sidebar-surface-body relative min-h-0 flex-1 overflow-hidden">
        {!state.sessionId ? (
          <BrowserEmptyState
            icon={state.capabilityStatus === 'disabled' ? 'alert' : 'ready'}
            title={state.capabilityStatus === 'disabled'
              ? t('browserUseDisabledTitle')
              : t('browserUseWaitingForAgent')}
            body={state.capabilityStatus === 'disabled'
              ? t('browserUseDisabledBody')
              : t('browserUseWaitingBody')}
          />
        ) : !activeTab && state.lifecycle === 'loading' ? (
          <BrowserEmptyState
            icon="loading"
            title={t('browserUseStartingTitle')}
            body={t('browserUseStartingBody')}
          />
        ) : !activeTab && state.lifecycle === 'error' ? (
          <BrowserEmptyState
            icon="alert"
            title={t('browserUseInitializationFailed')}
            body={state.reason || t('browserUseUnavailable')}
            action={threadId ? (
              <button
                type="button"
                onClick={() => void run(() => window.kunGui.clearBrowserUse(threadId))}
                className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md border border-red-500/30 px-3 text-[11px] font-semibold text-red-600 hover:bg-red-500/10 dark:text-red-300"
              >
                <Square className="h-3 w-3" />
                {t('browserUseStop')}
              </button>
            ) : undefined}
          />
        ) : !activeTab ? (
          <BrowserEmptyState
            icon="ready"
            title={t('browserUseWaitingForAgent')}
            body={t('browserUseWaitingBody')}
          />
        ) : null}

        {state.pendingOriginConsent ? (
          <div className="ds-sidebar-surface-body absolute inset-0 z-10 flex items-center justify-center overflow-auto p-5">
            <div className="w-full max-w-md rounded-2xl border border-ds-border-strong bg-ds-card p-4 shadow-xl">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-ds-ink">
                <ShieldAlert className="h-4 w-4 text-amber-500" />
                {t('browserUseOriginConsentTitle')}
              </div>
              <p className="mt-2 text-[11px] leading-5 text-ds-muted">
                {t('browserUseOriginConsentBody')}
              </p>
              <div className="mt-3 break-all rounded-lg bg-ds-surface-subtle px-3 py-2 font-mono text-[11px] text-ds-ink">
                {state.pendingOriginConsent.origin}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <ConsentButton onClick={() => decideOrigin('deny')}>
                  {t('browserUseDeny')}
                </ConsentButton>
                <ConsentButton primary onClick={() => decideOrigin('allow-once')}>
                  {t('browserUseAllowOriginOnce')}
                </ConsentButton>
              </div>
            </div>
          </div>
        ) : null}

        {state.pendingActionConsent ? (
          <div className="ds-sidebar-surface-body absolute inset-0 z-10 flex items-center justify-center overflow-auto p-5">
            <div className="w-full max-w-lg rounded-2xl border border-ds-border-strong bg-ds-card p-4 shadow-xl">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-ds-ink">
                <ShieldAlert className="h-4 w-4 text-amber-500" />
                {t('browserUseActionConsentTitle')}
              </div>
              {state.pendingActionConsent.previewDataUrl ? (
                <img
                  src={state.pendingActionConsent.previewDataUrl}
                  alt={t('browserUseTargetPreview')}
                  className="mt-3 max-h-56 w-full rounded-lg border border-ds-border-muted object-contain"
                />
              ) : null}
              <dl className="mt-3 grid grid-cols-[6rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-[11px]">
                <dt className="text-ds-faint">{t('browserUseAction')}</dt>
                <dd className="font-semibold text-ds-ink">{state.pendingActionConsent.action}</dd>
                <dt className="text-ds-faint">{t('browserUseTarget')}</dt>
                <dd className="break-words text-ds-ink">
                  {state.pendingActionConsent.targetRole}: {state.pendingActionConsent.targetName}
                </dd>
                <dt className="text-ds-faint">{t('browserUseOrigin')}</dt>
                <dd className="break-all text-ds-ink">{state.pendingActionConsent.origin}</dd>
                {state.pendingActionConsent.textPreview !== undefined ? (
                  <>
                    <dt className="text-ds-faint">{t('browserUseText')}</dt>
                    <dd className="break-words rounded bg-ds-surface-subtle px-2 py-1 text-ds-ink">
                      {state.pendingActionConsent.textPreview}
                    </dd>
                  </>
                ) : null}
              </dl>
              <p className="mt-3 text-[10.5px] leading-5 text-ds-muted">
                {t('browserUseActionConsentBody')}
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <ConsentButton onClick={() => decideAction('deny')}>
                  {t('browserUseDeny')}
                </ConsentButton>
                <ConsentButton primary onClick={() => decideAction('allow-once')}>
                  {t('browserUseAllowOnce')}
                </ConsentButton>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  )
}

function BrowserEmptyState({
  icon,
  title,
  body,
  action
}: {
  icon: 'alert' | 'loading' | 'ready'
  title: string
  body: string
  action?: ReactElement
}): ReactElement {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
      {icon === 'loading'
        ? <Loader2 className="h-10 w-10 animate-spin text-ds-accent motion-reduce:animate-none" />
        : icon === 'alert'
          ? <ShieldAlert className="h-12 w-12 text-red-500" />
          : <ShieldCheck className="h-12 w-12 text-ds-faint" />}
      <div className="mt-4 text-[13px] font-semibold text-ds-ink">{title}</div>
      <div className="mt-2 max-w-sm text-[11px] leading-5 text-ds-muted">{body}</div>
      {action}
    </div>
  )
}

function ConsentButton({
  children,
  primary = false,
  onClick
}: {
  children: string
  primary?: boolean
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-8 items-center rounded-lg px-3 text-[11px] font-semibold transition ${
        primary
          ? 'bg-accent text-white hover:brightness-105'
          : 'border border-ds-border-muted bg-ds-surface-subtle text-ds-muted hover:text-ds-ink'
      }`}
    >
      {children}
    </button>
  )
}

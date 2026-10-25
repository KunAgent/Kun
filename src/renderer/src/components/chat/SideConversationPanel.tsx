import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import {
  ArrowDownToLine,
  ChevronDown,
  MessageCircleMore,
  Minus,
  MoreHorizontal,
  Plus,
  Trash2,
  X
} from 'lucide-react'
import { useChatStore } from '../../store/chat-store'
import type { KunToolPermissionMode } from '@shared/app-settings'
import { useHarnessStore } from '../../store/harness-store'
import { nativePermissionPreview } from '../../lib/harness-native-permission'
import { FloatingComposer } from './FloatingComposer'
import { useSideConversationQuotes } from './use-side-conversation-quotes'
import { useSideComposerControls } from './use-side-composer-controls'
import { useSideConversationComposerConfig } from './use-side-conversation-composer-config'
import { useSideConversationAttachments } from './use-side-conversation-attachments'

type Props = {
  className?: string
  rightOffset?: number
  variant?: 'floating' | 'docked'
  attachmentStoreAvailable?: boolean
  defaultModelSupportsImageInput?: boolean
  onRequestClose?: () => void
  onTitleChange?: (title: string) => void
}

export { activeSideConversationOrdinal } from './SideConversationTimeline'
import {
  activeSideConversationOrdinal,
  EMPTY_QUEUED_MESSAGES,
  SideConversationTimeline,
  formatInheritedTime,
  noop,
  overlayStyle
} from './SideConversationTimeline'

export function SideConversationPanel({
  className,
  rightOffset = 24,
  variant = 'floating',
  attachmentStoreAvailable = false,
  defaultModelSupportsImageInput = false,
  onRequestClose,
  onTitleChange
}: Props): ReactElement | null {
  const { t, i18n } = useTranslation('common')
  const [draftInput, setDraftInput] = useState('')
  const [preparingSend, setPreparingSend] = useState(false)
  const sendPending = useRef(false)
  const [minimized, setMinimized] = useState(false)
  const [switchMenuOpen, setSwitchMenuOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const switchMenuRef = useRef<HTMLDivElement | null>(null)
  const moreMenuRef = useRef<HTMLDivElement | null>(null)
  const previousParentRef = useRef<string | null>(null)
  const previousActiveRef = useRef<string | null | undefined>(undefined)

  const sideData = useChatStore(
    useShallow((s) => ({
      sides: s.sideConversations,
      panel: s.sidePanel,
      parentThreadId: s.activeThreadId,
      threads: s.threads,
      workspaceRoot: s.workspaceRoot,
      runtimeConnection: s.runtimeConnection,
      composerPickList: s.composerPickList,
      composerModelGroups: s.composerModelGroups,
      composerExecutionSettings: s.composerExecutionSettings,
      spawnSideConversation: s.spawnSideConversation,
      sendSideMessage: s.sendSideMessage,
      interruptSide: s.interruptSide,
      resolveSideUserInput: s.resolveSideUserInput,
      setSideInput: s.setSideInput,
      selectSideConversation: s.selectSideConversation,
      setSidePanelOpen: s.setSidePanelOpen,
      openSideConversationDraft: s.openSideConversationDraft,
      discardSideConversation: s.discardSideConversation,
      promoteSideConversation: s.promoteSideConversation
    }))
  )
  const openSettings = useChatStore((s) => s.openSettings)

  const currentSides = useMemo(
    () =>
      Object.values(sideData.sides)
        .filter((side) => side.parentThreadId === sideData.parentThreadId)
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    [sideData.parentThreadId, sideData.sides]
  )
  const sideIds = currentSides.map((side) => side.threadId)
  const activeId =
    sideData.panel.activeSideId && sideIds.includes(sideData.panel.activeSideId)
      ? sideData.panel.activeSideId
      : null
  const activeSide = activeId ? sideData.sides[activeId] : null
  const canSwitchSide = activeSide ? currentSides.length > 1 : currentSides.length > 0
  const parentThread = sideData.parentThreadId
    ? sideData.threads.find((thread) => thread.id === sideData.parentThreadId) ?? null
    : null
  const docked = variant === 'docked'
  const shouldRender = Boolean(sideData.parentThreadId && (docked || sideData.panel.open))
  const runtimeReady = sideData.runtimeConnection === 'ready'
  const attachmentWorkspace = (parentThread?.workspace || sideData.workspaceRoot).trim()
  const sideQuotes = useSideConversationQuotes({
    parentThreadId: sideData.parentThreadId,
    activeSideId: activeSide?.threadId ?? null,
    workspaceRoot: attachmentWorkspace
  })

  const composerConfig = useSideConversationComposerConfig({
    parentThreadId: sideData.parentThreadId,
    activeSide
  })
  const sideControls = useSideComposerControls({
    ...composerConfig.config,
    enabled: shouldRender && runtimeReady,
    threadId: activeSide?.threadId ?? null,
    workspaceRoot: attachmentWorkspace,
    harnessId: composerConfig.config.harnessId,
    credentialMode: composerConfig.config.credentialMode,
    gatewayBinding: composerConfig.config.gatewayBinding,
    model: composerConfig.config.model,
    providerId: composerConfig.config.providerId,
    hasUserMessages: Boolean(activeSide),
    onApply: composerConfig.apply
  })
  const attachments = useSideConversationAttachments({
    attachmentStoreAvailable, attachmentWorkspace, runtimeReady, activeSide,
    model: composerConfig.config.model,
    providerId: sideControls.modelProviderId,
    modelGroups: sideControls.modelGroups,
    defaultModelSupportsImageInput, t
  })

  const showDraft = shouldRender && !activeSide
  const ordinal = activeSideConversationOrdinal(currentSides, activeId)
  const reportedTitle = activeSide
    ? t('sidePanelTabTitle', { index: ordinal })
    : t('sidePanelNewTabTitle')

  const resetDraftState = (): void => {
    setDraftInput('')
    composerConfig.resetDraft()
    attachments.resetDraftAttachments()
  }

  useEffect(() => {
    if (previousParentRef.current === sideData.parentThreadId) return
    previousParentRef.current = sideData.parentThreadId
    setDraftInput('')
    composerConfig.resetDraft()
    attachments.resetDraftAttachments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideData.parentThreadId])

  useEffect(() => {
    const previous = previousActiveRef.current
    previousActiveRef.current = activeId
    if (!showDraft || previous === undefined || previous === null) return
    setDraftInput('')
    composerConfig.resetDraft()
    attachments.resetDraftAttachments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, showDraft])

  useEffect(() => {
    attachments.clearUploadError()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  useEffect(() => {
    onTitleChange?.(reportedTitle)
  }, [onTitleChange, reportedTitle])

  useEffect(() => {
    if (!shouldRender) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setSwitchMenuOpen(false)
      setMoreMenuOpen(false)
      if (!docked) setMinimized(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [docked, shouldRender])

  useEffect(() => {
    if (!switchMenuOpen && !moreMenuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (
        target instanceof Node &&
        (switchMenuRef.current?.contains(target) || moreMenuRef.current?.contains(target))
      ) {
        return
      }
      setSwitchMenuOpen(false)
      setMoreMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [switchMenuOpen, moreMenuOpen])

  if (!shouldRender) return null

  const rightStyle = overlayStyle(rightOffset)
  const parentTitle = parentThread?.title?.trim() || t('sidePanelParentMissing')
  const originLabel = activeSide
    ? t('sidePanelOriginMeta', {
        title: parentTitle,
        time: formatInheritedTime(activeSide.inheritedAt, i18n.language)
      })
    : t('sidePanelDraftOrigin', { title: parentTitle })

  const closeWindow = (): void => {
    setMinimized(false)
    setSwitchMenuOpen(false)
    setMoreMenuOpen(false)
    sideData.setSidePanelOpen(false)
    onRequestClose?.()
  }

  const sendDraft = (): void => {
    const text = draftInput.trim()
    if (sendPending.current || !sideControls.selectionReady) return
    if (!text && attachments.attachments.length === 0) return
    const config = structuredClone(composerConfig.config)
    sendPending.current = true
    setPreparingSend(true)
    void (async () => {
      try {
      const quoted = await sideQuotes.prepareSend()
      if (useChatStore.getState().activeThreadId !== sideData.parentThreadId || useChatStore.getState().sidePanel.activeSideId !== null) return
      const sideId = await sideData.spawnSideConversation(text, {
        harnessId: config.harnessId,
        credentialMode: config.credentialMode,
        gatewayBinding: config.gatewayBinding,
        ...(config.approvalPolicy ? { approvalPolicy: config.approvalPolicy } : {}),
        ...(config.sandboxMode ? { sandboxMode: config.sandboxMode } : {}),
        ...(config.approvalReviewer ? { approvalReviewer: config.approvalReviewer } : {}),
        model: config.model,
        providerId: config.providerId,
        reasoningEffort: config.reasoningEffort,
        fastMode: config.fastMode,
        attachments: attachments.attachments,
        ...(quoted ? { composerContexts: quoted.composerContexts } : {})
      })
      if (!sideId) return
      if (useChatStore.getState().sideConversations[sideId]?.error) return
      quoted?.consume()
      setDraftInput('')
      attachments.resetDraftAttachments()
      } catch (error) {
        attachments.reportError(error instanceof Error ? error.message : String(error))
      } finally {
        sendPending.current = false
        setPreparingSend(false)
      }
    })()
  }

  const sendActiveSide = (): void => {
    if (!activeSide || !composerConfig.editable || sendPending.current || !sideControls.selectionReady) return
    const { threadId, input } = activeSide
    const config = structuredClone(composerConfig.config)
    sendPending.current = true
    setPreparingSend(true)
    void (async () => {
      try {
        const quoted = await sideQuotes.prepareSend()
        const sent = await sideData.sendSideMessage(threadId, input, {
          config,
          ...(quoted ? { composerContexts: quoted.composerContexts } : {})
        })
        if (sent) quoted?.consume()
      } catch (error) {
        attachments.reportError(error instanceof Error ? error.message : String(error))
      } finally {
        sendPending.current = false
        setPreparingSend(false)
      }
    })()
  }

  const discardActiveSide = (): void => {
    if (!activeSide) return
    setMoreMenuOpen(false)
    void sideData.discardSideConversation(activeSide.threadId)
  }

  const promoteActiveSide = (): void => {
    if (!activeSide) return
    setMoreMenuOpen(false)
    void sideData.promoteSideConversation(activeSide.threadId)
  }

  if (minimized && !docked) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        className={`ds-side-chat-mini ds-no-drag fixed bottom-[112px] z-40 flex h-11 items-center gap-2 rounded-full border border-ds-border-muted bg-ds-card/94 px-3 text-ds-muted shadow-[0_16px_42px_rgba(20,47,95,0.18)] backdrop-blur-xl transition hover:bg-ds-card hover:text-ds-ink ${className ?? ''}`}
        style={rightStyle}
        aria-label={t('sidePanelExpand')}
        title={t('sidePanelExpand')}
      >
        <MessageCircleMore className="h-4 w-4" strokeWidth={1.85} />
        <span className="text-[12px] font-semibold">{Math.max(sideIds.length, 1)}</span>
      </button>
    )
  }

  const config = composerConfig.config
  const approvalPolicy = config.approvalPolicy
  const sandboxMode = config.sandboxMode
  const approvalReviewer = config.approvalReviewer
  const executionSettings = approvalPolicy && sandboxMode && approvalReviewer
    ? { approvalPolicy, sandboxMode, approvalReviewer }
    : null
  const externalAgentId = sideControls.isExternalAgent ? sideControls.harnessId : ''
  const agentPermission = externalAgentId ? {
    agentName: sideControls.harnessLabel,
    preview: (mode: KunToolPermissionMode) => nativePermissionPreview(
      externalAgentId,
      sideControls.permissionModes,
      mode,
      undefined,
      sideControls.transport
    )
  } : undefined
  const composerModelGroups = sideControls.modelGroups ?? sideData.composerModelGroups
  const composerPickList = sideControls.pickList ?? sideData.composerPickList
  const configLocked = !composerConfig.editable || preparingSend

  return (
    <aside
      className={`ds-side-chat ds-sidebar-surface ds-no-drag flex flex-col overflow-hidden text-ds-ink ${
        docked
          ? 'h-full min-h-0 w-full'
          : 'fixed bottom-[112px] z-40 max-h-[min(680px,calc(100vh-156px))] w-[min(520px,calc(100vw-24px))] rounded-[16px] border border-ds-border shadow-[0_22px_64px_rgba(20,47,95,0.2)] dark:shadow-[0_24px_72px_rgba(0,0,0,0.46)]'
      } ${className ?? ''}`}
      style={docked ? undefined : rightStyle}
      aria-label={t('sidePanelTitle')}
    >
      <div className="ds-sidebar-surface-chrome flex h-10 shrink-0 items-center gap-2 border-b border-ds-border-muted px-3">
        <div ref={switchMenuRef} className="relative min-w-0 flex-1">
          <button
            type="button"
            onClick={() => canSwitchSide && setSwitchMenuOpen((open) => !open)}
            disabled={!canSwitchSide}
            className="flex max-w-full items-center gap-1.5 rounded-md text-left text-[11.5px] text-ds-faint transition enabled:hover:text-ds-ink"
            aria-label={t('sidePanelSwitch')}
            aria-expanded={switchMenuOpen}
            title={originLabel}
          >
            <span className="min-w-0 truncate">{originLabel}</span>
            {canSwitchSide ? (
              <ChevronDown className="h-3 w-3 shrink-0" strokeWidth={1.9} />
            ) : null}
          </button>

          {switchMenuOpen ? (
            <div className="absolute left-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-[12px] border border-ds-border bg-ds-card/98 p-1 shadow-[0_18px_46px_rgba(20,47,95,0.18)] backdrop-blur-xl">
              {currentSides.map((side, index) => {
                const selected = side.threadId === activeSide?.threadId
                return (
                  <button
                    key={side.threadId}
                    type="button"
                    onClick={() => {
                      sideData.selectSideConversation(side.threadId)
                      setSwitchMenuOpen(false)
                    }}
                    className={`flex min-h-[38px] w-full items-center gap-2 rounded-lg px-2 text-left transition ${
                      selected
                        ? 'bg-ds-hover text-ds-ink'
                        : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                    }`}
                  >
                    <MessageCircleMore className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium">
                        {t('sidePanelTabTitle', { index: index + 1 })}
                      </span>
                      <span className="block truncate text-[10.5px] text-ds-faint" title={side.title}>
                        {side.title}
                      </span>
                    </span>
                    {side.busy ? (
                      <span
                        className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500"
                        aria-label={t('sidePanelRunningDot')}
                      />
                    ) : null}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>

        {!docked ? (
          <button
            type="button"
            onClick={() => {
              sideData.openSideConversationDraft()
              resetDraftState()
            }}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('sidePanelNew')}
            title={t('sidePanelNew')}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />
          </button>
        ) : null}

        <div ref={moreMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setMoreMenuOpen((open) => !open)}
            disabled={!activeSide}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-35"
            aria-label={t('sidePanelMore')}
            title={t('sidePanelMore')}
            aria-expanded={moreMenuOpen}
          >
            <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.9} />
          </button>
          {moreMenuOpen && activeSide ? (
            <div className="absolute right-0 top-full z-50 mt-2 w-48 overflow-hidden rounded-[12px] border border-ds-border bg-ds-card/98 p-1 text-[12.5px] shadow-[0_18px_46px_rgba(20,47,95,0.18)] backdrop-blur-xl">
              <button
                type="button"
                onClick={promoteActiveSide}
                className="flex min-h-[34px] w-full items-center gap-2 rounded-lg px-2 text-left text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
              >
                <ArrowDownToLine className="h-3.5 w-3.5" strokeWidth={1.8} />
                <span className="min-w-0 flex-1 truncate">{t('sidePanelPromote')}</span>
              </button>
              <button
                type="button"
                onClick={discardActiveSide}
                className="flex min-h-[34px] w-full items-center gap-2 rounded-lg px-2 text-left text-red-600 transition hover:bg-red-500/10 dark:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                <span className="min-w-0 flex-1 truncate">{t('sidePanelDiscard')}</span>
              </button>
            </div>
          ) : null}
        </div>

        {!docked ? (
          <>
            <button
              type="button"
              onClick={() => setMinimized(true)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
              aria-label={t('sidePanelMinimize')}
              title={t('sidePanelMinimize')}
            >
              <Minus className="h-3.5 w-3.5" strokeWidth={1.9} />
            </button>
            <button
              type="button"
              onClick={closeWindow}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
              aria-label={t('sidePanelHide')}
              title={t('sidePanelHide')}
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.9} />
            </button>
          </>
        ) : null}
      </div>

      {activeSide ? (
        <SideConversationTimeline side={activeSide} workspaceRoot={sideData.workspaceRoot} />
      ) : (
        <div className="ds-sidebar-surface-body flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-8 text-center text-[12.5px] leading-5 text-ds-faint">
          <MessageCircleMore className="h-5 w-5 opacity-65" strokeWidth={1.7} />
          <p>{t('sidePanelDraftEmpty')}</p>
        </div>
      )}

      <footer className="ds-sidebar-surface-chrome shrink-0 px-3 pb-3 pt-2">
        <FloatingComposer
          variant="side"
          workspaceRootOverride={sideData.workspaceRoot}
          activeThreadIdOverride={activeSide?.threadId ?? null}
          userInputBlocksOverride={activeSide?.blocks ?? []}
          onResolveUserInput={async (blockId, action) => {
            if (!activeSide) return
            await sideData.resolveSideUserInput(activeSide.threadId, blockId, action)
          }}
          input={activeSide?.input ?? draftInput}
          setInput={(value) => {
            if (activeSide) sideData.setSideInput(activeSide.threadId, value)
            else setDraftInput(value)
          }}
          mode="agent"
          setMode={noop}
          busy={activeSide?.busy ?? false}
          disabled={preparingSend || activeSide?.submitting === true}
          runtimeReady={runtimeReady}
          hasActiveThread={Boolean(sideData.parentThreadId)}
          composerModel={config.model}
          composerProviderId={sideControls.modelProviderId}
          composerPickList={composerPickList}
          composerModelGroups={composerModelGroups}
          composerReasoningEffort={config.reasoningEffort}
          composerFastMode={config.fastMode}
          attachments={attachments.attachments}
          contextChips={sideQuotes.contextChips}
          onRemoveContextChip={sideQuotes.removeQuote}
          attachmentUploadEnabled={attachments.uploadEnabled}
          attachmentUploadBusy={attachments.uploadBusy}
          attachmentUploadError={attachments.uploadError}
          onPickAttachments={(files) => void attachments.pickImages(files)}
          onPasteClipboardImage={attachments.pasteClipboardImage}
          onPasteLongText={attachments.pasteLongText}
          onRemoveAttachment={attachments.removeAttachment}
          modelControlVariant="split"
          executionSettings={executionSettings}
          onExecutionSettingsChange={composerConfig.apply}
          sideAgentControls={{
            contextKey: activeSide?.threadId ?? `draft:${sideData.parentThreadId}`,
            selectionReady: sideControls.selectionReady,
            credentialMode: config.credentialMode,
            modelsLoading: sideControls.modelsLoading,
            nativeProfileReady: sideControls.nativeProfileReady,
            modelsError: sideControls.modelsError,
            rows: sideControls.rows,
            loading: sideControls.rowsLoading,
            harnessId: sideControls.harnessId,
            harnessLabel: sideControls.harnessLabel,
            needsConfirm: sideControls.needsConfirm,
            onSelect: (harnessId) => sideControls.selectHarness(harnessId),
            onOpen: sideControls.refreshRows,
            onManage: (harnessId, configureProvider) => {
              if (configureProvider) {
                openSettings('providers')
                return
              }
              useHarnessStore.setState({ settingsHarnessId: harnessId ?? sideControls.harnessId })
              openSettings('agentsHarnesses')
            },
            ...(agentPermission ? { agentPermission } : {}),
            disabled: configLocked || !runtimeReady
          }}
          onComposerModelChange={(nextModel, nextProviderId) => {
            if (sideControls.onModelChange) {
              sideControls.onModelChange(nextModel, nextProviderId)
              return
            }
            composerConfig.apply({
              model: nextModel,
              providerId: nextProviderId?.trim() ?? ''
            })
          }}
          onComposerReasoningEffortChange={(effort) => {
            composerConfig.apply({ reasoningEffort: effort })
          }}
          onComposerFastModeChange={(enabled) => {
            composerConfig.apply({ fastMode: enabled })
          }}
          queuedMessages={EMPTY_QUEUED_MESSAGES}
          onRemoveQueuedMessage={noop}
          onSend={activeSide ? sendActiveSide : sendDraft}
          onInterrupt={() => {
            if (activeSide) void sideData.interruptSide(activeSide.threadId)
          }}
          hideBtwCommand
        />
        <p className="px-2 pt-2 text-[11px] text-ds-muted" role="status">
          {t(configLocked ? 'sideComposerLocked' : !sideControls.selectionReady ? 'sideComposerUnavailable' : 'sideComposerScope')}
        </p>
      </footer>
    </aside>
  )
}

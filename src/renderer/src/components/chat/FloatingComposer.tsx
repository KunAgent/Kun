import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  Archive,
  BarChart3,
  Bot,
  ChevronDown,
  Clock3,
  GitFork,
  Gauge,
  ListTodo,
  Minimize2,
  RotateCcw,
  Send,
  Square,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chat-store'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'
import {
  formatCompactNumber,
  formatCost,
  formatPercent,
  useThreadUsageState
} from '../../hooks/use-thread-usage'
import { GitBranchPicker } from './GitBranchPicker'

type QueuedComposerMessage = {
  id: string
  text: string
}

type Props = {
  variant?: 'default' | 'compact'
  workspaceRootOverride?: string
  input: string
  setInput: (v: string) => void
  mode: 'plan' | 'agent'
  setMode: (m: 'plan' | 'agent') => void
  busy: boolean
  runtimeReady: boolean
  hasActiveThread: boolean
  composerModel: string
  composerPickList: string[]
  onComposerModelChange: (modelId: string) => void
  hideModelPicker?: boolean
  modelPickerMode?: 'select' | 'combobox'
  queuedMessages: QueuedComposerMessage[]
  onRemoveQueuedMessage: (id: string) => void
  onSend: () => void
  onInterrupt: () => void
  onOpenRuntimePanel?: () => void
}

type SlashCommandId = 'plan' | 'agent' | 'compact' | 'fork' | 'archive' | 'restore' | 'runtime' | 'usage'

type SlashCommand = {
  id: SlashCommandId
  title: string
  description: string
  keywords: string[]
  icon: ReactElement
  disabled?: boolean
}

function getSlashQuery(input: string): string | null {
  const trimmed = input.trimStart()
  if (!trimmed.startsWith('/')) return null
  if (/\s/.test(trimmed)) return null
  return trimmed.slice(1).toLowerCase()
}

export function FloatingComposer({
  variant = 'default',
  workspaceRootOverride,
  input,
  setInput,
  mode,
  setMode,
  busy,
  runtimeReady,
  hasActiveThread,
  composerModel,
  composerPickList,
  onComposerModelChange,
  hideModelPicker = false,
  modelPickerMode = 'select',
  queuedMessages,
  onRemoveQueuedMessage,
  onSend,
  onInterrupt,
  onOpenRuntimePanel
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const route = useChatStore((s) => s.route)
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const threads = useChatStore((s) => s.threads)
  const compactActiveThread = useChatStore((s) => s.compactActiveThread)
  const forkActiveThread = useChatStore((s) => s.forkActiveThread)
  const archiveThread = useChatStore((s) => s.archiveThread)
  const clawChannels = useChatStore((s) => s.clawChannels)
  const activeClawChannelId = useChatStore((s) => s.activeClawChannelId)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const composingRef = useRef(false)
  const [focused, setFocused] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const compact = variant === 'compact'
  const modelPickerRef = useRef<HTMLElement | null>(null)
  const activeClawChannel = useMemo(
    () => clawChannels.find((channel) => channel.id === activeClawChannelId) ?? null,
    [activeClawChannelId, clawChannels]
  )
  const activeThreadWorkspace = activeThreadId
    ? threads.find((thread) => thread.id === activeThreadId)?.workspace
    : ''
  const activeThread = activeThreadId
    ? threads.find((thread) => thread.id === activeThreadId) ?? null
    : null
  const activeThreadArchived = activeThread?.archived === true
  const showThreadUsageFooter = !compact && route === 'chat' && Boolean(activeThreadId) && runtimeReady
  const threadUsageState = useThreadUsageState(
    activeThreadId,
    showThreadUsageFooter,
    `${activeThread?.updatedAt ?? ''}:${busy ? 'busy' : 'idle'}`
  )
  const threadUsage = threadUsageState.usage
  const effectiveWorkspaceRoot = normalizeWorkspaceRoot(activeThreadWorkspace || workspaceRootOverride || workspaceRoot)
  const clawAgentName =
    activeClawChannel?.agentProfile.name.trim()
    || activeClawChannel?.label.trim()
    || t('clawEmptyHeroFallbackName')
  const clawHasInboundConversation = Boolean(
    activeClawChannel?.conversations.length || activeClawChannel?.remoteSession?.chatId?.trim()
  )

  const canCompose = runtimeReady && (
    route === 'claw'
      ? clawHasInboundConversation
      : (hasActiveThread || !!effectiveWorkspaceRoot)
  )
  const canChangeModel = canCompose && !busy
  const canSend = canCompose && input.trim().length > 0
  const slashQuery = getSlashQuery(input)
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const modelOptions = useMemo(() => {
    const ordered = new Set<string>()
    for (const id of composerPickList) {
      const normalized = id.trim()
      if (normalized) ordered.add(normalized)
    }
    const current = composerModel.trim()
    if (current) ordered.add(current)
    return [...ordered]
  }, [composerModel, composerPickList])
  const placeholder = !runtimeReady
    ? t('runtimeActionNeedsConnection')
    : !hasActiveThread && !effectiveWorkspaceRoot
      ? t('workspaceRequiredToCreateThread')
      : busy
        ? t('composerQueuePlaceholder')
        : mode === 'plan'
        ? t('composerPlanPlaceholder')
        : route === 'claw'
            ? clawHasInboundConversation
              ? t('clawPlaceholder', { name: clawAgentName })
              : t('clawPlaceholderNeedsInbound')
            : hasActiveThread
            ? t('placeholder')
            : t('composerStartsThread')
  const footerHint = !runtimeReady
    ? t('composerOfflineHint')
    : !hasActiveThread && !effectiveWorkspaceRoot
      ? t('composerWorkspaceHint')
      : mode === 'plan'
        ? t('planModeActiveHint')
        : route === 'claw'
          ? clawHasInboundConversation
            ? t('clawComposerHint')
            : t('clawComposerHintNeedsInbound')
          : t('composerSlashHint')
  const slashCommands = useMemo<SlashCommand[]>(() => {
    const threadActionDisabled = !runtimeReady || busy || !activeThreadId
    const commands: SlashCommand[] = [
      {
        id: 'plan',
        title: t('slashCommandPlanTitle'),
        description:
          mode === 'plan'
            ? t('slashCommandPlanActiveDescription')
            : t('slashCommandPlanDescription'),
        keywords: ['plan', 'planner', 'planning', '规划', '计划'],
        icon: <ListTodo className="h-4 w-4" strokeWidth={1.9} />
      }
    ]

    if (mode === 'plan') {
      commands.splice(1, 0, {
        id: 'agent',
        title: t('slashCommandAgentTitle'),
        description: t('slashCommandAgentDescription'),
        keywords: ['agent', 'default', 'normal', '代理', '默认'],
        icon: <Bot className="h-4 w-4" strokeWidth={1.9} />
      })
    }

    if (route !== 'claw') {
      commands.push(
        {
          id: 'compact',
          title: t('slashCommandCompactTitle'),
          description: t('slashCommandCompactDescription'),
          keywords: ['compact', 'summarize', 'compress', '压缩', '总结'],
          icon: <Minimize2 className="h-4 w-4" strokeWidth={1.9} />,
          disabled: threadActionDisabled
        },
        {
          id: 'fork',
          title: t('slashCommandForkTitle'),
          description: t('slashCommandForkDescription'),
          keywords: ['fork', 'branch', 'copy', '分叉', '复制'],
          icon: <GitFork className="h-4 w-4" strokeWidth={1.9} />,
          disabled: threadActionDisabled
        }
      )

      if (activeThreadArchived) {
        commands.push({
          id: 'restore',
          title: t('slashCommandRestoreTitle'),
          description: t('slashCommandRestoreDescription'),
          keywords: ['restore', 'unarchive', '恢复'],
          icon: <RotateCcw className="h-4 w-4" strokeWidth={1.9} />,
          disabled: threadActionDisabled
        })
      } else {
        commands.push({
          id: 'archive',
          title: t('slashCommandArchiveTitle'),
          description: t('slashCommandArchiveDescription'),
          keywords: ['archive', 'hide', '归档'],
          icon: <Archive className="h-4 w-4" strokeWidth={1.9} />,
          disabled: threadActionDisabled
        })
      }
    }

    commands.push(
      {
        id: 'usage',
        title: t('slashCommandUsageTitle'),
        description: t('slashCommandUsageDescription'),
        keywords: ['usage', 'cost', 'tokens', '用量', '费用'],
        icon: <BarChart3 className="h-4 w-4" strokeWidth={1.9} />,
        disabled: !onOpenRuntimePanel
      },
      {
        id: 'runtime',
        title: t('slashCommandRuntimeTitle'),
        description: t('slashCommandRuntimeDescription'),
        keywords: ['runtime', 'status', 'tasks', 'mcp', '运行时'],
        icon: <Gauge className="h-4 w-4" strokeWidth={1.9} />,
        disabled: !onOpenRuntimePanel
      }
    )

    return commands
  }, [activeThreadArchived, activeThreadId, busy, mode, onOpenRuntimePanel, route, runtimeReady, t])

  const filteredSlashCommands = useMemo(() => {
    if (slashQuery == null) return []
    if (!slashQuery) return slashCommands
    return slashCommands.filter((command) => {
      const haystack = [command.id, command.title, command.description, ...command.keywords]
      return haystack.some((part) => part.toLowerCase().includes(slashQuery))
    })
  }, [slashCommands, slashQuery])

  const highlightedSlashCommand =
    filteredSlashCommands.length > 0
      ? filteredSlashCommands[Math.min(selectedCommandIndex, filteredSlashCommands.length - 1)]
      : null
  const primaryActionLabel = highlightedSlashCommand
    ? t('slashCommandApply')
    : busy
      ? t('queueMessage')
      : t('send')
  const primaryActionDisabled = highlightedSlashCommand
    ? highlightedSlashCommand.disabled === true
    : !canSend

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return

    el.style.height = '0px'
    const nextHeight = Math.min(el.scrollHeight, 176)
    const minHeight = 44
    el.style.height = `${Math.max(nextHeight, minHeight)}px`
    el.style.overflowY = el.scrollHeight > 176 ? 'auto' : 'hidden'
  }, [])

  useLayoutEffect(() => {
    resizeTextarea()
  }, [canCompose, input, resizeTextarea])

  useEffect(() => {
    const el = textareaRef.current
    if (!el || typeof ResizeObserver === 'undefined') return

    let frame = 0
    let previousWidth = el.getBoundingClientRect().width
    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = entry?.contentRect.width ?? el.getBoundingClientRect().width
      if (Math.abs(nextWidth - previousWidth) < 0.5) return
      previousWidth = nextWidth
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(resizeTextarea)
    })

    observer.observe(el)

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [resizeTextarea])

  useEffect(() => {
    setSelectedCommandIndex(0)
  }, [slashQuery])

  useEffect(() => {
    if (!modelMenuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (modelPickerRef.current?.contains(target)) return
      setModelMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [modelMenuOpen])

  const focusComposer = (): void => {
    window.requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const applySlashCommand = (commandId: SlashCommandId): void => {
    if (commandId === 'plan') {
      setMode('plan')
      setInput('')
      focusComposer()
      return
    }
    if (commandId === 'agent') {
      setMode('agent')
      setInput('')
      focusComposer()
      return
    }
    if (commandId === 'compact') {
      setInput('')
      void compactActiveThread()
      focusComposer()
      return
    }
    if (commandId === 'fork') {
      setInput('')
      void forkActiveThread()
      focusComposer()
      return
    }
    if (commandId === 'archive' && activeThreadId) {
      setInput('')
      void archiveThread(activeThreadId, true)
      focusComposer()
      return
    }
    if (commandId === 'restore' && activeThreadId) {
      setInput('')
      void archiveThread(activeThreadId, false)
      focusComposer()
      return
    }
    if (commandId === 'runtime' || commandId === 'usage') {
      setInput('')
      onOpenRuntimePanel?.()
      focusComposer()
      return
    }
  }

  const handlePrimaryAction = (): void => {
    if (highlightedSlashCommand) {
      if (highlightedSlashCommand.disabled) return
      applySlashCommand(highlightedSlashCommand.id)
      return
    }
    onSend()
  }

  return (
    <div className={compact
      ? 'ds-floating-composer pointer-events-auto w-full pb-0 pt-0'
      : 'ds-floating-composer ds-chat-column-inset pointer-events-auto w-full max-w-4xl pb-5 pt-1'}
    >
      {queuedMessages.length > 0 ? (
        <div className="mb-2 rounded-[22px] border border-ds-border bg-ds-card/88 px-4 py-3 shadow-sm backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center gap-2 text-[13px] font-medium text-ds-ink">
              <Clock3 className="h-3.5 w-3.5 text-ds-muted" strokeWidth={1.9} />
              <span>{t('queuedMessagesTitle', { count: queuedMessages.length })}</span>
            </div>
            <div className="text-[12px] text-ds-muted">{t('queuedMessagesHint')}</div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {queuedMessages.map((message, index) => (
              <div
                key={message.id}
                className="flex min-w-0 max-w-full items-center gap-2 rounded-full border border-ds-border-muted bg-ds-main/80 px-3 py-1.5 text-[13px] text-ds-ink"
              >
                <span className="shrink-0 text-ds-faint">{index + 1}.</span>
                <span className="max-w-[360px] truncate">{message.text}</span>
                <button
                  type="button"
                  onClick={() => onRemoveQueuedMessage(message.id)}
                  className="shrink-0 rounded-full p-0.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                  aria-label={t('queuedMessageRemove')}
                  title={t('queuedMessageRemove')}
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="relative">
        {slashQuery != null ? (
          <div className="ds-card-strong absolute inset-x-2 bottom-full z-30 mb-3 overflow-hidden rounded-[26px] p-2 shadow-[0_26px_70px_rgba(15,23,42,0.16)]">
            <div className="px-3 pb-2 pt-1 text-[12px] font-medium uppercase tracking-[0.14em] text-ds-faint">
              {t('slashCommandMenuTitle')}
            </div>
            {filteredSlashCommands.length > 0 ? (
              <div className="flex flex-col gap-1">
                {filteredSlashCommands.map((command) => {
                  const active = highlightedSlashCommand?.id === command.id
                  return (
                    <button
                      key={command.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applySlashCommand(command.id)}
                      disabled={command.disabled}
                      className={`flex w-full items-center gap-3 rounded-[20px] px-3 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${
                        active && !command.disabled
                          ? 'bg-accent/10 text-ds-ink shadow-[inset_0_0_0_1px_rgba(0,136,255,0.14)]'
                          : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:hover:bg-transparent disabled:hover:text-ds-muted'
                      }`}
                    >
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ${
                          active && !command.disabled ? 'bg-accent/12 text-accent' : 'bg-ds-hover text-ds-muted'
                        }`}
                      >
                        {command.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-semibold text-inherit">
                          {command.title}
                        </span>
                        <span className="mt-0.5 block text-[13px] leading-5 text-ds-faint">
                          {command.description}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span className="rounded-full border border-ds-border-muted px-2.5 py-1 text-[11px] font-semibold text-ds-faint">
                          /{command.id}
                        </span>
                        {command.id === 'plan' && mode === 'plan' ? (
                          <span className="rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-semibold text-accent">
                            {t('slashCommandCurrent')}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-[20px] border border-dashed border-ds-border-muted px-4 py-5 text-[13px] text-ds-faint">
                {t('slashCommandEmpty')}
              </div>
            )}
          </div>
        ) : null}

        <div
          className={`ds-composer-shell ds-chat-composer ds-frosted flex flex-col gap-2 px-4 py-2.5 transition ${
            focused ? 'ds-chat-composer-focus' : ''
          } ${compact ? 'rounded-[24px] px-3 py-2 shadow-none' : ''}`}
        >
          {mode === 'plan' ? (
            <div className="flex items-center gap-2 px-1 pt-1">
              <button
                type="button"
                onClick={() => setMode('agent')}
                className="ds-chip-active ds-no-drag inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-semibold text-ds-ink transition hover:brightness-105"
                title={t('removePlan')}
                aria-label={t('removePlan')}
              >
                <ListTodo className="h-3.5 w-3.5 text-accent" strokeWidth={2} />
                <span>{t('planMode')}</span>
              </button>
            </div>
          ) : null}

          <div className="flex items-end gap-3">
            <textarea
              ref={textareaRef}
              rows={1}
              className={`ds-no-drag block min-w-0 flex-1 resize-none break-words bg-transparent px-2 py-2 text-[15px] leading-[1.55] text-ds-ink placeholder:text-ds-faint focus:outline-none [overflow-wrap:anywhere] ${
                canCompose ? '' : 'opacity-80'
              } ${compact ? 'text-[14px]' : ''}`}
              placeholder={placeholder}
              value={input}
              disabled={!canCompose}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onCompositionStart={() => {
                composingRef.current = true
              }}
              onCompositionEnd={() => {
                composingRef.current = false
              }}
              onKeyDown={(e) => {
                const sendByEnter =
                  e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey
                const composing =
                  e.nativeEvent.isComposing || composingRef.current || e.keyCode === 229

                if (!composing && slashQuery != null) {
                  if (e.key === 'ArrowDown' && filteredSlashCommands.length > 0) {
                    e.preventDefault()
                    setSelectedCommandIndex((current) => (current + 1) % filteredSlashCommands.length)
                    return
                  }
                  if (e.key === 'ArrowUp' && filteredSlashCommands.length > 0) {
                    e.preventDefault()
                    setSelectedCommandIndex((current) =>
                      current === 0 ? filteredSlashCommands.length - 1 : current - 1
                    )
                    return
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setInput('')
                    return
                  }
                }

                if (!sendByEnter || composing) return

                e.preventDefault()
                handlePrimaryAction()
              }}
            />

            {hideModelPicker ? null : modelPickerMode === 'combobox' ? (
              <div
                ref={(node) => {
                  modelPickerRef.current = node
                }}
                className={`ds-composer-model-picker ds-no-drag relative flex shrink-0 items-center ${
                  compact ? 'max-w-[142px]' : 'max-w-[220px]'
                }`}
              >
                <span className="sr-only">{t('composerModel')}</span>
                <input
                  value={composerModel}
                  disabled={!canChangeModel}
                  onChange={(e) => onComposerModelChange(e.target.value)}
                  onFocus={() => setModelMenuOpen(true)}
                  placeholder={t('composerModelDefault')}
                  title={t('composerModel')}
                  className={`min-w-0 flex-1 truncate rounded-full bg-transparent py-2 pl-3 pr-7 text-right text-[13px] font-medium outline-none transition ${
                    canChangeModel
                      ? 'text-ds-muted placeholder:text-ds-faint hover:text-ds-ink focus:text-ds-ink'
                      : 'cursor-not-allowed text-ds-faint'
                  }`}
                />
                <button
                  type="button"
                  disabled={!canChangeModel}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setModelMenuOpen((open) => !open)}
                  className="absolute right-1.5 flex h-7 w-7 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-ds-faint"
                  aria-label={t('composerModel')}
                  title={t('composerModel')}
                >
                  <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} />
                </button>
                {modelMenuOpen && canChangeModel ? (
                  <div className="absolute bottom-full right-0 z-50 mb-2 max-h-56 w-[220px] overflow-y-auto rounded-2xl border border-ds-border bg-white p-1.5 text-[12.5px] shadow-[0_18px_50px_rgba(15,23,42,0.16)] dark:bg-ds-card">
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        onComposerModelChange('')
                        setModelMenuOpen(false)
                      }}
                      className={`flex w-full items-center rounded-xl px-3 py-2 text-left font-medium transition hover:bg-ds-hover ${
                        composerModel.trim() === '' ? 'text-accent' : 'text-ds-muted'
                      }`}
                    >
                      {t('composerModelDefault')}
                    </button>
                    {modelOptions.map((id) => (
                      <button
                        type="button"
                        key={id}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          onComposerModelChange(id)
                          setModelMenuOpen(false)
                        }}
                        className={`flex w-full items-center rounded-xl px-3 py-2 text-left font-medium transition hover:bg-ds-hover ${
                          composerModel.trim() === id ? 'text-accent' : 'text-ds-muted'
                        }`}
                      >
                        <span className="min-w-0 truncate">{id}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <label className={`ds-composer-model-picker ds-no-drag relative shrink-0 items-center ${
                compact ? 'max-w-[112px]' : 'max-w-[220px]'
              }`} ref={(node) => {
                modelPickerRef.current = node
              }}>
                <span className="sr-only">{t('composerModel')}</span>
                <select
                  value={composerModel}
                  disabled={!canChangeModel}
                  onChange={(e) => onComposerModelChange(e.target.value)}
                  title={t('composerModel')}
                  className={`max-w-full cursor-pointer appearance-none truncate rounded-full bg-transparent py-2 pl-3 pr-7 text-[15px] font-medium transition ${
                    canChangeModel
                      ? 'text-ds-muted hover:text-ds-ink'
                      : 'cursor-not-allowed text-ds-faint'
                  }`}
                >
                  <option value="">{t('composerModelDefault')}</option>
                  {modelOptions.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-ds-faint" strokeWidth={1.8} />
              </label>
            )}

            {busy ? (
              <button
                type="button"
                onClick={onInterrupt}
                className="ds-no-drag flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-ds-border bg-ds-card text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink"
                aria-label={t('interrupt')}
                title={t('interrupt')}
              >
                <Square className="h-3.5 w-3.5" strokeWidth={2.4} />
              </button>
            ) : null}

            <button
              type="button"
              disabled={primaryActionDisabled}
              onClick={handlePrimaryAction}
              className="ds-no-drag flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-accent/15 bg-accent text-white shadow-[0_10px_24px_rgba(79,124,255,0.28)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:border-ds-border disabled:bg-ds-card disabled:text-ds-faint disabled:shadow-none"
              aria-label={primaryActionLabel}
              title={primaryActionLabel}
            >
              <Send className="h-4 w-4" strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </div>
      {compact ? null : (
        <div className="ds-composer-footer mt-2 flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4">
          <div className="ds-composer-footer-left flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <GitBranchPicker workspaceRoot={effectiveWorkspaceRoot} />
            {showThreadUsageFooter ? (
              <div
                className="ds-composer-usage ds-no-drag inline-flex h-8 max-w-full min-w-0 items-center gap-2 overflow-hidden rounded-lg border border-ds-border-muted bg-ds-card/72 px-2.5 text-[12.5px] font-medium text-ds-muted shadow-sm"
                title={
                  threadUsage
                    ? t('sessionUsageCacheTitle', {
                        cached: formatCompactNumber(threadUsage.cachedTokens),
                        miss: formatCompactNumber(threadUsage.cacheMissTokens)
                      })
                    : t('sessionUsageUnavailable')
                }
              >
                <BarChart3 className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.9} />
                {threadUsage ? (
                  <>
                    <span className="ds-composer-usage-tokens shrink-0 tabular-nums">
                      {t('sessionUsageTokens', {
                        tokens: formatCompactNumber(threadUsage.totalTokens)
                      })}
                    </span>
                    <span className="ds-composer-usage-cost-separator text-ds-faint">·</span>
                    <span className="ds-composer-usage-cost shrink-0 tabular-nums">
                      {t('sessionUsageCost', { cost: formatCost(threadUsage.costUsd) })}
                    </span>
                    <span className="ds-composer-usage-cache-separator text-ds-faint">·</span>
                    <span className="ds-composer-usage-cache shrink-0 tabular-nums">
                      {t('sessionUsageCache', {
                        cache: formatPercent(threadUsage.cacheHitRate)
                      })}
                    </span>
                    <span className="ds-composer-usage-turns-separator hidden text-ds-faint sm:inline">·</span>
                    <span className="ds-composer-usage-turns hidden shrink-0 tabular-nums sm:inline">
                      {t('sessionUsageTurns', { turns: threadUsage.turns })}
                    </span>
                  </>
                ) : (
                  <span className="shrink-0 text-ds-faint">
                    {threadUsageState.loading
                      ? t('sessionUsageLoading')
                      : t('sessionUsageUnavailable')}
                  </span>
                )}
              </div>
            ) : null}
          </div>
          {footerHint ? (
            <div className="ds-composer-footer-hint min-w-0 flex-1 text-right text-[13.5px] font-medium text-ds-faint">
              <span className="block truncate">{footerHint}</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

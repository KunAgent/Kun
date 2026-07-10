import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  type RefObject
} from 'react'
import {
  AppWindow,
  Bold,
  ChevronDown,
  ChevronRight,
  Code,
  Heading1,
  Heading2,
  Heading3,
  ImageIcon,
  Italic,
  LayoutTemplate,
  Lightbulb,
  List,
  ListOrdered,
  Loader2,
  MessageSquareQuote,
  Pilcrow,
  Quote,
  Replace,
  Settings2,
  Sparkles,
  Strikethrough,
  Wand2,
  WandSparkles,
  type LucideIcon
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { WRITE_BLOCK_TYPES, type WriteBlockType } from '../../write/block-type'
import type { WriteInlineFormatKind } from '../../write/inline-format'
import type { ResolvedWriteQuickAction } from '../../write/quick-actions'
import type { ResolvedWriteAgentPreset } from '../../write/agent-presets'
import {
  inlineAgentPlacement,
  type WriteInlineAgentPlacement,
  type WriteInlineAgentPosition
} from './write-workspace-view-utils'

type Props = {
  action: WriteInlineAgentPosition
  value: string
  inFlight: boolean
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onValueChange: (value: string) => void
  onSubmitPrompt: (value: string) => void
  onApplyEdit: (value: string) => void
  askOnly?: boolean
  preferAbove?: boolean
  /** Inline markdown formatting + block types; hidden for read-only or non-markdown files. */
  formattingEnabled?: boolean
  onApplyFormat?: (kind: WriteInlineFormatKind) => void
  blockType?: WriteBlockType
  onSetBlockType?: (type: WriteBlockType) => void
  /** Configurable AI quick actions (edit ones rewrite in place, chat ones go to the sidebar). */
  quickActions?: ResolvedWriteQuickAction[]
  onQuickAction?: (action: ResolvedWriteQuickAction) => void
  /** Writing-assistant persona presets for quick role switching; active '' = no agent. */
  agentPresets?: ResolvedWriteAgentPreset[]
  activeAgentId?: string
  onSelectAgent?: (id: string) => void
  /** Opens the writing-agent settings (empty-state hint + manage link). */
  onOpenAgentSettings?: () => void
  /** Adds the current selection to the writing assistant quote tray without sending a message. */
  onQuoteSelection?: () => void
  /** Shown only when the image generation provider is configured. Generation
   * is async: the click inserts an animated placeholder and returns. */
  infographicEnabled?: boolean
  onGenerateInfographic?: () => void
  /** UI design mockup generation; same async placeholder flow as infographics. */
  designDraftEnabled?: boolean
  onGenerateDesignDraft?: () => void
  /** Interactive HTML prototype generation; embeds a runnable page below the selection. */
  prototypeEnabled?: boolean
  onGeneratePrototype?: () => void
  /** A raster image is selected instead of text: only image-aware actions
   * apply, everything text-oriented is hidden. */
  imageMode?: boolean
  /** Called when the AI-edit textarea gains focus so the parent can freeze the
   * selection state and keep the toolbar visible while the user types. */
  onTextareaFocus?: () => void
  /** Called when the AI-edit textarea loses focus so the parent can unfreeze. */
  onTextareaBlur?: () => void
}

/**
 * Activates without stealing the editor selection: the mouse-down default is
 * prevented so the browser never collapses the selection that anchors this
 * menu.
 */
function ToolbarButton({
  className,
  label,
  disabled = false,
  onActivate,
  children
}: {
  className: string
  label: string
  disabled?: boolean
  onActivate: () => void
  children: ReactNode
}): ReactElement {
  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    if (event.pointerType !== 'mouse') event.preventDefault()
  }
  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.pointerType === 'mouse') return
    event.preventDefault()
    event.stopPropagation()
    onActivate()
  }
  const handleMouseDown = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.stopPropagation()
  }
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      title={label}
      disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onMouseDown={handleMouseDown}
      onClick={onActivate}
    >
      {children}
    </button>
  )
}

const FORMAT_BUTTONS: Array<{ kind: WriteInlineFormatKind; labelKey: string; icon: LucideIcon }> = [
  { kind: 'bold', labelKey: 'writeFormatBold', icon: Bold },
  { kind: 'italic', labelKey: 'writeFormatItalic', icon: Italic },
  { kind: 'strikethrough', labelKey: 'writeFormatStrikethrough', icon: Strikethrough },
  { kind: 'code', labelKey: 'writeFormatCode', icon: Code }
]

const BLOCK_TYPE_META: Record<WriteBlockType, { labelKey: string; icon: LucideIcon }> = {
  paragraph: { labelKey: 'writeBlockTypeParagraph', icon: Pilcrow },
  heading1: { labelKey: 'writeBlockTypeHeading1', icon: Heading1 },
  heading2: { labelKey: 'writeBlockTypeHeading2', icon: Heading2 },
  heading3: { labelKey: 'writeBlockTypeHeading3', icon: Heading3 },
  quote: { labelKey: 'writeBlockTypeQuote', icon: Quote },
  bullet: { labelKey: 'writeBlockTypeBullet', icon: List },
  ordered: { labelKey: 'writeBlockTypeOrdered', icon: ListOrdered },
  code: { labelKey: 'writeBlockTypeCode', icon: Code }
}

function quickActionIcon(id: string): LucideIcon {
  if (id === 'polish') return Wand2
  if (id === 'explain') return Lightbulb
  if (id === 'reformat') return WandSparkles
  return Sparkles
}

export function WriteInlineAgent({
  action,
  value,
  inFlight,
  textareaRef,
  onValueChange,
  onSubmitPrompt,
  onApplyEdit,
  askOnly = false,
  preferAbove = false,
  formattingEnabled = false,
  onApplyFormat,
  blockType = 'paragraph',
  onSetBlockType,
  quickActions = [],
  onQuickAction,
  agentPresets = [],
  activeAgentId = '',
  onSelectAgent,
  onOpenAgentSettings,
  onQuoteSelection,
  infographicEnabled = false,
  onGenerateInfographic,
  designDraftEnabled = false,
  onGenerateDesignDraft,
  prototypeEnabled = false,
  onGeneratePrototype,
  imageMode = false,
  onTextareaFocus,
  onTextareaBlur
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [placement, setPlacement] = useState<WriteInlineAgentPlacement | null>(null)
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }))
  const [blockMenuOpen, setBlockMenuOpen] = useState(false)

  const showBlockSelector = !imageMode && formattingEnabled && Boolean(onSetBlockType)
  const showFormatting = !imageMode && formattingEnabled && Boolean(onApplyFormat)
  const showQuoteSelection = !imageMode && Boolean(onQuoteSelection)
  const showQuickActions = !imageMode && quickActions.length > 0 && Boolean(onQuickAction)
  const showAgentSwitcher =
    !imageMode && Boolean(onSelectAgent) && (agentPresets.length > 0 || Boolean(onOpenAgentSettings))
  const showInfographic = !imageMode && infographicEnabled && Boolean(onGenerateInfographic)
  const showDesignDraft = designDraftEnabled && Boolean(onGenerateDesignDraft)
  const showPrototype = prototypeEnabled && Boolean(onGeneratePrototype)
  const showComposer = !imageMode
  const activeBlock = BLOCK_TYPE_META[blockType] ?? BLOCK_TYPE_META.paragraph
  const ActiveBlockIcon = activeBlock.icon

  useLayoutEffect(() => {
    const updateViewport = (): void => {
      setViewport({ width: window.innerWidth, height: window.innerHeight })
    }
    window.addEventListener('resize', updateViewport)
    return () => window.removeEventListener('resize', updateViewport)
  }, [])

  // Measure before paint, then choose a non-overlapping side of the selection.
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    setPlacement(inlineAgentPlacement({
      left: action.left,
      width: action.width,
      anchorLeft: action.anchorLeft,
      anchorRight: action.anchorRight,
      anchorTop: action.anchorTop,
      anchorBottom: action.anchorBottom
    }, {
      menuHeight: el.scrollHeight,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      preferAbove
    }))
  }, [
    action.anchorTop,
    action.anchorBottom,
    action.anchorLeft,
    action.anchorRight,
    action.left,
    action.width,
    value,
    inFlight,
    showFormatting,
    showBlockSelector,
    showQuoteSelection,
    showInfographic,
    showDesignDraft,
    showPrototype,
    showComposer,
    blockMenuOpen,
    quickActions.length,
    preferAbove,
    viewport.height,
    viewport.width
  ])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (inFlight) return
      onValueChange('')
      return
    }
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    // Enter rewrites editable selections in place; read-only selections such
    // as PDFs send the prompt to the sidebar assistant instead.
    if (askOnly) {
      onSubmitPrompt(value)
      return
    }
    if (event.metaKey || event.ctrlKey) {
      onSubmitPrompt(value)
      return
    }
    onApplyEdit(value)
  }

  return (
    <div
      className="write-inline-agent fixed z-50"
      data-origin={placement?.origin ?? 'top-center'}
      data-selection-ignore="true"
      style={{
        left: placement?.left ?? action.left,
        top: placement?.top ?? action.anchorBottom,
        width: action.width,
        maxHeight: placement?.maxHeight,
        transformOrigin: placement?.origin.replace('-', ' '),
        visibility: placement ? 'visible' : 'hidden'
      }}
    >
      <div
        ref={menuRef}
        className="write-inline-agent-menu"
        style={{
          maxHeight: placement?.maxHeight,
          overflowY: placement?.constrained ? 'auto' : 'visible'
        }}
      >
        {showBlockSelector ? (
          <div className="write-inline-agent-block">
            <button
              type="button"
              className="write-inline-agent-block-trigger"
              aria-label={t('writeBlockTypeLabel')}
              title={t('writeBlockTypeLabel')}
              aria-expanded={blockMenuOpen}
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={() => setBlockMenuOpen((open) => !open)}
            >
              <ActiveBlockIcon className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.85} />
              <span className="min-w-0 flex-1 truncate text-left">{t(activeBlock.labelKey)}</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.9} />
            </button>
            {blockMenuOpen ? (
              <>
                <div
                  className="write-inline-agent-block-backdrop"
                  onPointerDown={() => setBlockMenuOpen(false)}
                  onMouseDown={(event) => event.preventDefault()}
                />
                <div className="write-inline-agent-block-pop" role="menu">
                  {WRITE_BLOCK_TYPES.map((type) => {
                    const meta = BLOCK_TYPE_META[type]
                    const Icon = meta.icon
                    return (
                      <ToolbarButton
                        key={type}
                        className={`write-inline-agent-block-item${type === blockType ? ' is-active' : ''}`}
                        label={t(meta.labelKey)}
                        onActivate={() => {
                          setBlockMenuOpen(false)
                          onSetBlockType?.(type)
                        }}
                      >
                        <Icon className="h-4 w-4 shrink-0" strokeWidth={1.85} />
                        <span className="min-w-0 flex-1 truncate text-left">{t(meta.labelKey)}</span>
                      </ToolbarButton>
                    )
                  })}
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {showFormatting ? (
          <div className="write-inline-agent-format-row">
            {FORMAT_BUTTONS.map(({ kind, labelKey, icon: Icon }) => (
              <ToolbarButton
                key={kind}
                className="write-inline-agent-format"
                label={t(labelKey)}
                onActivate={() => onApplyFormat?.(kind)}
              >
                <Icon className="h-4 w-4" strokeWidth={2} />
              </ToolbarButton>
            ))}
          </div>
        ) : null}

        {showAgentSwitcher || showQuoteSelection || showQuickActions || showInfographic || showDesignDraft || showPrototype ? (
          <div className="write-inline-agent-actions">
            {showAgentSwitcher ? (
              <div className="mb-1">
                <div className="flex items-center justify-between gap-2 pr-1">
                  <span className="write-inline-agent-section-label">{t('writeAgentSwitcherLabel')}</span>
                  {onOpenAgentSettings && agentPresets.length > 0 ? (
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onOpenAgentSettings()}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ds-faint transition hover:text-accent"
                    >
                      <Settings2 className="h-3 w-3" strokeWidth={1.9} />
                      {t('writeAgentSwitcherManage')}
                    </button>
                  ) : null}
                </div>
                {agentPresets.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1.5 px-1">
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onSelectAgent?.('')}
                      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[12px] font-medium transition ${
                        activeAgentId === ''
                          ? 'border-accent/40 bg-accent/12 text-accent'
                          : 'border-ds-border bg-ds-card text-ds-faint hover:border-accent/40 hover:bg-accent/5'
                      }`}
                    >
                      {t('writeAgentSwitcherNone')}
                    </button>
                    {agentPresets.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        title={preset.persona}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => onSelectAgent?.(activeAgentId === preset.id ? '' : preset.id)}
                        className={`inline-flex max-w-[150px] items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-medium transition ${
                          activeAgentId === preset.id
                            ? 'border-accent/40 bg-accent/12 text-accent'
                            : 'border-ds-border bg-ds-card text-ds-ink hover:border-accent/40 hover:bg-accent/5'
                        }`}
                      >
                        <span aria-hidden="true" className="text-[13px] leading-none">{preset.emoji}</span>
                        <span className="truncate">{preset.name}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onOpenAgentSettings?.()}
                    className="mt-1 flex w-full items-center gap-2 rounded-lg border border-dashed border-ds-border px-2.5 py-1.5 text-[12px] text-ds-ink transition hover:border-accent/40 hover:bg-accent/5"
                  >
                    <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.85} />
                    <span className="min-w-0 flex-1 truncate text-left">{t('writeAgentSwitcherEmptyHint')}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" strokeWidth={1.8} />
                  </button>
                )}
              </div>
            ) : null}
            {showQuoteSelection || showQuickActions || showInfographic || showDesignDraft || showPrototype ? (
              <div className="write-inline-agent-section-label">{t('writeSelectionSkills')}</div>
            ) : null}
            {showQuoteSelection ? (
              <ToolbarButton
                className="write-inline-agent-action-row"
                label={t('writeSelectionQuote')}
                onActivate={() => onQuoteSelection?.()}
              >
                <MessageSquareQuote className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.85} />
                <span className="min-w-0 flex-1 truncate text-left">{t('writeSelectionQuote')}</span>
                <MessageSquareQuote className="write-inline-agent-action-hint h-3.5 w-3.5" strokeWidth={1.8} />
              </ToolbarButton>
            ) : null}
            {showQuickActions
              ? quickActions.map((quickAction) => {
                  const Icon = quickActionIcon(quickAction.id)
                  return (
                    <ToolbarButton
                      key={quickAction.id}
                      className="write-inline-agent-action-row"
                      label={quickAction.label}
                      onActivate={() => onQuickAction?.(quickAction)}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.85} />
                      <span className="min-w-0 flex-1 truncate text-left">{quickAction.label}</span>
                      {quickAction.mode === 'edit' ? (
                        <Replace className="write-inline-agent-action-hint h-3.5 w-3.5" strokeWidth={1.8} />
                      ) : (
                        <MessageSquareQuote className="write-inline-agent-action-hint h-3.5 w-3.5" strokeWidth={1.8} />
                      )}
                    </ToolbarButton>
                  )
                })
              : null}
            {showInfographic ? (
              <ToolbarButton
                className="write-inline-agent-action-row"
                label={t('writeInfographicGenerate')}
                onActivate={() => onGenerateInfographic?.()}
              >
                <ImageIcon className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.85} />
                <span className="min-w-0 flex-1 truncate text-left">
                  {t('writeInfographicGenerate')}
                </span>
                <Replace className="write-inline-agent-action-hint h-3.5 w-3.5" strokeWidth={1.8} />
              </ToolbarButton>
            ) : null}
            {showDesignDraft ? (
              <ToolbarButton
                className="write-inline-agent-action-row"
                label={t('writeDesignDraftGenerate')}
                onActivate={() => onGenerateDesignDraft?.()}
              >
                <LayoutTemplate className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.85} />
                <span className="min-w-0 flex-1 truncate text-left">
                  {t('writeDesignDraftGenerate')}
                </span>
                <Replace className="write-inline-agent-action-hint h-3.5 w-3.5" strokeWidth={1.8} />
              </ToolbarButton>
            ) : null}
            {showPrototype ? (
              <ToolbarButton
                className="write-inline-agent-action-row"
                label={t('writePrototypeGenerate')}
                onActivate={() => onGeneratePrototype?.()}
              >
                <AppWindow className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.85} />
                <span className="min-w-0 flex-1 truncate text-left">
                  {t('writePrototypeGenerate')}
                </span>
                <Replace className="write-inline-agent-action-hint h-3.5 w-3.5" strokeWidth={1.8} />
              </ToolbarButton>
            ) : null}
          </div>
        ) : null}

        {showComposer ? (
        <form
          className="write-inline-agent-edit"
          onSubmit={(event) => {
            event.preventDefault()
            if (askOnly) {
              onSubmitPrompt(value)
            } else {
              onApplyEdit(value)
            }
          }}
        >
          {askOnly ? (
            <MessageSquareQuote className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.9} />
          ) : (
            <Sparkles className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.9} />
          )}
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            placeholder={t(askOnly ? 'writeInlineAgentPlaceholder' : 'writeInlineAgentEditHint')}
            aria-label={t(askOnly ? 'writeInlineAgentPlaceholder' : 'writeInlineAgentEditHint')}
            spellCheck={false}
            className="write-inline-agent-input"
            disabled={inFlight}
            onChange={(event) => onValueChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={onTextareaFocus}
            onBlur={onTextareaBlur}
          />
          {!askOnly ? (
            <button
              type="button"
              className="write-inline-agent-secondary"
              aria-label={t('writeInlineAgentSend')}
              title={t('writeInlineAgentSend')}
              disabled={!value.trim() || inFlight}
              onClick={() => onSubmitPrompt(value)}
            >
              <MessageSquareQuote className="h-4 w-4" strokeWidth={1.9} />
            </button>
          ) : null}
          <button
            type="submit"
            className="write-inline-agent-submit"
            aria-label={inFlight ? t('writeInlineEditApplying') : t(askOnly ? 'writeInlineAgentSend' : 'writeInlineEditApply')}
            title={inFlight ? t('writeInlineEditApplying') : t(askOnly ? 'writeInlineAgentSend' : 'writeInlineEditApply')}
            disabled={!value.trim() || inFlight}
          >
            {inFlight ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            ) : askOnly ? (
              <MessageSquareQuote className="h-4 w-4" strokeWidth={2} />
            ) : (
              <Sparkles className="h-4 w-4" strokeWidth={2} />
            )}
          </button>
        </form>
        ) : null}
      </div>
    </div>
  )
}

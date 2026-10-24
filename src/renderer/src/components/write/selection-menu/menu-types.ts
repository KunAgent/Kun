import type { WriteBlockType } from '../../../write/block-type'
import type { WriteInlineFormatKind } from '../../../write/inline-format'
import type { ResolvedWriteQuickAction } from '../../../write/quick-actions'
import type { ResolvedWriteAgentPreset } from '../../../write/agent-presets'

export type SelectionMenuProps = {
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
  /** Raises the selection surface above Write's distraction-free shell. */
  focusMode?: boolean
  activeFormats?: WriteInlineFormatKind[]
  richMode?: boolean
  askEnabled?: boolean
  editEnabled?: boolean
  readOnlyNote?: boolean
  onAskEdit?: (instruction: string) => void
  onAskChat?: (instruction: string) => void
  onFreezeSelection?: () => void
  onReleaseSelection?: () => void
  onRestoreSelection?: () => void
  onDismiss?: () => void
}

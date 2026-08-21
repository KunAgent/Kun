import type { AppLocale } from './app-locales'
import type { GuiUpdateChannel } from './gui-update'
import type { KeyboardShortcutsConfigV1 } from './keyboard-shortcuts'
import type { LocalWhisperDownloadSourceId } from './local-whisper'
import type {
  ApprovalPolicy,
  ApprovalReviewer,
  SandboxMode
} from '../../kun/src/contracts/policy.js'
import type { ComputerUseMode } from '../../kun/src/contracts/capabilities.js'
import type { BrowserUseMode } from './browser-use'
import type { ModelEndpointFormat } from '../../kun/src/contracts/model-endpoint-format.js'
import type { ToolOutputLimitsConfig } from '../../kun/src/contracts/tool-output-limits.js'

import {
  AppBehaviorConfigV1,
  CheckpointCleanupConfigV1,
  KunSettingsEnvelopePatchV1,
  KunSettingsEnvelopeV1,
  LogConfigV1,
  NotificationConfigV1,
  ScheduleInternalSettingsV1,
  ScheduleSettingsV1,
  ScheduleSkillSettingsV1,
  ScheduledTaskV1
} from './app-settings-types-kun-services'
import {
  ChatContentMaxWidthPx,
  ClawImProvider,
  ClawRunMode,
  ClawScheduleKind,
  ComposerSendKey,
  ModelProviderSettingsPatchV1,
  ModelProviderSettingsV1,
  ScheduleTaskStatus,
  UiFontScale
} from './app-settings-types-provider'
import {
  WorkflowSettingsPatchV1,
  WorkflowSettingsV1
} from './app-settings-types-workflow-runtime'

export type ClawSkillSettingsV1 = {
  defaultNames: string[]
  extraDirs: string[]
  /**
   * Discovered skill roots the user turned off. Holds common-directory ids
   * (e.g. `global-codex`) and/or normalized absolute paths for custom dirs.
   */
  disabledDirs: string[]
  promptPrefix: string
}

export type ClawImSettingsV1 = {
  enabled: boolean
  provider: ClawImProvider
  port: number
  path: string
  secret: string
  weixinBridgeUrl: string
  workspaceRoot: string
  /** Default model provider for IM channels without their own provider. Empty inherits Kun runtime provider. */
  providerId?: string
  model: string
  mode: ClawRunMode
  responseTimeoutMs: number
  recentThreadListLimit: number
}

export type ClawTaskScheduleV1 = {
  kind: ClawScheduleKind
  everyMinutes: number
  timeOfDay: string
  atTime: string
}

export type ClawTaskV1 = ScheduledTaskV1

export type ClawImAgentProfileV1 = {
  name: string
  description: string
  identity: string
  personality: string
  userContext: string
  replyRules: string
}

export type ClawImFeishuPlatformCredentialV1 = {
  kind: 'feishu'
  appId: string
  appSecret: string
  domain: string
  createdAt: string
}

export type ClawImWeixinPlatformCredentialV1 = {
  kind: 'weixin'
  accountId: string
  sessionKey: string
  createdAt: string
}

export type ClawImTelegramProxyV1 = {
  enabled: boolean
  url: string
}

export type ClawImTelegramPlatformCredentialV1 = {
  kind: 'telegram'
  botToken: string
  /**
   * Comma-separated Telegram chat ids allowed to talk to the bot.
   * Empty string means "allow all private chats" (group chats are always rejected).
   */
  allowedChatIds: string
  /** Bot username resolved via getMe, e.g. "my_kun_bot". Cosmetic only. */
  botUsername?: string
  /** Optional explicit proxy used only for this Telegram Bot connection. */
  proxy?: ClawImTelegramProxyV1
  createdAt: string
}

export type ClawImPlatformCredentialV1 =
  | ClawImFeishuPlatformCredentialV1
  | ClawImWeixinPlatformCredentialV1
  | ClawImTelegramPlatformCredentialV1

export type ClawImRemoteSessionV1 = {
  chatId: string
  messageId: string
  threadId: string
  senderId: string
  senderName: string
  updatedAt: string
}

export type ClawImConversationV1 = {
  id: string
  chatId: string
  remoteThreadId: string
  latestMessageId: string
  senderId: string
  senderName: string
  /** Kun thread id this conversation maps to. */
  localThreadId: string
  workspaceRoot: string
  /** Model provider used by this IM conversation. Empty inherits channel/IM/global provider. */
  providerId?: string
  /** Model used by this IM conversation. Empty inherits channel/IM model. */
  model?: string
  createdAt: string
  updatedAt: string
}

export type ClawImChannelV1 = {
  id: string
  provider: ClawImProvider
  label: string
  enabled: boolean
  /** Enable SSE-driven Feishu / Lark reply streaming instead of one-shot polling replies. */
  feishuStream?: boolean
  /** Model provider used by this IM channel. Empty inherits the IM/global provider. */
  providerId?: string
  model: string
  /** Kun thread id this channel maps to. */
  threadId: string
  workspaceRoot: string
  agentProfile: ClawImAgentProfileV1
  platformCredential?: ClawImPlatformCredentialV1
  remoteSession?: ClawImRemoteSessionV1
  conversations: ClawImConversationV1[]
  /** When the one-time IM welcome/intro message was delivered. */
  welcomeSentAt?: string
  createdAt: string
  updatedAt: string
}

export type ClawSettingsV1 = {
  enabled: boolean
  skills: ClawSkillSettingsV1
  im: ClawImSettingsV1
  channels: ClawImChannelV1[]
  tasks: ClawTaskV1[]
}

export type WriteInlineCompletionSettingsV1 = {
  enabled: boolean
  retrievalEnabled: boolean
  longCompletionEnabled: boolean
  /** When true, Write inherits Kun's selected provider instead of using `providerId`. */
  inheritProvider: boolean
  /** Selected provider for Write inline completion when `inheritProvider` is false. */
  providerId: string
  apiKey: string
  baseUrl: string
  /** When true, Write inherits Kun's runtime model instead of using `model` as an override. */
  inheritModel: boolean
  model: string
  debounceMs: number
  longDebounceMs: number
  minAcceptScore: number
  longMinAcceptScore: number
  maxTokens: number
  longMaxTokens: number
}

/** 'edit' rewrites the selection in place; 'chat' hands it to the sidebar assistant. */
export type WriteQuickActionMode = 'edit' | 'chat'

export type WriteQuickActionV1 = {
  /** Stable identifier; built-in ids ('polish' | 'explain' | 'reformat') get localized fallbacks. */
  id: string
  /** Display label shown in the selection toolbar; empty = localized default for built-in ids. */
  label: string
  /** Prompt used for the edit/chat; empty = localized default for built-in ids. */
  prompt: string
  /** Whether the result rewrites the selection in place ('edit') or goes to the sidebar ('chat'). */
  mode: WriteQuickActionMode
}

export type WriteSelectionAssistSettingsV1 = {
  /** Custom infographic generation prompt prefix; empty = built-in default. */
  infographicPrompt: string
  /** Custom UI design mockup prompt prefix; empty = built-in default. */
  designDraftPrompt: string
  /** Custom interactive HTML prototype prompt; empty = built-in default. */
  prototypePrompt: string
  quickActions: WriteQuickActionV1[]
}

export type WriteFontPreset =
  | 'system'
  | 'sourceHanSans'
  | 'yahei'
  | 'pingfang'
  | 'simhei'
  | 'simsun'
  | 'kaiti'
  | 'custom'

export const WRITE_FONT_PRESETS: readonly WriteFontPreset[] = [
  'system',
  'sourceHanSans',
  'yahei',
  'pingfang',
  'simhei',
  'simsun',
  'kaiti',
  'custom'
] as const

export const WRITE_EDITOR_FONT_SIZE_MIN = 10

export const WRITE_EDITOR_FONT_SIZE_MAX = 48

export const DEFAULT_WRITE_EDITOR_FONT_SIZE_PX = 16

export const WRITE_EDITOR_LINE_HEIGHT_MIN = 1.4

export const WRITE_EDITOR_LINE_HEIGHT_MAX = 2.2

export const DEFAULT_WRITE_EDITOR_LINE_HEIGHT = 1.75

/**
 * Typography for the Write editor prose surfaces (rich editor, CodeMirror live
 * appearance, and the markdown preview). The raw source appearance keeps its
 * monospace family but still honors the configured size.
 */
export type WriteTypographySettingsV1 = {
  /** Named font preset; 'custom' uses `customFontFamily`. */
  fontPreset: WriteFontPreset
  /** CSS font-family stack used when `fontPreset === 'custom'`. */
  customFontFamily: string
  /** Base font size in px, clamped to [WRITE_EDITOR_FONT_SIZE_MIN, WRITE_EDITOR_FONT_SIZE_MAX]. */
  fontSizePx: number
  /** Unitless line-height, clamped to [WRITE_EDITOR_LINE_HEIGHT_MIN, WRITE_EDITOR_LINE_HEIGHT_MAX]. */
  lineHeight: number
}

export const WRITE_AGENT_PRESET_MAX_COUNT = 12

export const WRITE_AGENT_PRESET_NAME_MAX_CHARS = 40

/** Kept in sync with the runtime turn-persona contract. */
export const WRITE_AGENT_PERSONA_MAX_CHARS = 2000

/**
 * A named, reusable writing-assistant persona (plot coordinator, line editor,
 * foreshadowing tracker, continuity checker…). The persona text frames the
 * assistant for a specific creative role and can be switched per conversation.
 */
export type WriteAgentPresetV1 = {
  /** Stable id; built-in ids ('coordinator' | 'editor' | 'foreshadowing' | 'continuity') get localized name/persona fallbacks. */
  id: string
  /** Display name; empty = localized default for built-in ids. */
  name: string
  /** Short emoji/glyph badge shown in the switcher. */
  emoji: string
  /** Persona + behavior rules used to frame the assistant. Empty = localized default for built-in ids. */
  persona: string
}

export const CODE_AGENT_PRESET_MAX_COUNT = 12
export const CODE_AGENT_PRESET_NAME_MAX_CHARS = 40
/** Lucide icon names are PascalCase ASCII; the longest today is ~40 chars. */
export const CODE_AGENT_PRESET_ICON_MAX_CHARS = 64
/** Kept in sync with the runtime cap (`TURN_PERSONA_MAX_CHARS` in kun/src/contracts/turns.ts). */
export const CODE_AGENT_PERSONA_MAX_CHARS = 2000
/**
 * A named, reusable stance for the Code agent (skeptic, explorer, minimalist…).
 * The persona text is sent per turn and guides tone and working style only — it
 * never grants tools or relaxes policy.
 */
export type CodeAgentPresetV1 = {
  /** Stable id; built-in ids get localized name/persona fallbacks. */
  id: string
  /** Display name; empty = localized default for built-in ids. */
  name: string
  /** Lucide icon name shown in the composer picker; unknown/empty renders a fallback. */
  icon: string
  /** Persona text framing the agent. Empty = localized default for built-in ids. */
  persona: string
}

export type WriteSettingsV1 = {
  defaultWorkspaceRoot: string
  activeWorkspaceRoot: string
  workspaces: string[]
  autoSaveEnabled: boolean
  autoSaveDelayMs: number
  inlineCompletion: WriteInlineCompletionSettingsV1
  selectionAssist: WriteSelectionAssistSettingsV1
  typography: WriteTypographySettingsV1
  agentPresets: WriteAgentPresetV1[]
}

export type ClawSettingsPatchV1 = Partial<Omit<ClawSettingsV1, 'skills' | 'im' | 'channels' | 'tasks'>> & {
  skills?: Partial<ClawSkillSettingsV1>
  im?: Partial<ClawImSettingsV1>
  channels?: Array<Partial<ClawImChannelV1>>
  tasks?: Array<Partial<ClawTaskV1>>
}

export type ScheduleSettingsPatchV1 = Partial<
  Omit<ScheduleSettingsV1, 'skills' | 'internal' | 'tasks'>
> & {
  skills?: Partial<ScheduleSkillSettingsV1>
  internal?: Partial<ScheduleInternalSettingsV1>
  tasks?: Array<Partial<ScheduledTaskV1>>
}

export type WriteSettingsPatchV1 = Partial<Omit<WriteSettingsV1, 'inlineCompletion' | 'selectionAssist' | 'typography' | 'agentPresets'>> & {
  inlineCompletion?: Partial<WriteInlineCompletionSettingsV1>
  selectionAssist?: Partial<Omit<WriteSelectionAssistSettingsV1, 'quickActions'>> & {
    /** Replaced wholesale when present. */
    quickActions?: Array<Partial<WriteQuickActionV1>>
  }
  typography?: Partial<WriteTypographySettingsV1>
  /** Replaced wholesale when present. */
  agentPresets?: Array<Partial<WriteAgentPresetV1>>
}

export type DesignSystemPreset =
  | 'none'
  | 'shadcn'
  | 'radix'
  | 'material'
  | 'ios'
  | 'fluent'
  | 'ant'
  | 'chakra'
  | 'carbon'
  | 'polaris'
  | 'bootstrap'
  | 'geist'
  | 'brutalism'
  | 'editorial'

export type DesignSurfaceSetting = '' | 'brand' | 'product'

export type DesignRadiusSetting = '' | 'sharp' | 'soft' | 'rounded' | 'pill'

export type DesignDensitySetting = '' | 'compact' | 'cozy' | 'spacious'

export type DesignFontStyleSetting = '' | 'system' | 'geometric' | 'humanist' | 'serif' | 'mono'

export type DesignViewportSetting = 'mobile' | 'tablet' | 'desktop'

export type DesignCanvasViewSetting = 'preview' | 'code'

export type DesignCanvasBackgroundSetting = 'light' | 'dark'

export type DesignSettingsV1 = {
  /** Workspace root for design artifacts; empty = use the built-in Design workspace. */
  defaultWorkspaceRoot: string
  /** Design workspace roots shown in the Design sidebar. */
  workspaces: string[]
  /** Last active Design workspace root; falls back to the default workspace. */
  activeWorkspaceRoot: string

  // --- Design system (shared source of truth for design + code) ---
  /** Anchor brand color (CSS color) injected into the design agent's context. */
  brandColor: string
  /** Free-form tone chips (e.g. 编辑风, 专业, 科技感). */
  tone: string[]
  /** Named design-system preset that seeds tokens/voice; 'none' = no preset. */
  designSystemPreset: DesignSystemPreset
  /** Default surface type for new designs; '' = unset. */
  designType: DesignSurfaceSetting
  /** Free-form additional design rules injected alongside the preset and written to DESIGN_SYSTEM.md. */
  designGuidelines: string
  /** Corner-radius token; '' = unset. */
  radius: DesignRadiusSetting
  /** Spacing-density token; '' = unset. */
  density: DesignDensitySetting
  /** Type-style token; '' = unset. */
  fontStyle: DesignFontStyleSetting

  // --- Design agent ---
  /** Default model for design turns; '' = inherit runtime default. */
  model: string
  providerId: string
  /** Reasoning effort for design turns; '' = default. */
  reasoningEffort: string
  /** Custom override of the single-file HTML generation contract; '' = built-in default. */
  generationPrompt: string

  // --- Design → code integration ---
  /** Target stack hint for "implement this design", e.g. "React + Tailwind + shadcn". */
  implementStackHint: string
  /** Tell the coding agent to honor the published design system. */
  injectIntoCode: boolean
  /** Publish DESIGN_SYSTEM.md to the workspace when implementing. */
  publishDesignSystem: boolean

  // --- Canvas defaults ---
  defaultViewport: DesignViewportSetting
  defaultCanvasView: DesignCanvasViewSetting
  canvasBackground: DesignCanvasBackgroundSetting
  /** Auto-refresh the canvas as the agent writes. */
  liveRefresh: boolean
  /** Show a device frame for mobile/tablet viewports. */
  deviceFrame: boolean
}

export type DesignSettingsPatchV1 = Partial<DesignSettingsV1>

export type ClawGeneratedFileV1 = {
  path: string
  relativePath?: string
  fileName: string
}

export type ClawRunResult =
  | {
      ok: true
      threadId: string
      turnId?: string
      text?: string
      message?: string
      files?: ClawGeneratedFileV1[]
      /**
       * Whether the watched turn finished within the response window.
       * `false` means it outran the IM timeout and is still running —
       * the caller should ack now and push the result when it finishes.
       * Absent on the fire-and-forget (no `waitForResult`) path.
       */
      completed?: boolean
      /** The task was accepted by the background queue but has not started. */
      queued?: boolean
    }
  | { ok: false; message: string }

export type ScheduleRunResult = ClawRunResult

export type ScheduleTaskFromTextResult =
  | { kind: 'noop' }
  | { kind: 'created'; taskId: string; title: string; scheduleAt: string; confirmationText: string }
  | { kind: 'error'; message: string }

export type ClawTaskFromTextResult = ScheduleTaskFromTextResult

export type ClawRuntimeStatus = {
  imServerRunning: boolean
  imUrl: string
  runningTaskIds: string[]
}

export type ScheduleRuntimeStatus = {
  internalServerRunning: boolean
  internalUrl: string
  runningTaskIds: string[]
  queuedTaskIds: string[]
  boundThreadTasks: Array<{
    taskId: string
    threadId: string
    enabled: boolean
    status: ScheduleTaskStatus
    nextRunAt: string
    lastRunAt: string
    updatedAt: string
  }>
  powerSaveBlockerActive: boolean
}

export type GuiUpdateConfigV1 = {
  channel: GuiUpdateChannel
}

export type TerminalColorMode = 'native' | 'none' | 'custom'

export type TerminalColorSettingsV1 = {
  /** 'native' = built-in app theme colors; 'none' = monochrome; 'custom' = use user-defined colors. */
  colorMode: TerminalColorMode
  foreground: string
  background: string
  cursor: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export type TerminalSettingsV1 = {
  colors: TerminalColorSettingsV1
}

export type TerminalSettingsPatchV1 = {
  colors?: Partial<TerminalColorSettingsV1>
}

export type AppSettingsV1 = {
  version: 1
  /** Persisted independently from credentials so SDK/subscription providers do not reopen onboarding. */
  initialSetupCompleted?: boolean
  locale: AppLocale
  theme: 'system' | 'light' | 'dark'
  uiFontScale: UiFontScale
  chatContentMaxWidthPx: ChatContentMaxWidthPx
  /** Enter sends (default) or Shift+Enter sends; the other key inserts a newline. */
  composerSendKey: ComposerSendKey
  cursorSpotlight?: boolean
  cursorSpotlightColor?: string
  provider: ModelProviderSettingsV1
  agents: KunSettingsEnvelopeV1
  workspaceRoot: string
  /** 对话会话的工作目录根(默认 ~/Documents/Kun),不绑定项目文件夹。 */
  conversationWorkspaceRoot: string
  log: LogConfigV1
  checkpointCleanup: CheckpointCleanupConfigV1
  /** Prefix applied when the branch picker creates a branch or worktree branch. */
  gitBranchPrefix?: string
  notifications: NotificationConfigV1
  appBehavior: AppBehaviorConfigV1
  keyboardShortcuts: KeyboardShortcutsConfigV1
  write: WriteSettingsV1
  claw: ClawSettingsV1
  schedule: ScheduleSettingsV1
  workflow: WorkflowSettingsV1
  design: DesignSettingsV1
  guiUpdate: GuiUpdateConfigV1
  terminal: TerminalSettingsV1
  codePromptPrefix: string
  /**
   * Custom empty-chat welcome title. Empty string keeps the locale default
   * (`emptyHeroTitle`).
   */
  chatWelcomeMessage: string
  /** Experimental Code composer persona picker. Legacy snapshots omit it and are treated as enabled. */
  codeAgentPersonaEnabled?: boolean
  /** Selectable Code-agent personas. Replaced wholesale on patch. */
  codeAgentPresets: CodeAgentPresetV1[]
  /** User-disabled skill IDs. Disabled skills are hidden from command surfaces. */
  disabledSkillIds: string[]
}

export type AppSettingsPatch = Partial<
  Omit<AppSettingsV1, 'provider' | 'agents' | 'log' | 'checkpointCleanup' | 'notifications' | 'appBehavior' | 'keyboardShortcuts' | 'write' | 'claw' | 'schedule' | 'design' | 'workflow' | 'guiUpdate' | 'terminal'>
> & {
  provider?: ModelProviderSettingsPatchV1
  agents?: KunSettingsEnvelopePatchV1
  log?: Partial<LogConfigV1>
  checkpointCleanup?: Partial<CheckpointCleanupConfigV1>
  notifications?: Partial<NotificationConfigV1>
  appBehavior?: Partial<AppBehaviorConfigV1>
  keyboardShortcuts?: Partial<KeyboardShortcutsConfigV1>
  write?: WriteSettingsPatchV1
  claw?: ClawSettingsPatchV1
  schedule?: ScheduleSettingsPatchV1
  workflow?: WorkflowSettingsPatchV1
  design?: DesignSettingsPatchV1
  guiUpdate?: Partial<GuiUpdateConfigV1>
  terminal?: TerminalSettingsPatchV1
}

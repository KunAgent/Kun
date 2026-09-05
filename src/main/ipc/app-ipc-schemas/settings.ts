import { z } from 'zod'
import {
  MAX_WRITE_AUTOSAVE_DELAY_MS,
  MIN_WRITE_AUTOSAVE_DELAY_MS,
  MIN_KUN_LOCAL_PORT,
  SCHEDULE_MODEL_IDS,
  WRITE_AGENT_PERSONA_MAX_CHARS,
  WINDOW_CLOSE_ACTIONS
} from '../../../shared/app-settings'
import { GUI_UPDATE_CHANNELS } from '../../../shared/gui-update'
import { KEYBOARD_SHORTCUT_COMMANDS } from '../../../shared/keyboard-shortcuts'
import { kunGraphPatchSchema } from './settings-graph'
import { kunLabPatchSchema } from './settings-lab'
import {
  MAX_BODY_BYTES,
  MAX_CHANNEL_TEXT_LENGTH,
  MAX_ID_LENGTH,
  MAX_PATH_LENGTH,
  MAX_URL_LENGTH,
  defaultPathSchema,
  optionalTrimmedString,
  trimmedString
} from './common'
import {
  approvalPolicySchema,
  chatContentMaxWidthSchema,
  clawImProviderSchema,
  clawRunModeSchema,
  clawScheduleKindSchema,
  clawTaskStatusSchema,
  hexColorSchema,
  kunRuntimePatchSchema,
  localeSchema,
  modelIdSchema,
  modelProviderPatchSchema,
  optionalModelIdSchema,
  scheduleReasoningEffortSchema,
  themeSchema,
  uiFontScaleSchema,
  writeInlineCompletionModelSchema
} from './settings-model'
import { workflowSettingsPatchSchema } from './settings-workflow'

export {
  clawImProviderSchema,
  clawRunModeSchema,
  cursorSubscriptionDiscoveryPayloadSchema,
  localWhisperDownloadSourceSchema,
  localWhisperModelIdSchema,
  modelIdSchema,
  optionalModelIdSchema,
  scheduleReasoningEffortSchema,
  speechToTextSettingsSchema
} from './settings-model'
export {
  workflowCodeCheckPayloadSchema,
  workflowResolveApprovalPayloadSchema,
  workflowRunNodePayloadSchema,
  workflowTestNodePayloadSchema
} from './settings-workflow'

const logPatchSchema = z.object({
  enabled: z.boolean().optional(),
  retentionDays: z.number().int().min(1).max(365).optional()
}).strict()

const checkpointCleanupPatchSchema = z.object({
  createEnabled: z.boolean().optional(),
  enabled: z.boolean().optional(),
  intervalDays: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(5),
    z.literal(10)
  ]).optional(),
  // Issue #651: user-configurable checkpoint storage directory (e.g. another
  // drive) + per-thread retention cap. Empty string clears the override.
  directory: z.string().max(4096).optional(),
  maxPerThread: z.number().int().min(1).max(100).optional(),
  // Issue #1156: one-time createEnabled migration marker + global disk quota.
  createEnabledResetAt: z.string().max(64).optional(),
  maxTotalBytes: z.number().int().min(0).optional(),
  minFreeDiskBytes: z.number().int().min(0).optional()
}).strict()

const notificationsPatchSchema = z.object({
  turnComplete: z.boolean().optional(),
  mainAgentTurnComplete: z.boolean().optional(),
  subagentTurnComplete: z.boolean().optional()
}).strict()

const darkUiColorsPatchSchema = z.object({
  background: hexColorSchema.optional(),
  border: hexColorSchema.optional(),
  panel: hexColorSchema.optional()
}).strict()

const appBehaviorPatchSchema = z.object({
  openAtLogin: z.boolean().optional(),
  startMinimized: z.boolean().optional(),
  keepAwake: z.boolean().optional(),
  useSystemTitleBar: z.boolean().optional(),
  closeAction: z.enum(WINDOW_CLOSE_ACTIONS).optional(),
  closeToTray: z.boolean().optional()
}).strict()

const keyboardShortcutCommandIds = KEYBOARD_SHORTCUT_COMMANDS.map((command) => command.id) as [
  typeof KEYBOARD_SHORTCUT_COMMANDS[number]['id'],
  ...Array<typeof KEYBOARD_SHORTCUT_COMMANDS[number]['id']>
]

const keyboardShortcutsPatchSchema = z.object({
  bindings: z.partialRecord(
    z.enum(keyboardShortcutCommandIds),
    z.array(z.string().trim().max(64)).max(4)
  ).optional()
}).strict()

const writeInlineCompletionPatchSchema = z.object({
  enabled: z.boolean().optional(),
  retrievalEnabled: z.boolean().optional(),
  longCompletionEnabled: z.boolean().optional(),
  inheritProvider: z.boolean().optional(),
  providerId: z.string().trim().max(64).optional(),
  apiKey: z.string().max(MAX_BODY_BYTES).optional(),
  baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
  inheritModel: z.boolean().optional(),
  model: writeInlineCompletionModelSchema.optional(),
  debounceMs: z.number().int().min(150).max(5_000).optional(),
  longDebounceMs: z.number().int().min(1_000).max(15_000).optional(),
  minAcceptScore: z.number().min(0.1).max(0.95).optional(),
  longMinAcceptScore: z.number().min(0.1).max(0.95).optional(),
  maxTokens: z.number().int().min(16).max(512).optional(),
  longMaxTokens: z.number().int().min(64).max(1_024).optional()
}).strict()

const writeQuickActionSchema = z.object({
  id: trimmedString(64),
  label: z.string().max(64).optional(),
  prompt: z.string().max(4_000).optional(),
  mode: z.enum(['edit', 'chat']).optional()
}).strict()

const writeSelectionAssistPatchSchema = z.object({
  infographicPrompt: z.string().max(4_000).optional(),
  designDraftPrompt: z.string().max(4_000).optional(),
  prototypePrompt: z.string().max(4_000).optional(),
  quickActions: z.array(writeQuickActionSchema).max(24).optional()
}).strict()

const writeTypographyPatchSchema = z.object({
  fontPreset: z.string().max(32).optional(),
  customFontFamily: z.string().max(200).optional(),
  fontSizePx: z.number().optional(),
  lineHeight: z.number().optional()
}).strict()

const writeAgentPresetSchema = z.object({
  id: trimmedString(64),
  name: z.string().max(64).optional(),
  emoji: z.string().max(16).optional(),
  persona: z.string().max(WRITE_AGENT_PERSONA_MAX_CHARS).optional()
}).strict()

const codeAgentPresetSchema = z.object({
  id: trimmedString(64),
  name: z.string().max(64).optional(),
  /** Lucide icon name (PascalCase); unknown names render a fallback icon. */
  icon: z.string().max(64).optional(),
  persona: z.string().max(2_000).optional()
}).strict()

const writeSettingsPatchSchema = z.object({
  defaultWorkspaceRoot: defaultPathSchema,
  activeWorkspaceRoot: defaultPathSchema,
  workspaces: z.array(trimmedString(MAX_PATH_LENGTH)).max(256).optional(),
  autoSaveEnabled: z.boolean().optional(),
  autoSaveDelayMs: z.number().int().min(MIN_WRITE_AUTOSAVE_DELAY_MS).max(MAX_WRITE_AUTOSAVE_DELAY_MS).optional(),
  inlineCompletion: writeInlineCompletionPatchSchema.optional(),
  selectionAssist: writeSelectionAssistPatchSchema.optional(),
  typography: writeTypographyPatchSchema.optional(),
  agentPresets: z.array(writeAgentPresetSchema).max(24).optional()
}).strict()

const terminalColorPatchSchema = z.object({
  colorMode: z.enum(['native', 'none', 'custom']).optional(),
  foreground: z.string().max(64).optional(),
  background: z.string().max(64).optional(),
  cursor: z.string().max(64).optional(),
  selectionBackground: z.string().max(64).optional(),
  black: z.string().max(64).optional(),
  red: z.string().max(64).optional(),
  green: z.string().max(64).optional(),
  yellow: z.string().max(64).optional(),
  blue: z.string().max(64).optional(),
  magenta: z.string().max(64).optional(),
  cyan: z.string().max(64).optional(),
  white: z.string().max(64).optional(),
  brightBlack: z.string().max(64).optional(),
  brightRed: z.string().max(64).optional(),
  brightGreen: z.string().max(64).optional(),
  brightYellow: z.string().max(64).optional(),
  brightBlue: z.string().max(64).optional(),
  brightMagenta: z.string().max(64).optional(),
  brightCyan: z.string().max(64).optional(),
  brightWhite: z.string().max(64).optional()
}).strict()

const terminalSettingsPatchSchema = z.object({
  colors: terminalColorPatchSchema.optional()
}).strict()

const clawSkillPatchSchema = z.object({
  defaultNames: z.array(trimmedString(128)).max(128).optional(),
  extraDirs: z.array(trimmedString(MAX_PATH_LENGTH)).max(128).optional(),
  disabledDirs: z.array(trimmedString(MAX_PATH_LENGTH)).max(128).optional(),
  promptPrefix: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional()
}).strict()

const clawImPatchSchema = z.object({
  enabled: z.boolean().optional(),
  provider: clawImProviderSchema.optional(),
  port: z.number().int().min(MIN_KUN_LOCAL_PORT).max(65_535).optional(),
  path: trimmedString(MAX_PATH_LENGTH).optional(),
  secret: z.string().max(MAX_BODY_BYTES).optional(),
  weixinBridgeUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
  openClawGatewayUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
  workspaceRoot: defaultPathSchema,
  providerId: z.string().trim().max(64).optional(),
  model: modelIdSchema.optional(),
  mode: clawRunModeSchema.optional(),
  responseTimeoutMs: z.number().int().min(5_000).max(600_000).optional(),
  recentThreadListLimit: z.number().int().min(1).max(50).optional()
}).strict()

const clawImAgentProfilePatchSchema = z.object({
  name: z.string().max(200).optional(),
  description: z.string().max(2_000).optional(),
  identity: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  personality: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  userContext: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  replyRules: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional()
}).strict()

const clawImTelegramProxyPatchSchema = z.object({
  enabled: z.boolean().optional(),
  url: z.string().max(MAX_URL_LENGTH).optional()
}).strict()

const clawImPlatformCredentialPatchSchema = z.union([
  z.object({
    kind: z.literal('feishu').optional(),
    appId: z.string().max(512).optional(),
    appSecret: z.string().max(MAX_BODY_BYTES).optional(),
    domain: z.string().max(512).optional(),
    createdAt: z.string().max(128).optional()
  }).strict(),
  z.object({
    kind: z.literal('weixin'),
    accountId: z.string().max(512).optional(),
    sessionKey: z.string().max(MAX_BODY_BYTES).optional(),
    createdAt: z.string().max(128).optional()
  }).strict(),
  z.object({
    kind: z.literal('telegram'),
    botToken: z.string().max(MAX_BODY_BYTES).optional(),
    allowedChatIds: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
    botUsername: z.string().trim().max(128).optional(),
    proxy: clawImTelegramProxyPatchSchema.optional(),
    createdAt: z.string().max(128).optional()
  }).strict()
])

const clawImRemoteSessionPatchSchema = z.object({
  chatId: z.string().max(MAX_ID_LENGTH).optional(),
  messageId: z.string().max(MAX_ID_LENGTH).optional(),
  threadId: z.string().max(MAX_ID_LENGTH).optional(),
  senderId: z.string().max(MAX_ID_LENGTH).optional(),
  senderName: z.string().max(512).optional(),
  updatedAt: z.string().max(128).optional()
}).strict()

const clawImConversationPatchSchema = z.object({
  id: z.string().max(MAX_ID_LENGTH).optional(),
  chatId: z.string().max(MAX_ID_LENGTH).optional(),
  remoteThreadId: z.string().max(MAX_ID_LENGTH).optional(),
  latestMessageId: z.string().max(MAX_ID_LENGTH).optional(),
  senderId: z.string().max(MAX_ID_LENGTH).optional(),
  senderName: z.string().max(512).optional(),
  localThreadId: z.string().max(MAX_ID_LENGTH).optional(),
  workspaceRoot: defaultPathSchema,
  providerId: z.string().trim().max(64).optional(),
  model: z.string().trim().max(128).optional(),
  createdAt: z.string().max(128).optional(),
  updatedAt: z.string().max(128).optional()
}).strict()

const clawImChannelPatchSchema = z.object({
  id: z.string().max(MAX_ID_LENGTH).optional(),
  provider: clawImProviderSchema.optional(),
  label: z.string().max(512).optional(),
  enabled: z.boolean().optional(),
  providerId: z.string().trim().max(64).optional(),
  model: modelIdSchema.optional(),
  threadId: z.string().max(MAX_ID_LENGTH).optional(),
  workspaceRoot: defaultPathSchema,
  agentProfile: clawImAgentProfilePatchSchema.optional(),
  platformCredential: clawImPlatformCredentialPatchSchema.optional(),
  remoteSession: clawImRemoteSessionPatchSchema.optional(),
  conversations: z.array(clawImConversationPatchSchema).max(512).optional(),
  welcomeSentAt: z.string().max(128).optional(),
  createdAt: z.string().max(128).optional(),
  updatedAt: z.string().max(128).optional(),
  feishuStream: z.boolean().optional()
}).strict()

const clawTaskSchedulePatchSchema = z.object({
  kind: clawScheduleKindSchema.optional(),
  everyMinutes: z.number().int().min(1).max(10_080).optional(),
  timeOfDay: z.string().max(16).optional(),
  atTime: z.string().max(128).optional()
}).strict()

const clawTaskPatchSchema = z.object({
  id: z.string().max(MAX_ID_LENGTH).optional(),
  title: z.string().max(512).optional(),
  enabled: z.boolean().optional(),
  prompt: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  workspaceRoot: defaultPathSchema,
  clawChannelId: z.string().trim().max(MAX_ID_LENGTH).optional(),
  providerId: z.string().trim().max(64).optional(),
  model: modelIdSchema.optional(),
  reasoningEffort: scheduleReasoningEffortSchema.optional(),
  mode: clawRunModeSchema.optional(),
  schedule: clawTaskSchedulePatchSchema.optional(),
  createdAt: z.string().max(128).optional(),
  updatedAt: z.string().max(128).optional(),
  lastRunAt: z.string().max(128).optional(),
  nextRunAt: z.string().max(128).optional(),
  lastStatus: clawTaskStatusSchema.optional(),
  lastMessage: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  lastThreadId: z.string().max(MAX_ID_LENGTH).optional()
}).strict()

const clawSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  skills: clawSkillPatchSchema.optional(),
  im: clawImPatchSchema.optional(),
  channels: z.array(clawImChannelPatchSchema).max(512).optional(),
  tasks: z.array(clawTaskPatchSchema).max(512).optional()
}).strict()

const scheduleSkillPatchSchema = z.object({
  defaultNames: z.array(trimmedString(128)).max(128).optional(),
  extraDirs: z.array(trimmedString(MAX_PATH_LENGTH)).max(128).optional(),
  disabledDirs: z.array(trimmedString(MAX_PATH_LENGTH)).max(128).optional()
}).strict()

const scheduleInternalPatchSchema = z.object({
  port: z.number().int().min(MIN_KUN_LOCAL_PORT).max(65_535).optional(),
  secret: z.string().max(MAX_BODY_BYTES).optional()
}).strict()

const scheduledTaskSchedulePatchSchema = z.object({
  kind: clawScheduleKindSchema.optional(),
  everyMinutes: z.number().int().min(1).max(10_080).optional(),
  timeOfDay: z.string().max(16).optional(),
  atTime: z.string().max(128).optional()
}).strict()

const scheduledTaskPatchSchema = z.object({
  id: z.string().max(MAX_ID_LENGTH).optional(),
  title: z.string().max(512).optional(),
  enabled: z.boolean().optional(),
  prompt: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  workspaceRoot: defaultPathSchema,
  clawChannelId: z.string().trim().max(MAX_ID_LENGTH).optional(),
  providerId: z.string().trim().max(64).optional(),
  model: modelIdSchema.optional(),
  reasoningEffort: scheduleReasoningEffortSchema.optional(),
  mode: clawRunModeSchema.optional(),
  priority: z.number().int().min(0).max(100).optional(),
  dependsOn: z.array(z.string().trim().min(1).max(MAX_ID_LENGTH)).max(32).optional(),
  useWorktree: z.boolean().optional(),
  schedule: scheduledTaskSchedulePatchSchema.optional(),
  createdAt: z.string().max(128).optional(),
  updatedAt: z.string().max(128).optional(),
  lastRunAt: z.string().max(128).optional(),
  nextRunAt: z.string().max(128).optional(),
  lastStatus: clawTaskStatusSchema.optional(),
  lastMessage: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  lastThreadId: z.string().max(MAX_ID_LENGTH).optional()
}).strict()

const sessionDaemonPushPatchSchema = z.object({
  enabled: z.boolean().optional(),
  channelId: z.string().trim().max(MAX_ID_LENGTH).optional(),
  conversationId: z.string().trim().max(MAX_ID_LENGTH).optional()
}).strict()

const sessionDaemonPatchSchema = z.object({
  id: z.string().trim().min(1).max(MAX_ID_LENGTH).optional(),
  title: z.string().trim().max(128).optional(),
  enabled: z.boolean().optional(),
  workspaceRoot: defaultPathSchema.optional(),
  threadId: z.string().trim().max(MAX_ID_LENGTH).optional(),
  scriptPath: z.string().trim().max(1024).optional(),
  interpreter: z.enum(['auto', 'python', 'node']).optional(),
  heartbeatIntervalSeconds: z.number().int().min(5).max(3600).optional(),
  silenceTimeoutSeconds: z.number().int().min(15).max(86_400).optional(),
  restartOnFailure: z.boolean().optional(),
  push: sessionDaemonPushPatchSchema.optional(),
  createdAt: z.string().max(128).optional(),
  updatedAt: z.string().max(128).optional()
}).strict()

const sessionDaemonSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  items: z.array(sessionDaemonPatchSchema).max(256).optional()
}).strict()

const scheduleSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  defaultWorkspaceRoot: defaultPathSchema,
  providerId: z.string().trim().max(64).optional(),
  model: z.union([z.enum(SCHEDULE_MODEL_IDS), modelIdSchema]).optional(),
  mode: clawRunModeSchema.optional(),
  promptPrefix: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  skills: scheduleSkillPatchSchema.optional(),
  keepAwake: z.boolean().optional(),
  internal: scheduleInternalPatchSchema.optional(),
  tasks: z.array(scheduledTaskPatchSchema).max(512).optional(),
  daemons: sessionDaemonSettingsPatchSchema.optional()
}).strict()

// --- Workflow (node-based automation) ---

const designSettingsPatchSchema = z.object({
  defaultWorkspaceRoot: defaultPathSchema,
  workspaces: z.array(trimmedString(MAX_PATH_LENGTH)).max(256).optional(),
  activeWorkspaceRoot: defaultPathSchema,
  brandColor: z.string().trim().max(32).optional(),
  tone: z.array(trimmedString(32)).max(12).optional(),
  designSystemPreset: z
    .enum([
      'none', 'shadcn', 'radix', 'material', 'ios', 'fluent', 'ant',
      'chakra', 'carbon', 'polaris', 'bootstrap', 'geist', 'brutalism', 'editorial'
    ])
    .optional(),
  designType: z.enum(['', 'brand', 'product']).optional(),
  designGuidelines: z.string().max(4000).optional(),
  radius: z.enum(['', 'sharp', 'soft', 'rounded', 'pill']).optional(),
  density: z.enum(['', 'compact', 'cozy', 'spacious']).optional(),
  fontStyle: z.enum(['', 'system', 'geometric', 'humanist', 'serif', 'mono']).optional(),
  model: z.string().trim().max(128).optional(),
  providerId: z.string().trim().max(128).optional(),
  reasoningEffort: z.string().trim().max(32).optional(),
  generationPrompt: z.string().max(6000).optional(),
  implementStackHint: z.string().trim().max(200).optional(),
  injectIntoCode: z.boolean().optional(),
  publishDesignSystem: z.boolean().optional(),
  defaultViewport: z.enum(['mobile', 'tablet', 'desktop']).optional(),
  defaultCanvasView: z.enum(['preview', 'code']).optional(),
  canvasBackground: z.enum(['light', 'dark']).optional(),
  liveRefresh: z.boolean().optional(),
  deviceFrame: z.boolean().optional()
}).strict()

function stripLegacySettingsPatchKeys(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return payload
  const source = payload as Record<string, unknown>
  const next: Record<string, unknown> = { ...source }

  delete next.agentProvider
  delete next.deepseek
  delete next.reasonix
  delete next.quickChat

  if (typeof next.agents === 'object' && next.agents !== null && !Array.isArray(next.agents)) {
    const agents = { ...(next.agents as Record<string, unknown>) }
    delete agents.codewhale
    delete agents.reasonix
    delete agents.quickChat
    next.agents = agents
  }

  return next
}

const settingsPatchObjectSchema = z.object({
  version: z.literal(1).optional(),
  initialSetupCompleted: z.boolean().optional(),
  locale: localeSchema.optional(),
  theme: themeSchema.optional(),
  uiFontScale: uiFontScaleSchema.optional(),
  chatContentMaxWidthPx: chatContentMaxWidthSchema.optional(),
  composerSendKey: z.enum(['enter', 'shiftEnter']).optional(),
  cursorSpotlight: z.boolean().optional(),
  cursorSpotlightColor: hexColorSchema.optional(),
  darkUiColors: darkUiColorsPatchSchema.optional(),
  provider: modelProviderPatchSchema.optional(),
  agents: z.object({
    kun: kunRuntimePatchSchema.optional()
  }).strict().optional(),
  workspaceRoot: defaultPathSchema,
  conversationWorkspaceRoot: defaultPathSchema,
  log: logPatchSchema.optional(),
  checkpointCleanup: checkpointCleanupPatchSchema.optional(),
  gitBranchPrefix: trimmedString(128).or(z.literal('')).optional(),
  notifications: notificationsPatchSchema.optional(),
  appBehavior: appBehaviorPatchSchema.optional(),
  keyboardShortcuts: keyboardShortcutsPatchSchema.optional(),
  write: writeSettingsPatchSchema.optional(),
  claw: clawSettingsPatchSchema.optional(),
  schedule: scheduleSettingsPatchSchema.optional(),
  workflow: workflowSettingsPatchSchema.optional(),
  design: designSettingsPatchSchema.optional(),
  terminal: terminalSettingsPatchSchema.optional(),
  guiUpdate: z.object({
    channel: z.enum(GUI_UPDATE_CHANNELS).optional()
  }).strict().optional(),
  codePromptPrefix: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  chatWelcomeMessage: z.string().max(200).optional(),
  codeAgentPersonaEnabled: z.boolean().optional(),
  codeAgentPresets: z.array(codeAgentPresetSchema).max(24).optional(),
  disabledSkillIds: z.array(trimmedString(128)).max(512).optional()
}).strict()

export const settingsPatchSchema = z.preprocess(stripLegacySettingsPatchKeys, settingsPatchObjectSchema)

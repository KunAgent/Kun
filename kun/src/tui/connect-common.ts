import {
  Editor,
  Input,
  Markdown,
  ProcessTerminal,
  TUI,
  decodeKittyPrintable,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type EditorTheme,
  type Focusable,
  type MarkdownTheme,
  type OverlayHandle,
  type SelectListTheme,
  type SlashCommand
} from '@earendil-works/pi-tui'
import {
  providerCatalogEntries,
  type ProviderCatalogAuthFlow,
  type ProviderCatalogAuthType,
  type ProviderCatalogCredentialRequirement,
  type ProviderCatalogKind
} from '@kun/provider-catalog'
import { spawn } from 'node:child_process'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, sep } from 'node:path'
import { stdin as processStdin, stdout as processStdout } from 'node:process'
import { redactSecrets, redactSecretText } from '../config/secret-redaction.js'
import { withRuntimeDataDirAncillaryWriter } from '../server/runtime-data-dir-lease.js'
import type { AttachmentMetadata } from '../contracts/attachments.js'
import type { TurnItem } from '../contracts/items.js'
import type { ModelReasoningEffort } from '../contracts/capabilities.js'
import {
  KUN_TOOL_PERMISSION_MODES,
  kunToolPermissionModeFromSettings,
  kunToolPermissionModeSettings,
  type ApprovalPolicy,
  type ApprovalReviewer,
  type KunToolPermissionMode,
  type SandboxMode
} from '../contracts/policy.js'
import {
  isModelConnectionProfileUsable,
  type ClaudeSdkInstallStatus,
  type ModelConnectionOAuthStatus,
  type ModelConnectionProfile,
  type ModelConnectionSnapshot
} from '../contracts/model-connections.js'
import type { TuiCommand, TuiCommandDefinition } from './commands.js'
import { parseTuiCommand, TUI_COMMAND_DEFINITIONS, TUI_SLASH_COMMANDS } from './commands.js'
import { runSelfUpdateCommand } from '../cli/self-update.js'
import {
  activityFrame,
  formatContextGauge,
  formatTokenCount,
  type ActivityVisualKind
} from './activity.js'
import { parseTuiKeymapConfig, type TuiKeyAction, type TuiKeymap } from './keymap.js'
import { TuiClientError, type KunTuiClient, type SkillsSnapshot } from './client.js'
import type { TuiControllerState } from './controller.js'
import { TuiController } from './controller.js'
import {
  sanitizeTerminalText as stripTerminalControls,
  wrapText
} from './layout.js'
import { codeFenceLanguage, highlightTerminalCode, terminalAssistantMarkdown } from './markdown-code.js'
import {
  contextualFooter,
  pageFrame,
  sectionLabel,
  selectionRow,
  statusGlyph,
  visual,
  visualDensity
} from './visual-system.js'
import { InlineStreamTerminal, ScrollbackPreservingTerminal } from './pi-terminal.js'
import { ProviderQuotaDialog } from './provider-quota.js'
import { UsageDialog } from './usage-report.js'
import {
  installAntigravityCli,
  resolveAntigravityCliCommand,
  resolveGeminiCliCommand,
  type OfficialProviderCliId
} from '../services/official-provider-cli.js'
import {
  copyWithSystemClipboard,
  editTextInExternalEditor,
  lastAssistantText,
  osc52ClipboardSequence,
  renderThreadMarkdown,
  runInteractiveProviderCli,
  writeThreadExport
} from './operations.js'
import {
  applyRuntimeEvent,
  hydrateProjectedChildRuns,
  matchingRequestContextSnapshot,
  projectThreadSnapshot,
  type ProjectedApprovalReview,
  type ProjectedChildRun,
  type ProjectedTurnActivity,
  type ThreadProjection
} from './state.js'
import type { TerminalInput, TerminalOutput } from './pi-terminal.js'
import {
  latestTuiGraphRun,
  moveTuiGraphBoardSelection,
  projectTuiGraphBoard,
  type TuiGraphBoardNode,
  type TuiGraphBoardProjection,
  summarizeTuiGraphRun
} from './graph-mode.js'
import {
  answerCurrentUserInputWithText,
  confirmCurrentUserInput,
  createUserInputSession,
  currentUserInputQuestion,
  isUserInputSessionComplete,
  moveUserInputOption,
  orderedUserInputAnswers,
  selectedUserInputLabels,
  toggleCurrentUserInputOption,
  type UserInputSession
} from './user-input.js'
import {
  ClipboardImageError,
  clipboardImageEmptyHint,
  readClipboardImage,
  type ClipboardImage
} from './clipboard-image.js'
import { WorkspaceFileAutocompleteProvider } from './file-mentions.js'
import { bold, dim, blue, cyan, green, yellow, red, magenta, italic, isCancelInput, EXIT_CONFIRM_WINDOW_MS, UNDO_ESCAPE_WINDOW_MS, TOTAL_ELAPSED_MIN_START_GAP_MS, BRACKETED_PASTE_START, BRACKETED_PASTE_END, ENABLE_MOUSE_TRACKING, DISABLE_MOUSE_TRACKING, DIRECT_SEMANTIC_ACTIONS, sanitizeTerminalText, selectTheme, editorTheme, markdownTheme, parseSgrMouseEvent, writeLocalShareSnapshot, removeLocalShareSnapshot, type SgrMouseEvent, type ExclusiveRouteHandle } from './pi-common.js'

export type ConnectionPreset = {
  id: string
  presetSource?: string
  name: string
  category: 'Free' | 'Subscription' | 'API'
  kind: ProviderCatalogKind
  authFlow: ProviderCatalogAuthFlow
  authType: ProviderCatalogAuthType
  credentialRequirement: ProviderCatalogCredentialRequirement
  baseUrl?: string
  endpointFormat: 'chat_completions' | 'responses' | 'messages' | 'custom_endpoint'
  models: string[]
  docsUrl?: string
  credentialUrl?: string
}

export const connectionPresets: ConnectionPreset[] = [
  {
    id: 'custom', name: 'Custom provider', category: 'API', kind: 'http',
    authFlow: 'api-key', authType: 'api-key', credentialRequirement: 'required',
    endpointFormat: 'chat_completions', models: []
  },
  ...providerCatalogEntries().map((entry): ConnectionPreset => ({
    id: entry.profileId,
    presetSource: entry.presetSource,
    name: entry.label,
    category: entry.category === 'free'
      ? 'Free'
      : entry.category === 'subscription' ? 'Subscription' : 'API',
    kind: entry.kind,
    authFlow: entry.authFlow,
    authType: entry.authType,
    credentialRequirement: entry.credentialRequirement,
    ...(entry.baseUrl ? { baseUrl: entry.baseUrl } : {}),
    endpointFormat: entry.endpointFormat,
    models: [...entry.models],
    docsUrl: entry.docsUrl,
    credentialUrl: entry.credentialUrl
  }))
]

export function connectionPresetForProfile(profile: ModelConnectionProfile): ConnectionPreset | undefined {
  const identities = [profile.presetSource, profile.id].filter((value): value is string => Boolean(value))
  const exact = connectionPresets.find((entry) => identities.includes(entry.id))
  if (exact) return exact
  return [...connectionPresets]
    .filter((entry) => entry.id !== 'custom')
    .sort((left, right) => right.id.length - left.id.length)
    .find((entry) => identities.some((identity) =>
      identity.startsWith(`${entry.id}-`) && /^\d+$/u.test(identity.slice(entry.id.length + 1))
    ))
}

export function credentialAvailabilityLabel(
  profile: Pick<ModelConnectionProfile, 'configured' | 'credentialStatus'>
): string {
  if (profile.credentialStatus === 'missing') return 'Credential missing'
  if (profile.credentialStatus === 'unreadable') return 'Credential unreadable'
  return isModelConnectionProfileUsable(profile) ? 'Connected' : 'Needs configuration'
}

export const CONNECT_ENDPOINT_FORMATS = ['chat_completions', 'responses', 'messages', 'custom_endpoint'] as const

export type ConnectField = 'id' | 'name' | 'baseUrl' | 'endpointFormat' | 'credential' | 'models'

export function connectionRequiresCredential(preset: ConnectionPreset): boolean {
  return preset.credentialRequirement === 'required'
}

export type ManagementAction = {
  kind: 'rename' | 'reconnect' | 'credential' | 'probe' | 'disconnect' | 'back'
  label: string
}

export function authenticationStrategy(
  authFlow: ProviderCatalogAuthFlow
): 'secret' | 'runtime' | 'official-cli' {
  switch (authFlow) {
    case 'api-key':
    case 'cursor-api-key':
      return 'secret'
    case 'chatgpt-oauth':
    case 'grok-oauth':
    case 'claude-subscription':
      return 'runtime'
    case 'gemini-subscription':
    case 'gemini-cli-subscription':
      return 'official-cli'
  }
}

export function managementActions(
  profile: ModelConnectionProfile,
  preset: ConnectionPreset | undefined
): ManagementAction[] {
  const strategy = preset ? authenticationStrategy(preset.authFlow) : undefined
  return [
    { kind: 'rename', label: 'Rename connection' },
    ...(strategy === 'runtime' || strategy === 'official-cli'
      ? [{ kind: 'reconnect', label: 'Sign in again / reconnect' }] satisfies ManagementAction[]
      : profile.kind === 'http' || profile.kind === 'cursor-sdk'
      ? [{ kind: 'credential', label: 'Replace credential' }] satisfies ManagementAction[]
      : []),
    ...(profile.kind === 'http'
      ? [{ kind: 'probe', label: 'Probe connection and models' }] satisfies ManagementAction[]
      : []),
    { kind: 'disconnect', label: 'Disconnect and remove credential' },
    { kind: 'back', label: 'Back to connections' }
  ]
}

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
import { authenticationStrategy, connectionPresetForProfile, connectionRequiresCredential, credentialAvailabilityLabel, connectionPresets, managementActions, type ConnectionPreset, type ConnectField, type ManagementAction } from './connect-common.js'
import { ConnectDialogManagement } from './connect-dialog-management.js'
import { endpointFormat, fieldLabel, isModelProbeFailure, normalizeConnectionProviderId, openBrowser } from './model-dialog.js'
import { printableInput } from './render-utils.js'
import { redactExactSecret, safeError } from './render-layout.js'

export class ConnectDialog extends ConnectDialogManagement {
  protected override choosePreset(preset: ConnectionPreset): void {
    this.preset = preset
    this.search.focused = false
    this.error = ''
    this.notice = ''
    this.allowUnprobedSave = false
    const strategy = authenticationStrategy(preset.authFlow)
    if (strategy === 'runtime') {
      if (preset.authFlow === 'claude-subscription') void this.beginClaude(preset)
      else void this.beginOAuth(preset)
      return
    }
    if (strategy === 'official-cli') {
      void this.beginOfficialCli(preset)
      return
    }
    const customId = preset.id === 'custom' ? this.suggestCustomProviderId() : undefined
    this.fields = [
      ...(preset.id === 'custom' ? ['id', 'name', 'baseUrl', 'endpointFormat'] as ConnectField[] : []),
      ...((preset.kind === 'http' || preset.kind === 'cursor-sdk') &&
          preset.credentialRequirement !== 'none'
        ? ['credential'] as ConnectField[]
        : []),
      'models'
    ]
    this.values = {
      id: customId,
      name: preset.id === 'custom'
        ? `Custom provider ${this.snapshot.providers.length + 1}`
        : preset.name,
      baseUrl: preset.baseUrl ?? (preset.id === 'custom' ? 'https://api.example.com/v1' : undefined),
      endpointFormat: preset.endpointFormat,
      models: preset.models.join(', ')
    }
    this.fieldIndex = 0
    this.value = this.values[this.fields[0]!] ?? ''
  }

  protected async beginOfficialCli(preset: ConnectionPreset): Promise<void> {
    this.saving = true
    this.error = ''
    this.notice = preset.authFlow === 'gemini-cli-subscription'
      ? 'Opening the official Gemini CLI for Google sign-in…'
      : 'Opening the official Antigravity CLI for Google sign-in…'
    this.officialCli = preset.authFlow === 'gemini-cli-subscription'
      ? 'gemini-cli'
      : 'antigravity'
    this.tui.requestRender()
    try {
      const provider = this.officialCli
      await this.authenticateOfficialProvider(provider)
      const snapshot = await this.controller.client.completeModelCliAuth({
        expectedRevision: this.snapshot.revision,
        provider,
        model: preset.models[0],
        select: true
      })
      this.snapshot = snapshot
      this.controller.applyModelSelection(snapshot)
      this.clearSensitiveDraft()
      this.closed = true
      this.close()
    } catch (error) {
      this.error = await this.mutationError(error)
      this.notice = ''
      this.officialCli = undefined
    } finally {
      this.saving = false
      this.tui.requestRender()
    }
  }

  protected async beginClaude(preset: ConnectionPreset): Promise<void> {
    this.saving = true
    this.error = ''
    this.tui.requestRender()
    try {
      this.claudeSdk = await this.controller.client.claudeSdkStatus()
      if (!this.claudeSdk.installed) this.claudeSdk = await this.controller.client.installClaudeSdk()
      this.tui.requestRender()
      while (!this.closed && !this.claudeSdk.installed && this.claudeSdk.status === 'downloading') {
        await new Promise((resolve) => setTimeout(resolve, 1_000))
        this.claudeSdk = await this.controller.client.claudeSdkStatus()
        this.tui.requestRender()
      }
      if (this.closed) return
      if (!this.claudeSdk.installed) throw new Error(this.claudeSdk.message || 'Claude Code installation failed')
      this.claudeSdk = undefined
      this.oauth = await this.controller.client.startModelOAuth({
        expectedRevision: this.snapshot.revision,
        provider: 'claude',
        model: preset.models[0],
        select: true
      })
      this.saving = false
      this.tui.requestRender()
      void this.pollOAuth()
    } catch (error) {
      this.saving = false
      this.error = await this.mutationError(error)
      this.claudeSdk = this.claudeSdk?.status === 'error' ? this.claudeSdk : undefined
      this.tui.requestRender()
    }
  }

  protected async beginOAuth(preset: ConnectionPreset): Promise<void> {
    this.saving = true
    this.error = ''
    this.tui.requestRender()
    try {
      this.oauth = await this.controller.client.startModelOAuth({
        expectedRevision: this.snapshot.revision,
        provider: preset.authFlow === 'chatgpt-oauth' ? 'chatgpt' : 'grok',
        model: preset.models[0],
        select: true
      })
      this.saving = false
      if (this.oauth.url) openBrowser(this.oauth.url)
      this.tui.requestRender()
      void this.pollOAuth()
    } catch (error) {
      this.saving = false
      this.error = await this.mutationError(error)
      this.tui.requestRender()
    }
  }

  protected override async refreshOAuth(): Promise<void> {
    if (!this.oauth || this.oauth.status !== 'pending') return
    try {
      this.oauth = await this.controller.client.modelOAuthStatus(this.oauth.sessionId)
      this.finishOAuthIfConnected()
    } catch (error) {
      this.error = safeError(error)
    }
    this.tui.requestRender()
  }

  protected override async submitOAuthCode(): Promise<void> {
    if (!this.oauth || this.oauth.provider !== 'grok' || this.oauth.status !== 'pending') return
    const sessionId = this.oauth.sessionId
    const code = this.oauthCode.trim()
    if (!code) return
    this.oauthCode = ''
    this.saving = true
    this.error = ''
    this.tui.requestRender()
    try {
      this.oauth = await this.controller.client.submitModelOAuth(sessionId, code)
      this.finishOAuthIfConnected()
    } catch (error) {
      this.error = redactExactSecret(safeError(error), code)
    } finally {
      this.saving = false
      this.tui.requestRender()
    }
  }

  protected finishOAuthIfConnected(): void {
    if (this.oauth?.status !== 'connected' || !this.oauth.snapshot) return
    this.snapshot = this.oauth.snapshot
    this.controller.applyModelSelection(this.snapshot)
    this.oauthCode = ''
    this.closed = true
    this.close()
  }

  protected async pollOAuth(): Promise<void> {
    while (!this.closed && this.oauth?.status === 'pending') {
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, this.oauth?.interval ?? 2) * 1000))
      if (this.closed) return
      await this.refreshOAuth()
    }
  }

  protected override async next(): Promise<void> {
    const field = this.fields[this.fieldIndex]!
    const trimmed = this.value.trim()
    if (field !== 'credential' && !trimmed) {
      this.error = `${fieldLabel(field, this.preset!)} is required.`
      this.tui.requestRender()
      return
    }
    if (field === 'id') {
      const normalized = normalizeConnectionProviderId(trimmed)
      if (!normalized) {
        this.error = 'Provider ID must contain letters, numbers, dots, underscores, or dashes.'
        this.tui.requestRender()
        return
      }
      if (this.snapshot.providers.some((profile) => profile.id === normalized)) {
        this.error = `Provider ID “${normalized}” already exists. Choose a unique ID.`
        this.tui.requestRender()
        return
      }
      this.value = normalized
    }
    if (field === 'baseUrl') {
      try {
        const url = new URL(trimmed)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol')
      } catch {
        this.error = 'Base URL must be a valid HTTP or HTTPS URL.'
        this.tui.requestRender()
        return
      }
    }
    if (
      field === 'credential' &&
      !trimmed &&
      connectionRequiresCredential(this.preset!)
    ) {
      this.error = 'Credential is required and is never echoed or logged.'
      this.tui.requestRender()
      return
    }
    this.values[field] = this.value.trim()
    if (this.fieldIndex < this.fields.length - 1) {
      this.fieldIndex += 1
      this.value = this.values[this.fields[this.fieldIndex]!] ?? ''
      this.allowUnprobedSave = false
      this.tui.requestRender()
      return
    }
    await this.saveConnection(true)
  }

  protected override async saveConnection(probe: boolean): Promise<void> {
    const preset = this.preset
    if (!preset) return
    this.saving = true
    this.error = ''
    this.allowUnprobedSave = false
    this.tui.requestRender()
    try {
      const models = (this.values.models ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)
      const snapshot = await this.controller.client.connectModel({
        expectedRevision: this.snapshot.revision,
        ...(preset.id !== 'custom'
          ? { id: preset.id, presetSource: preset.presetSource ?? preset.id }
          : this.values.id ? { id: normalizeConnectionProviderId(this.values.id) } : {}),
        name: this.values.name ?? preset.name,
        kind: preset.kind,
        authType: preset.authType,
        ...(this.values.baseUrl ? { baseUrl: this.values.baseUrl } : {}),
        endpointFormat: endpointFormat(this.values.endpointFormat),
        ...(this.values.credential ? { credential: this.values.credential } : {}),
        models,
        ...(models[0] ? { selectedModel: models[0] } : {}),
        probe: preset.kind === 'http' && probe,
        select: true
      })
      this.snapshot = snapshot
      this.controller.applyModelSelection(snapshot)
      this.clearSensitiveDraft()
      this.closed = true
      this.close()
    } catch (error) {
      this.saving = false
      const message = await this.mutationError(error)
      const models = (this.values.models ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)
      this.allowUnprobedSave = probe && preset.kind === 'http' && models.length > 0 && isModelProbeFailure(error)
      this.error = this.allowUnprobedSave
        ? `${message} Review the endpoint, or press Ctrl+S to save the supplied models without probing.`
        : message
      this.tui.requestRender()
    }
  }

  protected suggestCustomProviderId(): string {
    const used = new Set(this.snapshot.providers.map((profile) => profile.id))
    let index = this.snapshot.providers.length + 1
    let id = `custom-provider-${index}`
    while (used.has(id)) {
      index += 1
      id = `custom-provider-${index}`
    }
    return id
  }

  protected override resetPreset(): void {
    this.clearSensitiveDraft()
    this.preset = undefined
    this.oauth = undefined
    this.oauthCode = ''
    this.claudeSdk = undefined
    this.officialCli = undefined
    this.fields = []
    this.fieldIndex = 0
    this.error = ''
    this.notice = ''
    this.allowUnprobedSave = false
    this.catalogOpen = true
    this.search.focused = this._focused
  }

  protected override clearSensitiveDraft(): void {
    if (this.values.credential) this.values.credential = ''
    this.values = {}
    this.value = ''
    this.oauthCode = ''
    this.bracketedPaste = false
  }

  protected override textInput(data: string): string | undefined {
    const start = '\x1b[200~'
    const end = '\x1b[201~'
    let text = data
    let pasted = this.bracketedPaste
    const startIndex = text.indexOf(start)
    if (startIndex >= 0) {
      pasted = true
      this.bracketedPaste = true
      text = text.slice(startIndex + start.length)
    }
    const endIndex = text.indexOf(end)
    if (endIndex >= 0) {
      pasted = true
      this.bracketedPaste = false
      text = text.slice(0, endIndex)
    }
    return pasted ? stripTerminalControls(text) : printableInput(data)
  }

  protected override async mutationError(error: unknown): Promise<string> {
    if (!(error instanceof TuiClientError) || error.status !== 409) return safeError(error)
    try {
      const snapshot = await this.controller.client.modelConnections()
      this.updateSnapshot(snapshot)
      this.controller.applyModelSelection(snapshot, false)
      return 'Connections changed in another client. The latest list is loaded; review and retry.'
    } catch (refreshError) {
      return safeError(refreshError)
    }
  }
}

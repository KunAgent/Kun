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
import { credentialAvailabilityLabel, type ConnectionPreset, type ConnectField, connectionPresetForProfile } from './connect-common.js'
import { popupFrame } from './render-utils.js'
import { safeError } from './render-layout.js'

export class ModelDialog implements Component, Focusable {
  private readonly input = new Input()
  private _focused = false
  private index = 0
  private saving = false
  private error = ''
  private mode: 'models' | 'providers' = 'models'
  private providerFilter?: string
  private allEntries: Array<{
    providerId: string
    accountId: string
    model: string
    label: string
    usable: boolean
  }> = []

  constructor(
    private readonly tui: TUI,
    private readonly controller: TuiController,
    private readonly keymap: TuiKeymap,
    private snapshot: ModelConnectionSnapshot,
    private readonly close: () => void
  ) {
    this.rebuildEntries()
  }

  get focused(): boolean { return this._focused }
  set focused(value: boolean) { this._focused = value; this.input.focused = value }

  updateSnapshot(snapshot: ModelConnectionSnapshot): void {
    if (snapshot.revision <= this.snapshot.revision) return
    const selected = this.entries()[this.index]
    this.snapshot = snapshot
    this.rebuildEntries(selected)
    if (this.providerFilter && !snapshot.providers.some((profile) =>
      `${profile.id}\0${profile.accountId}` === this.providerFilter
    )) {
      this.providerFilter = undefined
      this.mode = 'models'
    }
    this.error = ''
    this.tui.requestRender()
  }

  private rebuildEntries(preferred?: { providerId: string; accountId: string; model: string }): void {
    const entries = new Map<string, {
      providerId: string
      accountId: string
      model: string
      label: string
      usable: boolean
    }>()
    for (const provider of this.snapshot.providers) {
      const models = new Set(provider.models)
      if (provider.selectedModel) models.add(provider.selectedModel)
      if (provider.id === this.snapshot.defaultProviderId && this.snapshot.defaultModel) models.add(this.snapshot.defaultModel)
      for (const model of models) {
        const key = `${provider.id}\0${provider.accountId}\0${model}`
        entries.set(key, {
          providerId: provider.id,
          accountId: provider.accountId,
          model,
          label: `${provider.name} · ${model}`,
          usable: isModelConnectionProfileUsable(provider)
        })
      }
    }
    this.allEntries = [...entries.values()]
      .sort((a, b) => Number(this.controller.isModelFavorite(b.providerId, b.accountId, b.model)) - Number(this.controller.isModelFavorite(a.providerId, a.accountId, a.model)))
    const target = preferred ?? {
      providerId: this.snapshot.defaultProviderId ?? '',
      accountId: this.snapshot.defaultAccountId ?? '',
      model: this.snapshot.defaultModel ?? ''
    }
    const selected = this.allEntries.findIndex((entry) =>
      entry.providerId === target.providerId &&
      entry.accountId === target.accountId &&
      entry.model === target.model
    )
    this.index = Math.max(0, selected)
  }

  private entries(): Array<{
    providerId: string
    accountId: string
    model: string
    label: string
    usable: boolean
  }> {
    const query = this.input.getValue().trim().toLowerCase()
    const entries = this.providerFilter
      ? this.allEntries.filter((entry) => `${entry.providerId}\0${entry.accountId}` === this.providerFilter)
      : this.allEntries
    return query
      ? entries.filter((entry) => `${entry.label} ${entry.providerId} ${entry.accountId}`.toLowerCase().includes(query))
      : entries
  }

  private providers(): ModelConnectionProfile[] {
    const query = this.input.getValue().trim().toLowerCase()
    return this.snapshot.providers.filter((provider) => {
      if (!provider.models.length && !provider.selectedModel) return false
      return !query || `${provider.name} ${provider.id} ${provider.accountId}`.toLowerCase().includes(query)
    })
  }

  render(width: number): string[] {
    const inner = Math.max(16, width - 2)
    const title = this.mode === 'providers' ? 'Providers & accounts' : 'Models'
    const current = this.snapshot.defaultProviderId && this.snapshot.defaultModel
      ? `${this.snapshot.defaultProviderId} / ${this.snapshot.defaultModel}`
      : 'not selected'
    const lead = [
      ` ${dim('Search')}  ${this.input.render(Math.max(10, inner - 10)).join(' ')}`,
      ''
    ]
    if (this.mode === 'providers') {
      const providers = this.providers()
      this.index = Math.min(this.index, Math.max(0, providers.length - 1))
      const rows = visibleWindow(providers, this.index, 14).map(({ value: provider, index }) => {
        const selected = index === this.index
        const usable = isModelConnectionProfileUsable(provider)
        const count = new Set([...provider.models, ...(provider.selectedModel ? [provider.selectedModel] : [])]).size
        return selectionRow(
          `${statusGlyph(usable ? 'success' : 'warning')} ${sanitizeTerminalText(provider.name)}  ${dim(provider.accountId)}`,
          `${count} model${count === 1 ? '' : 's'}${usable ? '' : ` · ${credentialAvailabilityLabel(provider)}`}`,
          inner,
          selected
        )
      })
      return pageFrame({
        path: ['KUN', title],
        right: `Current · ${sanitizeTerminalText(current)}`,
        description: 'Choose an account to filter the shared model catalog.',
        body: [
          ...lead,
          ...(rows.length ? rows : [` ${dim('No providers with model catalogs. Run /connect first.')}`])
        ],
        footer: [
          { key: 'Enter', label: 'open' },
          { key: this.keymap.display('model_provider_list'), label: 'all models' },
          { key: 'Esc', label: 'back' }
        ],
        width
      })
    }
    const entries = this.entries()
    this.index = Math.min(this.index, Math.max(0, entries.length - 1))
    const rows: string[] = []
    let group = ''
    visibleWindow(entries, this.index, 14).forEach(({ value: entry, index }) => {
      const selected = index === this.index
      const active = entry.providerId === this.snapshot.defaultProviderId &&
        entry.accountId === this.snapshot.defaultAccountId &&
        entry.model === this.snapshot.defaultModel
      const favorite = this.controller.isModelFavorite(entry.providerId, entry.accountId, entry.model)
      const nextGroup = `${entry.providerId} · ${entry.accountId}`
      if (nextGroup !== group) {
        group = nextGroup
        rows.push(sectionLabel(group, inner))
      }
      rows.push(selectionRow(
        `${favorite ? yellow('★') : dim('☆')} ${sanitizeTerminalText(entry.label)}`,
        `${entry.providerId}${active ? ' · current' : ''}${entry.usable ? '' : ' · connect'}`,
        inner,
        selected
      ))
    })
    const selected = entries[this.index]
    return pageFrame({
      path: ['KUN', title],
      right: `Current · ${sanitizeTerminalText(current)}`,
      description: 'Choose the shared default model.',
      body: [
        ...lead,
        ...(rows.length ? rows : [` ${dim('No model catalogs. Run /connect first.')}`]),
        ...(selected && visualDensity(width) === 'wide'
          ? [
              '',
              ` ${dim('Selected')}  ${sanitizeTerminalText(selected.providerId)} / ${cyan(sanitizeTerminalText(selected.model))}`
            ]
          : []),
        ...(this.error ? [` ${red(this.error)}`] : [])
      ],
      footer: this.saving
        ? [{ key: statusGlyph('running'), label: 'saving' }]
        : [
            { key: 'Enter', label: 'select' },
            { key: this.keymap.display('model_provider_list'), label: 'providers' },
            { key: this.keymap.display('model_favorite_toggle'), label: 'favorite' },
            { key: 'Esc', label: 'back' }
          ],
      width
    })
  }

  handleInput(data: string): void {
    if (this.saving) return
    if (isCancelInput(data)) { this.close(); return }
    if (this.keymap.matches('model_provider_list', data)) {
      this.mode = this.mode === 'models' ? 'providers' : 'models'
      this.index = 0
      this.tui.requestRender()
      return
    }
    const entries = this.entries()
    const max = this.mode === 'providers' ? this.providers().length - 1 : entries.length - 1
    if (matchesKey(data, 'up') || matchesKey(data, 'ctrl+p')) this.index = Math.max(0, this.index - 1)
    else if (matchesKey(data, 'down') || matchesKey(data, 'ctrl+n')) this.index = Math.min(Math.max(0, max), this.index + 1)
    else if (matchesKey(data, 'pageUp')) this.index = Math.max(0, this.index - 10)
    else if (matchesKey(data, 'pageDown')) this.index = Math.min(Math.max(0, max), this.index + 10)
    else if (matchesKey(data, 'home')) this.index = 0
    else if (matchesKey(data, 'end')) this.index = Math.max(0, max)
    else if (this.keymap.matches('model_favorite_toggle', data) && this.mode === 'models' && entries[this.index]) {
      const entry = entries[this.index]!
      this.controller.toggleModelFavorite(entry.providerId, entry.accountId, entry.model)
    } else if (matchesKey(data, 'enter') && this.mode === 'providers') {
      const provider = this.providers()[this.index]
      if (provider) {
        this.providerFilter = `${provider.id}\0${provider.accountId}`
        this.mode = 'models'
        this.index = 0
      }
    } else if (matchesKey(data, 'enter') && entries[this.index]) void this.select(entries[this.index]!)
    else {
      this.input.handleInput(data)
      this.index = 0
    }
    this.tui.requestRender()
  }

  invalidate(): void { this.input.invalidate() }

  private async select(entry: {
    providerId: string
    accountId: string
    model: string
    usable: boolean
  }): Promise<void> {
    if (!entry.usable) {
      this.error = `${entry.providerId} is not connected. Run /connect to configure it before selecting this model.`
      this.tui.requestRender()
      return
    }
    this.saving = true
    try {
      this.snapshot = await this.controller.selectModel({
        providerId: entry.providerId,
        accountId: entry.accountId,
        model: entry.model
      })
      this.close()
    } catch (error) {
      this.saving = false
      this.error = safeError(error)
      this.tui.requestRender()
    }
  }
}

export function visibleWindow<T>(values: readonly T[], selected: number, size: number): Array<{ value: T; index: number }> {
  const start = Math.max(0, Math.min(selected - Math.floor(size / 2), Math.max(0, values.length - size)))
  return values.slice(start, start + size).map((value, offset) => ({ value, index: start + offset }))
}

export function fieldLabel(field: ConnectField | undefined, preset: ConnectionPreset): string {
  switch (field) {
    case 'id': return 'Provider ID'
    case 'name': return 'Provider name'
    case 'baseUrl': return 'Base URL'
    case 'endpointFormat': return 'Endpoint format'
    case 'credential': {
      const label = preset.authType === 'oauth' ? 'OAuth credential' : 'API key / token plan key'
      return preset.credentialRequirement === 'optional' ? `${label} (optional)` : label
    }
    case 'models': return 'Models (comma separated)'
    default: return ''
  }
}

export function fieldPlaceholder(field: ConnectField | undefined): string {
  if (field === 'credential') return 'hidden input'
  if (field === 'id') return 'for example: company-proxy'
  if (field === 'name') return 'display name'
  if (field === 'baseUrl') return 'https://api.example.com/v1'
  if (field === 'models') return 'model-a, model-b'
  return 'type a value'
}

export function endpointFormat(value: string | undefined): 'chat_completions' | 'responses' | 'messages' | 'custom_endpoint' {
  return value === 'responses' || value === 'messages' || value === 'custom_endpoint'
    ? value
    : 'chat_completions'
}

export function normalizeConnectionProviderId(value: string): string {
  return value.trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 100)
}

export function isModelProbeFailure(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return message.includes('provider probe failed') ||
    message.includes('model probe failed') ||
    message.includes('fetch failed') ||
    message.includes('failed to fetch') ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('/models')
}

export function openBrowser(
  url: string,
  spawnFn: typeof spawn = spawn,
  platform: NodeJS.Platform = process.platform
): void {
  const launch = platform === 'darwin'
    ? { command: 'open', args: [url] }
    : platform === 'win32'
      ? { command: 'cmd.exe', args: ['/d', '/s', '/c', 'start', '', url] }
      : { command: 'xdg-open', args: [url] }
  try {
    const child = spawnFn(launch.command, launch.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    // spawn() reports a missing desktop opener asynchronously. Consume that
    // event so headless/SSH TUI sessions keep running with the visible,
    // copyable authorization URL as their fallback.
    child.once('error', () => undefined)
    child.unref()
  } catch {
    // The URL remains visible and copyable when no desktop opener exists.
  }
}

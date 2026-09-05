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
import { CONNECT_ENDPOINT_FORMATS, authenticationStrategy, connectionPresetForProfile, credentialAvailabilityLabel, connectionPresets, managementActions, type ConnectionPreset, type ConnectField, type ManagementAction } from './connect-common.js'
import { popupFrame } from './render-utils.js'
import { formatBytes } from './render-layout.js'
import { endpointFormat, fieldLabel, fieldPlaceholder, openBrowser, visibleWindow } from './model-dialog.js'

export abstract class ConnectDialogBase implements Component, Focusable {
  protected readonly search = new Input()
  protected _focused = true
  protected connectionIndex = 0
  protected catalogOpen = false
  protected catalogIndex = 0
  protected preset?: ConnectionPreset
  protected management?: {
    profile: ModelConnectionProfile
    mode: 'menu' | 'rename' | 'credential' | 'confirm-delete'
    index: number
    connectAfterCredential?: boolean
  }
  protected fields: ConnectField[] = []
  protected fieldIndex = 0
  protected value = ''
  protected values: Partial<Record<ConnectField, string>> = {}
  protected saving = false
  protected error = ''
  protected notice = ''
  protected allowUnprobedSave = false
  protected oauth?: ModelConnectionOAuthStatus
  protected oauthCode = ''
  protected bracketedPaste = false
  protected claudeSdk?: ClaudeSdkInstallStatus
  protected officialCli?: OfficialProviderCliId
  protected closed = false

  protected abstract renderManagement(width: number): string[]
  protected abstract handleManagementInput(data: string): void
  protected abstract choosePreset(preset: ConnectionPreset): void
  protected abstract refreshOAuth(): Promise<void>
  protected abstract submitOAuthCode(): Promise<void>
  protected abstract next(): Promise<void>
  protected abstract saveConnection(probe: boolean): Promise<void>
  protected abstract resetPreset(): void
  protected abstract clearSensitiveDraft(): void
  protected abstract textInput(data: string): string | undefined
  protected abstract mutationError(error: unknown): Promise<string>

  constructor(
    protected readonly tui: TUI,
    protected readonly controller: TuiController,
    protected snapshot: ModelConnectionSnapshot,
    protected readonly authenticateOfficialProvider: (
      provider: OfficialProviderCliId
    ) => Promise<void>,
    protected readonly close: () => void
  ) {}

  get focused(): boolean { return this._focused }
  set focused(value: boolean) {
    this._focused = value
    this.search.focused = value && this.catalogOpen && !this.preset && !this.management
  }

  updateSnapshot(snapshot: ModelConnectionSnapshot): void {
    if (snapshot.revision <= this.snapshot.revision) return
    this.snapshot = snapshot
    this.connectionIndex = Math.min(this.connectionIndex, snapshot.providers.length)
    if (this.management) {
      const current = snapshot.providers.find((profile) =>
        profile.id === this.management?.profile.id && profile.accountId === this.management.profile.accountId
      )
      if (current) this.management.profile = current
      else {
        this.management = undefined
        this.notice = 'That connection was removed by another client. The list has been refreshed.'
      }
    }
    this.tui.requestRender()
  }

  render(width: number): string[] {
    if (this.management) return this.renderManagement(width)
    if (!this.preset) {
      return this.catalogOpen ? this.renderCatalog(width) : this.renderConnections(width)
    }
    if (this.oauth) {
      const grok = this.preset.authFlow === 'grok-oauth'
      const pending = this.oauth.status === 'pending'
      const body = [
        ` ${statusGlyph(pending ? 'running' : 'success', Math.floor(Date.now() / 200))} ` +
          `${bold(pending ? 'Waiting for browser authorization' : 'Connection authorized')}`,
        this.oauth.userCode ? ` ${dim('Device code')}  ${bold(sanitizeTerminalText(this.oauth.userCode))}` : '',
        this.oauth.url ? ` ${dim('Browser')}      ${cyan(sanitizeTerminalText(this.oauth.url))}` : '',
        this.oauth.message ? ` ${red(sanitizeTerminalText(this.oauth.message))}` : '',
        ...(grok && pending
          ? [
              '',
              ` ${bold('Return from the browser')}`,
              ` ${dim('Paste the authorization code or complete callback URL below.')}`,
              '',
              selectionRow(
                this.oauthCode
                  ? '•'.repeat(Math.min(48, Array.from(this.oauthCode).length))
                  : dim('authorization code or callback URL'),
                '',
                width,
                true
              )
            ]
          : [
              '',
              ` ${dim('Complete the sign-in in your browser, then return here.')}`
            ]),
        this.error ? ` ${red(this.error)}` : ''
      ].filter((line): line is string => Boolean(line))
      return pageFrame({
        path: ['KUN', 'Connect', this.preset.name],
        right: pending ? 'Authorizing' : 'Connected',
        description: grok && pending
          ? 'Grok returns an authorization value that must be pasted back into Kun.'
          : 'Credentials are stored by the shared runtime and are never printed.',
        body,
        footer: grok && pending
          ? [
              { key: 'Enter', label: this.saving ? 'exchanging…' : 'submit' },
              { key: 'Ctrl+R', label: 'refresh' },
              { key: 'Esc', label: 'cancel' }
            ]
          : [
              { key: 'Enter', label: 'refresh' },
              { key: 'Esc', label: 'cancel' }
            ],
        width
      })
    }
    if (this.claudeSdk) {
      const total = this.claudeSdk.totalBytes
      const progress = total > 0 ? Math.min(100, Math.round(this.claudeSdk.receivedBytes / total * 100)) : 0
      const installed = this.claudeSdk.installed
      return pageFrame({
        path: ['KUN', 'Connect', this.preset.name],
        right: installed ? 'Ready' : 'Installing',
        description: 'Claude Code is installed once by the shared runtime and reused by GUI and TUI.',
        body: [
          ` ${statusGlyph(installed ? 'success' : 'running', Math.floor(Date.now() / 200))} ` +
            `${bold(installed ? 'Claude Code is ready' : 'Downloading Claude Code')}`,
          this.claudeSdk.status === 'downloading'
            ? ` ${dim('Progress')}  ${formatBytes(this.claudeSdk.receivedBytes)} / ` +
              `${total ? formatBytes(total) : 'unknown'}${total ? ` · ${progress}%` : ''}`
            : '',
          this.claudeSdk.message ? ` ${red(sanitizeTerminalText(this.claudeSdk.message))}` : ''
        ].filter((line): line is string => Boolean(line)),
        footer: [{ key: 'Esc', label: 'close; download continues' }],
        width
      })
    }
    if (this.officialCli) {
      const displayName = this.officialCli === 'gemini-cli'
        ? 'Gemini CLI'
        : 'Antigravity CLI'
      return pageFrame({
        path: ['KUN', 'Connect', this.preset.name],
        right: 'Provider login',
        description: 'Authentication stays inside the official provider CLI; Kun verifies it after you return.',
        body: [
          ` ${statusGlyph('running', Math.floor(Date.now() / 200))} ${bold(`Opening ${displayName}`)}`,
          '',
          ` ${dim('Complete Google sign-in in the provider CLI.')}`,
          ` ${dim('Then quit the provider CLI to return to Kun and finish verification.')}`,
          this.error ? ` ${red(this.error)}` : ''
        ].filter((line): line is string => Boolean(line)),
        footer: [{ key: 'Provider CLI', label: 'finish or cancel there' }],
        width
      })
    }
    const field = this.fields[this.fieldIndex]
    const label = fieldLabel(field, this.preset)
    const display = field === 'credential'
      ? '•'.repeat(Math.min(48, Array.from(this.value).length))
      : sanitizeTerminalText(this.value)
    const step = this.fieldIndex + 1
    const body = [
      ` ${dim('Step')}  ${bold(`${step} of ${this.fields.length}`)}  ${dim(label)}`,
      '',
      selectionRow(
        display || dim(fieldPlaceholder(field)),
        field === 'endpointFormat' ? '←/→ choose' : '',
        width,
        true
      ),
      ...(field === 'credential' && this.preset.credentialUrl
        ? [
            '',
            ` ${dim('Need a credential?')} ${cyan('Ctrl+O')} ${dim('opens the provider page.')}`
          ]
        : []),
      this.notice ? ` ${green(this.notice)}` : '',
      this.error ? ` ${red(this.error)}` : '',
      this.allowUnprobedSave
        ? ` ${yellow('Probe failed. Ctrl+S saves these model IDs without marking the probe successful.')}`
        : '',
      this.saving
        ? ` ${statusGlyph('running', Math.floor(Date.now() / 200))} ${yellow('Probing and saving…')}`
        : ''
    ].filter((line): line is string => Boolean(line))
    return pageFrame({
      path: ['KUN', 'Connect', this.preset.name],
      right: `Step ${step}/${this.fields.length}`,
      description: field === 'credential'
        ? 'Secret input is masked and never written to terminal history or logs.'
        : 'Review one value at a time. Nothing is saved until verification succeeds.',
      body,
      footer: [
        { key: field === 'endpointFormat' ? '←/→' : 'Enter', label: field === 'endpointFormat' ? 'choose' : 'next' },
        ...(field === 'endpointFormat' ? [{ key: 'Enter', label: 'next' }] : []),
        { key: 'Ctrl+U', label: 'clear' },
        { key: 'Esc', label: 'previous' }
      ],
      width
    })
  }

  handleInput(data: string): void {
    if (this.management) {
      this.handleManagementInput(data)
      return
    }
    if (isCancelInput(data)) {
      this.navigateBack()
      return
    }
    if (this.saving) return
    if (this.oauth) {
      if (this.preset?.authFlow === 'grok-oauth' && this.oauth.status === 'pending') {
        if (matchesKey(data, 'backspace')) {
          this.oauthCode = Array.from(this.oauthCode).slice(0, -1).join('')
        } else if (matchesKey(data, 'ctrl+u')) {
          this.oauthCode = ''
        } else if (matchesKey(data, 'ctrl+r')) {
          void this.refreshOAuth()
          return
        } else if (matchesKey(data, 'enter')) {
          if (this.oauthCode.trim()) void this.submitOAuthCode()
          else void this.refreshOAuth()
          return
        } else {
          const text = this.textInput(data)
          if (text) this.oauthCode += text.replace(/[\r\n]/gu, '')
        }
        this.error = ''
        this.tui.requestRender()
      } else if (matchesKey(data, 'enter')) {
        void this.refreshOAuth()
      }
      return
    }
    if (!this.preset) {
      if (this.catalogOpen) this.handleCatalogInput(data)
      else this.handleConnectionListInput(data)
      return
    }
    if (this.allowUnprobedSave && matchesKey(data, 'ctrl+s')) {
      void this.saveConnection(false)
      return
    }
    const field = this.fields[this.fieldIndex]
    if (field === 'endpointFormat' && (
      matchesKey(data, 'left') ||
      matchesKey(data, 'right') ||
      matchesKey(data, 'up') ||
      matchesKey(data, 'down') ||
      matchesKey(data, 'tab')
    )) {
      const direction = matchesKey(data, 'left') || matchesKey(data, 'up') ? -1 : 1
      const current = Math.max(0, CONNECT_ENDPOINT_FORMATS.indexOf(endpointFormat(this.value)))
      this.value = CONNECT_ENDPOINT_FORMATS[
        (current + direction + CONNECT_ENDPOINT_FORMATS.length) % CONNECT_ENDPOINT_FORMATS.length
      ]!
      this.error = ''
      this.allowUnprobedSave = false
      this.tui.requestRender()
      return
    }
    if (field === 'endpointFormat') {
      if (matchesKey(data, 'enter')) void this.next()
      else if (matchesKey(data, 'ctrl+u')) {
        this.value = 'chat_completions'
        this.error = ''
        this.allowUnprobedSave = false
        this.tui.requestRender()
      }
      return
    }
    if (field === 'credential' && matchesKey(data, 'ctrl+o') && this.preset.credentialUrl) {
      openBrowser(this.preset.credentialUrl)
      this.notice = 'Opened the credential page in your browser.'
    } else if (matchesKey(data, 'backspace')) {
      this.value = Array.from(this.value).slice(0, -1).join('')
    } else if (matchesKey(data, 'ctrl+u')) {
      this.value = ''
    } else if (matchesKey(data, 'enter')) {
      void this.next()
      return
    } else {
      const text = this.textInput(data)
      if (text) this.value += text.replace(/[\r\n]/gu, '')
    }
    this.error = ''
    this.allowUnprobedSave = false
    this.tui.requestRender()
  }

  invalidate(): void { this.search.invalidate() }

  protected renderConnections(width: number): string[] {
    const connected = this.snapshot.providers.filter(isModelConnectionProfileUsable).length
    const body = [
      sectionLabel('Connections', width, `${connected}/${this.snapshot.providers.length} connected`),
      selectionRow(
        `${cyan('+')} ${bold('Add a provider')}`,
        'subscriptions or API',
        width,
        this.connectionIndex === 0
      )
    ]
    this.snapshot.providers.forEach((profile, index) => {
      const selected = this.connectionIndex === index + 1
      const usable = isModelConnectionProfileUsable(profile)
      const defaultConnection = profile.id === this.snapshot.defaultProviderId &&
        profile.accountId === this.snapshot.defaultAccountId
      body.push(
        selectionRow(
          `${statusGlyph(usable ? 'success' : 'warning')} ${sanitizeTerminalText(profile.name)}`,
          [
            profile.selectedModel ? sanitizeTerminalText(profile.selectedModel) : 'needs configuration',
            !usable ? credentialAvailabilityLabel(profile) : '',
            defaultConnection ? 'default' : ''
          ].filter(Boolean).join(' · '),
          width,
          selected
        )
      )
    })
    if (!this.snapshot.providers.length) body.push(` ${dim('No providers configured. Add one to start chatting.')}`)
    body.push(
      this.notice ? ` ${green(this.notice)}` : '',
      this.error ? ` ${red(this.error)}` : ''
    )
    return pageFrame({
      path: ['KUN', 'Connect'],
      right: this.snapshot.defaultModel ? `Default · ${this.snapshot.defaultModel}` : 'No default',
      description: 'Providers, accounts, credentials, and defaults are shared with the GUI and every TUI.',
      body: body.filter((line): line is string => Boolean(line)),
      footer: [
        { key: 'Enter', label: 'add or manage' },
        { key: '↑/↓', label: 'choose' },
        { key: 'Esc', label: 'back' }
      ],
      width
    })
  }

  protected renderCatalog(width: number): string[] {
    const entries = this.catalogEntries()
    this.catalogIndex = Math.min(this.catalogIndex, Math.max(0, entries.length - 1))
    const body = [
      ` ${dim('Search')}  ${this.search.render(Math.max(12, width - 12)).join(' ')}`,
      '',
      ...(entries.some((entry) => entry.id === 'custom')
        ? [selectionRow(
            `${cyan('+')} ${bold('Custom provider')}`,
            'ID, URL, protocol, key, models',
            width,
            entries[this.catalogIndex]?.id === 'custom'
          )]
        : [])
    ]
    let category = ''
    visibleWindow(entries, this.catalogIndex, 14).forEach(({ value: preset, index }) => {
      if (preset.id === 'custom') return
      if (preset.category !== category) {
        category = preset.category
        body.push('', sectionLabel(category, width))
      }
      body.push(selectionRow(
        sanitizeTerminalText(preset.name),
        preset.models.length ? `${preset.models.length} model${preset.models.length === 1 ? '' : 's'}` : preset.authType,
        width,
        index === this.catalogIndex
      ))
    })
    if (!entries.length) body.push('', ` ${dim(`No providers match “${sanitizeTerminalText(this.search.getValue())}”.`)}`)
    body.push(
      entries.length > 14 ? ` ${dim(`${this.catalogIndex + 1}/${entries.length}`)}` : ''
    )
    const subscriptions = entries.filter((entry) => entry.category === 'Subscription').length
    const free = entries.filter((entry) => entry.category === 'Free').length
    const apis = entries.filter((entry) => entry.category === 'API' && entry.id !== 'custom').length
    return pageFrame({
      path: ['KUN', 'Connect', 'Add provider'],
      right: `${free} free · ${subscriptions} subscriptions · ${apis} APIs`,
      description: 'Choose the same built-in provider catalog available in GUI, or define a compatible endpoint.',
      body: body.filter((line): line is string => line !== ''),
      footer: [
        { key: 'Type', label: 'search' },
        { key: 'Enter', label: 'continue' },
        { key: 'Esc', label: 'back' }
      ],
      width
    })
  }

  protected handleConnectionListInput(data: string): void {
    const maxIndex = this.snapshot.providers.length
    if (matchesKey(data, 'up') || matchesKey(data, 'ctrl+p')) {
      this.connectionIndex = Math.max(0, this.connectionIndex - 1)
    } else if (matchesKey(data, 'down') || matchesKey(data, 'ctrl+n')) {
      this.connectionIndex = Math.min(maxIndex, this.connectionIndex + 1)
    } else if (matchesKey(data, 'pageUp') || matchesKey(data, 'home')) {
      this.connectionIndex = 0
    } else if (matchesKey(data, 'pageDown') || matchesKey(data, 'end')) {
      this.connectionIndex = maxIndex
    } else if (matchesKey(data, 'enter')) {
      if (this.connectionIndex === 0) {
        this.catalogOpen = true
        this.catalogIndex = 0
        this.search.setValue('')
        this.search.focused = this._focused
      } else {
        const profile = this.snapshot.providers[this.connectionIndex - 1]
        const preset = profile ? connectionPresetForProfile(profile) : undefined
        if (profile && isModelConnectionProfileUsable(profile)) {
          this.management = { profile, mode: 'menu', index: 0 }
        } else if (preset && authenticationStrategy(preset.authFlow) !== 'secret') {
          this.choosePreset(preset)
        } else if (profile?.kind === 'http') {
          this.management = {
            profile,
            mode: 'credential',
            index: 0,
            connectAfterCredential: true
          }
          this.value = ''
        } else if (profile) {
          if (preset) this.choosePreset(preset)
          else this.error = 'This subscription requires a current provider preset.'
        }
      }
    }
    this.tui.requestRender()
  }

  protected handleCatalogInput(data: string): void {
    const entries = this.catalogEntries()
    if (matchesKey(data, 'up') || matchesKey(data, 'ctrl+p')) {
      this.catalogIndex = Math.max(0, this.catalogIndex - 1)
    } else if (matchesKey(data, 'down') || matchesKey(data, 'ctrl+n')) {
      this.catalogIndex = Math.min(Math.max(0, entries.length - 1), this.catalogIndex + 1)
    } else if (matchesKey(data, 'pageUp') || matchesKey(data, 'home')) {
      this.catalogIndex = 0
    } else if (matchesKey(data, 'pageDown') || matchesKey(data, 'end')) {
      this.catalogIndex = Math.max(0, entries.length - 1)
    } else if (matchesKey(data, 'enter')) {
      const preset = entries[this.catalogIndex]
      if (preset) this.choosePreset(preset)
    } else {
      this.search.handleInput(data)
      this.catalogIndex = 0
    }
    this.tui.requestRender()
  }

  protected catalogEntries(): ConnectionPreset[] {
    const custom = connectionPresets.find((preset) => preset.id === 'custom')!
    const ordered = [custom, ...connectionPresets.filter((preset) => preset.id !== 'custom')]
    const query = this.search.getValue().trim().toLowerCase()
    return query
      ? ordered.filter((preset) => `${preset.name} ${preset.id} ${preset.category}`.toLowerCase().includes(query))
      : ordered
  }

  protected navigateBack(): void {
    if (this.oauth?.status === 'pending') {
      void this.controller.client.cancelModelOAuth(this.oauth.sessionId)
      this.oauth = undefined
      this.resetPreset()
    } else if (this.claudeSdk) {
      this.closed = true
      this.clearSensitiveDraft()
      this.close()
      return
    } else if (this.preset) {
      if (this.fieldIndex > 0) {
        this.value = ''
        this.fieldIndex -= 1
        this.value = this.values[this.fields[this.fieldIndex]!] ?? ''
        this.error = ''
        this.allowUnprobedSave = false
      } else {
        this.resetPreset()
      }
    } else if (this.catalogOpen) {
      this.catalogOpen = false
      this.search.focused = false
      this.search.setValue('')
      this.catalogIndex = 0
    } else {
      this.closed = true
      this.clearSensitiveDraft()
      this.close()
      return
    }
    this.tui.requestRender()
  }
}

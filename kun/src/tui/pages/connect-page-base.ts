import {
  isModelConnectionProfileUsable,
  type ClaudeSdkInstallStatus,
  type ModelConnectionOAuthStatus,
  type ModelConnectionProfile,
  type ModelConnectionSnapshot
} from '../../contracts/model-connections.js'
import type { OfficialProviderCliId } from '../../services/official-provider-cli.js'
import { formatBytes } from '../chat-format.js'
import {
  CONNECT_ENDPOINT_FORMATS,
  authenticationStrategy,
  connectionPresetForProfile,
  connectionPresets,
  credentialAvailabilityLabel,
  type ConnectField,
  type ConnectionPreset
} from '../connect-common.js'
import type { TuiController } from '../controller.js'
import { isCancelKey, isKey, type TuiKeyEvent } from '../keys.js'
import {
  rowBlock,
  sectionBlock,
  type PageBlock,
  type PageMouseEvent,
  type PageSize,
  type PageView,
  type TuiPage
} from '../page-model.js'
import { sanitizeTerminalText } from '../safe-text.js'
import { TextField } from '../text-field.js'
import { statusGlyph, visual } from '../visual-system.js'
import { endpointFormat, fieldLabel, fieldPlaceholder, openBrowser } from './connect-fields.js'
import { navigateList, visibleWindow, type Invalidate } from './page-kit.js'

const { strong: bold, muted: dim, focus: cyan, success: green, warning: yellow, danger: red } = visual

export type ConnectManagement = {
  profile: ModelConnectionProfile
  mode: 'menu' | 'rename' | 'credential' | 'confirm-delete'
  index: number
  connectAfterCredential?: boolean
}

export function spinner(): string {
  return statusGlyph('running', Math.floor(Date.now() / 200))
}

export abstract class ConnectPageBase implements TuiPage {
  readonly kind = 'connect'
  protected readonly search = new TextField()
  protected readonly field = new TextField()
  protected readonly oauthCode = new TextField()
  protected connectionIndex = 0
  protected catalogOpen = false
  protected catalogIndex = 0
  protected preset?: ConnectionPreset
  protected management?: ConnectManagement
  protected fields: ConnectField[] = []
  protected fieldIndex = 0
  protected values: Partial<Record<ConnectField, string>> = {}
  protected saving = false
  protected error = ''
  protected notice = ''
  protected allowUnprobedSave = false
  protected oauth?: ModelConnectionOAuthStatus
  protected claudeSdk?: ClaudeSdkInstallStatus
  protected officialCli?: OfficialProviderCliId
  protected closed = false

  protected abstract managementView(size: PageSize): PageView
  protected abstract handleManagementKey(key: TuiKeyEvent): void
  protected abstract choosePreset(preset: ConnectionPreset): void
  protected abstract refreshOAuth(): Promise<void>
  protected abstract submitOAuthCode(): Promise<void>
  protected abstract next(): Promise<void>
  protected abstract saveConnection(probe: boolean): Promise<void>
  protected abstract resetPreset(): void
  protected abstract clearSensitiveDraft(): void

  constructor(
    protected readonly controller: TuiController,
    protected snapshot: ModelConnectionSnapshot,
    protected readonly authenticateOfficialProvider: (provider: OfficialProviderCliId) => Promise<void>,
    protected readonly close: () => void,
    protected readonly invalidate: Invalidate
  ) {}

  /** Animated waits (OAuth polling, downloads) need periodic repaints. */
  get animated(): boolean {
    return this.saving || this.oauth?.status === 'pending' || Boolean(this.claudeSdk) || Boolean(this.officialCli)
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
    this.invalidate()
  }

  dispose(): void {
    this.closed = true
    this.clearSensitiveDraft()
  }

  view(size: PageSize): PageView {
    if (this.management) return this.managementView(size)
    if (!this.preset) return this.catalogOpen ? this.catalogView(size) : this.connectionsView()
    if (this.oauth) return this.oauthView(this.preset)
    if (this.claudeSdk) return this.claudeView(this.preset)
    if (this.officialCli) return this.officialCliView(this.preset)
    return this.fieldView(this.preset)
  }

  private oauthView(preset: ConnectionPreset): PageView {
    const oauth = this.oauth!
    const grok = preset.authFlow === 'grok-oauth'
    const pending = oauth.status === 'pending'
    const body: PageBlock[] = [
      { kind: 'line', text: ` ${pending ? spinner() : statusGlyph('success')} ${bold(pending ? 'Waiting for browser authorization' : 'Connection authorized')}` }
    ]
    if (oauth.userCode) body.push({ kind: 'line', text: ` ${dim('Device code')}  ${bold(sanitizeTerminalText(oauth.userCode))}` })
    if (oauth.url) body.push({ kind: 'text', text: ` ${dim('Browser')}      ${cyan(sanitizeTerminalText(oauth.url))}` })
    if (oauth.message) body.push({ kind: 'text', text: ` ${red(sanitizeTerminalText(oauth.message))}` })
    if (grok && pending) {
      body.push(
        { kind: 'spacer' },
        { kind: 'line', text: ` ${bold('Return from the browser')}` },
        { kind: 'line', text: ` ${dim('Paste the authorization code or complete callback URL below.')}` },
        { kind: 'spacer' },
        { kind: 'field', field: this.oauthCode, masked: true, focused: true, placeholder: 'authorization code or callback URL' }
      )
    } else {
      body.push({ kind: 'spacer' }, { kind: 'line', text: ` ${dim('Complete the sign-in in your browser, then return here.')}` })
    }
    if (this.error) body.push({ kind: 'text', text: ` ${red(this.error)}` })
    return {
      path: ['KUN', 'Connect', preset.name],
      right: pending ? 'Authorizing' : 'Connected',
      description: grok && pending
        ? 'Grok returns an authorization value that must be pasted back into Kun.'
        : 'Credentials are stored by the shared runtime and are never printed.',
      body,
      footer: grok && pending
        ? [{ key: 'Enter', label: this.saving ? 'exchanging…' : 'submit' }, { key: 'Ctrl+R', label: 'refresh' }, { key: 'Esc', label: 'cancel' }]
        : [{ key: 'Enter', label: 'refresh' }, { key: 'Esc', label: 'cancel' }]
    }
  }

  private claudeView(preset: ConnectionPreset): PageView {
    const sdk = this.claudeSdk!
    const total = sdk.totalBytes
    const progress = total > 0 ? Math.min(100, Math.round(sdk.receivedBytes / total * 100)) : 0
    const body: PageBlock[] = [
      { kind: 'line', text: ` ${sdk.installed ? statusGlyph('success') : spinner()} ${bold(sdk.installed ? 'Claude Code is ready' : 'Downloading Claude Code')}` }
    ]
    if (sdk.status === 'downloading') {
      body.push({ kind: 'line', text: ` ${dim('Progress')}  ${formatBytes(sdk.receivedBytes)} / ${total ? formatBytes(total) : 'unknown'}${total ? ` · ${progress}%` : ''}` })
    }
    if (sdk.message) body.push({ kind: 'text', text: ` ${red(sanitizeTerminalText(sdk.message))}` })
    return {
      path: ['KUN', 'Connect', preset.name],
      right: sdk.installed ? 'Ready' : 'Installing',
      description: 'Claude Code is installed once by the shared runtime and reused by GUI and TUI.',
      body,
      footer: [{ key: 'Esc', label: 'close; download continues' }]
    }
  }

  private officialCliView(preset: ConnectionPreset): PageView {
    const displayName = this.officialCli === 'gemini-cli' ? 'Gemini CLI' : 'Antigravity CLI'
    return {
      path: ['KUN', 'Connect', preset.name],
      right: 'Provider login',
      description: 'Authentication stays inside the official provider CLI; Kun verifies it after you return.',
      body: [
        { kind: 'line', text: ` ${spinner()} ${bold(`Opening ${displayName}`)}` },
        { kind: 'spacer' },
        { kind: 'line', text: ` ${dim('Complete Google sign-in in the provider CLI.')}` },
        { kind: 'line', text: ` ${dim('Then quit the provider CLI to return to Kun and finish verification.')}` },
        ...(this.error ? [{ kind: 'text' as const, text: ` ${red(this.error)}` }] : [])
      ],
      footer: [{ key: 'Provider CLI', label: 'finish or cancel there' }]
    }
  }

  private fieldView(preset: ConnectionPreset): PageView {
    const field = this.fields[this.fieldIndex]
    const step = this.fieldIndex + 1
    const body: PageBlock[] = [
      { kind: 'line', text: ` ${dim('Step')}  ${bold(`${step} of ${this.fields.length}`)}  ${dim(fieldLabel(field, preset))}` },
      { kind: 'spacer' }
    ]
    if (field === 'endpointFormat') {
      const current = endpointFormat(this.field.getValue())
      body.push(...CONNECT_ENDPOINT_FORMATS.map((format, index) => rowBlock(format, format === current ? '←/→ choose' : '', format === current, index)))
    } else {
      body.push({ kind: 'field', field: this.field, masked: field === 'credential', focused: true, placeholder: fieldPlaceholder(field) })
    }
    if (field === 'credential' && preset.credentialUrl) {
      body.push({ kind: 'spacer' }, { kind: 'line', text: ` ${dim('Need a credential?')} ${cyan('Ctrl+O')} ${dim('opens the provider page.')}` })
    }
    if (this.notice) body.push({ kind: 'text', text: ` ${green(this.notice)}` })
    if (this.error) body.push({ kind: 'text', text: ` ${red(this.error)}` })
    if (this.allowUnprobedSave) body.push({ kind: 'text', text: ` ${yellow('Probe failed. Ctrl+S saves these model IDs without marking the probe successful.')}` })
    if (this.saving) body.push({ kind: 'line', text: ` ${spinner()} ${yellow('Probing and saving…')}` })
    return {
      path: ['KUN', 'Connect', preset.name],
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
      ]
    }
  }

  private connectionsView(): PageView {
    const connected = this.snapshot.providers.filter(isModelConnectionProfileUsable).length
    const body: PageBlock[] = [
      sectionBlock('Connections', `${connected}/${this.snapshot.providers.length} connected`),
      rowBlock(`${cyan('+')} ${bold('Add a provider')}`, 'subscriptions or API', this.connectionIndex === 0, 0)
    ]
    this.snapshot.providers.forEach((profile, index) => {
      const usable = isModelConnectionProfileUsable(profile)
      const isDefault = profile.id === this.snapshot.defaultProviderId && profile.accountId === this.snapshot.defaultAccountId
      body.push(rowBlock(
        `${statusGlyph(usable ? 'success' : 'warning')} ${sanitizeTerminalText(profile.name)}`,
        [
          profile.selectedModel ? sanitizeTerminalText(profile.selectedModel) : 'needs configuration',
          usable ? '' : credentialAvailabilityLabel(profile),
          isDefault ? 'default' : ''
        ].filter(Boolean).join(' · '),
        this.connectionIndex === index + 1,
        index + 1
      ))
    })
    if (!this.snapshot.providers.length) body.push({ kind: 'line', text: ` ${dim('No providers configured. Add one to start chatting.')}` })
    if (this.notice) body.push({ kind: 'text', text: ` ${green(this.notice)}` })
    if (this.error) body.push({ kind: 'text', text: ` ${red(this.error)}` })
    return {
      path: ['KUN', 'Connect'],
      right: this.snapshot.defaultModel ? `Default · ${this.snapshot.defaultModel}` : 'No default',
      description: 'Providers, accounts, credentials, and defaults are shared with the GUI and every TUI.',
      body,
      footer: [{ key: 'Enter', label: 'add or manage' }, { key: '↑/↓', label: 'choose' }, { key: 'Esc', label: 'back' }]
    }
  }

  private catalogView(size: PageSize): PageView {
    const entries = this.catalogEntries()
    this.catalogIndex = Math.min(this.catalogIndex, Math.max(0, entries.length - 1))
    const body: PageBlock[] = [{ kind: 'field', field: this.search, label: 'Search', focused: true }, { kind: 'spacer' }]
    let category = ''
    for (const { value: preset, index } of visibleWindow(entries, this.catalogIndex, Math.max(6, size.height - 14))) {
      if (preset.id === 'custom') {
        body.push(rowBlock(`${cyan('+')} ${bold('Custom provider')}`, 'ID, URL, protocol, key, models', index === this.catalogIndex, index))
        continue
      }
      if (preset.category !== category) {
        category = preset.category
        body.push(sectionBlock(category))
      }
      body.push(rowBlock(
        sanitizeTerminalText(preset.name),
        preset.models.length ? `${preset.models.length} model${preset.models.length === 1 ? '' : 's'}` : preset.authType,
        index === this.catalogIndex,
        index
      ))
    }
    if (!entries.length) body.push({ kind: 'line', text: ` ${dim(`No providers match “${sanitizeTerminalText(this.search.getValue())}”.`)}` })
    const subscriptions = entries.filter((entry) => entry.category === 'Subscription').length
    const free = entries.filter((entry) => entry.category === 'Free').length
    const apis = entries.filter((entry) => entry.category === 'API' && entry.id !== 'custom').length
    return {
      path: ['KUN', 'Connect', 'Add provider'],
      right: `${free} free · ${subscriptions} subscriptions · ${apis} APIs`,
      description: 'Choose the same built-in provider catalog available in GUI, or define a compatible endpoint.',
      body,
      footer: [{ key: 'Type', label: 'search' }, { key: 'Enter', label: 'continue' }, { key: 'Esc', label: 'back' }]
    }
  }

  handleKey(key: TuiKeyEvent): void {
    if (this.management) { this.handleManagementKey(key); return }
    if (isCancelKey(key)) { this.navigateBack(); return }
    if (this.saving) return
    if (this.oauth) {
      if (this.preset?.authFlow === 'grok-oauth' && this.oauth.status === 'pending') {
        if (isKey(key, 'ctrl+r')) { void this.refreshOAuth(); return }
        if (isKey(key, 'enter')) {
          if (this.oauthCode.getValue().trim()) void this.submitOAuthCode()
          else void this.refreshOAuth()
          return
        }
        if (this.oauthCode.handleKey(key)) {
          this.error = ''
          this.invalidate()
        }
      } else if (isKey(key, 'enter')) void this.refreshOAuth()
      return
    }
    if (!this.preset) {
      if (this.catalogOpen) this.handleCatalogKey(key)
      else this.handleConnectionKey(key)
      return
    }
    if (this.allowUnprobedSave && isKey(key, 'ctrl+s')) { void this.saveConnection(false); return }
    const field = this.fields[this.fieldIndex]
    if (field === 'endpointFormat') {
      if (isKey(key, 'left', 'right', 'up', 'down', 'tab')) {
        const direction = isKey(key, 'left', 'up') ? -1 : 1
        const current = Math.max(0, CONNECT_ENDPOINT_FORMATS.indexOf(endpointFormat(this.field.getValue())))
        this.field.setValue(CONNECT_ENDPOINT_FORMATS[(current + direction + CONNECT_ENDPOINT_FORMATS.length) % CONNECT_ENDPOINT_FORMATS.length]!)
      } else if (isKey(key, 'enter')) { void this.next(); return }
      else if (isKey(key, 'ctrl+u')) this.field.setValue('chat_completions')
      else return
      this.error = ''
      this.allowUnprobedSave = false
      this.invalidate()
      return
    }
    if (field === 'credential' && isKey(key, 'ctrl+o') && this.preset.credentialUrl) {
      openBrowser(this.preset.credentialUrl)
      this.notice = 'Opened the credential page in your browser.'
    } else if (isKey(key, 'enter')) { void this.next(); return }
    else if (!this.field.handleKey(key)) return
    this.error = ''
    this.allowUnprobedSave = false
    this.invalidate()
  }

  handlePaste(text: string): void {
    if (this.management) {
      if (this.management.mode === 'rename' || this.management.mode === 'credential') this.field.insert(text)
    } else if (this.oauth) {
      if (this.preset?.authFlow === 'grok-oauth' && this.oauth.status === 'pending') this.oauthCode.insert(text)
    } else if (!this.preset) {
      if (this.catalogOpen) {
        this.search.insert(text)
        this.catalogIndex = 0
      }
    } else if (this.fields[this.fieldIndex] !== 'endpointFormat') {
      this.field.insert(text)
      this.error = ''
      this.allowUnprobedSave = false
    }
    this.invalidate()
  }

  handleMouse(event: PageMouseEvent): void {
    if (event.type !== 'row' || this.saving) return
    if (this.management?.mode === 'menu') {
      if (event.activate && event.index === this.management.index) this.handleManagementKey({ name: 'return', ctrl: false, meta: false, shift: false })
      else this.management.index = event.index
    } else if (!this.preset && !this.management) {
      if (this.catalogOpen) {
        if (event.activate && event.index === this.catalogIndex) { this.handleCatalogKey({ name: 'return', ctrl: false, meta: false, shift: false }); return }
        this.catalogIndex = event.index
      } else {
        if (event.activate && event.index === this.connectionIndex) { this.handleConnectionKey({ name: 'return', ctrl: false, meta: false, shift: false }); return }
        this.connectionIndex = event.index
      }
    } else if (this.preset && !this.oauth && this.fields[this.fieldIndex] === 'endpointFormat') {
      const format = CONNECT_ENDPOINT_FORMATS[event.index]
      if (!format) return
      if (event.activate && format === endpointFormat(this.field.getValue())) { void this.next(); return }
      this.field.setValue(format)
      this.error = ''
      this.allowUnprobedSave = false
    }
    this.invalidate()
  }

  protected handleConnectionKey(key: TuiKeyEvent): void {
    const next = navigateList(key, this.connectionIndex, this.snapshot.providers.length + 1, Number.MAX_SAFE_INTEGER)
    if (next !== undefined) this.connectionIndex = next
    else if (isKey(key, 'enter')) {
      if (this.connectionIndex === 0) {
        this.catalogOpen = true
        this.catalogIndex = 0
        this.search.clear()
      } else {
        const profile = this.snapshot.providers[this.connectionIndex - 1]
        const preset = profile ? connectionPresetForProfile(profile) : undefined
        if (profile && isModelConnectionProfileUsable(profile)) {
          this.management = { profile, mode: 'menu', index: 0 }
        } else if (preset && authenticationStrategy(preset.authFlow) !== 'secret') {
          this.choosePreset(preset)
        } else if (profile?.kind === 'http') {
          this.management = { profile, mode: 'credential', index: 0, connectAfterCredential: true }
          this.field.clear()
        } else if (profile) {
          if (preset) this.choosePreset(preset)
          else this.error = 'This subscription requires a current provider preset.'
        }
      }
    } else return
    this.invalidate()
  }

  protected handleCatalogKey(key: TuiKeyEvent): void {
    const entries = this.catalogEntries()
    const next = navigateList(key, this.catalogIndex, entries.length, Number.MAX_SAFE_INTEGER)
    if (next !== undefined) this.catalogIndex = next
    else if (isKey(key, 'enter')) {
      const preset = entries[this.catalogIndex]
      if (preset) this.choosePreset(preset)
    } else if (this.search.handleKey(key)) this.catalogIndex = 0
    else return
    this.invalidate()
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
        this.fieldIndex -= 1
        this.field.setValue(this.values[this.fields[this.fieldIndex]!] ?? '')
        this.error = ''
        this.allowUnprobedSave = false
      } else this.resetPreset()
    } else if (this.catalogOpen) {
      this.catalogOpen = false
      this.search.clear()
      this.catalogIndex = 0
    } else {
      this.closed = true
      this.clearSensitiveDraft()
      this.close()
      return
    }
    this.invalidate()
  }
}

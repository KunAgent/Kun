import { redactExactSecret, safeError } from '../chat-format.js'
import { TuiClientError } from '../client.js'
import {
  authenticationStrategy,
  connectionRequiresCredential,
  type ConnectField,
  type ConnectionPreset
} from '../connect-common.js'
import { ConnectPageManagement } from './connect-page-management.js'
import { endpointFormat, fieldLabel, isModelProbeFailure, normalizeConnectionProviderId, openBrowser } from './connect-fields.js'

export class ConnectPage extends ConnectPageManagement {
  protected override choosePreset(preset: ConnectionPreset): void {
    this.preset = preset
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
    this.fields = [
      ...(preset.id === 'custom' ? ['id', 'name', 'baseUrl', 'endpointFormat'] as ConnectField[] : []),
      ...((preset.kind === 'http' || preset.kind === 'cursor-sdk') && preset.credentialRequirement !== 'none'
        ? ['credential'] as ConnectField[]
        : []),
      'models'
    ]
    this.values = {
      id: preset.id === 'custom' ? this.suggestCustomProviderId() : undefined,
      name: preset.id === 'custom' ? `Custom provider ${this.snapshot.providers.length + 1}` : preset.name,
      baseUrl: preset.baseUrl ?? (preset.id === 'custom' ? 'https://api.example.com/v1' : undefined),
      endpointFormat: preset.endpointFormat,
      models: preset.models.join(', ')
    }
    this.fieldIndex = 0
    this.field.setValue(this.values[this.fields[0]!] ?? '')
  }

  protected async beginOfficialCli(preset: ConnectionPreset): Promise<void> {
    const provider = preset.authFlow === 'gemini-cli-subscription' ? 'gemini-cli' : 'antigravity'
    this.saving = true
    this.error = ''
    this.notice = provider === 'gemini-cli'
      ? 'Opening the official Gemini CLI for Google sign-in…'
      : 'Opening the official Antigravity CLI for Google sign-in…'
    this.officialCli = provider
    this.invalidate()
    try {
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
      this.invalidate()
    }
  }

  protected async beginClaude(preset: ConnectionPreset): Promise<void> {
    this.saving = true
    this.error = ''
    this.invalidate()
    try {
      this.claudeSdk = await this.controller.client.claudeSdkStatus()
      if (!this.claudeSdk.installed) this.claudeSdk = await this.controller.client.installClaudeSdk()
      this.invalidate()
      while (!this.closed && !this.claudeSdk.installed && this.claudeSdk.status === 'downloading') {
        await new Promise((resolve) => setTimeout(resolve, 1_000))
        this.claudeSdk = await this.controller.client.claudeSdkStatus()
        this.invalidate()
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
      this.invalidate()
      void this.pollOAuth()
    } catch (error) {
      this.saving = false
      this.error = await this.mutationError(error)
      this.claudeSdk = this.claudeSdk?.status === 'error' ? this.claudeSdk : undefined
      this.invalidate()
    }
  }

  protected async beginOAuth(preset: ConnectionPreset): Promise<void> {
    this.saving = true
    this.error = ''
    this.invalidate()
    try {
      this.oauth = await this.controller.client.startModelOAuth({
        expectedRevision: this.snapshot.revision,
        provider: preset.authFlow === 'chatgpt-oauth' ? 'chatgpt' : 'grok',
        model: preset.models[0],
        select: true
      })
      this.saving = false
      if (this.oauth.url) openBrowser(this.oauth.url)
      this.invalidate()
      void this.pollOAuth()
    } catch (error) {
      this.saving = false
      this.error = await this.mutationError(error)
      this.invalidate()
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
    this.invalidate()
  }

  protected override async submitOAuthCode(): Promise<void> {
    if (!this.oauth || this.oauth.provider !== 'grok' || this.oauth.status !== 'pending') return
    const sessionId = this.oauth.sessionId
    const code = this.oauthCode.getValue().trim()
    if (!code) return
    this.oauthCode.clear()
    this.saving = true
    this.error = ''
    this.invalidate()
    try {
      this.oauth = await this.controller.client.submitModelOAuth(sessionId, code)
      this.finishOAuthIfConnected()
    } catch (error) {
      this.error = redactExactSecret(safeError(error), code)
    } finally {
      this.saving = false
      this.invalidate()
    }
  }

  protected finishOAuthIfConnected(): void {
    if (this.oauth?.status !== 'connected' || !this.oauth.snapshot) return
    this.snapshot = this.oauth.snapshot
    this.controller.applyModelSelection(this.snapshot)
    this.oauthCode.clear()
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
    const trimmed = this.field.getValue().trim()
    if (field !== 'credential' && !trimmed) {
      this.error = `${fieldLabel(field, this.preset!)} is required.`
      this.invalidate()
      return
    }
    let value = trimmed
    if (field === 'id') {
      const normalized = normalizeConnectionProviderId(trimmed)
      if (!normalized) {
        this.error = 'Provider ID must contain letters, numbers, dots, underscores, or dashes.'
        this.invalidate()
        return
      }
      if (this.snapshot.providers.some((profile) => profile.id === normalized)) {
        this.error = `Provider ID “${normalized}” already exists. Choose a unique ID.`
        this.invalidate()
        return
      }
      value = normalized
    }
    if (field === 'baseUrl') {
      try {
        const url = new URL(trimmed)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol')
      } catch {
        this.error = 'Base URL must be a valid HTTP or HTTPS URL.'
        this.invalidate()
        return
      }
    }
    if (field === 'credential' && !trimmed && connectionRequiresCredential(this.preset!)) {
      this.error = 'Credential is required and is never echoed or logged.'
      this.invalidate()
      return
    }
    this.values[field] = value
    if (this.fieldIndex < this.fields.length - 1) {
      this.fieldIndex += 1
      this.field.setValue(this.values[this.fields[this.fieldIndex]!] ?? '')
      this.allowUnprobedSave = false
      this.invalidate()
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
    this.invalidate()
    const models = (this.values.models ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)
    try {
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
      this.allowUnprobedSave = probe && preset.kind === 'http' && models.length > 0 && isModelProbeFailure(error)
      this.error = this.allowUnprobedSave
        ? `${message} Review the endpoint, or press Ctrl+S to save the supplied models without probing.`
        : message
      this.invalidate()
    }
  }

  protected suggestCustomProviderId(): string {
    const used = new Set(this.snapshot.providers.map((profile) => profile.id))
    let index = this.snapshot.providers.length + 1
    while (used.has(`custom-provider-${index}`)) index += 1
    return `custom-provider-${index}`
  }

  protected override resetPreset(): void {
    this.clearSensitiveDraft()
    this.preset = undefined
    this.oauth = undefined
    this.claudeSdk = undefined
    this.officialCli = undefined
    this.fields = []
    this.fieldIndex = 0
    this.error = ''
    this.notice = ''
    this.allowUnprobedSave = false
    this.catalogOpen = true
  }

  protected override clearSensitiveDraft(): void {
    this.values = {}
    this.field.clear()
    this.oauthCode.clear()
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

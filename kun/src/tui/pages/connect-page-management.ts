import { isModelConnectionProfileUsable } from '../../contracts/model-connections.js'
import { safeError } from '../chat-format.js'
import {
  connectionPresetForProfile,
  credentialAvailabilityLabel,
  managementActions,
  type ManagementAction
} from '../connect-common.js'
import { isCancelKey, isKey, letter, type TuiKeyEvent } from '../keys.js'
import { rowBlock, type PageBlock, type PageView } from '../page-model.js'
import { sanitizeTerminalText } from '../safe-text.js'
import { visual } from '../visual-system.js'
import { ConnectPageBase, spinner } from './connect-page-base.js'
import { navigateShortList } from './page-kit.js'

const { strong: bold, muted: dim, success: green, warning: yellow, danger: red } = visual

export abstract class ConnectPageManagement extends ConnectPageBase {
  protected abstract mutationError(error: unknown): Promise<string>

  protected override managementView(): PageView {
    const management = this.management!
    const profile = management.profile
    const status: PageBlock[] = [
      ...(this.notice ? [{ kind: 'text' as const, text: ` ${green(this.notice)}` }] : []),
      ...(this.error ? [{ kind: 'text' as const, text: ` ${red(this.error)}` }] : [])
    ]
    if (management.mode === 'menu') {
      const actions = managementActions(profile, connectionPresetForProfile(profile))
      return {
        path: ['KUN', 'Connect', profile.name],
        right: isModelConnectionProfileUsable(profile) ? 'Connected' : credentialAvailabilityLabel(profile),
        description: [
          profile.selectedModel ? `Model ${profile.selectedModel}.` : 'No model selected.',
          this.snapshot.defaultProviderId === profile.id ? ' This is the shared default.' : ''
        ].join(''),
        body: [
          ...actions.map((action, index) => rowBlock(
            sanitizeTerminalText(action.label),
            action.kind === 'disconnect' ? 'removes protected credential' : '',
            index === management.index,
            index
          )),
          ...status,
          ...(this.saving ? [{ kind: 'line' as const, text: ` ${spinner()} ${yellow('Working…')}` }] : [])
        ],
        footer: [{ key: 'Enter', label: 'continue' }, { key: '↑/↓', label: 'choose' }, { key: 'Esc', label: 'back' }]
      }
    }
    if (management.mode === 'confirm-delete') {
      const fallback = this.snapshot.defaultProviderId === profile.id
        ? 'The next available connection becomes the shared default.'
        : 'Other clients will be notified immediately.'
      return {
        path: ['KUN', 'Connect', profile.name, 'Disconnect'],
        right: 'Confirmation required',
        body: [
          { kind: 'text', text: ` ${red(bold('Remove this connection and its protected credential?'))}` },
          { kind: 'text', text: ` ${dim(fallback)}` },
          ...(this.error ? [{ kind: 'text' as const, text: ` ${red(this.error)}` }] : []),
          ...(this.saving ? [{ kind: 'line' as const, text: ` ${spinner()} ${yellow('Disconnecting…')}` }] : [])
        ],
        footer: [{ key: 'Y', label: 'disconnect', tone: 'danger' }, { key: 'N / Esc', label: 'keep connection' }]
      }
    }
    const credential = management.mode === 'credential'
    return {
      path: ['KUN', 'Connect', profile.name, credential ? 'Credential' : 'Rename'],
      description: credential
        ? 'The replacement secret is masked and committed atomically.'
        : 'This changes the account label shown in both GUI and TUI.',
      body: [
        { kind: 'line', text: ` ${dim(credential ? 'New API key / token plan key' : 'New connection name')}` },
        { kind: 'spacer' },
        { kind: 'field', field: this.field, masked: credential, focused: true, placeholder: credential ? 'secret value' : 'connection name' },
        ...(this.error ? [{ kind: 'text' as const, text: ` ${red(this.error)}` }] : []),
        ...(this.saving ? [{ kind: 'line' as const, text: ` ${spinner()} ${yellow('Saving…')}` }] : [])
      ],
      footer: [{ key: 'Enter', label: 'save' }, { key: 'Ctrl+U', label: 'clear' }, { key: 'Esc', label: 'cancel' }]
    }
  }

  protected override handleManagementKey(key: TuiKeyEvent): void {
    const management = this.management!
    if (this.saving) return
    if (isCancelKey(key)) {
      if (management.mode === 'menu') this.management = undefined
      else {
        management.mode = 'menu'
        this.field.clear()
        this.error = ''
      }
      this.invalidate()
      return
    }
    if (management.mode === 'menu') {
      const actions = managementActions(management.profile, connectionPresetForProfile(management.profile))
      const next = navigateShortList(key, management.index, actions.length)
      if (next !== undefined) management.index = next
      else if (isKey(key, 'enter')) void this.beginManagementAction(actions[management.index]!.kind)
      this.invalidate()
      return
    }
    if (management.mode === 'confirm-delete') {
      if (letter(key) === 'y') void this.disconnectManagedConnection()
      else if (letter(key) === 'n') management.mode = 'menu'
      this.invalidate()
      return
    }
    if (isKey(key, 'enter')) { void this.commitManagementInput(); return }
    if (!this.field.handleKey(key)) return
    this.error = ''
    this.notice = ''
    this.invalidate()
  }

  protected async beginManagementAction(action: ManagementAction['kind']): Promise<void> {
    const management = this.management
    if (!management) return
    this.error = ''
    this.notice = ''
    if (action === 'back') this.management = undefined
    else if (action === 'rename') {
      management.mode = 'rename'
      this.field.setValue(management.profile.name)
    } else if (action === 'credential') {
      management.mode = 'credential'
      this.field.clear()
    } else if (action === 'reconnect') {
      const preset = connectionPresetForProfile(management.profile)
      if (!preset) this.error = 'This connection has no current provider authentication preset.'
      else {
        this.management = undefined
        this.choosePreset(preset)
      }
    } else if (action === 'disconnect') management.mode = 'confirm-delete'
    else {
      this.saving = true
      this.invalidate()
      try {
        const result = await this.controller.client.probeModel(management.profile.id)
        this.notice = `Connection OK · ${result.models.length} model${result.models.length === 1 ? '' : 's'}`
      } catch (error) {
        this.error = safeError(error)
      } finally {
        this.saving = false
      }
    }
    this.invalidate()
  }

  protected async commitManagementInput(): Promise<void> {
    const management = this.management
    if (!management || (management.mode !== 'rename' && management.mode !== 'credential')) return
    const mode = management.mode
    const value = this.field.getValue().trim()
    if (!value) {
      this.error = mode === 'credential' ? 'Credential is required.' : 'Connection name is required.'
      this.invalidate()
      return
    }
    this.saving = true
    this.invalidate()
    try {
      this.snapshot = mode === 'credential'
        ? await this.controller.client.replaceModelCredential(management.profile.id, {
            expectedRevision: this.snapshot.revision,
            credential: value
          })
        : await this.controller.client.patchModel(management.profile.id, {
            expectedRevision: this.snapshot.revision,
            name: value
          })
      if (mode === 'credential' && management.connectAfterCredential) {
        const connected = this.snapshot.providers.find((profile) => profile.id === management.profile.id)
        const model = connected?.selectedModel ?? connected?.models[0]
        if (connected && model) {
          this.snapshot = await this.controller.client.selectModel({
            expectedRevision: this.snapshot.revision,
            providerId: connected.id,
            accountId: connected.accountId,
            model
          })
        }
      }
      const updated = this.snapshot.providers.find((profile) => profile.id === management.profile.id)
      if (updated) management.profile = updated
      management.mode = 'menu'
      this.notice = mode === 'credential' ? 'Credential replaced.' : 'Connection updated.'
      this.controller.applyModelSelection(this.snapshot)
    } catch (error) {
      this.error = await this.mutationError(error)
    } finally {
      this.field.clear()
      this.saving = false
      this.invalidate()
    }
  }

  protected async disconnectManagedConnection(): Promise<void> {
    const management = this.management
    if (!management) return
    this.saving = true
    this.error = ''
    this.invalidate()
    try {
      this.snapshot = await this.controller.client.deleteModel(management.profile.id, this.snapshot.revision)
      this.management = undefined
      this.connectionIndex = Math.min(this.connectionIndex, this.snapshot.providers.length)
      this.controller.applyModelSelection(this.snapshot)
    } catch (error) {
      this.error = await this.mutationError(error)
    } finally {
      this.saving = false
      this.invalidate()
    }
  }
}

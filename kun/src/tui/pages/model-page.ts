import {
  isModelConnectionProfileUsable,
  type ModelConnectionProfile,
  type ModelConnectionSnapshot
} from '../../contracts/model-connections.js'
import { safeError } from '../chat-format.js'
import { credentialAvailabilityLabel } from '../connect-common.js'
import type { TuiController } from '../controller.js'
import { isCancelKey, isKey, type TuiKeyEvent } from '../keys.js'
import type { TuiKeymap } from '../keymap.js'
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
import { statusGlyph, visual, visualDensity } from '../visual-system.js'
import { listCapacity, navigateList, visibleWindow, type Invalidate } from './page-kit.js'

const { muted: dim, focus: cyan, warning: yellow, danger: red } = visual

type ModelEntry = {
  providerId: string
  accountId: string
  model: string
  label: string
  usable: boolean
}

export class ModelPage implements TuiPage {
  readonly kind = 'models'
  private readonly search = new TextField()
  private index = 0
  private saving = false
  private error = ''
  private mode: 'models' | 'providers' = 'models'
  private providerFilter?: string
  private allEntries: ModelEntry[] = []

  constructor(
    private readonly controller: TuiController,
    private readonly keymap: TuiKeymap,
    private snapshot: ModelConnectionSnapshot,
    private readonly close: () => void,
    private readonly invalidate: Invalidate
  ) {
    this.rebuildEntries()
  }

  updateSnapshot(snapshot: ModelConnectionSnapshot): void {
    if (snapshot.revision <= this.snapshot.revision) return
    const selected = this.entries()[this.index]
    this.snapshot = snapshot
    this.rebuildEntries(selected)
    if (this.providerFilter && !snapshot.providers.some((profile) => `${profile.id}\0${profile.accountId}` === this.providerFilter)) {
      this.providerFilter = undefined
      this.mode = 'models'
    }
    this.error = ''
    this.invalidate()
  }

  private rebuildEntries(preferred?: { providerId: string; accountId: string; model: string }): void {
    const entries = new Map<string, ModelEntry>()
    for (const provider of this.snapshot.providers) {
      const models = new Set(provider.models)
      if (provider.selectedModel) models.add(provider.selectedModel)
      if (provider.id === this.snapshot.defaultProviderId && this.snapshot.defaultModel) models.add(this.snapshot.defaultModel)
      for (const model of models) {
        entries.set(`${provider.id}\0${provider.accountId}\0${model}`, {
          providerId: provider.id,
          accountId: provider.accountId,
          model,
          label: `${provider.name} · ${model}`,
          usable: isModelConnectionProfileUsable(provider)
        })
      }
    }
    const favorite = (entry: ModelEntry): number => Number(this.controller.isModelFavorite(entry.providerId, entry.accountId, entry.model))
    this.allEntries = [...entries.values()].sort((a, b) => favorite(b) - favorite(a))
    const target = preferred ?? {
      providerId: this.snapshot.defaultProviderId ?? '',
      accountId: this.snapshot.defaultAccountId ?? '',
      model: this.snapshot.defaultModel ?? ''
    }
    this.index = Math.max(0, this.allEntries.findIndex((entry) =>
      entry.providerId === target.providerId && entry.accountId === target.accountId && entry.model === target.model
    ))
  }

  private entries(): ModelEntry[] {
    const query = this.search.getValue().trim().toLowerCase()
    const entries = this.providerFilter
      ? this.allEntries.filter((entry) => `${entry.providerId}\0${entry.accountId}` === this.providerFilter)
      : this.allEntries
    return query
      ? entries.filter((entry) => `${entry.label} ${entry.providerId} ${entry.accountId}`.toLowerCase().includes(query))
      : entries
  }

  private providers(): ModelConnectionProfile[] {
    const query = this.search.getValue().trim().toLowerCase()
    return this.snapshot.providers.filter((provider) => {
      if (!provider.models.length && !provider.selectedModel) return false
      return !query || `${provider.name} ${provider.id} ${provider.accountId}`.toLowerCase().includes(query)
    })
  }

  view(size: PageSize): PageView {
    const current = this.snapshot.defaultProviderId && this.snapshot.defaultModel
      ? `${this.snapshot.defaultProviderId} / ${this.snapshot.defaultModel}`
      : 'not selected'
    const lead: PageBlock[] = [{ kind: 'field', field: this.search, label: 'Search', focused: true }, { kind: 'spacer' }]
    const capacity = listCapacity(size, 5)
    if (this.mode === 'providers') {
      const providers = this.providers()
      this.index = Math.min(this.index, Math.max(0, providers.length - 1))
      const rows = visibleWindow(providers, this.index, capacity).map(({ value: provider, index }) => {
        const usable = isModelConnectionProfileUsable(provider)
        const count = new Set([...provider.models, ...(provider.selectedModel ? [provider.selectedModel] : [])]).size
        return rowBlock(
          `${statusGlyph(usable ? 'success' : 'warning')} ${sanitizeTerminalText(provider.name)}  ${dim(provider.accountId)}`,
          `${count} model${count === 1 ? '' : 's'}${usable ? '' : ` · ${credentialAvailabilityLabel(provider)}`}`,
          index === this.index,
          index
        )
      })
      return {
        path: ['KUN', 'Providers & accounts'],
        right: `Current · ${sanitizeTerminalText(current)}`,
        description: 'Choose an account to filter the shared model catalog.',
        body: [...lead, ...(rows.length ? rows : [{ kind: 'line' as const, text: ` ${dim('No providers with model catalogs. Run /connect first.')}` }])],
        footer: [
          { key: 'Enter', label: 'open' },
          { key: this.keymap.display('model_provider_list'), label: 'all models' },
          { key: 'Esc', label: 'back' }
        ]
      }
    }
    const entries = this.entries()
    this.index = Math.min(this.index, Math.max(0, entries.length - 1))
    const rows: PageBlock[] = []
    let group = ''
    for (const { value: entry, index } of visibleWindow(entries, this.index, capacity)) {
      const active = entry.providerId === this.snapshot.defaultProviderId &&
        entry.accountId === this.snapshot.defaultAccountId &&
        entry.model === this.snapshot.defaultModel
      const favorite = this.controller.isModelFavorite(entry.providerId, entry.accountId, entry.model)
      const nextGroup = `${entry.providerId} · ${entry.accountId}`
      if (nextGroup !== group) {
        group = nextGroup
        rows.push(sectionBlock(group))
      }
      rows.push(rowBlock(
        `${favorite ? yellow('★') : dim('☆')} ${sanitizeTerminalText(entry.label)}`,
        `${entry.providerId}${active ? ' · current' : ''}${entry.usable ? '' : ' · connect'}`,
        index === this.index,
        index
      ))
    }
    const selected = entries[this.index]
    return {
      path: ['KUN', 'Models'],
      right: `Current · ${sanitizeTerminalText(current)}`,
      description: 'Choose the shared default model.',
      body: [
        ...lead,
        ...(rows.length ? rows : [{ kind: 'line' as const, text: ` ${dim('No model catalogs. Run /connect first.')}` }]),
        ...(selected && visualDensity(size.width) === 'wide'
          ? [{ kind: 'spacer' } as const, { kind: 'line' as const, text: ` ${dim('Selected')}  ${sanitizeTerminalText(selected.providerId)} / ${cyan(sanitizeTerminalText(selected.model))}` }]
          : []),
        ...(this.error ? [{ kind: 'text' as const, text: ` ${red(this.error)}` }] : [])
      ],
      footer: this.saving
        ? [{ key: statusGlyph('running'), label: 'saving' }]
        : [
            { key: 'Enter', label: 'select' },
            { key: this.keymap.display('model_provider_list'), label: 'providers' },
            { key: this.keymap.display('model_favorite_toggle'), label: 'favorite' },
            { key: 'Esc', label: 'back' }
          ]
    }
  }

  handleKey(key: TuiKeyEvent): void {
    if (this.saving) return
    if (isCancelKey(key)) { this.close(); return }
    if (this.keymap.matches('model_provider_list', key)) {
      this.mode = this.mode === 'models' ? 'providers' : 'models'
      this.index = 0
      this.invalidate()
      return
    }
    const entries = this.entries()
    const count = this.mode === 'providers' ? this.providers().length : entries.length
    const next = navigateList(key, this.index, count)
    if (next !== undefined) this.index = next
    else if (this.keymap.matches('model_favorite_toggle', key) && this.mode === 'models' && entries[this.index]) {
      const entry = entries[this.index]!
      this.controller.toggleModelFavorite(entry.providerId, entry.accountId, entry.model)
    } else if (isKey(key, 'enter')) {
      this.activate()
      return
    } else if (this.search.handleKey(key)) this.index = 0
    else return
    this.invalidate()
  }

  handlePaste(text: string): void {
    this.search.insert(text)
    this.index = 0
    this.invalidate()
  }

  handleMouse(event: PageMouseEvent): void {
    const count = this.mode === 'providers' ? this.providers().length : this.entries().length
    if (event.type === 'scroll') this.index = Math.max(0, Math.min(count - 1, this.index + event.delta))
    else if (event.activate && event.index === this.index) { this.activate(); return }
    else this.index = event.index
    this.invalidate()
  }

  private activate(): void {
    if (this.mode === 'providers') {
      const provider = this.providers()[this.index]
      if (!provider) return
      this.providerFilter = `${provider.id}\0${provider.accountId}`
      this.mode = 'models'
      this.index = 0
      this.invalidate()
      return
    }
    const entry = this.entries()[this.index]
    if (entry) void this.select(entry)
  }

  private async select(entry: ModelEntry): Promise<void> {
    if (!entry.usable) {
      this.error = `${entry.providerId} is not connected. Run /connect to configure it before selecting this model.`
      this.invalidate()
      return
    }
    this.saving = true
    this.invalidate()
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
      this.invalidate()
    }
  }
}

import { JsonValueSchema, type JsonValue } from '@kun/extension-api'
import type {
  ExtensionLoadConfigurationRequest,
  ExtensionRuntimeRequestResult,
  ExtensionUpdateConfigurationRequest
} from '@shared/extension-ipc'
import type {
  ExtensionSettingUpdateRequest,
  ExtensionSettingsLoadRequest,
  ExtensionSettingsService,
  ExtensionSettingsSnapshot
} from './extension-settings-service'

type ExtensionSettingsTransport = {
  load: (request: ExtensionLoadConfigurationRequest) => Promise<ExtensionRuntimeRequestResult>
  update: (request: ExtensionUpdateConfigurationRequest) => Promise<ExtensionRuntimeRequestResult>
}

const trustedExtensionSettingsTransport: ExtensionSettingsTransport = {
  load: (request) => window.kunGui.extensionLoadConfiguration(request),
  update: (request) => window.kunGui.extensionUpdateConfiguration(request)
}

/** Authenticated renderer adapter; the runtime remains the persistence/validation authority. */
export class RuntimeExtensionSettingsService implements ExtensionSettingsService {
  private revision = 0
  private loaded = false
  private workspaceRoot = ''
  private contributionIds = new Set<string>()
  private values: ExtensionSettingsSnapshot['values'] = {}
  private revisionsByExtension = new Map<string, number>()
  private loadGeneration = 0

  constructor(
    private readonly transport: ExtensionSettingsTransport = trustedExtensionSettingsTransport
  ) {}

  async load(request: ExtensionSettingsLoadRequest): Promise<ExtensionSettingsSnapshot> {
    const generation = ++this.loadGeneration
    const contributionIds = [...new Set(request.contributionIds)].sort()
    if (contributionIds.length === 0) {
      this.reset(request.workspaceRoot, contributionIds, {}, {})
      return this.project()
    }
    const input = {
      contributionIds,
      ...(request.workspaceRoot ? { workspaceRoot: request.workspaceRoot } : {})
    }
    const response = await this.transport.load(input)
    const result = parseRuntimeResult(response)
    const parsed = parseLoadResponse(result)
    if (generation !== this.loadGeneration) {
      throw new Error('Extension settings request was superseded by a newer workspace load.')
    }
    this.reset(request.workspaceRoot, contributionIds, parsed.values, parsed.revisions)
    return this.project()
  }

  async update(request: ExtensionSettingUpdateRequest): Promise<ExtensionSettingsSnapshot> {
    if (!this.loaded || request.expectedRevision !== this.revision) {
      throw new Error('Extension settings changed; reload before saving again.')
    }
    if ((request.workspaceRoot ?? '') !== this.workspaceRoot) {
      throw new Error('Extension settings workspace changed; reload before saving again.')
    }
    if (!this.contributionIds.has(request.contributionId)) {
      throw new Error('Extension setting contribution is not part of the loaded snapshot.')
    }
    const extensionId = extensionIdFromContribution(request.contributionId)
    const extensionRevision = this.revisionsByExtension.get(extensionId)
    if (extensionRevision === undefined) throw new Error('Extension settings revision is unavailable.')
    const generation = this.loadGeneration
    const input = {
      contributionId: request.contributionId,
      key: request.key,
      value: JsonValueSchema.parse(request.value),
      expectedRevision: extensionRevision,
      ...(request.workspaceRoot ? { workspaceRoot: request.workspaceRoot } : {})
    }
    const response = await this.transport.update(input)
    const result = parseRuntimeResult(response)
    const parsed = parseUpdateResponse(result, extensionId)
    if (generation !== this.loadGeneration || (request.workspaceRoot ?? '') !== this.workspaceRoot) {
      throw new Error('Extension settings update was superseded by a newer workspace load.')
    }
    this.revisionsByExtension.set(extensionId, parsed.revision)
    for (const [contributionId, values] of Object.entries(parsed.values)) {
      if (this.contributionIds.has(contributionId)) this.values[contributionId] = values
    }
    this.revision += 1
    return this.project()
  }

  private reset(
    workspaceRoot: string | undefined,
    contributionIds: readonly string[],
    values: ExtensionSettingsSnapshot['values'],
    revisions: Record<string, number>
  ): void {
    this.loaded = true
    this.workspaceRoot = workspaceRoot ?? ''
    this.contributionIds = new Set(contributionIds)
    this.values = structuredClone(values)
    this.revisionsByExtension = new Map(Object.entries(revisions))
    this.revision += 1
  }

  private project(): ExtensionSettingsSnapshot {
    return {
      schemaVersion: 1,
      revision: this.revision,
      values: structuredClone(this.values)
    }
  }
}

function parseRuntimeResult(result: ExtensionRuntimeRequestResult): unknown {
  let body: unknown
  try {
    body = result.body ? JSON.parse(result.body) : undefined
  } catch {
    throw new Error(`Extension settings service returned invalid JSON (${result.status}).`)
  }
  if (result.ok) return body
  const error = isRecord(body) ? body : {}
  throw new Error(typeof error.message === 'string'
    ? error.message.slice(0, 4_096)
    : `Extension settings request failed (${result.status}).`)
}

function parseLoadResponse(value: unknown): {
  values: ExtensionSettingsSnapshot['values']
  revisions: Record<string, number>
} {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.values) || !isRecord(value.revisions)) {
    throw new Error('Extension settings snapshot is malformed.')
  }
  return {
    values: parseValues(value.values),
    revisions: Object.fromEntries(Object.entries(value.revisions).map(([extensionId, revision]) => {
      if (!Number.isSafeInteger(revision) || Number(revision) < 0) {
        throw new Error('Extension settings revision is malformed.')
      }
      return [extensionId, Number(revision)]
    }))
  }
}

function parseUpdateResponse(value: unknown, extensionId: string): {
  revision: number
  values: ExtensionSettingsSnapshot['values']
} {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.extensionId !== extensionId ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !isRecord(value.values)
  ) throw new Error('Extension settings update response is malformed.')
  return { revision: Number(value.revision), values: parseValues(value.values) }
}

function parseValues(input: Record<string, unknown>): ExtensionSettingsSnapshot['values'] {
  const values: ExtensionSettingsSnapshot['values'] = {}
  for (const [contributionId, candidate] of Object.entries(input)) {
    extensionIdFromContribution(contributionId)
    if (!isRecord(candidate)) throw new Error('Extension settings values are malformed.')
    values[contributionId] = Object.fromEntries(Object.entries(candidate).map(([key, value]) => [
      key,
      JsonValueSchema.parse(value) as JsonValue
    ]))
  }
  return values
}

function extensionIdFromContribution(value: string): string {
  const match = /^extension:([a-z0-9][a-z0-9-]{0,63}\.[a-z0-9][a-z0-9-]{0,63})\/[a-z][a-z0-9-]{0,63}$/.exec(value)
  if (!match) throw new Error('Extension setting contribution ID is invalid.')
  return match[1]!
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

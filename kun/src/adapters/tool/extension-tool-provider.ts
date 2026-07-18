import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import { ExtensionApiError, type ExtensionErrorCode } from '@kun/extension-api'
import type { ExtensionPrincipal } from '../../services/extension-agent-service.js'
import type {
  ExtensionToolCatalogEntry,
  ExtensionToolCatalogEpoch
} from '../../contracts/threads.js'
import type { ToolExecutionUpdate, ToolHostContext } from '../../ports/tool-host.js'
import {
  compileExtensionJsonSchema,
  type ExtensionJsonSchemaValidator
} from '../../extensions/json-schema-validator.js'
import { CapabilityRegistry, type CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'

export type ExtensionToolSideEffect =
  | 'none'
  | 'workspace-read'
  | 'workspace-write'
  | 'network'
  | 'external'

export type ExtensionToolDeclaration = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  sideEffect: ExtensionToolSideEffect
  idempotent?: boolean
  maxOutputBytes?: number
}

export type ExtensionToolInvocation = {
  invocationId: string
  canonicalToolId: string
  modelAlias: string
  arguments: Record<string, unknown>
  threadId: string
  turnId: string
  workspace: string
  signal: AbortSignal
  reportProgress(update: ToolExecutionUpdate): Promise<void>
}

export type ExtensionToolHandler = (
  invocation: ExtensionToolInvocation
) => Promise<{
  output: unknown
  isError?: boolean
  /** Value governed by outputSchema when the ToolHost output is an envelope. */
  declaredOutput?: unknown
}>

export type ExtensionToolAuthorizationRequest = {
  operation: 'register' | 'invoke'
  canonicalToolId: string
  workspace?: string
  sideEffect: ExtensionToolSideEffect
}

export interface ExtensionToolAuthorizer {
  authorize(
    principal: ExtensionPrincipal,
    request: ExtensionToolAuthorizationRequest
  ): Promise<void> | void
}

export type ExtensionToolRegistration = {
  canonicalToolId: string
  modelAlias: string
  dispose(): void
}

export type ExtensionToolRegistryOptions = {
  registry: CapabilityRegistry
  authorizer?: ExtensionToolAuthorizer
  isManifestDeclared?: (principal: ExtensionPrincipal, declaration: ExtensionToolDeclaration) => boolean
}

type ActiveRegistration = {
  registrationKey: string
  principal: ExtensionPrincipal
  declaration: ExtensionToolDeclaration
  inputValidator: ExtensionJsonSchemaValidator
  outputValidator?: ExtensionJsonSchemaValidator
  canonicalToolId: string
  modelAlias: string
  handler: ExtensionToolHandler
  controller: AbortController
  disposed: boolean
}

const RESERVED_TOOL_NAMES = new Set([
  'request_user_input',
  'user_input',
  'extension_tool_search',
  'extension_tool_call',
  'approval',
  'approve'
])
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024
const ABSOLUTE_MAX_OUTPUT_BYTES = 1024 * 1024
const MAX_PROGRESS_UPDATES = 64
const MAX_PROGRESS_BYTES = 64 * 1024
export const MAX_DIRECT_EXTENSION_TOOLS = 16
const KNOWN_PRE_COMMIT_EXTENSION_API_ERROR_CODES: ReadonlySet<ExtensionErrorCode> = new Set([
  'INVALID_ARGUMENT',
  'VALIDATION_FAILED',
  'PERMISSION_DENIED',
  'NOT_FOUND',
  'CONFLICT',
  'UNSUPPORTED_CAPABILITY',
  'INCOMPATIBLE_API',
  'INCOMPATIBLE_MANIFEST',
  'INCOMPATIBLE_ENGINE',
  'INCOMPATIBLE_RPC',
  'INTERACTION_REQUIRED',
  'ACCOUNT_REQUIRED',
  'RESOURCE_LIMIT'
])

/**
 * Dynamic Extension Tool Provider. It adapts host-process handlers into
 * LocalTool entries so every invocation keeps Kun's approval, sandbox,
 * operation-journal, output-offload, cancellation, and history semantics.
 */
export class ExtensionToolRegistry {
  /** Workspace ownership key -> registration. Canonical tool IDs may have one registration per Host scope. */
  private readonly registrations = new Map<string, ActiveRegistration>()
  private readonly aliases = new Map<string, string>()
  private readonly providerIds = new Set<string>()
  private readonly authorizer: ExtensionToolAuthorizer
  private readonly gatewayDispatchHost: LocalToolHost

  constructor(private readonly options: ExtensionToolRegistryOptions) {
    this.authorizer = options.authorizer ?? new PermissionExtensionToolAuthorizer()
    this.gatewayDispatchHost = new LocalToolHost({ registry: options.registry })
    this.syncProviders()
  }

  async register(
    principal: ExtensionPrincipal,
    declarationInput: ExtensionToolDeclaration,
    handler: ExtensionToolHandler
  ): Promise<ExtensionToolRegistration> {
    const declaration = validateDeclaration(declarationInput)
    const inputValidator = compileExtensionJsonSchema(
      declaration.inputSchema,
      `extension tool ${declaration.name} input`
    )
    const outputValidator = declaration.outputSchema
      ? compileExtensionJsonSchema(
          declaration.outputSchema,
          `extension tool ${declaration.name} output`
        )
      : undefined
    if (this.options.isManifestDeclared && !this.options.isManifestDeclared(principal, declaration)) {
      throw new Error(`extension tool is not declared by the active manifest: ${declaration.name}`)
    }
    const canonicalToolId = canonicalExtensionToolId(principal.extensionId, declaration.name)
    const registrationKey = scopedRegistrationKey(canonicalToolId, principal.workspaceRoots)
    if (this.registrations.has(registrationKey)) {
      throw new Error(`extension tool already registered for workspace scope: ${canonicalToolId}`)
    }
    const modelAlias = extensionToolModelAlias(principal.extensionId, declaration.name)
    const aliasOwner = this.aliases.get(modelAlias)
    if (aliasOwner && aliasOwner !== canonicalToolId) {
      throw new Error(`extension tool alias collision: ${modelAlias}`)
    }
    await this.authorizer.authorize(principal, {
      operation: 'register', canonicalToolId, sideEffect: declaration.sideEffect
    })
    const registration: ActiveRegistration = {
      registrationKey,
      principal,
      declaration,
      inputValidator,
      ...(outputValidator ? { outputValidator } : {}),
      canonicalToolId,
      modelAlias,
      handler,
      controller: new AbortController(),
      disposed: false
    }
    const existing = this.registrationsForCanonical(canonicalToolId)[0]
    if (existing && registrationDigest(existing) !== registrationDigest(registration)) {
      throw new Error(`extension tool declaration differs across workspace scopes: ${canonicalToolId}`)
    }
    this.registrations.set(registrationKey, registration)
    this.aliases.set(modelAlias, canonicalToolId)
    this.syncProviders()
    let disposed = false
    return {
      canonicalToolId,
      modelAlias,
      dispose: () => {
        if (disposed) return
        disposed = true
        this.disposeRegistration(registration)
      }
    }
  }

  disposeExtension(extensionId: string): void {
    for (const registration of [...this.registrations.values()]) {
      if (registration.principal.extensionId === extensionId) this.disposeRegistration(registration, false)
    }
    this.syncProviders()
  }

  disposeAll(): void {
    for (const registration of [...this.registrations.values()]) {
      this.disposeRegistration(registration, false)
    }
    this.syncProviders()
  }

  /** Rebind live extension registrations after Kun rebuilds its base registry. */
  rebindRegistry(registry: CapabilityRegistry): void {
    if (this.options.registry === registry) return
    for (const providerId of this.providerIds) {
      this.options.registry.unregisterProvider(providerId)
    }
    this.options.registry = registry
    this.gatewayDispatchHost.replaceRuntimeComponents({ registry })
    this.providerIds.clear()
    this.syncProviders()
  }

  list(extensionId?: string, workspace?: string): Array<{
    canonicalToolId: string
    modelAlias: string
    extensionId: string
    declaration: ExtensionToolDeclaration
  }> {
    return uniqueCanonicalRegistrations([...this.registrations.values()]
      .filter((registration) => !extensionId || registration.principal.extensionId === extensionId)
      .filter((registration) => workspace === undefined || registrationOwnsWorkspace(registration, workspace)))
      .map((registration) => ({
        canonicalToolId: registration.canonicalToolId,
        modelAlias: registration.modelAlias,
        extensionId: registration.principal.extensionId,
        declaration: structuredClone(registration.declaration)
      }))
      .sort((a, b) => a.canonicalToolId.localeCompare(b.canonicalToolId))
  }

  createCatalogEpoch(input: {
    eligibleCanonicalToolIds?: readonly string[]
    workspace?: string
    id?: string
    createdAt?: string
  } = {}): ExtensionToolCatalogEpoch {
    const eligible = input.eligibleCanonicalToolIds
      ? new Set(input.eligibleCanonicalToolIds)
      : null
    const registrations = uniqueCanonicalRegistrations([...this.registrations.values()]
      .filter((registration) => !eligible || eligible.has(registration.canonicalToolId))
      .filter((registration) => input.workspace === undefined || registrationOwnsWorkspace(registration, input.workspace)))
      .sort((a, b) => a.canonicalToolId.localeCompare(b.canonicalToolId))
    if (eligible) {
      for (const canonicalToolId of eligible) {
        if (!registrations.some((registration) => registration.canonicalToolId === canonicalToolId)) {
          throw new Error(`eligible extension tool is unavailable: ${canonicalToolId}`)
        }
      }
    }
    const tools = registrations.map(catalogEntry)
    const schemaDigests = Object.fromEntries(registrations.map((registration) => [
      registration.canonicalToolId,
      registrationDigest(registration)
    ]))
    const fingerprint = `sha256:${stableHash(tools)}`
    return {
      id: input.id ?? `epoch_${fingerprint.slice(-16)}_${randomUUID().slice(0, 8)}`,
      fingerprint,
      toolCount: tools.length,
      canonicalToolIds: tools.map((tool) => tool.canonicalToolId),
      schemaDigests,
      tools,
      createdAt: input.createdAt ?? new Date().toISOString()
    }
  }

  verifyCatalogEpoch(epoch: ExtensionToolCatalogEpoch): {
    kind: 'none' | 'additive' | 'breaking'
    missing: string[]
    changed: string[]
    added: string[]
  } {
    const pinned = new Set(epoch.canonicalToolIds)
    const missing: string[] = []
    const changed: string[] = []
    for (const canonicalToolId of epoch.canonicalToolIds) {
      const registration = this.registrationsForCanonical(canonicalToolId)
        .find((candidate) => !candidate.disposed)
      if (!registration || registration.disposed) {
        missing.push(canonicalToolId)
      } else if (registrationDigest(registration) !== epoch.schemaDigests[canonicalToolId]) {
        changed.push(canonicalToolId)
      }
    }
    const added = [...new Set([...this.registrations.values()]
      .map((registration) => registration.canonicalToolId))]
      .filter((id) => !pinned.has(id))
      .sort()
    return {
      kind: missing.length || changed.length ? 'breaking' : added.length ? 'additive' : 'none',
      missing,
      changed,
      added
    }
  }

  searchCatalogEpoch(epoch: ExtensionToolCatalogEpoch, query: string, limit = 5): ExtensionToolCatalogEntry[] {
    this.assertCatalogCurrent(epoch)
    const tokens = searchTokens(query)
    if (tokens.length === 0) return []
    return (epoch.tools ?? [])
      .map((tool) => {
        const haystack = searchTokens(`${tool.canonicalToolId} ${tool.description}`)
        const score = tokens.reduce((count, token) => count + (haystack.includes(token) ? 1 : 0), 0)
        return { tool, score }
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.tool.canonicalToolId.localeCompare(b.tool.canonicalToolId))
      .slice(0, Math.max(1, Math.min(10, Math.floor(limit))))
      .map((entry) => structuredClone(entry.tool))
  }

  private localTool(canonicalToolId: string, representative: ActiveRegistration): LocalTool {
    const { declaration } = representative
    return LocalToolHost.defineTool({
      name: representative.modelAlias,
      description: `${declaration.description}\nExtension tool: ${canonicalToolId}`,
      inputSchema: declaration.inputSchema,
      policy: policyForSideEffect(declaration.sideEffect),
      toolKind: declaration.sideEffect === 'workspace-write' ? 'file_change' : 'tool_call',
      ...(declaration.sideEffect === 'external' ? { requiresExplicitApproval: true } : {}),
      shouldAdvertise: (context) => {
        if (!this.registrationForWorkspace(canonicalToolId, context.workspace)) return false
        const epoch = context.extensionToolCatalogEpoch
        if (!epoch) return true
        this.assertCatalogCurrent(epoch)
        return epoch.toolCount <= MAX_DIRECT_EXTENSION_TOOLS &&
          epoch.canonicalToolIds.includes(canonicalToolId)
      },
      execute: async (args, context, onUpdate) => {
        const registration = this.registrationForWorkspace(canonicalToolId, context.workspace)
        if (!registration) {
          throw new Error(`extension tool is unavailable in workspace: ${canonicalToolId}`)
        }
        if (registration.disposed || registration.controller.signal.aborted) {
          throw new Error(`extension tool is unavailable: ${registration.canonicalToolId}`)
        }
        registration.inputValidator.assert(args, `extension tool ${registration.canonicalToolId} arguments`)
        await this.authorizer.authorize(registration.principal, {
          operation: 'invoke',
          canonicalToolId: registration.canonicalToolId,
          workspace: context.workspace,
          sideEffect: declaration.sideEffect
        })
        const signal = combineAbortSignals(context.abortSignal, registration.controller.signal)
        let progressCount = 0
        let dispatched = false
        try {
          dispatched = true
          const result = await registration.handler({
            invocationId: `extinv_${randomUUID()}`,
            canonicalToolId: registration.canonicalToolId,
            modelAlias: registration.modelAlias,
            arguments: structuredClone(args),
            threadId: context.threadId,
            turnId: context.turnId,
            workspace: context.workspace,
            signal,
            reportProgress: async (update) => {
              if (signal.aborted) throw abortError()
              progressCount += 1
              if (progressCount > MAX_PROGRESS_UPDATES) {
                throw new Error('extension tool progress update limit exceeded')
              }
              if (serializedBytes(update) > MAX_PROGRESS_BYTES) {
                throw new Error('extension tool progress update is too large')
              }
              await onUpdate?.(structuredClone(update))
            }
          })
          if (signal.aborted) throw abortError()
          if (registration.outputValidator && !result.isError) {
            registration.outputValidator.assert(
              result.declaredOutput ?? result.output,
              `extension tool ${registration.canonicalToolId} result`
            )
          }
          return normalizeOutput(result, declaration.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES)
        } catch (error) {
          if (signal.aborted) throw error
          if (dispatched && hasUnknownSideEffect(declaration.sideEffect) && !isKnownFailure(error)) {
            throw new ExtensionToolUnknownOutcomeError(
              `extension tool failed after dispatch; side-effect outcome is unknown: ${registration.canonicalToolId}`,
              error
            )
          }
          throw error
        }
      }
    })
  }

  private disposeRegistration(registration: ActiveRegistration, sync = true): void {
    if (registration.disposed) return
    registration.disposed = true
    registration.controller.abort(new Error('extension tool registration disposed'))
    this.registrations.delete(registration.registrationKey)
    if (this.registrationsForCanonical(registration.canonicalToolId).length === 0) {
      this.aliases.delete(registration.modelAlias)
    }
    if (sync) this.syncProviders()
  }

  private syncProviders(): void {
    const grouped = new Map<string, Map<string, ActiveRegistration>>()
    for (const registration of this.registrations.values()) {
      const registrations = grouped.get(registration.principal.extensionId) ?? new Map<string, ActiveRegistration>()
      if (!registrations.has(registration.canonicalToolId)) {
        registrations.set(registration.canonicalToolId, registration)
      }
      grouped.set(registration.principal.extensionId, registrations)
    }
    const activeProviderIds = new Set([
      ...[...grouped.keys()].map(extensionProviderId),
      EXTENSION_GATEWAY_PROVIDER_ID
    ])
    for (const providerId of this.providerIds) {
      if (!activeProviderIds.has(providerId)) this.options.registry.unregisterProvider(providerId)
    }
    this.providerIds.clear()
    for (const [extensionId, registrations] of grouped) {
      const provider: CapabilityToolProvider = {
        id: extensionProviderId(extensionId),
        kind: 'extension',
        enabled: true,
        available: true,
        tools: [...registrations.values()]
          .sort((a, b) => a.canonicalToolId.localeCompare(b.canonicalToolId))
          .map((registration) => this.localTool(registration.canonicalToolId, registration))
      }
      this.options.registry.replaceProvider(provider)
      this.providerIds.add(provider.id)
    }
    this.options.registry.replaceProvider(this.progressiveGatewayProvider())
    this.providerIds.add(EXTENSION_GATEWAY_PROVIDER_ID)
  }

  private progressiveGatewayProvider(): CapabilityToolProvider {
    return {
      id: EXTENSION_GATEWAY_PROVIDER_ID,
      kind: 'extension',
      enabled: true,
      available: true,
      tools: [
        LocalToolHost.defineTool({
          name: 'extension_tool_search',
          description: 'Search the current thread\'s pinned extension-tool catalog. Use this before extension_tool_call.',
          policy: 'auto',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', minLength: 1 },
              limit: { type: 'integer', minimum: 1, maximum: 10 }
            },
            required: ['query'],
            additionalProperties: false
          },
          shouldAdvertise: (context) => this.shouldAdvertiseGateway(context),
          execute: async (args, context) => {
            const epoch = requiredEpoch(context)
            const query = typeof args.query === 'string' ? args.query : ''
            const limit = typeof args.limit === 'number' ? args.limit : 5
            return { output: { epochId: epoch.id, tools: this.searchCatalogEpoch(epoch, query, limit) } }
          }
        }),
        LocalToolHost.defineTool({
          name: 'extension_tool_call',
          description: 'Call one tool from the current thread\'s pinned extension-tool catalog.',
          policy: 'auto',
          inputSchema: {
            type: 'object',
            properties: {
              canonicalToolId: { type: 'string', minLength: 1 },
              arguments: { type: 'object' }
            },
            required: ['canonicalToolId', 'arguments'],
            additionalProperties: false
          },
          shouldAdvertise: (context) => this.shouldAdvertiseGateway(context),
          execute: async (args, context, onUpdate) => {
            const epoch = requiredEpoch(context)
            const canonicalToolId = typeof args.canonicalToolId === 'string' ? args.canonicalToolId : ''
            const toolArgs = isPlainObject(args.arguments) ? args.arguments : {}
            if (!epoch.canonicalToolIds.includes(canonicalToolId)) {
              return { output: { code: 'extension_tool_not_pinned', error: 'Tool is not in the active catalog epoch.' }, isError: true }
            }
            this.assertCatalogCurrent(epoch)
            const registration = this.registrationForWorkspace(canonicalToolId, context.workspace)
            if (!registration) throw new Error(`pinned extension tool is unavailable: ${canonicalToolId}`)
            const targetCallId = `gateway_${stableHash({
              threadId: context.threadId,
              turnId: context.turnId,
              canonicalToolId,
              arguments: toolArgs
            }).slice(0, 20)}`
            const result = await this.gatewayDispatchHost.execute({
              callId: targetCallId,
              toolName: registration.modelAlias,
              providerId: extensionProviderId(registration.principal.extensionId),
              toolKind: registration.declaration.sideEffect === 'workspace-write' ? 'file_change' : 'tool_call',
              arguments: toolArgs
            }, {
              ...context,
              // The gateway already verified the persisted epoch and target.
              // Clear it for the nested dispatch so the target's direct-model
              // advertisement threshold does not block broker execution.
              extensionToolCatalogEpoch: undefined,
              allowedToolNames: context.allowedToolNames
                ? [...new Set([...context.allowedToolNames, registration.modelAlias])]
                : undefined,
              allowedProviderIds: context.allowedProviderIds
                ? [...new Set([...context.allowedProviderIds, extensionProviderId(registration.principal.extensionId)])]
                : undefined
            }, async (item) => {
              if (item.kind === 'tool_result') await onUpdate?.({ output: item.output, isError: item.isError })
            })
            if (result.item.kind !== 'tool_result') {
              return { output: { code: 'extension_tool_invalid_result', error: 'Extension tool returned invalid history.' }, isError: true }
            }
            return {
              output: {
                canonicalToolId,
                sideEffect: registration.declaration.sideEffect,
                result: result.item.output
              },
              ...(result.item.isError ? { isError: true } : {})
            }
          }
        })
      ]
    }
  }

  private shouldAdvertiseGateway(context: ToolHostContext): boolean {
    const epoch = context.extensionToolCatalogEpoch
    if (!epoch) return false
    this.assertCatalogCurrent(epoch)
    return epoch.toolCount > MAX_DIRECT_EXTENSION_TOOLS &&
      epoch.canonicalToolIds.every((canonicalToolId) =>
        this.registrationForWorkspace(canonicalToolId, context.workspace) !== undefined)
  }

  private registrationsForCanonical(canonicalToolId: string): ActiveRegistration[] {
    return [...this.registrations.values()]
      .filter((registration) => registration.canonicalToolId === canonicalToolId)
  }

  private registrationForWorkspace(
    canonicalToolId: string,
    workspace: string
  ): ActiveRegistration | undefined {
    return this.registrationsForCanonical(canonicalToolId)
      .find((registration) => !registration.disposed && registrationOwnsWorkspace(registration, workspace))
  }

  private assertCatalogCurrent(epoch: ExtensionToolCatalogEpoch): void {
    const drift = this.verifyCatalogEpoch(epoch)
    if (drift.kind === 'breaking') throw new ExtensionToolCatalogDriftError(epoch.id, drift)
  }
}

const EXTENSION_GATEWAY_PROVIDER_ID = 'extension:gateway'

export class PermissionExtensionToolAuthorizer implements ExtensionToolAuthorizer {
  authorize(principal: ExtensionPrincipal, request: ExtensionToolAuthorizationRequest): void {
    if (!principal.permissions.includes('tools.register')) {
      throw new Error('Missing permission: tools.register')
    }
    if (request.operation === 'invoke' && !principalOwnsWorkspace(principal, request.workspace)) {
      throw new Error(`Extension tool workspace scope mismatch: ${request.canonicalToolId}`)
    }
  }
}

export class ExtensionToolKnownFailure extends Error {
  readonly knownFailure = true
}

export class ExtensionToolUnknownOutcomeError extends Error {
  readonly unknownOutcome = true

  constructor(message: string, readonly originalCause?: unknown) {
    super(message)
    this.name = 'ExtensionToolUnknownOutcomeError'
  }
}

export class ExtensionToolCatalogDriftError extends Error {
  readonly code = 'extension_tool_catalog_drift'

  constructor(
    readonly epochId: string,
    readonly drift: { missing: string[]; changed: string[]; added: string[] }
  ) {
    super(`Extension tool catalog epoch ${epochId} no longer matches the active registrations.`)
    this.name = 'ExtensionToolCatalogDriftError'
  }
}

export function canonicalExtensionToolId(extensionId: string, localName: string): string {
  return `extension:${extensionId}/${localName}`
}

export function extensionToolModelAlias(extensionId: string, localName: string): string {
  const namespace = createHash('sha256').update(extensionId).digest('hex').slice(0, 10)
  const safeName = localName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)
  return `ext_${namespace}_${safeName}`
}

function extensionProviderId(extensionId: string): string {
  return `extension:${extensionId}`
}

function catalogEntry(registration: ActiveRegistration): ExtensionToolCatalogEntry {
  return {
    canonicalToolId: registration.canonicalToolId,
    modelAlias: registration.modelAlias,
    description: registration.declaration.description,
    inputSchema: structuredClone(registration.declaration.inputSchema),
    sideEffect: registration.declaration.sideEffect
  }
}

function registrationDigest(registration: ActiveRegistration): string {
  return `sha256:${stableHash({
    ...catalogEntry(registration),
    ...(registration.declaration.outputSchema
      ? { outputSchema: registration.declaration.outputSchema }
      : {}),
    idempotent: registration.declaration.idempotent ?? false,
    maxOutputBytes: registration.declaration.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  })}`
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)])
  )
}

function searchTokens(value: string): string[] {
  return [...new Set(value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}_.:-]+/gu) ?? [])]
}

function scopedRegistrationKey(canonicalToolId: string, workspaceRoots: readonly string[]): string {
  return `${canonicalToolId}\u0000${JSON.stringify(normalizedWorkspaceRoots(workspaceRoots))}`
}

function normalizedWorkspaceRoots(workspaceRoots: readonly string[]): string[] {
  return [...new Set(workspaceRoots.map((root) => resolve(root)))].sort()
}

function principalOwnsWorkspace(principal: ExtensionPrincipal, workspace: string | undefined): boolean {
  if (!workspace || !isAbsolute(workspace)) return false
  return normalizedWorkspaceRoots(principal.workspaceRoots).includes(resolve(workspace))
}

function registrationOwnsWorkspace(registration: ActiveRegistration, workspace: string): boolean {
  return principalOwnsWorkspace(registration.principal, workspace)
}

function uniqueCanonicalRegistrations(registrations: ActiveRegistration[]): ActiveRegistration[] {
  const unique = new Map<string, ActiveRegistration>()
  for (const registration of registrations) {
    if (!registration.disposed && !unique.has(registration.canonicalToolId)) {
      unique.set(registration.canonicalToolId, registration)
    }
  }
  return [...unique.values()]
}

function requiredEpoch(context: ToolHostContext): ExtensionToolCatalogEpoch {
  const epoch = context.extensionToolCatalogEpoch
  if (!epoch) throw new Error('extension tool catalog epoch is required')
  return epoch
}

function validateDeclaration(input: ExtensionToolDeclaration): ExtensionToolDeclaration {
  const name = input.name.trim()
  const description = input.description.trim()
  if (!/^[a-z][a-z0-9._-]{0,63}$/i.test(name)) throw new Error(`invalid extension tool name: ${name}`)
  if (RESERVED_TOOL_NAMES.has(name) || name.startsWith('kun.')) throw new Error(`reserved extension tool name: ${name}`)
  if (!description || description.length > 4_000) throw new Error(`invalid extension tool description: ${name}`)
  if (!isPlainObject(input.inputSchema) || input.inputSchema.type !== 'object') {
    throw new Error(`extension tool input schema must have object type: ${name}`)
  }
  if (input.outputSchema !== undefined && !isPlainObject(input.outputSchema)) {
    throw new Error(`extension tool output schema must be an object: ${name}`)
  }
  if (input.maxOutputBytes !== undefined && (
    !Number.isSafeInteger(input.maxOutputBytes) || input.maxOutputBytes < 1_024 || input.maxOutputBytes > ABSOLUTE_MAX_OUTPUT_BYTES
  )) throw new Error(`invalid extension tool maxOutputBytes: ${name}`)
  return structuredClone({ ...input, name, description })
}

function policyForSideEffect(sideEffect: ExtensionToolSideEffect): LocalTool['policy'] {
  switch (sideEffect) {
    case 'none':
    case 'workspace-read':
      return 'auto'
    case 'workspace-write':
    case 'network':
    case 'external':
      return 'on-request'
  }
}

function hasUnknownSideEffect(sideEffect: ExtensionToolSideEffect): boolean {
  return sideEffect === 'workspace-write' || sideEffect === 'network' || sideEffect === 'external'
}

function isKnownFailure(error: unknown): boolean {
  if (error instanceof ExtensionApiError) {
    return KNOWN_PRE_COMMIT_EXTENSION_API_ERROR_CODES.has(error.code)
  }
  return Boolean(error && typeof error === 'object' && 'knownFailure' in error && error.knownFailure === true)
}

function normalizeOutput(
  result: { output: unknown; isError?: boolean; declaredOutput?: unknown },
  maxBytes: number
): { output: unknown; isError?: boolean } {
  if (serializedBytes(result.output) <= maxBytes) {
    return { output: result.output, ...(result.isError ? { isError: true } : {}) }
  }
  const text = typeof result.output === 'string' ? result.output : JSON.stringify(result.output)
  const truncated = Buffer.from(text, 'utf8').subarray(0, Math.max(0, maxBytes - 256)).toString('utf8')
  return {
    output: {
      truncated: true,
      originalBytes: Buffer.byteLength(text, 'utf8'),
      content: truncated,
      message: 'Extension tool output exceeded its declared result budget.'
    },
    ...(result.isError ? { isError: true } : {})
  }
}

function combineAbortSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()
  const abort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason)
  }
  for (const signal of signals) {
    if (signal.aborted) abort(signal)
    else signal.addEventListener('abort', () => abort(signal), { once: true })
  }
  return controller.signal
}

function abortError(): Error {
  const error = new Error('extension tool invocation aborted')
  error.name = 'AbortError'
  return error
}

function serializedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf8')
  } catch {
    throw new Error('extension tool payload must be JSON serializable')
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

import type {
  ToolHostContext,
  ToolEffects,
  ToolProviderKind,
  ToolProviderPolicy
} from '../../ports/tool-host.js'
import type { LocalTool } from './local-tool-host.js'
import { isToolAdvertisedInSandbox } from './sandbox-policy.js'
import { isToolAllowedInOrchestration } from '../../graph/graph-tool-boundary.js'
import {
  isPlanModeToolAllowed,
  isPlanModeToolContext
} from './plan-mode-tool-policy.js'

export type CapabilityToolRecord = {
  provider: ToolProviderPolicy
  tool: LocalTool
}

export type CapabilityToolProvider = ToolProviderPolicy & {
  tools: readonly LocalTool[]
}

export type CapabilityToolSpec = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  toolKind?: 'tool_call' | 'command_execution' | 'file_change'
  sideEffect?: 'read-only' | 'unknown'
  providerId: string
  providerKind: ToolProviderKind
  effects?: ToolEffects
}

const USER_INPUT_TOOL_NAME = 'user_input'
const LEGACY_USER_INPUT_TOOL_NAME = 'request_user_input'

export class CapabilityRegistry {
  private readonly providers = new Map<string, CapabilityToolProvider>()
  private readonly tools = new Map<string, CapabilityToolRecord>()

  static fromLocalTools(tools: readonly LocalTool[]): CapabilityRegistry {
    return new CapabilityRegistry([
      {
        id: 'builtin',
        kind: 'built-in',
        enabled: true,
        available: true,
        tools
      }
    ])
  }

  constructor(providers: readonly CapabilityToolProvider[] = []) {
    this.replaceProviders(providers)
  }

  registerProvider(provider: CapabilityToolProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new Error(`duplicate tool provider: ${provider.id}`)
    }
    this.providers.set(provider.id, provider)
    for (const tool of provider.tools) {
      if (this.tools.has(tool.name)) {
        throw new Error(`duplicate tool name: ${tool.name}`)
      }
      this.tools.set(tool.name, { provider: providerPolicy(provider), tool })
    }
    return () => this.unregisterProvider(provider.id)
  }

  replaceProvider(provider: CapabilityToolProvider): void {
    const providers = [...this.providers.values()].filter((candidate) => candidate.id !== provider.id)
    this.replaceProviders([...providers, provider])
  }

  unregisterProvider(providerId: string): boolean {
    if (!this.providers.has(providerId)) return false
    this.replaceProviders([...this.providers.values()].filter((provider) => provider.id !== providerId))
    return true
  }

  replaceProviders(providers: readonly CapabilityToolProvider[]): void {
    const nextProviders = new Map<string, CapabilityToolProvider>()
    const nextTools = new Map<string, CapabilityToolRecord>()
    for (const provider of providers) {
      if (nextProviders.has(provider.id)) {
        throw new Error(`duplicate tool provider: ${provider.id}`)
      }
      nextProviders.set(provider.id, provider)
      for (const tool of provider.tools) {
        if (nextTools.has(tool.name)) {
          throw new Error(`duplicate tool name: ${tool.name}`)
        }
        nextTools.set(tool.name, { provider: providerPolicy(provider), tool })
      }
    }
    this.providers.clear()
    this.tools.clear()
    for (const [id, provider] of nextProviders) this.providers.set(id, provider)
    for (const [name, record] of nextTools) this.tools.set(name, record)
  }

  listTools(context?: ToolHostContext): CapabilityToolSpec[] {
    const specs: CapabilityToolSpec[] = []
    for (const record of this.tools.values()) {
      if (!this.canUseProvider(record.provider, context)) continue
      if (!isToolAllowedInOrchestration({
        toolName: record.tool.name,
        providerId: record.provider.id,
        providerKind: record.provider.kind
      }, context)) continue
      if (!this.canUseTool(record.tool, context)) continue
      if (record.tool.modelAdvertised === false) continue
      if (!isToolAdvertisedInSandbox(record.tool, context)) continue
      if (record.tool.shouldAdvertise) {
        if (!context || !record.tool.shouldAdvertise(context)) continue
      }
      specs.push({
        name: record.tool.name,
        description: record.tool.description,
        inputSchema: record.tool.inputSchema,
        toolKind: record.tool.toolKind,
        ...(record.tool.sideEffect ? { sideEffect: record.tool.sideEffect } : {}),
        providerId: record.provider.id,
        providerKind: record.provider.kind,
        ...(record.tool.effects || record.provider.effects
          ? { effects: record.tool.effects ?? record.provider.effects }
          : {})
      })
    }
    return canonicalizeAdvertisedToolAliases(specs)
  }

  resolveTool(toolName: string, context: ToolHostContext, providerId?: string): CapabilityToolRecord {
    const record = this.tools.get(toolName)
    if (!record) {
      throw new Error(`unknown tool: ${toolName}`)
    }
    if (providerId && providerId !== record.provider.id) {
      throw new Error(`tool ${toolName} is not provided by ${providerId}`)
    }
    if (!this.canUseProvider(record.provider, context)) {
      throw new Error(`tool ${toolName} is not advertised by provider ${record.provider.id}`)
    }
    if (!isToolAllowedInOrchestration({
      toolName: record.tool.name,
      providerId: record.provider.id,
      providerKind: record.provider.kind
    }, context)) {
      throw new Error(`tool ${toolName} is unavailable in the Graph capability plane`)
    }
    if (!this.canUseTool(record.tool, context)) {
      throw new Error(`tool ${toolName} is not advertised by active tool policy`)
    }
    if (record.tool.shouldAdvertise && !record.tool.shouldAdvertise(context)) {
      throw new Error(`tool ${toolName} is not advertised in this turn context`)
    }
    return record
  }

  diagnostics(): ToolProviderPolicy[] {
    return [...this.providers.values()].map(providerPolicy)
  }

  private canUseProvider(provider: ToolProviderPolicy, context?: ToolHostContext): boolean {
    if (!provider.enabled || !provider.available) return false
    // `gui` is reserved for capabilities that require a live desktop
    // workbench or control the local desktop. Diagnostics may list every
    // provider without a context, but a concrete non-GUI turn must never see
    // or execute these tools.
    if (context && provider.kind === 'gui' && effectiveClientSurface(context) !== 'gui') {
      return false
    }
    if (context?.blockedProviderIds?.includes(provider.id)) return false
    const allowed = context?.allowedProviderIds
    if (allowed && !allowed.includes(provider.id)) return false
    return true
  }

  private canUseTool(tool: LocalTool, context?: ToolHostContext): boolean {
    const toolName = tool.name
    if (context && isPlanModeToolContext(context) && !isPlanModeToolAllowed(tool)) {
      return false
    }
    if (context?.blockedToolNames?.includes(toolName)) return false
    const allowed = context?.allowedToolNames
    return !allowed || allowed.includes(toolName)
  }
}

/**
 * Keep legacy aliases executable through resolveTool(), but avoid advertising
 * duplicate schemas to models. If policy or an older catalog exposes only the
 * legacy name, preserve it as a compatibility fallback.
 */
function canonicalizeAdvertisedToolAliases(
  specs: readonly CapabilityToolSpec[]
): CapabilityToolSpec[] {
  if (!specs.some((spec) => spec.name === USER_INPUT_TOOL_NAME)) return [...specs]
  return specs.filter((spec) => spec.name !== LEGACY_USER_INPUT_TOOL_NAME)
}

function effectiveClientSurface(context: ToolHostContext): NonNullable<ToolHostContext['clientSurface']> {
  if (context.clientSurface) return context.clientSurface
  if (
    context.guiPlan ||
    context.guiDesignCanvas ||
    context.guiDesignMode ||
    context.guiDesignArtifact ||
    context.agentSurface
  ) return 'gui'
  if (context.imContext) return 'im'
  return 'api'
}

function providerPolicy(provider: ToolProviderPolicy): ToolProviderPolicy {
  return {
    id: provider.id,
    kind: provider.kind,
    enabled: provider.enabled,
    available: provider.available,
    ...(provider.reason ? { reason: provider.reason } : {}),
    ...(provider.effects ? { effects: provider.effects } : {})
  }
}

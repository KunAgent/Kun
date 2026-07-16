import type { Router } from '../server/router.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'

export const LOOP_HOOK_NAMES = ['beforeLoop', 'beforeModelRequest', 'afterModelSelect', 'beforeToolCall', 'afterTurn'] as const
export type LoopHookName = (typeof LOOP_HOOK_NAMES)[number]

/** Mutable context passed through loop hooks. Features read/annotate only their own fields. */
export type LoopHookContext = {
  threadId: string
  turnId: string
  [key: string]: unknown
}

export type LoopHookFn = (ctx: LoopHookContext) => Promise<void> | void

export interface LoopHookBus {
  on(name: LoopHookName, fn: LoopHookFn): void
  emit(name: LoopHookName, ctx: LoopHookContext): Promise<void>
}

export type ExtensionRuntimeServices = Record<string, unknown>

export type ModelCatalogEntry = {
  providerId: string
  modelId: string
  label: string
  capabilities: {
    input: Array<'text' | 'image' | 'video'>
    contextWindowTokens: number
  }
  source: 'configured' | 'extension'
}

export type RouteRegistrar = (router: Router, runtime: ServerRuntime) => void

export interface KunExtension {
  id: string
  registerRoutes?: RouteRegistrar
  /** Reads config.extensions[id]; validates with own schema. Returns services for runtime.extensions[id]. */
  initializeServices?(featureConfig: unknown, runtime: ServerRuntime): Promise<Record<string, unknown>>
  registerLoopHooks?(bus: LoopHookBus): void
  registerModelClients?(registry: unknown): void
  contributeModels?(): ModelCatalogEntry[]
}

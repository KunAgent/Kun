import type { HarnessDefinition } from '../../contracts/harness.js'
import { ANTIGRAVITY_MODULE } from './antigravity.js'
import { APPLICATION_MODULES } from './applications.js'
import { CLAUDE_CODE_MODULE } from './claude-code.js'
import { CODEX_MODULE } from './codex.js'
import { CURSOR_MODULE } from './cursor.js'
import { DEEPSEEK_HARNESS_MODULE } from './deepseek-harness.js'
import { DEVIN_MODULE } from './devin.js'
import { EXPANDED_CLI_MODULES } from './expanded-cli.js'
import { GEMINI_CLI_MODULE } from './gemini-cli.js'
import { KUN_MODULE } from './kun.js'
import { CODEMAKER_MODULE, OPENCODE_MODULE } from './opencode.js'
import { OPENCODE2_MODULE } from './opencode2.js'
import { PI_MODULE } from './pi.js'
import type { AgentProviderModule } from './provider-module.js'

/** Built-in engines in catalog order. */
export const PROVIDER_MODULES: readonly AgentProviderModule[] = [
  DEEPSEEK_HARNESS_MODULE,
  KUN_MODULE,
  CLAUDE_CODE_MODULE,
  CURSOR_MODULE,
  ANTIGRAVITY_MODULE,
  GEMINI_CLI_MODULE,
  CODEX_MODULE,
  PI_MODULE,
  OPENCODE_MODULE,
  CODEMAKER_MODULE,
  OPENCODE2_MODULE,
  DEVIN_MODULE,
  ...EXPANDED_CLI_MODULES,
  ...APPLICATION_MODULES
]

let byId: Map<string, AgentProviderModule> | undefined
let derived = new Map<string, AgentProviderModule>()

/** The built-in module for an engine id, ignoring settings-derived Agents. */
export function builtinProviderModule(id: string | undefined): AgentProviderModule | undefined {
  byId ??= new Map(PROVIDER_MODULES.map((module) => [module.definition.id, module]))
  return id ? byId.get(id) : undefined
}

/**
 * The module for an Agent id: a builtin engine or an Agent derived from one
 * in settings. Custom ACP and terminal Agents have none.
 */
export function providerModule(id: string | undefined): AgentProviderModule | undefined {
  return builtinProviderModule(id) ?? (id ? derived.get(id) : undefined)
}

/** Like `providerModule`, but an unsaved derived draft falls back to its base engine. */
export function providerModuleFor(definition: Pick<HarnessDefinition, 'id' | 'derivedFrom'>): AgentProviderModule | undefined {
  return providerModule(definition.id) ?? builtinProviderModule(definition.derivedFrom)
}

/** Settings-derived Agents; the catalog replaces the set each time it is listed. */
export function setDerivedProviderModules(modules: readonly AgentProviderModule[]): void {
  derived = new Map(modules.map((module) => [module.definition.id, module]))
}

export function builtinProviderDefinitions(): readonly HarnessDefinition[] {
  return PROVIDER_MODULES.map((module) => module.definition)
}

/** Variables that override an engine's executable path. */
export function providerBinaryEnvKeys(): string[] {
  return PROVIDER_MODULES.flatMap((module) => module.binaryEnv ? [module.binaryEnv] : [])
}

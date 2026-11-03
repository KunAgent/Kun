import type { HarnessDefinition } from '../contracts/harness.js'
import { builtinProviderDefinitions } from './providers/registry.js'

/**
 * Built-in engine manifests. Each engine lives in its own provider module
 * under `./providers/`; this file keeps the long-standing import surface.
 */
export {
  ACP_DEFAULT_CAPABILITIES,
  ANTIGRAVITY_CAPABILITIES,
  CLAUDE_CODE_CAPABILITIES,
  CLAUDE_SETTINGS_HOOK_EVENTS,
  CODEX_APP_SERVER_CAPABILITIES,
  CURSOR_CAPABILITIES,
  KUN_NATIVE_CAPABILITIES,
  PI_RPC_CAPABILITIES
} from './providers/capabilities.js'
export { CODEX_APP_SERVER_MIN_VERSION } from '../runtime/codex/codex-protocol.js'
export { PI_MIN_VERSION } from '../runtime/pi/pi-protocol.js'

export const BUILTIN_HARNESSES: readonly HarnessDefinition[] = builtinProviderDefinitions()

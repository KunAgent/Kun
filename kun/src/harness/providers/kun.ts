import { KUN_TOOL_PERMISSION_MODES } from '../../contracts/policy.js'
import type { HarnessDefinition } from '../../contracts/harness.js'
import { KUN_NATIVE_CAPABILITIES } from './capabilities.js'
import type { AgentProviderModule } from './provider-module.js'

/** The host's own loop; listed so pickers and routing see one catalog. */
export const KUN_DEFINITION: HarnessDefinition = {
  id: 'kun',
  displayName: 'Kun',
  transport: 'native-loop',
  credentialModes: ['provider'],
  permissionModes: KUN_TOOL_PERMISSION_MODES.map((mode) => ({
    id: mode,
    label: mode,
    kunPermissionMode: mode
  })),
  modelSource: 'provider',
  staticModels: [],
  capabilities: KUN_NATIVE_CAPABILITIES,
  builtin: true
}

export const KUN_MODULE: AgentProviderModule = { definition: KUN_DEFINITION }

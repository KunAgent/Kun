import type { HarnessDefinition } from '../../contracts/harness.js'
import { CURSOR_CAPABILITIES } from './capabilities.js'
import type { AgentProviderModule } from './provider-module.js'
import { probeProviderCredential } from './support.js'

export const CURSOR_DEFINITION: HarnessDefinition = {
  id: 'cursor',
  displayName: 'Cursor',
  transport: 'cursor-sdk',
  credentialModes: ['provider'],
  permissionModes: [
    { id: 'ask', label: 'Ask', kunPermissionMode: 'ask-for-approval' },
    { id: 'auto-run', label: 'Auto run', kunPermissionMode: 'full-access' }
  ],
  modelSource: 'provider',
  staticModels: [],
  capabilities: CURSOR_CAPABILITIES,
  builtin: true
}

export const CURSOR_MODULE: AgentProviderModule = {
  definition: CURSOR_DEFINITION,
  credentials: { envKeys: ['CURSOR_API_KEY'], evidenceEnvKeys: ['CURSOR_API_KEY'] },
  login: async ({ deps }) => probeProviderCredential(deps.providers(), 'cursor-sdk'),
  nativeAccount: { kind: 'cursor-sdk', credentialEnv: 'CURSOR_API_KEY', countsAsEvidence: true },
  // The Cursor SDK ships inside Kun.
  installation: { bundled: true }
}

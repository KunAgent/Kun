import type { HarnessDefinition } from '../../contracts/harness.js'
import { ACP_DEFAULT_CAPABILITIES } from './capabilities.js'
import type { AgentProviderModule } from './provider-module.js'
import { openCode2CredentialEvidence } from '../opencode2-credentials.js'
import { explainOpenCodeDatabaseFailure, explainOpenCodeServiceFailure, openCodeIsolationEnv } from './opencode-service-failure.js'
import { openCodeConfigFiles } from './support.js'

export const OPENCODE2_DEFINITION: HarnessDefinition = {
  id: 'opencode2',
  displayName: 'OpenCode2',
  transport: 'acp',
  detect: { command: 'opencode2', aliases: [], versionArgs: ['--version'] },
  launch: { command: 'opencode2', args: ['acp'], env: {} },
  credentialModes: ['native-login'],
  permissionModes: [
    { id: 'plan', label: 'Plan', kunPermissionMode: 'ask-for-approval' },
    { id: 'build', label: 'Build', kunPermissionMode: 'full-access' }
  ],
  modelSource: 'probe',
  nativeAgents: 'session-modes',
  staticModels: [],
  capabilities: ACP_DEFAULT_CAPABILITIES,
  // V2 has a separate command, credential store and config dialect. Do not
  // borrow V1's executable, history IDs or generated gateway configuration.
  setup: {
    install: [{ platform: 'any', command: 'npm install -g @opencode-ai/cli@next' }],
    login: { command: 'opencode2', args: ['auth', 'login', '--standalone'] },
    docsUrl: 'https://dev.opencode.ai/v2/docs/'
  },
  availability: 'preview',
  builtin: true
}

export const OPENCODE2_MODULE: AgentProviderModule = {
  definition: OPENCODE2_DEFINITION,
  credentials: {
    profileFiles: (env, home) => openCodeConfigFiles(env, home, 'opencode'),
    configured: (context) => openCode2CredentialEvidence(context.merged).configured,
    fingerprint: (env) => openCode2CredentialEvidence(env).fingerprint
  },
  // Free models need no sign-in; a missing V2 credential is not "signed out".
  update: { command: 'opencode2', packageName: '@opencode-ai/cli', tag: 'next' },
  acp: { isolationEnv: openCodeIsolationEnv },
  // V2 shares OpenCode's data directory, so its log lives under opencode/log.
  explainFailure: (message, _authRequired, context) =>
    explainOpenCodeDatabaseFailure({ displayName: 'OpenCode2', command: 'opencode2', apps: ['opencode'], other: 'OpenCode' }, message, context?.env) ??
    explainOpenCodeServiceFailure({ displayName: 'OpenCode2', command: 'opencode2', apps: ['opencode'] }, message, context)
}

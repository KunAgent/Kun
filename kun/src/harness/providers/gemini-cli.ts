import type { HarnessDefinition } from '../../contracts/harness.js'
import { ACP_DEFAULT_CAPABILITIES } from './capabilities.js'
import type { AgentProviderModule } from './provider-module.js'

export const GEMINI_CLI_DEFINITION: HarnessDefinition = {
  id: 'gemini-cli',
  displayName: 'Gemini CLI',
  availability: 'active',
  transport: 'acp',
  // `--acp` is the current flag; `--experimental-acp` still works on older
  // releases but is deprecated upstream (docs/ade/impl/p1 §P1-05).
  detect: { command: 'gemini', aliases: [], versionArgs: ['--version'] },
  launch: { command: 'gemini', args: ['--acp'], env: {} },
  credentialModes: ['native-login'],
  permissionModes: [
    // Gemini CLI approval modes, strictest first.
    { id: 'plan', label: 'Plan', kunPermissionMode: 'ask-for-approval' },
    { id: 'default', label: 'Default', kunPermissionMode: 'ask-for-approval' },
    // auto_edit self-approves file edits, which approve-for-me cannot cover.
    { id: 'auto_edit', label: 'Auto edit', kunPermissionMode: 'full-access' },
    { id: 'yolo', label: 'YOLO', kunPermissionMode: 'full-access' }
  ],
  modelSource: 'probe',
  staticModels: [],
  capabilities: ACP_DEFAULT_CAPABILITIES,
  setup: {
    install: [
      { platform: 'any', command: 'npm install -g @google/gemini-cli' },
      { platform: 'darwin', command: 'brew install gemini-cli' }
    ],
    login: {
      command: 'gemini',
      args: [],
      note: 'Start Gemini CLI to sign in; /auth inside a session switches methods'
    },
    docsUrl: 'https://github.com/google-gemini/gemini-cli'
  },
  builtin: true
}

export const GEMINI_CLI_MODULE: AgentProviderModule = {
  definition: GEMINI_CLI_DEFINITION,
  update: { command: 'gemini', packageName: '@google/gemini-cli' },
  // Gemini CLI 0.52 reports Google's retirement of the individual Code Assist
  // tier with the auth-required code; signing in cannot fix that.
  explainFailure: (message, authRequired) => authRequired && /no longer supported/i.test(message)
    ? { detail: `The Agent's service no longer supports this client; signing in will not help: ${message.slice(0, 240)}`, authRequired: false }
    : undefined
}

import type { HarnessDefinition } from '../contracts/harness.js'
import { allUnsupportedStatuses, type HarnessCapabilities } from '../contracts/harness-capabilities.js'

/** Reviewed upstream release: deepseek-ai/deepseek-harness tag dsh-v0.2.0-rc.2. */
export const DEEPSEEK_HARNESS_VERSION = '0.2.0-rc.2'
export const DEEPSEEK_HARNESS_ID = 'deepseek-harness'

/** Only capabilities supported by both the pinned server and Kun's ACP adapter. */
export const DEEPSEEK_HARNESS_CAPABILITIES: HarnessCapabilities = {
  statuses: {
    ...allUnsupportedStatuses('not-implemented'),
    structuredStreaming: { supported: true },
    reasoningStream: { supported: true },
    abort: { supported: true },
    switchModelMidSession: { supported: true },
    effort: { supported: true },
    kunTools: { supported: true },
    externalApproval: { supported: true },
    nativeToolInterception: { supported: true },
    nativeContextTelemetry: { supported: true },
    imageInput: { supported: true }
  },
  // ACP is not proof of OS isolation. DSH runs its own file and shell tools;
  // it does not use the client's mediated filesystem/terminal methods.
  facts: { sandbox: 'none', usageReporting: 'none', compactionOwner: 'harness' }
}

export const DEEPSEEK_HARNESS_DEFINITION: HarnessDefinition = {
  id: DEEPSEEK_HARNESS_ID,
  displayName: 'DeepSeek Harness',
  availability: 'preview',
  transport: 'acp',
  detect: {
    command: 'dsh', aliases: [], versionArgs: ['--version'],
    versionPattern: '\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?',
    exactVersion: DEEPSEEK_HARNESS_VERSION
  },
  launch: {
    command: 'dsh', args: ['--profile', 'acp'],
    env: { DSH_TELEMETRY_DISABLED: '1', DSH_TELEMETRY_MODE: 'DISABLED' }
  },
  credentialModes: ['native-login'],
  permissionModes: [{ id: 'default', label: 'Ask', kunPermissionMode: 'ask-for-approval' }],
  modelSource: 'probe',
  staticModels: [],
  capabilities: DEEPSEEK_HARNESS_CAPABILITIES,
  setup: {
    install: [{ platform: 'any', command: `npm install -g @deepseek-ai/dsh@${DEEPSEEK_HARNESS_VERSION}`,
      note: 'Preview: only this reviewed version and the stock ACP plugin composition are supported' }],
    // No login command: ACP authenticate is a no-op. Users configure native
    // credentials through upstream's documented setup; a handshake is not auth.
    docsUrl: 'https://github.com/deepseek-ai/deepseek-harness'
  },
  builtin: true
}

import type { HarnessDefinition, HarnessPermissionMode } from '../contracts/harness.js'
import { allUnsupportedStatuses, type HarnessCapabilities } from '../contracts/harness-capabilities.js'

type CliSpec = {
  id: string
  name: string
  command: string
  aliases?: string[]
  args?: string[]
  minVersion?: string
  poolScope?: HarnessDefinition['poolScope']
  config: string[]
  docs: string
  install?: NonNullable<HarnessDefinition['setup']>['install']
  loginArgs?: string[]
  loginNote?: string
  permissions?: HarnessPermissionMode[]
  policy?: HarnessDefinition['acpPermission']
  identityPattern?: string
  rejectApplicationLauncher?: boolean
  versionPackage?: string
  env?: Record<string, string>
}

const ask = (id = 'default', label = 'Ask for approval'): HarnessPermissionMode => ({
  id, label, kunPermissionMode: 'ask-for-approval'
})
const full = (id: string, label: string): HarnessPermissionMode => ({
  id, label, kunPermissionMode: 'full-access'
})
const npm = (packageName: string): NonNullable<HarnessDefinition['setup']>['install'] => [
  { platform: 'any', command: `npm install -g ${packageName}` }
]
const unixInstaller = (url: string): NonNullable<HarnessDefinition['setup']>['install'] => [
  { platform: 'darwin', command: `curl -fsSL ${url} | bash` },
  { platform: 'linux', command: `curl -fsSL ${url} | bash` }
]

const ACP_CLI_SPECS: CliSpec[] = [
  {
    id: 'cursor-cli', name: 'Cursor CLI', command: 'agent', aliases: ['cursor-agent'], args: ['acp'],
    identityPattern: '(?:^|\\n)(?:Cursor(?: Agent)?\\b|\\d{4}\\.\\d{1,2}\\.\\d{1,2})',
    config: ['.cursor/cli-config.json'], docs: 'https://cursor.com/docs/cli/acp',
    install: unixInstaller('https://cursor.com/install'), loginArgs: ['login'],
    permissions: [ask('ask', 'Ask (read-only)'), ask('plan', 'Plan'), ask('agent', 'Agent')]
  },
  {
    id: 'mimocode', name: 'MiMo Code', command: 'mimo', args: ['acp'],
    config: ['.config/mimocode/mimocode.json', '.config/mimocode/mimocode.jsonc'],
    docs: 'https://github.com/XiaomiMiMo/MiMo-Code',
    install: npm('@mimo-ai/cli'), loginArgs: ['auth', 'login'],
    permissions: [ask('plan', 'Plan'), ask('build', 'Build')]
  },
  {
    id: 'goose', name: 'Goose', command: 'goose', args: ['acp'],
    config: ['.config/goose/config.yaml'],
    docs: 'https://github.com/aaif-goose/goose/blob/main/documentation/docs/gdk/acp/index.md',
    install: [{ platform: 'darwin', command: 'brew install block-goose-cli' }],
    loginArgs: ['configure'], loginNote: 'Configure a provider with Goose.',
    permissions: [ask('approve', 'Approve tools')]
  },
  {
    id: 'copilot', name: 'GitHub Copilot CLI', command: 'copilot', args: ['--acp', '--stdio'],
    config: ['.copilot/settings.json'],
    docs: 'https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server',
    install: npm('@github/copilot'), loginArgs: ['login'],
    // The official ACP client example owns requestPermission; no native selector is documented.
    policy: { requireMode: false }
  },
  {
    id: 'fx', name: 'fx', command: 'fx', args: ['acp'], poolScope: 'thread', config: ['.fx/settings.json'],
    env: { FX_AUTO_UPGRADE: '0' },
    docs: 'https://fx.sh/docs/using-fx/acp', loginArgs: ['login'],
    install: unixInstaller('https://fx.sh/setup.sh'),
    // ACP code selects native auto permissions; full-access is not an ACP mode.
    permissions: [ask('ask', 'Ask'), full('code', 'Code')]
  },
  {
    id: 'omp', name: 'oh-my-pi', command: 'omp', args: ['acp'],
    config: ['.omp/agent/config.yml', '.omp/agent/models.yml'],
    docs: 'https://github.com/can1357/oh-my-pi/blob/main/docs/cli-reference.md',
    install: npm('@oh-my-pi/pi-coding-agent'),
    loginNote: 'Start oh-my-pi and use /login to configure a provider.',
    permissions: [ask('plan', 'Plan'), ask('default', 'Default')]
  },
  {
    id: 'hermes', name: 'Hermes Agent', command: 'hermes', args: ['acp'],
    config: ['.hermes/config.yaml'],
    docs: 'https://hermes-agent.nousresearch.com/docs/user-guide/features/acp/',
    install: unixInstaller('https://hermes-agent.nousresearch.com/install.sh'),
    loginArgs: ['model'], loginNote: 'Configure a provider; ACP requires the acp Python extra.',
    permissions: [ask(), full('accept_edits', 'Accept edits'), full('dont_ask', 'Allow file edits')]
  },
  {
    id: 'kimi', name: 'Kimi Code', command: 'kimi', args: ['acp'], minVersion: '2.0.0',
    config: ['.kimi-code/config.toml', '.kimi/config.toml'],
    docs: 'https://moonshotai.github.io/kimi-code/en/reference/kimi-acp.html',
    install: npm('@moonshot-ai/kimi-code'), loginArgs: ['login'],
    loginNote: 'Kimi Code 2.x replaces kimi-cli; migrating ~/.kimi does not migrate login credentials.',
    permissions: [ask('plan', 'Plan'), ask(), full('auto', 'Auto'), full('yolo', 'YOLO')]
  },
  {
    id: 'minimax-code', name: 'MiniMax Code', command: 'mcode', args: ['acp'], poolScope: 'thread',
    config: ['.minimax/config.yaml'], docs: 'https://github.com/MiniMax-AI/minimax-code',
    install: npm('@minimax-ai/code'), loginArgs: ['login'],
    // Interaction modes default/plan are separate from the process permission selector.
    policy: { configOptionId: 'permissionMode' },
    permissions: [ask(), full('auto', 'Auto'), full('bypassPermissions', 'Bypass permissions')]
  },
  {
    id: 'droid', name: 'Factory Droid', command: 'droid', args: ['exec', '--output-format', 'acp'],
    versionPackage: 'droid',
    config: ['.factory/settings.json'], docs: 'https://docs.factory.com/ide-integrations',
    install: npm('droid'), loginNote: 'Start Droid to sign in through its native browser flow.',
    // Work modes are distinct from autonomy levels. Normal work is offered only
    // under Kun's full-access ceiling; spec is the conservative read-only floor.
    permissions: [ask('spec', 'Specification'), full('auto', 'Normal (native autonomy)')]
  },
  {
    id: 'cline', name: 'Cline CLI', command: 'cline', args: ['--acp', '--auto-approve', 'false'],
    config: ['.cline/data/settings/providers.json'],
    docs: 'https://github.com/cline/cline/blob/main/docs/usage/acp.mdx',
    install: npm('cline'), loginArgs: ['auth'],
    permissions: [ask('plan', 'Plan'), ask('act', 'Act')]
  },
  {
    id: 'qoder', name: 'Qoder CLI', command: 'qoder', aliases: ['qodercli'], args: ['--acp'],
    rejectApplicationLauncher: true,
    config: ['.qoder/settings.json'], docs: 'https://docs.qoder.com/cli/acp',
    install: unixInstaller('https://qoder.com/install'), loginArgs: ['login'],
    permissions: [ask(), full('bypass_permissions', 'Bypass permissions')]
  },
  {
    id: 'qoder-cn', name: 'Qoder CN CLI', command: 'qodercn', aliases: ['qoderclicn'], args: ['--acp'],
    rejectApplicationLauncher: true,
    config: ['.qoder-cn/settings.json'], docs: 'https://docs.qoder.cn/cli/acp',
    install: npm('@qodercn-ai/qoderclicn'),
    loginArgs: ['login'], permissions: [ask(), full('bypass_permissions', 'Bypass permissions')]
  },
  {
    id: 'grok', name: 'Grok Build', command: 'grok', args: ['agent', 'stdio'],
    config: ['.grok/config.toml'],
    docs: 'https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/15-agent-mode.md',
    install: unixInstaller('https://x.ai/cli/install.sh'), loginNote: 'Start Grok Build and complete native authentication.',
    // Default ask mode sends tool-permission requests to the ACP host. Never add --always-approve.
    policy: { requireMode: false }
  }
]

const TERMINAL_CLI_SPECS: CliSpec[] = [
  {
    id: 'aside', name: 'Aside', command: 'aside', config: ['.aside/u/0/settings.json', '.aside/u/0/models.json'],
    docs: 'https://aside.com/', loginNote: 'Install and sign in with the Aside application.'
  },
  {
    id: 'omo', name: 'OmO Native', command: 'omo', config: ['.omo/agent/settings.json', '.omo/agent/models.json'],
    docs: 'https://omo.dev/docs', install: npm('omo-ai'), loginArgs: ['setup'],
    loginNote: 'Use the standalone OmO Native edition; OpenCode/Codex editions are plugins.'
  },
  {
    id: 'crush', name: 'Crush', command: 'crush', config: ['.config/crush/crush.json'],
    docs: 'https://github.com/charmbracelet/crush', install: npm('@charmland/crush'),
    loginNote: 'Start Crush and configure a model provider in its picker.'
  },
  {
    id: 'commandcode', name: 'Command Code', command: 'command-code', aliases: ['cmdc'],
    config: ['.commandcode/settings.json', '.commandcode/providers.json'],
    docs: 'https://commandcode.ai/docs/quickstart', install: npm('command-code'), loginArgs: ['login']
  },
  {
    id: 'morph', name: 'Mister Morph', command: 'mistermorph',
    config: ['.morph/config.yaml'], docs: 'https://docs.mistermorph.com/guide/config-patterns',
    install: [{ platform: 'any', command: 'go install github.com/quailyquaily/mistermorph/cmd/mistermorph@latest' }],
    loginArgs: ['install'], loginNote: 'Initialize settings, then configure the model provider.'
  },
  {
    id: 'muse', name: 'Muse Code', command: 'muse', config: ['.config/muse/settings.json'],
    docs: 'https://developers.meta.com/resources/videos/building-with-muse-spark-and-muse-code/',
    loginNote: 'Use the official Muse Code setup and native authentication.'
  },
  {
    id: 'empryo', name: 'Empryo', command: 'empryo', config: ['.empryo/config.json'],
    docs: 'https://empryo.com/docs/installation', install: unixInstaller('https://empryo.com/install.sh'),
    loginNote: 'Start Empryo and use /login or /keys. The vendor does not publish an npm package.'
  },
  {
    id: 'atomcode', name: 'AtomCode', command: 'atomcode', config: ['.atomcode/config.toml'],
    docs: 'https://atomcode.atomgit.com/docs/en/headless-daemon.html',
    install: npm('@atomgit.com/atomcode'), loginArgs: ['login']
  }
]

const TERMINAL_CAPABILITIES: HarnessCapabilities = {
  statuses: allUnsupportedStatuses('not-implemented', { message: 'Use the native terminal interface.' }),
  facts: { sandbox: 'none', usageReporting: 'none', compactionOwner: 'harness' }
}

/** Native CLIs with documented ACP servers, plus terminal entry points for other engines. */
export function expandedCliHarnesses(capabilities: HarnessCapabilities): HarnessDefinition[] {
  const definition = (spec: CliSpec, acp: boolean): HarnessDefinition => ({
    id: spec.id,
    displayName: spec.name,
    transport: acp ? 'acp' : 'terminal',
    detect: { command: spec.command, aliases: spec.aliases ?? [], versionArgs: ['--version'], minVersion: spec.minVersion,
      identityPattern: spec.identityPattern, rejectApplicationLauncher: spec.rejectApplicationLauncher, versionPackage: spec.versionPackage },
    launch: { command: spec.command, args: spec.args ?? [], env: spec.env ?? {} },
    configurationLocations: spec.config.map((path) => ({ platform: 'any', root: 'home', path })),
    ...(acp ? { poolScope: spec.poolScope ?? 'thread', acpPermission: spec.policy ?? { requireMode: true } } : { terminal: { argv: [] } }),
    credentialModes: ['native-login'],
    permissionModes: spec.permissions ?? [ask()],
    modelSource: acp ? 'probe' : 'static',
    staticModels: [],
    capabilities: acp ? { ...capabilities, facts: { ...capabilities.facts, sandbox: 'none' } } : TERMINAL_CAPABILITIES,
    setup: {
      install: spec.install,
      login: { command: spec.command, args: spec.loginArgs ?? [], note: spec.loginNote },
      docsUrl: spec.docs
    },
    builtin: true
  })
  return [
    ...ACP_CLI_SPECS.map((spec) => definition(spec, true)),
    ...TERMINAL_CLI_SPECS.map((spec) => definition(spec, false))
  ]
}

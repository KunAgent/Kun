import type { HarnessApplication, HarnessDefinition } from '../contracts/harness.js'
import { allUnsupportedStatuses, type HarnessCapabilities } from '../contracts/harness-capabilities.js'

type Location = HarnessApplication['locations'][number]
const macApp = (name: string): Location => ({ platform: 'darwin', root: 'applications', path: `${name}.app` })
const home = (path: string): Location => ({ platform: 'any', root: 'home', path })
const data = (path: string, platform: Location['platform'] = 'any'): Location => ({ platform, root: 'app-data', path })

const APPLICATION_CAPABILITIES: HarnessCapabilities = {
  statuses: allUnsupportedStatuses('not-implemented', {
    message: 'Open the application to use its own agent interface.'
  }),
  facts: { sandbox: 'none', usageReporting: 'none', compactionOwner: 'none' }
}

function application(
  id: string,
  displayName: string,
  kind: HarnessApplication['kind'],
  locations: Location[],
  configLocations: Location[],
  docsUrl: string,
  extra: Pick<HarnessApplication, 'productName'> & { command?: string } = {}
): HarnessDefinition {
  const { command, ...identity } = extra
  return {
    id,
    displayName,
    transport: 'application',
    application: { kind, locations, configLocations, configurationDocsUrl: docsUrl, ...identity },
    ...(command ? { detect: { command, aliases: [], versionArgs: [] } } : {}),
    credentialModes: ['native-login'],
    permissionModes: [{ id: 'application', label: 'Managed by application', kunPermissionMode: 'ask-for-approval' }],
    modelSource: 'static',
    staticModels: [],
    capabilities: APPLICATION_CAPABILITIES,
    setup: { docsUrl },
    builtin: true
  }
}

/** Installed applications and editors are launch targets, never delegated agent servers. */
export const APPLICATION_HARNESSES: HarnessDefinition[] = [
  application('claude-desktop', 'Claude Desktop', 'desktop', [macApp('Claude')], [
    data('Claude'), data('Claude-3p/configLibrary'),
    { platform: 'win32', root: 'local-app-data', path: 'Claude-3p/configLibrary' }
  ], 'https://claude.com/download'),

  application('openchamber', 'OpenChamber', 'desktop', [macApp('OpenChamber')], [
    home('.config/openchamber/preferences.json')
  ], 'https://docs.openchamber.dev/', { command: 'openchamber' }),

  application('cursor-local', 'Cursor Private Inference', 'editor', [macApp('Cursor')], [
    home('.cursor/cli-config.json'), data('Cursor/User/settings.json')
  ], 'https://cursor.com/docs', { productName: 'Cursor Private Inference' }),

  application('zed', 'Zed', 'editor', [macApp('Zed')], [
    home('.config/zed/settings.json'), data('Zed/settings.json', 'win32')
  ], 'https://zed.dev/docs/configuring-zed', { command: 'zed' }),

  application('vscode', 'VS Code Chat', 'editor', [
    macApp('Visual Studio Code'),
    { platform: 'win32', root: 'local-app-data', path: 'Programs/Microsoft VS Code/Code.exe' },
    { platform: 'win32', root: 'program-files', path: 'Microsoft VS Code/Code.exe' }
  ], [
    data('Code/User/settings.json'), data('Code/User/chatLanguageModels.json'),
    home('.config/Code/User/settings.json'), home('.config/Code/User/chatLanguageModels.json')
  ], 'https://code.visualstudio.com/docs/copilot/customization/language-models', { command: 'code' }),

  // Air is an ACP client. Its acp.json starts an external agent such as OpenCode.
  application('air', 'JetBrains Air', 'editor', [macApp('Air'), macApp('JetBrains Air')], [
    data('JetBrains/Air/acp.json'),
    home('.config/JetBrains/Air/acp.json')
  ], 'https://www.jetbrains.com/help/air/'),

  application('zcode', 'ZCode', 'desktop', [macApp('ZCode')], [
    home('.zcode/v2/config.json'), home('.zcode/v2/provider_config.json')
  ], 'https://zcode.z.ai/en/docs/install'),

  application('workbuddy', 'WorkBuddy', 'desktop', [macApp('WorkBuddy')], [
    home('.workbuddy/models.json')
  ], 'https://cloud.tencent.com/product/workbuddy'),

  application('pencil', 'Pencil / pen.dev', 'desktop', [macApp('Pencil'), macApp('pen.dev')], [
    home('.pencil/models.json')
  ], 'https://docs.pencil.dev/getting-started/authentication'),

  application('t3code', 'T3 Code', 'desktop', [macApp('T3 Code'), macApp('T3 Code (Alpha)')], [
    home('.t3/userdata/settings.json')
  ], 'https://github.com/pingdotgg/t3code'),

  application('hanako', 'OpenHanako', 'desktop', [macApp('OpenHanako'), macApp('HanaAgent')], [
    home('.hanako/provider-catalog.json'), home('.hanako/user/preferences.json'), home('.hanako/server-info.json')
  ], 'https://github.com/liliMozi/openhanako'),

  application('alma', 'Alma', 'desktop', [macApp('Alma')], [
    data('Alma')
  ], 'https://alma.now/docs/guide/'),

  // Provider imports are confirmed in the app; an encrypted database is not an auth probe.
  application('cindy', 'Cindy', 'desktop', [macApp('Cindy'), macApp('CindyGlobal')], [
    data('Cindy'), data('CindyGlobal')
  ], 'https://cindy.app/')
]

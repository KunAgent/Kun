import gatewayConnection from './settings/gateway-connection.json'
import gatewayAgents from './settings/gateway-agents.json'
import routeRules from './settings/route-rules.json'
import gatewayMiddleware from './settings/gateway-middleware.json'
import gatewayExtensions from './settings/gateway-extensions.json'
import providerConfiguration from './settings/provider-configuration.json'
import googleWorkspace from './settings/google-workspace.json'
import navigationProviders from './settings/navigation-providers.json'
import providerManagement from './settings/provider-management.json'
import providerMediaMcp from './settings/provider-media-mcp.json'
import mcpMigration from './settings/mcp-migration.json'
import memory from './settings/memory.json'
import migrationSystem from './settings/migration-system.json'
import codePersonas from './settings/code-personas.json'
import speak from './settings/speak.json'
import ade from './settings/ade.json'

const settings = {
  ...providerConfiguration,
  ...gatewayConnection,
  ...gatewayAgents,
  ...routeRules,
  ...gatewayMiddleware,
  ...gatewayExtensions,
  ...googleWorkspace,
  ...navigationProviders,
  ...providerManagement,
  ...providerMediaMcp,
  ...mcpMigration,
  ...memory,
  ...migrationSystem,
  ...codePersonas,
  guiUpdateErrFeedUnavailable: '当前没有可连接的更新源，请稍后重试或前往下载页。',
  ...speak,
  ...ade,
}

export default settings

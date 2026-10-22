import gatewayConnection from './settings/gateway-connection.json'
import gatewayAgents from './settings/gateway-agents.json'
import routeRules from './settings/route-rules.json'
import gatewayMiddleware from './settings/gateway-middleware.json'
import gatewayObservability from './settings/gateway-observability.json'
import gatewayExtensions from './settings/gateway-extensions.json'
import gatewaySetup from './settings/gateway-setup.json'
import providerConfiguration from './settings/provider-configuration.json'
import navigationProviders from './settings/navigation-providers.json'
import settingsChrome from './settings/settings-chrome.json'
import settingsIa from './settings/settings-ia.json'
import modelRoutes from './settings/model-routes.json'
import providerManagement from './settings/provider-management.json'
import providerMediaMcp from './settings/provider-media-mcp.json'
import mcpMigration from './settings/mcp-migration.json'
import memory from './settings/memory.json'
import migrationSystem from './settings/migration-system.json'
import codePersonas from './settings/code-personas.json'
import speak from './settings/speak.json'
import ade from './settings/ade.json'
import onboarding from './settings/onboarding.json'
import appSurfaces from './settings/app-surfaces.json'
import assistantMailboxSettings from './settings/assistant-mailbox.json'
import terminalDock from './settings/terminal-dock.json'

const settings = {
  ...providerConfiguration,
  ...gatewayConnection,
  ...gatewayAgents,
  ...routeRules,
  ...gatewayMiddleware,
  ...gatewayObservability,
  ...gatewayExtensions,
  ...gatewaySetup,
  ...navigationProviders,
  ...settingsChrome,
  ...settingsIa,
  ...modelRoutes,
  ...providerManagement,
  ...providerMediaMcp,
  ...mcpMigration,
  ...memory,
  ...migrationSystem,
  ...codePersonas,
  guiUpdateErrFeedUnavailable: '当前没有可连接的更新源，请稍后重试或前往下载页。',
  ...speak,
  ...ade,
  ...onboarding,
  ...appSurfaces,
  ...assistantMailboxSettings,
  ...terminalDock
}

export default settings

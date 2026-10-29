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
import assistantMailboxSettings from './settings/assistant-mailbox.json'
import terminalDock from './settings/terminal-dock.json'
import storageCleanup from './settings/storage-cleanup.json'

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
  guiUpdateErrFeedUnavailable: 'No update source is reachable right now. Try again later or use the download page.',
  ...speak,
  ...ade,
  ...onboarding,
  ...assistantMailboxSettings,
  ...terminalDock,
  ...storageCleanup
}

export default settings

import providerConfiguration from '../en/settings/provider-configuration.json'
// Gateway connection guidance uses the shared English fallback.
import gatewayConnection from '../en/settings/gateway-connection.json'
import gatewayAgents from './settings/gateway-agents.json'
import routeRules from './settings/route-rules.json'
import gatewayMiddleware from './settings/gateway-middleware.json'
import gatewayObservability from './settings/gateway-observability.json'
import gatewayExtensions from './settings/gateway-extensions.json'
import gatewaySetup from './settings/gateway-setup.json'
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
  guiUpdateErrFeedUnavailable: 'अभी कोई अपडेट स्रोत उपलब्ध नहीं है। बाद में फिर कोशिश करें या डाउनलोड पृष्ठ का उपयोग करें।',
  ...speak,
  ...ade,
  ...onboarding,
  ...appSurfaces,
  ...assistantMailboxSettings
}

export default settings

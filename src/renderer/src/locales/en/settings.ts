import navigationProviders from './settings/navigation-providers.json'
import providerManagement from './settings/provider-management.json'
import providerMediaMcp from './settings/provider-media-mcp.json'
import mcpMigration from './settings/mcp-migration.json'
import migrationSystem from './settings/migration-system.json'
import codePersonas from './settings/code-personas.json'
import speak from './settings/speak.json'

const settings = {
  ...navigationProviders,
  ...providerManagement,
  ...providerMediaMcp,
  ...mcpMigration,
  ...migrationSystem,
  ...codePersonas,
  guiUpdateErrFeedUnavailable: 'No update source is reachable right now. Try again later or use the download page.',
  ...speak,
}

export default settings

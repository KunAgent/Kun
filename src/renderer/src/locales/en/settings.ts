import navigationProviders from './settings/navigation-providers.json'
import providerMediaMcp from './settings/provider-media-mcp.json'
import mcpMigration from './settings/mcp-migration.json'
import migrationSystem from './settings/migration-system.json'
import codePersonas from './settings/code-personas.json'

const settings = {
  ...navigationProviders,
  ...providerMediaMcp,
  ...mcpMigration,
  ...migrationSystem,
  ...codePersonas,
  guiUpdateErrFeedUnavailable: 'No update source is reachable right now. Try again later or use the download page.',
}

export default settings

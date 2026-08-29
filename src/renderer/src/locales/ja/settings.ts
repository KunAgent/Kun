import navigationProviders from './settings/navigation-providers.json'
import modelRoutes from './settings/model-routes.json'
import providerMediaMcp from './settings/provider-media-mcp.json'
import mcpMigration from './settings/mcp-migration.json'
import migrationSystem from './settings/migration-system.json'
import codePersonas from './settings/code-personas.json'

const settings = {
  ...navigationProviders,
  ...modelRoutes,
  ...providerMediaMcp,
  ...mcpMigration,
  ...migrationSystem,
  ...codePersonas,
  guiUpdateErrFeedUnavailable: '現在、利用できる更新元がありません。後でもう一度試すか、ダウンロードページを利用してください。',
}

export default settings

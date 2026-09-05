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
  guiUpdateErrFeedUnavailable: 'Сейчас ни один источник обновлений недоступен. Повторите попытку позже или перейдите на страницу загрузки.',
}

export default settings

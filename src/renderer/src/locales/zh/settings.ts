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
  guiUpdateErrFeedUnavailable: '当前没有可连接的更新源，请稍后重试或前往下载页。',
}

export default settings

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
  guiUpdateErrFeedUnavailable: '현재 사용할 수 있는 업데이트 소스가 없습니다. 나중에 다시 시도하거나 다운로드 페이지를 이용하세요.',
}

export default settings

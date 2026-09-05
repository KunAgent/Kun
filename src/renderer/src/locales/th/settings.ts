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
  guiUpdateErrFeedUnavailable: 'ขณะนี้ไม่สามารถเข้าถึงแหล่งอัปเดตได้ โปรดลองอีกครั้งภายหลังหรือใช้หน้าดาวน์โหลด',
}

export default settings

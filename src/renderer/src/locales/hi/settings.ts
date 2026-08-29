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
  guiUpdateErrFeedUnavailable: 'अभी कोई अपडेट स्रोत उपलब्ध नहीं है। बाद में फिर कोशिश करें या डाउनलोड पृष्ठ का उपयोग करें।',
}

export default settings

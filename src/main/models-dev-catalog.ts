import { getModelProviderSettings, resolveModelProviderProxyUrl, type AppSettingsV1 } from '../shared/app-settings'
import type { ModelsDevCatalogRequest } from '../shared/kun-gui-api'
import { ModelsDevCatalogService as RuntimeCatalogService } from '../../kun/src/services/models-dev-catalog'
export * from '../../kun/src/services/models-dev-catalog'
/** Compatibility for temporary, unsaved provider forms. Saved providers use Runtime HTTP. */
export class ModelsDevCatalogService {
  private readonly service: RuntimeCatalogService
  constructor(...args: ConstructorParameters<typeof RuntimeCatalogService>) { this.service = new RuntimeCatalogService(...args) }
  attachDiskCache(path: string) { this.service.attachDiskCache(path) }
  clearCache() { this.service.clearCache() }
  fetch(request: ModelsDevCatalogRequest, settings?: AppSettingsV1) {
    return this.service.fetch(request, { proxyUrl: settings ? resolveModelProviderProxyUrl(settings) : '',
      catalogSources: settings ? getModelProviderSettings(settings).providers.find((profile) => profile.id === request.providerId)?.catalogSources : [] })
  }
}
const service = new ModelsDevCatalogService()
export const fetchModelsDevCatalog = (request: ModelsDevCatalogRequest, settings?: AppSettingsV1) => service.fetch(request, settings)
export const attachModelsDevDiskCache = (path: string) => service.attachDiskCache(path)

import type { JsonResponse } from '../response.js'
import { jsonResponse } from '../response.js'
import type { OfficialProviderCliService } from '../../services/official-provider-cli.js'
import { ERRORS } from './runtime-error.js'

export async function officialProviderCliStatus(
  service: OfficialProviderCliService | undefined
): Promise<JsonResponse> {
  return service
    ? jsonResponse(await service.status())
    : ERRORS.unavailable('official provider CLI is unavailable')
}

export async function installOfficialProviderCli(
  service: OfficialProviderCliService | undefined
): Promise<JsonResponse> {
  if (!service) return ERRORS.unavailable('official provider CLI is unavailable')
  const state = service.install()
  void state.catch(() => undefined)
  return jsonResponse((await service.status()).download, 202)
}

export async function listOfficialProviderCliModels(
  service: OfficialProviderCliService | undefined
): Promise<JsonResponse> {
  return service
    ? jsonResponse(await service.models())
    : ERRORS.unavailable('official provider CLI is unavailable')
}

import { jsonResponse, type JsonResponse } from '../server/response.js'

/** Reject state mutations while durable persistence is degraded. */
export function managerPersistenceDegradedResponse(): JsonResponse {
  return jsonResponse({
    code: 'manager_persistence_degraded',
    message: 'manager state persistence is degraded; rejecting state mutation'
  }, 503)
}

export function isManagerPersistenceDegraded(
  statePersistence?: () => { degraded: boolean }
): boolean {
  return statePersistence?.().degraded === true
}

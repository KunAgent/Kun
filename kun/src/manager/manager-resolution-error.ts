export type ManagerFailureKind =
  | 'discovery_invalid' | 'discovery_unreadable' | 'transport_timeout'
  | 'transport_refused' | 'transport_failure' | 'http_failure'
  | 'health_invalid' | 'identity_mismatch' | 'protocol_incompatible'
  | 'capability_incompatible'

/** Only allowlisted diagnostics cross the startup error boundary; never a token or response body. */
export class ServiceManagerUnavailableError extends Error {
  readonly code = 'service_manager_unavailable'
  readonly phase = 'manager-resolution'
  constructor(
    readonly kind: ManagerFailureKind,
    readonly pid?: number,
    readonly instanceId?: string
  ) {
    super(`${pid ? `Kun Service Manager process ${pid} is alive but unavailable` : 'Kun Service Manager is unavailable'} (${kind}). Inspect the Service Manager log before retrying.`)
    this.name = 'ServiceManagerUnavailableError'
  }
}

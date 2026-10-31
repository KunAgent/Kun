export type UsageIndexErrorCode = 'usage_index_unavailable' | 'usage_query_timeout'

export class UsageIndexUnavailableError extends Error {
  readonly code: UsageIndexErrorCode

  constructor(code: UsageIndexErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'UsageIndexUnavailableError'
    this.code = code
  }
}

export type ServiceManagerTransportKind = 'connection_refused' | 'timeout' | 'socket_closed'

export class ServiceManagerTransportError extends Error {
  constructor(
    readonly kind: ServiceManagerTransportKind,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'ServiceManagerTransportError'
  }
}

/** True when a Manager RPC failed because its own deadline expired. */
export function isServiceManagerTimeoutError(
  error: unknown
): error is ServiceManagerTransportError {
  return error instanceof ServiceManagerTransportError && error.kind === 'timeout'
}

export class ServiceManagerHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
    readonly detail = '',
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'ServiceManagerHttpError'
  }
}

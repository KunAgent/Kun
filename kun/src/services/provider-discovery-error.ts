/** Successful HTTP transport and model catalog validity are different facts. */
export class ProviderDiscoveryResponseError extends Error {
  constructor(message: string, readonly httpStatus?: number) { super(message); this.name = 'ProviderDiscoveryResponseError' }
}

export class ProviderDiscoveryConfigurationError extends Error {
  constructor(message: string) { super(message); this.name = 'ProviderDiscoveryConfigurationError' }
}

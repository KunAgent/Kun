/**
 * Credential seam for the Figma connector.
 *
 * The service resolves the token immediately before each request so a later
 * adapter can read it from Kun's encrypted secret store and so a rotation takes
 * effect without rebuilding the service. Nothing here logs or returns the
 * token; `FigmaReadService` only forwards it to the request header.
 */
export interface FigmaCredentialSource {
  /** Returns `undefined` when Figma is not connected. */
  readToken(): Promise<string | undefined>
}

/** Adapter for tests and for callers that already hold a token in memory. */
export function staticFigmaCredentialSource(token: string | undefined): FigmaCredentialSource {
  return { readToken: async () => token }
}

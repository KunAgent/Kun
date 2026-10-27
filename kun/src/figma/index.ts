/**
 * Read-only Figma REST connector.
 *
 * Composition supplies the credential source and transport:
 *
 *   const credentials = new FigmaCredentialStore(extensionCredentialStore)
 *   const service = new FigmaReadService({ credentials, fetchImpl })
 *
 * Credentials stay host-owned, the upstream origin is fixed, and no write
 * capability exists.
 */
export * from './ports.js'
export * from './figma-credential.js'
export * from './figma-credential-store.js'
export * from './figma-link.js'
export * from './figma-transport.js'
export * from './figma-client.js'
export * from './figma-service.js'

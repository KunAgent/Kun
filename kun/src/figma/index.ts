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
 *
 * The Figma Desktop local MCP backend is a separate, opt-in transport for the
 * same product: one pinned loopback endpoint, no process launch, and no
 * connection at runtime start-up.
 */
export * from './ports.js'
export * from './figma-credential.js'
export * from './figma-credential-store.js'
export * from './figma-link.js'
export * from './figma-transport.js'
export * from './figma-client.js'
export * from './figma-service.js'
export * from './figma-desktop-mcp-preset.js'
export * from './figma-desktop-connector.js'

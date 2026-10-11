/**
 * Composition-facing re-exports for the ACP runtime (kept out of the barrel
 * chain so runtime internals stay unbundled from composition imports).
 */
export { AcpRuntime, type AcpRuntimeDeps } from './acp-runtime.js'
export { AcpConnectionPool } from './acp-connection-pool.js'
export { AcpClientHost } from './acp-client-host.js'
export { AcpSessionManager } from './acp-session-manager.js'

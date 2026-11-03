import type { McpServerConfig } from '../../contracts/capabilities.js'

/**
 * `timeoutMs` bounds connecting, tool listing, and resource reads. A server
 * whose tool waits on long-running work can reserve a longer per-call budget
 * instead, without forcing every other operation on that server to wait.
 *
 * Kept in its own module because both the tool runtime and the deferred tool
 * search path need it, and those two already import each other's types.
 */
export function mcpCallTimeoutMs(server: McpServerConfig): number {
  return server.callTimeoutMs ?? server.timeoutMs
}

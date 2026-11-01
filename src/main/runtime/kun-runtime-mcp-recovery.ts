import { recoverPendingMcpTransaction } from '../../../kun/src/server/runtime-mcp-transaction.js'

/**
 * GUI-side entry point for an interrupted Runtime MCP mutation.
 *
 * The caller must already hold the data-directory lock: GUI synchronization
 * performs recovery inside its own lock scope, and acquiring the same lock here
 * again would deadlock. A transaction that is still running cannot be observed
 * under that lock, and a record whose owner is alive is refused.
 *
 * Recovery throws when the record is unusable, when its owner is still alive,
 * or when either target file cannot be read or parsed; in all of those cases
 * the record is preserved and synchronization must stop instead of writing a
 * configuration it cannot reconcile.
 */
export async function recoverMcpTransactionsForGui(options: {
  dataDir: string
  configPath?: string
  sharedMcpConfigPath?: string
}): Promise<string[]> {
  const recovered = await recoverPendingMcpTransaction(options)
  return recovered.serverIds
}

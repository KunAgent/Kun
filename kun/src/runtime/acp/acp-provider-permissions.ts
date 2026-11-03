import type { HarnessDefinition } from '../../contracts/harness.js'
import type { AcpConnection } from './acp-connection.js'
import type { AcpConfigOption, AcpSessionModes } from './acp-schema.js'
import type { AgentProviderModule } from '../../harness/providers/provider-module.js'
import { applyAcpSessionPermission } from './acp-session-permissions.js'

import { customAcpPermission } from '../../harness/acp-launch-args.js'
export { customAcpPermission } from '../../harness/acp-launch-args.js'

/** Explicit custom modes require exact protocol evidence, not provider defaults or aliases. */
export async function applyAcpProviderPermission(
  conn: AcpConnection,
  session: { sessionId: string; configOptions?: AcpConfigOption[] | null; modes?: AcpSessionModes | null },
  mode: string | undefined,
  module: AgentProviderModule | undefined,
  policy?: HarnessDefinition['acpPermission'],
  definition = module?.definition,
  exact = customAcpPermission(mode, definition)
): Promise<void> {
  if (exact) {
    await applyAcpSessionPermission(conn, session, mode, { requireMode: true, configOptionId: policy?.configOptionId })
  } else if (module?.acp?.applyPermission) {
    await module.acp.applyPermission(conn, session, mode)
  } else {
    await applyAcpSessionPermission(conn, session, mode, policy)
  }
}

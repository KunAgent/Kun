import type { HarnessTransport } from '../contracts/harness.js'
import type { DelegatedTurnRuntime } from '../runtime/delegated-turn-runtime.js'
import {
  createAgentSdkRuntime,
  type AgentSdkRuntimeFactoryDeps
} from '../runtime/agent-sdk/agent-sdk-runtime-factory.js'
import {
  AntigravityCliRuntime,
  type AntigravityCliRuntimeDeps
} from '../runtime/antigravity/antigravity-cli-runtime.js'
import {
  AcpRuntime,
  type AcpRuntimeDeps
} from '../runtime/acp/acp-runtime.js'
import {
  createCursorSdkRuntime,
  type CursorSdkRuntimeFactoryDeps
} from '../runtime/cursor/cursor-sdk-runtime-factory.js'
import {
  SessionTurnRuntime,
  type SessionTurnRuntimeDeps
} from '../session/session-turn-runtime.js'
import type { UsageService } from '../services/usage-service.js'
import { HARNESS_USAGE_MODES, withHarnessUsageLedger } from '../runtime/harness-usage-ledger.js'

/**
 * Shared transport map assembly used by the main runtime and by child/delegated
 * scopes. Callers build the per-scope deps objects (child scopes narrow them);
 * this factory only decides which transports exist.
 */
export function buildHarnessRuntimes(input: {
  agentSdk?: AgentSdkRuntimeFactoryDeps | null
  antigravity?: AntigravityCliRuntimeDeps | null
  cursor?: CursorSdkRuntimeFactoryDeps | null
  acp?: AcpRuntimeDeps | null
  /** P6-05/07: native `codex app-server` transport on the shared session layer. */
  codexAppServer?: SessionTurnRuntimeDeps | null
  /** P6-09/11: native `pi --mode rpc` transport on the shared session layer. */
  piRpc?: SessionTurnRuntimeDeps | null
  /**
   * Shared usage ledger. When present, every external transport's usage
   * reports are folded into thread-cumulative snapshots (see
   * harness-usage-ledger.ts) exactly like native-loop usage.
   */
  usage?: UsageService
}): Partial<Record<HarnessTransport, DelegatedTurnRuntime>> {
  const ledger = <T extends { events: { record(draft: never): unknown } }>(transport: HarnessTransport, deps: T, harnessId?: string): T =>
    input.usage
      ? { ...deps, events: withHarnessUsageLedger(deps.events as never, { usage: input.usage, mode: HARNESS_USAGE_MODES[transport], ...(harnessId ? { harnessId } : {}) }) }
      : deps
  const map: Partial<Record<HarnessTransport, DelegatedTurnRuntime>> = {}
  if (input.agentSdk) map['agent-sdk'] = createAgentSdkRuntime(ledger('agent-sdk', input.agentSdk, 'claude-code'))
  if (input.antigravity) map['antigravity-cli'] = new AntigravityCliRuntime(ledger('antigravity-cli', input.antigravity, 'antigravity'))
  if (input.cursor) map['cursor-sdk'] = createCursorSdkRuntime(ledger('cursor-sdk', input.cursor, 'cursor'))
  if (input.acp) map.acp = new AcpRuntime(ledger('acp', input.acp))
  if (input.codexAppServer) {
    map['codex-app-server'] = new SessionTurnRuntime(ledger('codex-app-server', input.codexAppServer, 'codex'))
  }
  if (input.piRpc) {
    map['pi-rpc'] = new SessionTurnRuntime(ledger('pi-rpc', input.piRpc, 'pi'))
  }
  return map
}

/**
 * Derive HarnessCapabilities v2 from the ACP `initialize` result plus facts
 * observed on a session (docs/ade/03 §10). ACP gives no fork/rewind/steer
 * methods, so those stay upstream-unsupported; sandbox facts come from the
 * harness catalog declaration since fs/terminal mediation is Kun-provided but
 * never guaranteed to be exercised by the agent.
 */
import {
  SUPPORTED,
  unsupported,
  type HarnessCapabilities,
  type HarnessCapabilityStatuses
} from '../../contracts/harness-capabilities.js'
import type {
  AcpInitializeResult,
  AcpSessionModes,
  AcpConfigOption
} from './acp-schema.js'

/** Facts learned after `initialize` — from session/new or live updates. */
export type AcpSessionFacts = {
  configOptions?: AcpConfigOption[] | null
  modes?: AcpSessionModes | null
  /** Saw available_commands_update at least once. */
  sawAvailableCommands?: boolean
  /** usage_update carried context-window fields (used/size). */
  sawUsageTelemetry?: boolean
  /** usage_update or a prompt result carried token counts. */
  sawUsageTokens?: boolean
}

function hasConfigCategory(
  options: readonly AcpConfigOption[] | null | undefined,
  category: string
): boolean {
  return Boolean(options?.some((option) => option.category === category))
}

export function capabilitiesFromAcp(
  initResult: AcpInitializeResult | undefined,
  session: AcpSessionFacts,
  facts: { sandbox: 'host' | 'native' | 'none' }
): HarnessCapabilities {
  const agent = initResult?.agentCapabilities
  const statuses: HarnessCapabilityStatuses = {
    nativeResume: agent?.loadSession === true ? SUPPORTED : unsupported('upstream'),
    fork: unsupported('upstream'),
    rewind: unsupported('upstream'),
    structuredStreaming: SUPPORTED,
    reasoningStream: SUPPORTED,
    abort: SUPPORTED,
    sameTurnSteer: unsupported('upstream'),
    switchModelMidSession: hasConfigCategory(session.configOptions, 'model')
      ? SUPPORTED
      : unsupported('upstream'),
    setPermissionModeMidSession:
      hasConfigCategory(session.configOptions, 'mode') ||
      (session.modes?.availableModes?.length ?? 0) > 0
        ? SUPPORTED
        : unsupported('upstream'),
    effort: hasConfigCategory(session.configOptions, 'thought_level')
      ? SUPPORTED
      : unsupported('upstream'),
    planMode: unsupported('upstream'),
    manualCompact: unsupported('upstream'),
    kunTools: SUPPORTED,
    externalApproval: SUPPORTED,
    nativeToolInterception: SUPPORTED,
    fsMediated: SUPPORTED,
    terminalMediated: SUPPORTED,
    nativeContextTelemetry: session.sawUsageTelemetry
      ? SUPPORTED
      : unsupported('upstream'),
    imageInput: agent?.promptCapabilities?.image === true
      ? SUPPORTED
      : unsupported('upstream'),
    fileInput: agent?.promptCapabilities?.embeddedContext === true
      ? SUPPORTED
      : unsupported('upstream'),
    nativeCommands: session.sawAvailableCommands
      ? SUPPORTED
      : unsupported('upstream'),
    modes:
      hasConfigCategory(session.configOptions, 'mode') ||
      (session.modes?.availableModes?.length ?? 0) > 0
        ? SUPPORTED
        : unsupported('upstream'),
    // elicitation exists in the spec but is deferred to P2 (§8.4).
    userInput: unsupported('not-implemented')
  }
  return {
    statuses,
    facts: {
      sandbox: facts.sandbox,
      usageReporting: session.sawUsageTokens ? 'exact' : 'none',
      compactionOwner: 'harness'
    }
  }
}

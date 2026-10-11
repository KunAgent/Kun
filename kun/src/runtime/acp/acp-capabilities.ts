/**
 * Derive HarnessCapabilities v2 from the ACP `initialize` result plus facts
 * observed on a session. ACP gives no fork/rewind methods, so those stay
 * upstream-unsupported; guidance is delivered live or deferred (see
 * acp-live-steering.ts); sandbox facts come from the
 * harness catalog declaration since fs/terminal mediation is Kun-provided but
 * never guaranteed to be exercised by the agent.
 */
import {
  SUPPORTED,
  unsupported,
  type HarnessCapabilities,
  type HarnessCapabilityStatuses
} from '../../contracts/harness-capabilities.js'
import {
  capabilityFlagOn,
  type AcpInitializeResult,
  type AcpSessionModes,
  type AcpConfigOption
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
  /**
   * Which Kun Tools MCP transport descriptor was actually delivered with
   * session/new. 'none' or absent means the agent runs tool-less and
   * `kunTools` must not report supported.
   */
  kunToolsDescriptor?: 'http' | 'stdio' | 'none'
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
  facts: { sandbox: 'host' | 'native' | 'none'; liveSteering?: boolean }
): HarnessCapabilities {
  const agent = initResult?.agentCapabilities
  const statuses: HarnessCapabilityStatuses = {
    nativeResume: agent?.loadSession === true ? SUPPORTED : unsupported('upstream'),
    fork: unsupported('upstream'),
    rewind: unsupported('upstream'),
    structuredStreaming: SUPPORTED,
    reasoningStream: SUPPORTED,
    abort: SUPPORTED,
    // ACP has no steer method; an engine whose concurrent session/prompt joins
    // the running loop (ProviderAcpHooks.liveSteering) is steered that way,
    // every other one gets guidance as a follow-up prompt in the same turn.
    sameTurnSteer: SUPPORTED,
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
    // Honest declaration: kunTools counts only when a descriptor was
    // actually delivered on a transport the agent accepts.
    kunTools:
      session.kunToolsDescriptor === 'http' || session.kunToolsDescriptor === 'stdio'
        ? SUPPORTED
        : unsupported('upstream', {
            message: 'no Kun Tools MCP descriptor was delivered for this session'
          }),
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
    // Form elicitation bridges to the user_input gate / ask_manager,
    // but only when the agent declares it supports elicitation.
    userInput: capabilityFlagOn(agent?.elicitation) ? SUPPORTED : unsupported('upstream')
  }
  return {
    statuses,
    facts: {
      sandbox: facts.sandbox,
      usageReporting: session.sawUsageTokens ? 'exact' : 'none',
      compactionOwner: 'harness',
      steering: facts.liveSteering ? 'live' : 'deferred'
    }
  }
}

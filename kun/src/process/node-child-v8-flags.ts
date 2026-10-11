/**
 * V8 flags for long-lived Kun Node children (Service Manager, Runtime).
 *
 * Their steady-state young generation sat at 56-60 MB each because RPC
 * bursts grew V8's semi-spaces to the default ceiling, which RSS then kept.
 * An 8 MB semi-space keeps the nursery around 16-24 MB; scavenges get more
 * frequent but stay sub-millisecond, while old-space limits are unchanged.
 */
export const KUN_NODE_CHILD_V8_FLAGS: readonly string[] = ['--max-semi-space-size=8']

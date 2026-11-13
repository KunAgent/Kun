export type DelegatedProviderKind =
  | 'agent-sdk'
  | 'cursor-sdk'
  | 'antigravity-cli'
  | 'acp'
  | 'codex-app-server'
  | 'pi-rpc'
export type DelegatedContinuationMode = 'native' | 'portable'

export type DelegatedSessionRoute = {
  providerKind: DelegatedProviderKind
  providerId: string
  credentialIdentity: string
  workspace: string
  /**
   * Canonical additional roots the native session was launched with. Part of
   * the route identity (not only the capability fingerprint) so a root change
   * can never be ignored by a native capability resume. Absent/empty keeps the
   * single-directory identity of older bindings.
   */
  additionalWorkspaceRoots?: readonly string[]
  model: string
  /**
   * `session`: the Agent applies the turn's model to its live native session
   * on every turn (Codex `turn/start`, an ACP model selector, Pi `set_model`),
   * so changing the model continues the same conversation instead of starting
   * a new native session with a handoff brief. Unset (`pinned`): the model is
   * part of the session identity. Everything else in the route still is.
   */
  modelScope?: 'pinned' | 'session'
  /** Physical state directory of the resumed session; not part of route identity. */
  providerStateKey?: string
  capabilityFingerprint: string
  continuationMode: DelegatedContinuationMode
}

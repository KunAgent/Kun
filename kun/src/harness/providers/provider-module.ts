import type { HarnessDefinition, HarnessStatus, HarnessTransport } from '../../contracts/harness.js'
import type { NativeAgentNetworkSnapshot } from '../../contracts/native-agent-network.js'
import type { HarnessModelInfo } from '../../contracts/harness-models.js'
import type { HarnessUpdateRecipe } from '../harness-update-recipes.js'
import type { HarnessLoginProbeDeps } from '../harness-login-probes.js'
import type { AcpConnection } from '../../runtime/acp/acp-connection.js'
import type { AcpConfigOption, AcpSessionModes } from '../../runtime/acp/acp-schema.js'

export type ProviderEnv = Record<string, string | undefined>
export type HarnessLoginState = HarnessStatus['login']

/** Credential inputs a hook may need; secret values never leave the hook. */
export type ProviderCredentialContext = {
  /** process env + launch env + selected secrets, unfiltered. */
  merged: ProviderEnv
  /** `merged` without host-control variables (KUN_, ELECTRON_, ...). */
  native: ProviderEnv
  /** The selected engine's resolved env (launch env, secrets, native credential env). */
  selected: Record<string, string>
  /** Credential files for `merged`. */
  files(): string[]
}

/**
 * Native credentials owned by the engine. Everything here is configuration
 * evidence; none of it proves an authenticated account.
 */
export type ProviderCredentials = {
  /** Ambient variables forwarded to an explicitly chosen native profile. */
  readonly envKeys?: readonly string[]
  /**
   * The engine cannot report a missing sign-in over its protocol (ACP
   * authenticate is a no-op, session/new succeeds), so readiness needs local
   * evidence. Every other engine only warns when none is found.
   */
  readonly requireEvidence?: boolean
  /** Variables whose presence in the selected env counts as configured evidence. */
  readonly evidenceEnvKeys?: readonly string[]
  /** Local configuration pointers that accompany the credential into login probes. */
  readonly pointerEnvKeys?: readonly string[]
  /** Engine-specific native env, merged before the `envKeys` allow-list. */
  env?(base: ProviderEnv): Record<string, string>
  /** User-owned credential files. */
  files?(env: ProviderEnv, home: string): string[]
  /** Configuration files whose edits invalidate readiness proofs. */
  profileFiles?(env: ProviderEnv, home: string): string[]
  /** Evidence from files or databases beyond `evidenceEnvKeys`. */
  configured?(context: ProviderCredentialContext): boolean
  /** Extra material bound into the readiness identity (never sent anywhere). */
  fingerprint?(env: ProviderEnv): unknown
  /** Asynchronous local evidence resolved with each readiness snapshot. */
  snapshotEvidence?(env: ProviderEnv): Promise<{ configured: boolean; fingerprint: string }>
  /** Evidence that needs the resolved executable, checked once it is installed. */
  commandEvidence?(command: string | undefined, input: { env: Record<string, string>; signal: AbortSignal }):
    Promise<{ configured?: boolean | 'unknown' }>
}

/** A Kun provider kind whose profiles carry this engine's native credential. */
export type ProviderNativeAccount = {
  /** `ServeProviderConfig.kind`, e.g. `agent-sdk` for Claude subscriptions. */
  readonly kind: string
  /** Variable that receives the provider profile's key. */
  readonly credentialEnv: string
  /** Whether a configured key is credential evidence for readiness. */
  readonly countsAsEvidence: boolean
}

export type ProviderInstallation = {
  /** The app bundles this engine; an installed status is Kun-owned. */
  readonly bundled?: boolean
  /** Path fragments of an executable Kun ships inside its own packages. */
  readonly bundledPathMarkers?: readonly string[]
  /** Native self-updating installer layout: versions under the canonical home, launcher under home. */
  native?(homes: { home: string; canonicalHome: string }): { versionsDir: string; launcher: string; owner: string }
  /** Look for a newer local installation next to the configured one. */
  readonly localCandidates?: boolean
}

export type ProviderFailure = { detail: string; authRequired: boolean }

/** ACP session behaviour that differs per engine. */
export type ProviderAcpHooks = {
  /** Replaces the generic permission-mode negotiation. */
  applyPermission?(conn: AcpConnection, session: { sessionId: string; configOptions?: AcpConfigOption[] | null;
    modes?: AcpSessionModes | null }, permissionMode: string | undefined): Promise<void>
  /** Category label for a model option value (Devin groups fusion models). */
  modelCategory?(value: string): NonNullable<HarnessModelInfo['category']>
  /** Report a known-empty reasoning list when no thought_level option exists. */
  readonly emptyEffortsWithoutThoughtLevel?: boolean
}

export type ProviderGatewayConfigInput = {
  protocol: string
  dir: string
  baseUrl: string
  model: string
  tokenEnv: string
  writeConfigFile(path: string, content: string): string
}

/**
 * Everything Kun knows about one external engine beyond its manifest.
 * Pipeline stages (detection, readiness, login, gateway, handshake) only
 * dispatch to these hooks; a missing hook means the generic behaviour.
 */
export type AgentProviderModule = {
  readonly definition: HarnessDefinition
  readonly credentials?: ProviderCredentials
  /** Local account status from metadata only; never a login or inference. */
  login?(input: { definition: HarnessDefinition; deps: HarnessLoginProbeDeps; command?: string; env: ProviderEnv }): Promise<HarnessLoginState>
  readonly nativeAccount?: ProviderNativeAccount
  /** Variables removed from a native-login launch (host provider credentials). */
  readonly nativeLoginStripEnv?: readonly string[]
  /** A signed-in status is not evidence for the route while one of these is set. */
  readonly loginStatusIgnoredWhen?: readonly string[]
  /** Variable that overrides the executable path for this engine. */
  readonly binaryEnv?: string
  /** Executable shipped with Kun; `undefined` when unavailable. */
  bundled?(): { version?: string; command?: string } | undefined
  /** Resolve the executable when the definition's command alone is not enough. */
  resolveExecutable?(): Promise<string>
  /** Snapshot entry that carries this engine's native network policy. */
  readonly nativeNetwork?: { readonly transport: HarnessTransport; readonly snapshotKey: Exclude<keyof NativeAgentNetworkSnapshot, 'harnesses' | 'installer'> }
  readonly installation?: ProviderInstallation
  readonly update?: HarnessUpdateRecipe
  readonly acp?: ProviderAcpHooks
  /** Native permission mode for a writable turn, before the generic mapping. */
  permissionMode?(input: { requested?: string; ceiling: number }): string | undefined
  /** Write the engine's gateway config and return the variables pointing at it. */
  gatewayConfig?(input: ProviderGatewayConfigInput): Record<string, string> | undefined
  /** Explain a known startup or handshake failure in user terms. */
  explainFailure?(message: string, authRequired: boolean): ProviderFailure | undefined
}

import type { HarnessDefinition, HarnessRoute, HarnessStatus } from '../contracts/harness.js'
import type { HarnessReadiness, HarnessTestHandshake, HarnessTestRequest, HarnessTestResponse } from '../contracts/harness-test.js'
import type { HarnessEnabledProfile } from '../config/kun-config-harnesses.js'
import type { HarnessCatalog } from './harness-catalog.js'
import type { HarnessDetector } from './harness-detector.js'
import { nativeHarnessCredentialEnv, resolveHarnessSecretEnv, type HarnessSecretRefResolver } from './harness-secret-env.js'
import { probeAcpHandshake } from './acp-handshake-probe.js'
import { probeCodexHandshake } from './codex-handshake-probe.js'
import { probePiHandshake } from './pi-handshake-probe.js'
import { legacyProviderKindFor } from './harness-provider-kind.js'
import { parseGatewayModelId } from './gateway-model-id.js'
import { nativeAgentNetworkStatus } from './native-agent-network.js'
import { raceProbeAbort } from './probe-abort.js'
import { harnessProfile, harnessProfileKey, nativeHasKey,
  readinessFingerprint, readinessProvider, type ReadinessOptions } from './harness-readiness-profile.js'
import { readinessProbeEnvironment } from './harness-readiness-env.js'
import { spawnCaptured } from './harness-detector.js'

const PROOF_TTL_MS = 5 * 60_000
const DEFAULT_TIMEOUT_MS = 30_000
export type ReadyHarnessProfile = HarnessEnabledProfile & { expiresAt: string }
type Handshake = Omit<HarnessTestHandshake, 'durationMs'>
type Snapshot = { definition: HarnessDefinition; route: HarnessRoute; secretEnv: Record<string, string>;
  env: Record<string, string>; identity: string; configured: boolean; hasKey: boolean; detail?: string }
type Proof = { route: HarnessRoute; identity: string; command?: string; expires: number; result: HarnessTestResponse }

export type HarnessReadinessDeps = {
  options(): ReadinessOptions
  revision?: () => number
  catalog: HarnessCatalog
  detector: Pick<HarnessDetector, 'status'>
  resolveSecretEnv?: HarnessSecretRefResolver
  resolveProviderCredential?: (sourceId: string) => Promise<{ apiKey: string } | null>
  sdkHandshake?: (definition: HarnessDefinition, env: Record<string, string>, signal: AbortSignal) => Promise<Handshake>
  handshake?: (definition: HarnessDefinition, command: string, env: Record<string, string>, signal: AbortSignal) => Promise<Handshake>
  nowMs?: () => number
}

/** Process-local proofs: no model prompts or interactive login. Adapter metadata may contact its service. */
export class HarnessReadinessService {
  private readonly proofs = new Map<string, Proof>()
  private readonly warming = new Map<string, Promise<unknown>>()
  private readonly warmed = new Map<string, string>()
  private readonly launches = new Map<string, { route: HarnessRoute; identity: string; signature: string }>()
  private readonly generations = new Map<string, number>()
  constructor(private readonly deps: HarnessReadinessDeps) {}

  route(definition: HarnessDefinition, input: Pick<HarnessTestRequest, 'credentialMode' | 'providerId' | 'model'>): HarnessRoute {
    const defaults = this.deps.options().harnesses?.defaults?.[definition.id]
    const credentialMode = input.credentialMode ?? defaults?.credentialMode ?? definition.credentialModes[0]!
    return { harnessId: definition.id, credentialMode,
      ...(input.providerId ?? defaults?.providerId ? { providerId: input.providerId ?? defaults?.providerId } : credentialMode !== 'native-login' ? { providerId: 'default' } : {}),
      model: input.model ?? defaults?.model ?? (credentialMode === 'native-login' ? 'default' : this.deps.options().model ?? '') }
  }

  async test(definition: HarnessDefinition, input: HarnessTestRequest, signal?: AbortSignal): Promise<HarnessTestResponse> {
    const started = this.now()
    const route = this.route(definition, input)
    const key = harnessProfileKey(route)
    const generation = (this.generations.get(key) ?? 0) + 1
    this.generations.set(key, generation)
    this.proofs.delete(key)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error('Readiness check timed out')), Math.min(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 60_000))
    const bounded = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    const revision = this.deps.revision?.()
    const initialEnabled = this.deps.catalog.isProfileEnabled(route)
    let status: HarnessStatus = { harnessId: definition.id, installed: 'unknown', login: 'unknown', checkedAt: new Date(this.now()).toISOString() }
    let handshake: HarnessTestHandshake | undefined
    const checks: HarnessReadiness['checks'] = []
    let authentication: HarnessReadiness['authentication'] = 'unverified'
    let snapshot: Snapshot | undefined
    let detail: string | undefined
    try {
      bounded.throwIfAborted()
      snapshot = await raceProbeAbort(this.snapshot(route), bounded)
      bounded.throwIfAborted()
      status = await raceProbeAbort(this.deps.detector.status(definition.id, { force: true, signal: bounded }), bounded)
      if (snapshot.identity !== (await raceProbeAbort(this.snapshot(route), bounded)).identity) throw new Error('Configuration or credentials changed during the check; test again')
      snapshot = await raceProbeAbort(this.snapshot(route, status.resolvedCommand), bounded)
      const installation = status.installed === 'yes' && status.versionSupported !== false
      checks.push({ id: 'installation', ok: installation, detail: installation ? 'Installed supported runtime' : 'Install a supported runtime and retry' })
      checks.push({ id: 'configuration', ok: snapshot.configured, ...(snapshot.detail ? { detail: snapshot.detail } : {}) })
      if (installation && snapshot.configured && input.level !== 'detect') {
        const hsStarted = this.now()
        handshake = { ...await raceProbeAbort(this.handshake(snapshot, status, bounded), bounded), durationMs: this.now() - hsStarted }
      }
      const nativeEvidence = route.credentialMode === 'native-login' && (handshake?.authentication === 'verified' ||
        ((!route.providerId || route.providerId === 'default') &&
          !(definition.id === 'claude-code' && snapshot.env.CLAUDE_CODE_OAUTH_TOKEN) && status.login === 'signed-in'))
      authentication = nativeEvidence ? 'verified' : snapshot.hasKey ? 'unverified' : 'missing'
      // Initializing ACP or returning model names is never evidence of authentication.
      const credentials = definition.transport === 'native-loop' || snapshot.hasKey || (route.credentialMode === 'native-login' && nativeEvidence)
      checks.push({ id: 'credentials', ok: credentials, detail: nativeEvidence ? 'Local account status verified; quota not tested' :
        snapshot.hasKey ? 'Credential configured; authentication and quota not tested' : 'No verified local account or configured API credential' })
      const protocol = definition.transport === 'native-loop' || (handshake?.ok === true && handshake.supported && (route.credentialMode !== 'native-login' || handshake.authRequired !== true))
      const modelMatches = route.credentialMode !== 'native-login' || (handshake?.models === undefined
        ? route.model === 'default'
        : handshake.models.length > 0 && (route.model === 'default' || handshake.models.includes(route.model)))
      checks.push({ id: 'protocol', ok: protocol && modelMatches, ...(handshake?.detail ? { detail: handshake.detail } : {}) })
      bounded.throwIfAborted()
      const latest = await raceProbeAbort(this.snapshot(route, status.resolvedCommand), bounded)
      if (revision !== this.deps.revision?.() || latest.identity !== snapshot.identity ||
        this.generations.get(key) !== generation || initialEnabled !== this.deps.catalog.isProfileEnabled(route)) {
        throw new Error('Configuration or credentials changed during the check; test again')
      }
      snapshot.identity = latest.identity
    } catch (error) {
      // Keep errors categorical: probe stderr and credential resolver errors may
      // contain secrets, account names or workspace data.
      detail = bounded.aborted ? 'Readiness check cancelled or timed out' :
        error instanceof Error && error.message.startsWith('Configuration or credentials changed') ? error.message : 'Readiness check failed; review the selected profile and retry'
    } finally { clearTimeout(timeout) }
    const usable = !detail && input.level !== 'detect' && checks.length === 4 && checks.every((check) => check.ok)
    const readiness: HarnessReadiness = { profileKey: key, usable, authentication, checks,
      checkedAt: new Date(this.now()).toISOString(), ...(detail ? { detail } : {}) }
    const result: HarnessTestResponse = { harnessId: definition.id, transport: definition.transport, level: input.level,
      ok: usable, durationMs: this.now() - started, detect: { durationMs: this.now() - started, ok: status.installed === 'yes', status },
      ...(handshake ? { handshake } : {}), readiness }
    if (usable && snapshot && this.generations.get(key) === generation && !bounded.aborted) {
      this.proofs.set(key, { route, identity: snapshot.identity, command: status.resolvedCommand, expires: this.now() + PROOF_TTL_MS, result })
    }
    return result
  }

  warmProfiles(id: string): void {
    const definition = this.deps.catalog.get(id)
    if (!definition || id === 'kun') return
    for (const profile of this.deps.catalog.enabledProfiles(id)) {
      const route = this.route(definition, { ...profile, providerId: profile.providerId ?? 'default' })
      const key = harnessProfileKey(route)
      const signature = this.configurationSignature(route)
      const proof = this.proofs.get(key)
      if (proof && proof.expires <= this.now()) { this.proofs.delete(key); this.warmed.delete(key) }
      if (this.proofs.has(key) || this.warming.has(key) || this.warmed.get(key) === signature) continue
      this.warmed.set(key, signature)
      const pending = this.test(definition, { level: 'handshake', ...route })
        .catch(() => undefined).finally(() => this.warming.delete(key))
      this.warming.set(key, pending)
    }
  }
  checking(id: string): boolean {
    return [...this.warming.keys()].some((key) => JSON.parse(key)[0] === id)
  }

  async readyProfiles(id: string): Promise<ReadyHarnessProfile[]> {
    const signal = AbortSignal.timeout(5_000)
    const profiles: ReadyHarnessProfile[] = []
    for (const [key, proof] of this.proofs) {
      if (proof.route.harnessId !== id) continue
      if (proof.expires <= this.now()) { this.proofs.delete(key); continue }
      if (!this.deps.catalog.isProfileEnabled(proof.route)) continue
      try {
        if ((await raceProbeAbort(this.snapshot(proof.route, proof.command), signal)).identity !== proof.identity) { this.proofs.delete(key); this.warmed.delete(key); continue }
        profiles.push({ ...harnessProfile(proof.route), expiresAt: new Date(proof.expires).toISOString() })
      } catch { this.proofs.delete(key) }
    }
    return profiles
  }

  configurationSignature(route: HarnessRoute): string {
    const definition = this.deps.catalog.get(route.harnessId)
    if (!definition) return 'missing'
    return `${this.deps.revision?.() ?? 0}:${readinessFingerprint({ options: this.deps.options(), definition, route, secretEnv: {} })}`
  }
  async prepareTurn(threadId: string, turnId: string, route: HarnessRoute, signature: string, signal: AbortSignal): Promise<void> {
    if (signature !== this.configurationSignature(route)) throw new Error('Agent profile changed before launch; retry the turn')
    const identity = await this.assertReady(route, signal)
    if (signature !== this.configurationSignature(route)) throw new Error('Agent profile changed during readiness check; retry the turn')
    this.launches.set(`${threadId}:${turnId}`, { route, identity, signature })
    await this.validateTurn(threadId, turnId, signal)
  }
  async validateTurn(threadId: string, turnId: string, signal: AbortSignal, actualRoute?: HarnessRoute): Promise<string> {
    const launch = this.launches.get(`${threadId}:${turnId}`)
    if (!launch || launch.signature !== this.configurationSignature(launch.route)) throw new Error('Agent launch has no current readiness proof')
    if (actualRoute && (harnessProfileKey(actualRoute) !== harnessProfileKey(launch.route) ||
      (parseGatewayModelId(actualRoute.model)?.model ?? actualRoute.model) !== (parseGatewayModelId(launch.route.model)?.model ?? launch.route.model))) {
      throw new Error('Actual Agent profile does not match the checked launch route')
    }
    await this.validateProof(launch.route, launch.identity, signal)
    if (this.launches.get(`${threadId}:${turnId}`) !== launch || launch.signature !== this.configurationSignature(launch.route)) {
      throw new Error('Agent profile changed during launch validation')
    }
    return launch.identity
  }
  commandForTurn(threadId: string, turnId: string): string | undefined {
    const launch = this.launches.get(`${threadId}:${turnId}`)
    return launch ? this.proofs.get(harnessProfileKey(launch.route))?.command : undefined
  }
  releaseTurn(threadId: string, turnId: string): void { this.launches.delete(`${threadId}:${turnId}`) }

  async assertReady(route: HarnessRoute, signal?: AbortSignal): Promise<string> {
    if (route.harnessId === 'kun') return 'native'
    const definition = this.deps.catalog.get(route.harnessId)
    if (!definition || definition.availability === 'retired' || !this.deps.catalog.isProfileEnabled(route)) {
      throw new Error(`Agent profile is disabled: ${route.harnessId}. Test and enable this profile in Agent settings.`)
    }
    const result = await this.test(definition, { level: 'handshake', ...route }, signal)
    signal?.throwIfAborted()
    if (!result.readiness?.usable || !this.deps.catalog.isProfileEnabled(route)) {
      throw new Error(result.readiness?.detail ?? result.readiness?.checks.find((check) => !check.ok)?.detail ?? 'Agent profile is not ready; test it in Agent settings')
    }
    const proof = this.proofs.get(harnessProfileKey(route))
    if (!proof) throw new Error('Readiness check was superseded; retry')
    return proof.identity
  }

  /** Last boundary check, after turn setup awaits and immediately before acquiring/spawning. */
  async validateProof(route: HarnessRoute, identity: string, signal?: AbortSignal): Promise<void> {
    signal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(10_000)])
    signal.throwIfAborted()
    const proof = this.proofs.get(harnessProfileKey(route))
    const revision = this.deps.revision?.()
    if (!this.deps.catalog.isProfileEnabled(route) || !proof || proof.identity !== identity ||
      (await raceProbeAbort(this.snapshot(route, proof.command), signal)).identity !== identity) throw new Error('Agent profile changed before launch; test it again')
    if (revision !== this.deps.revision?.() || !this.deps.catalog.isProfileEnabled(route) ||
      this.proofs.get(harnessProfileKey(route)) !== proof) throw new Error('Agent profile changed during launch validation')
    signal?.throwIfAborted()
  }

  private async snapshot(route: HarnessRoute, command?: string): Promise<Snapshot> {
    const definition = this.deps.catalog.get(route.harnessId)
    if (!definition) throw new Error('Unknown harness')
    const options = this.deps.options()
    const secretEnv = await resolveHarnessSecretEnv(definition, this.deps.resolveSecretEnv)
    const candidate = readinessProvider(options, route)
    const provider = route.credentialMode === 'native-login' && (!route.providerId || route.providerId === 'default') &&
      candidate?.kind !== legacyProviderKindFor(definition.id) ? undefined : candidate
    let apiKey = provider?.apiKey?.trim() ?? ''
    if (provider?.credentialSourceId) {
      apiKey = (await this.deps.resolveProviderCredential?.(provider.credentialSourceId))?.apiKey?.trim() ?? ''
      // Bind the resolved credential value, not just its durable reference.
      secretEnv.__KUN_READINESS_PROVIDER = apiKey
    }
    const env = { ...definition.launch?.env, ...secretEnv,
      ...nativeHarnessCredentialEnv(definition, { ...process.env, ...definition.launch?.env, ...secretEnv }) }
    delete env.__KUN_READINESS_PROVIDER
    if (definition.id === 'claude-code' && route.credentialMode === 'native-login') {
      delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN; delete env.ANTHROPIC_BASE_URL
    }
    let configured = definition.availability !== 'retired' && definition.credentialModes.includes(route.credentialMode)
    let detail: string | undefined
    let hasKey = nativeHasKey(definition, env) || (!definition.builtin && Object.entries(secretEnv).some(([key, value]) =>
      /^(?:OPENAI|ANTHROPIC|DEEPSEEK|GEMINI|GOOGLE|WINDSURF|MISTRAL|GROQ|OPENROUTER|XAI)_API_KEY$/.test(key) && Boolean(value.trim())))
    if (route.credentialMode !== 'native-login') {
      hasKey = Boolean(apiKey)
      const gateway = route.credentialMode === 'kun-gateway'
      const validProvider = Boolean(provider && (gateway ? ((provider.kind ?? 'http') === 'http' && (!provider.authType || provider.authType === 'api-key')) :
        !legacyProviderKindFor(definition.id) || provider.kind === legacyProviderKindFor(definition.id)))
      configured &&= validProvider && Boolean(route.model) && (!gateway || Boolean(definition.gateway))
      const modelPool = [...(provider?.models ?? []), ...(provider?.selectedModel ? [provider.selectedModel] : [])]
      if (modelPool.length && !modelPool.includes(parseGatewayModelId(route.model)?.model ?? route.model)) { configured = false; detail = 'Selected model is not in this provider profile' }
      if (!validProvider) detail = 'Select a supported provider profile'
      // Protocol initialization must not consume the provider key or issue a gateway grant.
      // Its model route and credential are checked locally, independently of login.
    } else if (provider && route.providerId && definition.id === 'claude-code' && provider.kind === 'agent-sdk') {
      if (apiKey) env.CLAUDE_CODE_OAUTH_TOKEN = apiKey
    } else if (provider && route.providerId && definition.id === 'cursor') {
      hasKey ||= Boolean(apiKey && provider.kind === 'cursor-sdk')
      if (apiKey && provider.kind === 'cursor-sdk') env.CURSOR_API_KEY = apiKey
    } else if (provider && route.providerId && definition.id === 'antigravity') {
      hasKey ||= Boolean(apiKey && provider.kind === 'antigravity-cli')
      if (apiKey && provider.kind === 'antigravity-cli') env.GEMINI_API_KEY = apiKey
    }
    if (route.credentialMode === 'native-login' && route.providerId && route.providerId !== 'default' &&
      (!legacyProviderKindFor(definition.id) || !provider || provider.kind !== legacyProviderKindFor(definition.id))) { configured = false; detail = 'Native login cannot use an unrelated provider profile' }
    if (nativeAgentNetworkStatus(definition).networkSource === 'explicit-required') {
      configured = false; detail = 'Configure an explicit proxy for this Agent'
    }
    return { definition, route, secretEnv, env, configured, hasKey, ...(detail ? { detail } : {}),
      identity: readinessFingerprint({ options, definition, route, secretEnv, command }) }
  }

  private async handshake(snapshot: Snapshot, status: HarnessStatus, signal: AbortSignal): Promise<Handshake> {
    const { definition } = snapshot
    const probeEnv = await readinessProbeEnvironment(definition, snapshot.route, snapshot.env)
    const env = probeEnv.env
    try { return await this.runHandshake(snapshot, status, signal, env) } finally { await probeEnv.dispose() }
  }

  private async runHandshake(snapshot: Snapshot, status: HarnessStatus, signal: AbortSignal, env: Record<string, string>): Promise<Handshake> {
    const { definition } = snapshot
    const command = status.resolvedCommand ?? definition.launch?.command ?? definition.detect?.command ?? definition.id
    if (this.deps.handshake) return this.deps.handshake(definition, command, env, signal)
    const options = { env, signal, resolveSecretEnv: this.deps.resolveSecretEnv }
    switch (definition.transport) {
      case 'native-loop': return { ok: true, supported: true, protocol: 'native-loop' }
      case 'acp': return probeAcpHandshake(definition, command, { ...options,
        includeModels: snapshot.route.credentialMode === 'native-login' && snapshot.route.model !== 'default' })
      case 'codex-app-server': return probeCodexHandshake(definition, command, { ...options,
        includeModels: snapshot.route.credentialMode === 'native-login' && snapshot.route.model !== 'default' })
      case 'pi-rpc': return probePiHandshake(definition, command, { ...options, includeModels: true })
      case 'agent-sdk': {
        return await this.deps.sdkHandshake?.(definition, env, signal) ?? { ok: false, supported: true, protocol: 'agent-sdk' }
      }
      case 'antigravity-cli': {
        const result = await spawnCaptured(command, ['models'], { timeoutMs: 10_000, signal, env })
        const models = [...new Set(result.stdout.match(/\b[a-z][a-z0-9]*(?:[-.][a-z0-9]+)+\b/gi) ?? [])]
        return { ok: !result.timedOut && result.exitCode === 0 && models.length > 0, supported: true, models,
          protocol: 'antigravity-models', detail: 'Local agy models check; no model prompt sent' }
      }
      default: return { ok: false, supported: false, detail: 'No supported non-inference readiness check for this transport' }
    }
  }
  private now(): number { return this.deps.nowMs?.() ?? Date.now() }
}

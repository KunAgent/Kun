import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { homedir } from 'node:os'
import semver from 'semver'
import type { HarnessDefinition, HarnessStatus } from '../contracts/harness.js'
import type { HarnessUpdateJob, HarnessUpdateState } from '../contracts/harness-update.js'
import type { NativeAgentNetworkPolicy } from '../contracts/native-agent-network.js'
import { describeHarnessInstallation, localHarnessCandidate } from './harness-installation.js'
import { latestHarnessVersion } from './harness-update-check.js'
import { HARNESS_UPDATE_RECIPES } from './harness-update-recipes.js'
import { resolveExecutable } from '../process/owned-process.js'
import { harnessExecutableEnv } from './harness-executable-env.js'
import { harnessExecutableIdentity } from './harness-executable-identity.js'
import { runHarnessUpdater } from './harness-update-process.js'
import { redactApprovalSensitiveText } from '../domain/approval.js'

const DAY = 24 * 60 * 60_000
const active = (job?: HarnessUpdateJob) => job && ['waiting', 'running', 'verifying', 'ready'].includes(job.status)
export type HarnessUpdatesDeps = {
  definition(id: string): HarnessDefinition | undefined
  detect(id: string): Promise<HarnessStatus>
  /**
   * Settled detection already held by the catalog. A background update check
   * reuses it: forcing detection re-runs the Agent's login probe, which can
   * take many seconds on a slow network and is irrelevant to versions.
   */
  currentStatus?(id: string): HarnessStatus | undefined
  verify(id: string, path: string, signal: AbortSignal): Promise<{ version: string; models: string[] }>
  beginMaintenance(id: string): () => void
  inUse(id: string): boolean
  invalidate(id: string): void
  afterActivate?(id: string): Promise<void>
  network?(): NativeAgentNetworkPolicy | undefined
  latest?: typeof latestHarnessVersion
  describe?: typeof describeHarnessInstallation
  candidate?: typeof localHarnessCandidate
  run?: typeof runHarnessUpdater
  resolve?: typeof resolveExecutable
  home?: string
}

/** Update discovery is cached/read-only. Mutations require a fingerprint-bound explicit action. */
export class HarnessUpdates {
  private readonly cache = new Map<string, { value: HarnessUpdateState; expires: number }>()
  private readonly pending = new Map<string, Promise<HarnessUpdateState>>()
  private readonly jobs = new Map<string, { job: HarnessUpdateJob; abort: AbortController; release?: () => void; task?: Promise<void> }>()
  constructor(private readonly deps: HarnessUpdatesDeps) {}

  async check(id: string, force = false): Promise<HarnessUpdateState> {
    const definition = this.deps.definition(id)
    if (!definition) throw new Error('Unknown Agent')
    const cached = this.cache.get(id)
    if (!force && cached && cached.expires > Date.now() &&
      cached.value.current.fingerprint === harnessExecutableIdentity(cached.value.current.path)) return this.withJob(cached.value)
    const existing = this.pending.get(id)
    if (existing) return this.withJob(await existing)
    const pending = this.checkOnce(definition, force).finally(() => this.pending.delete(id))
    this.pending.set(id, pending)
    return this.withJob(await pending)
  }

  private async checkOnce(definition: HarnessDefinition, force = false): Promise<HarnessUpdateState> {
    const id = definition.id
    const status = (!force ? this.deps.currentStatus?.(id) : undefined) ?? await this.deps.detect(id)
    const current = await (this.deps.describe ?? describeHarnessInstallation)(id, status, this.deps.home)
    const recipe = definition.builtin ? HARNESS_UPDATE_RECIPES[id] : undefined
    const candidate = recipe ? await (this.deps.candidate ?? localHarnessCandidate)(id, current) : undefined
    const value: HarnessUpdateState = { harnessId: id, current, candidate,
      channel: recipe?.tag ?? 'latest', docsUrl: definition.setup?.docsUrl, status: 'unchecked',
      canUpdate: Boolean(recipe && (['managed', 'npm', 'homebrew'].includes(current.source) || (current.source === 'native' && recipe.nativeArgs))),
      canInstallManaged: Boolean(recipe?.packageName), ownerUpdateRequired: ['application', 'kun-bundled'].includes(current.source) }
    try {
      const latest = recipe ? await (this.deps.latest ?? latestHarnessVersion)(id, current.source, this.deps.network?.()) : undefined
      value.latestVersion = latest
      value.status = latest ? current.version && semver.valid(current.version) && semver.gte(current.version, latest) ? 'current' : 'available'
        : candidate ? 'available' : recipe ? 'unknown' : 'unsupported'
      if (latest && current.version && semver.valid(current.version) && semver.lt(latest, current.version)) {
        value.canInstallManaged = false
      }
      if (value.status === 'current') value.canUpdate = false
      if (candidate) value.status = 'available'
      if (definition.detect?.exactVersion && latest !== definition.detect.exactVersion) {
        value.canUpdate = false; value.canInstallManaged = false; value.ownerUpdateRequired = true
      }
    } catch (error) { value.status = 'unknown'; value.error = redactApprovalSensitiveText(String(error)).slice(0, 512) }
    value.checkedAt = new Date().toISOString()
    this.cache.set(id, { value, expires: Date.now() + (value.error ? 5 * 60_000 : DAY) })
    return value
  }

  async start(id: string, action: HarnessUpdateJob['action'], fingerprint: string): Promise<HarnessUpdateState> {
    const entry = this.jobs.get(id)
    if (active(entry?.job)) return this.check(id)
    const state = await this.check(id, true)
    if (state.current.fingerprint !== fingerprint || harnessExecutableIdentity(state.current.path) !== fingerprint) {
      throw new Error('Agent installation changed; check updates again')
    }
    if (action === 'use-local' ? !state.candidate : action === 'managed' ? !state.canInstallManaged : !state.canUpdate) {
      throw new Error('This update action is unavailable for the current installation')
    }
    // Recheck after awaits so double clicks share exactly one updater.
    if (active(this.jobs.get(id)?.job)) return this.withJob(state)
    const abort = new AbortController()
    const job: HarnessUpdateJob = { id: randomUUID(), action, status: 'waiting', startedAt: new Date().toISOString(), output: '', previousPath: state.current.path }
    this.jobs.set(id, { job, abort })
    this.jobs.get(id)!.task = this.perform(id, state, job, abort.signal)
    return this.withJob(state)
  }

  cancel(id: string, jobId: string): void {
    const entry = this.jobs.get(id)
    if (!entry || entry.job.id !== jobId) throw new Error('Agent update job changed')
    entry.abort.abort()
    if (entry.job.status === 'ready') { entry.job.status = 'cancelled'; entry.release?.(); entry.release = undefined }
  }

  async activated(id: string, jobId: string): Promise<void> {
    const entry = this.jobs.get(id)
    if (!entry || entry.job.id !== jobId || !['ready', 'completed'].includes(entry.job.status)) throw new Error('Agent update is not ready to activate')
    const current = await this.deps.detect(id)
    if (!entry.job.activationPath || harnessExecutableIdentity(current.resolvedCommand) !== entry.job.activationFingerprint ||
      current.version !== entry.job.version) throw new Error('Kun has not switched to the verified Agent executable')
    this.deps.invalidate(id)
    await this.deps.afterActivate?.(id)
    this.cache.delete(id)
    entry.job.status = 'completed'
    entry.release?.(); entry.release = undefined
  }

  async rollback(id: string, jobId: string): Promise<HarnessUpdateState> {
    const prior = this.jobs.get(id)?.job
    if (!prior || prior.id !== jobId || prior.status !== 'completed' || !prior.previousPath ||
      prior.previousPath === prior.activationPath) throw new Error('No retained previous installation is available')
    const state = await this.check(id, true)
    if (this.jobs.get(id)?.job !== prior) return this.withJob(state)
    if (state.current.fingerprint !== prior.activationFingerprint) throw new Error('Agent selection changed; check again before rollback')
    const abort = new AbortController()
    const job: HarnessUpdateJob = { id: randomUUID(), action: 'rollback', status: 'waiting', output: '',
      startedAt: new Date().toISOString(), previousPath: state.current.path }
    const target = { ...state, candidate: { path: prior.previousPath, fingerprint: harnessExecutableIdentity(prior.previousPath), source: 'custom' as const } }
    this.jobs.set(id, { job, abort })
    this.jobs.get(id)!.task = this.perform(id, target, job, abort.signal)
    return this.withJob(state)
  }

  async dispose(): Promise<void> {
    for (const entry of this.jobs.values()) { entry.abort.abort(); entry.release?.(); entry.release = undefined }
    await Promise.allSettled([...this.jobs.values()].map((entry) => entry.task))
  }

  private async perform(id: string, state: HarnessUpdateState, job: HarnessUpdateJob, signal: AbortSignal): Promise<void> {
    let release: (() => void) | undefined
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(15 * 60_000)])
    try {
      release = this.deps.beginMaintenance(id)
      const entry = this.jobs.get(id)
      if (entry?.job === job) entry.release = release
      while (this.deps.inUse(id)) {
        bounded.throwIfAborted()
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      bounded.throwIfAborted()
      const recipe = HARNESS_UPDATE_RECIPES[id]!
      let path: string
      if (job.action === 'use-local' || job.action === 'rollback') {
        const candidate = state.candidate!
        path = candidate.path!
        if (harnessExecutableIdentity(path) !== candidate.fingerprint) throw new Error('Local Agent changed; check again')
      } else {
        job.status = 'running'
        const resolve = this.deps.resolve ?? resolveExecutable
        let command: string, args: string[]
        if (job.action === 'managed' || (state.current.source === 'managed' && recipe.packageName)) {
          const version = state.latestVersion
          if (!recipe.packageName || !version || !semver.valid(version)) throw new Error('A verified release version is required')
          const dir = join(this.deps.home ?? homedir(), '.kun', 'agents', id, 'versions', version)
          command = await resolve('npm', { env: harnessExecutableEnv() }) ?? ''
          args = ['install', '--prefix', dir, '--no-audit', '--no-fund', '--save-exact', '--registry=https://registry.npmjs.org', `${recipe.packageName}@${version}`]
          path = join(dir, 'node_modules', '.bin', recipe.command + (process.platform === 'win32' ? '.cmd' : ''))
        } else if (state.current.source === 'homebrew') {
          command = await resolve('brew', { env: harnessExecutableEnv() }) ?? ''
          args = ['upgrade', '--cask', recipe.cask!]; path = state.current.path!
        } else if (state.current.source === 'npm') {
          const description = await (this.deps.describe ?? describeHarnessInstallation)(id,
            { harnessId: id, resolvedCommand: state.current.path, installed: 'yes', login: 'unknown', checkedAt: '' }, this.deps.home)
          if (!description.prefix || !recipe.packageName || !state.latestVersion) throw new Error('The original npm prefix could not be verified')
          command = await resolve('npm', { env: harnessExecutableEnv() }) ?? ''
          args = ['install', '--global', '--prefix', description.prefix, '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org', `${recipe.packageName}@${state.latestVersion}`]
          path = state.current.path!
        } else { command = state.current.path!; args = recipe.nativeArgs!; path = command }
        if (!command || !args?.length) throw new Error('Required update command is unavailable')
        await (this.deps.run ?? runHarnessUpdater)({ command, args, signal: bounded, network: this.deps.network?.(),
          output: (text) => { job.output = (job.output + text).slice(-32_768) } })
      }
      job.status = 'verifying'
      const beforeVerification = harnessExecutableIdentity(path)
      const verified = await this.deps.verify(id, path, bounded)
      bounded.throwIfAborted()
      if (beforeVerification !== harnessExecutableIdentity(path)) throw new Error('Agent executable changed during verification; check again')
      if (job.action !== 'rollback' && state.current.version && semver.valid(state.current.version) && semver.lt(verified.version, state.current.version)) throw new Error('The update resolved to an older Agent')
      const expected = job.action === 'use-local' || job.action === 'rollback' ? state.candidate?.version : state.latestVersion
      if (expected && semver.valid(expected) && semver.lt(verified.version, expected)) throw new Error('The updater did not install the requested Agent version')
      job.version = verified.version; job.models = verified.models; job.activationPath = path; job.activationFingerprint = beforeVerification
      job.status = 'ready'
      this.deps.invalidate(id)
      this.cache.delete(id)
    } catch (error) {
      job.status = signal.aborted ? 'cancelled' : 'failed'
      job.error = redactApprovalSensitiveText(error instanceof Error ? error.message : String(error)).slice(0, 1024)
    } finally { if (job.status !== 'ready') { release?.(); const entry = this.jobs.get(id); if (entry?.job === job) entry.release = undefined }; job.finishedAt = new Date().toISOString() }
  }

  private withJob(state: HarnessUpdateState): HarnessUpdateState {
    const job = this.jobs.get(state.harnessId)?.job
    return { ...state, ...(job ? { job: { ...job } } : {}) }
  }
}

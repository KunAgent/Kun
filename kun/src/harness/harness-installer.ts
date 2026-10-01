import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { stripVTControlCharacters } from 'node:util'
import type { ChildProcess } from 'node:child_process'
import type { HarnessDefinition, HarnessStatus } from '../contracts/harness.js'
import type { HarnessInstallAction, HarnessInstallJob, HarnessInstallState } from '../contracts/harness-install.js'
import type { NativeAgentNetworkPolicy } from '../contracts/native-agent-network.js'
import { spawnOwnedProcess, stopOwnedProcess } from '../process/owned-process.js'
import { redactApprovalSensitiveText } from '../domain/approval.js'
import { buildHarnessEnv } from './harness-env.js'
import { harnessExecutableEnv } from './harness-executable-env.js'
import { harnessInstallPlan } from './harness-install-plan.js'

type Entry = { job: HarnessInstallJob; child?: ChildProcess; cancelRequested: boolean }
const active = (job: HarnessInstallJob) => job.status === 'running' || job.status === 'verifying'

/** Bounded, app-owned installation jobs. This service never accepts shell text from an API caller. */
export class HarnessInstaller {
  private readonly jobs = new Map<string, Entry>()
  private readonly starting = new Map<string, Promise<HarnessInstallState>>()
  constructor(private readonly deps: {
    definition: (id: string) => HarnessDefinition | undefined
    detect: (id: string) => Promise<HarnessStatus>
    network?: () => NativeAgentNetworkPolicy | undefined
    plan?: typeof harnessInstallPlan
    spawn?: typeof spawnOwnedProcess
    stop?: typeof stopOwnedProcess
    timeoutMs?: number
  }) {}

  async state(id: string, action: HarnessInstallAction = 'install'): Promise<HarnessInstallState> {
    const definition = this.deps.definition(id)
    if (!definition?.builtin) throw new Error('Only built-in Agent installation is supported')
    const plan = await (this.deps.plan ?? harnessInstallPlan)(definition, action)
    const job = this.jobs.get(id)?.job
    return { plan, ...(job ? { job: { ...job, output: stripVTControlCharacters(redactApprovalSensitiveText(job.output)) } } : {}) }
  }

  start(id: string, action: HarnessInstallAction): Promise<HarnessInstallState> {
    const pending = this.starting.get(id)
    if (pending) return pending
    const task = this.startOnce(id, action).finally(() => this.starting.delete(id))
    this.starting.set(id, task)
    return task
  }

  private async startOnce(id: string, action: HarnessInstallAction): Promise<HarnessInstallState> {
    const state = await this.state(id, action)
    if (state.job && active(state.job)) return state
    if (!state.plan?.available) throw new Error(state.plan?.missingCommand
      ? `Required installer command is missing: ${state.plan.missingCommand}` : 'No installer is available for this platform')
    const entry: Entry = { cancelRequested: false, job: { id: randomUUID(), harnessId: id,
      command: state.plan.command, status: 'running', startedAt: new Date().toISOString(), output: '' } }
    this.jobs.set(id, entry)
    void this.run(entry)
    return { plan: state.plan, job: { ...entry.job } }
  }

  async cancel(id: string, jobId: string): Promise<void> {
    const entry = this.jobs.get(id)
    if (!entry || entry.job.id !== jobId) throw new Error('Installation job changed; refresh and retry')
    if (!active(entry.job)) return
    entry.cancelRequested = true
    if (entry.child) await (this.deps.stop ?? stopOwnedProcess)(entry.child)
  }

  private async run(entry: Entry): Promise<void> {
    let timer: NodeJS.Timeout | undefined
    let timedOut = false
    const append = (chunk: Buffer | string) => {
      entry.job.output = (entry.job.output + String(chunk)).slice(-32_768)
    }
    try {
      const env = buildHarnessEnv({ base: harnessExecutableEnv(), strip: Object.keys(process.env)
        .filter((key) => /^(KUN_|DEEPSEEK_|ANTHROPIC_|OPENAI_API_KEY$)/i.test(key)) })
      const policy = this.deps.network?.()
      if (!Object.keys(env).some((key) => /^(https?|all)_proxy$/i.test(key) && env[key])) {
        if (policy?.source === 'explicit-required') throw new Error('Installer proxy rules differ by destination; configure an explicit HTTP proxy')
        if (policy?.source === 'system') Object.assign(env, { HTTPS_PROXY: policy.proxyUrl, HTTP_PROXY: policy.proxyUrl,
          https_proxy: policy.proxyUrl, http_proxy: policy.proxyUrl })
      }
      Object.assign(env, { CI: '1', NONINTERACTIVE: '1', HOMEBREW_NO_AUTO_UPDATE: '1', FORCE_COLOR: '0' })
      const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash'
      const args = process.platform === 'win32'
        ? ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference = 'Stop'; " + entry.job.command + '; if ($LASTEXITCODE) { exit $LASTEXITCODE }']
        : ['-o', 'pipefail', '-c', entry.job.command]
      const child = await (this.deps.spawn ?? spawnOwnedProcess)(shell, args,
        { env, cwd: homedir(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      entry.child = child
      const exited = new Promise<number | null>((resolve, reject) => {
        child.once('exit', resolve)
        child.once('error', reject)
      })
      child.stdout?.setEncoding('utf8').on('data', append)
      child.stderr?.setEncoding('utf8').on('data', append)
      timer = setTimeout(() => {
        timedOut = true
        void (this.deps.stop ?? stopOwnedProcess)(child).catch(() => undefined)
      }, this.deps.timeoutMs ?? 10 * 60_000)
      timer.unref?.()
      if (entry.cancelRequested) await (this.deps.stop ?? stopOwnedProcess)(child)
      const code = await exited
      if (entry.cancelRequested) { entry.job.status = 'cancelled'; return }
      if (timedOut) throw new Error('Installation timed out')
      if (code !== 0) throw new Error(`Installer exited with code ${code ?? 'unknown'}`)
      entry.job.status = 'verifying'
      const detected = await this.deps.detect(entry.job.harnessId)
      if (entry.cancelRequested) { entry.job.status = 'cancelled'; return }
      entry.job.detected = detected
      if (detected.installed !== 'yes' || detected.versionSupported === false) {
        throw new Error('Installer finished, but the configured executable is still unavailable; check its path and the installation log')
      }
      entry.job.status = 'completed'
    } catch (error) {
      entry.job.status = entry.cancelRequested ? 'cancelled' : 'failed'
      entry.job.error = redactApprovalSensitiveText(error instanceof Error ? error.message : String(error)).slice(0, 1024)
    } finally {
      if (timer) clearTimeout(timer)
      if (entry.child) {
        await (this.deps.stop ?? stopOwnedProcess)(entry.child).catch(() => undefined)
        entry.child = undefined
      }
      entry.job.output = redactApprovalSensitiveText(entry.job.output)
      entry.job.finishedAt = new Date().toISOString()
    }
  }
}

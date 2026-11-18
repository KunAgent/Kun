import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type {
  ColabAccelerator,
  ColabCliRuntimeStatus,
  ColabSessionErrorKind
} from '../../shared/colab/colab-types'

const execFileAsync = promisify(execFile)

export type ParsedColabUsage = {
  balanceCu: number
  burnRateCuPerHour: number
  activeAssignments: number
}

export type ParsedColabServerSession = {
  name: string
  endpoint: string
  accelerator: ColabAccelerator
  variant: string
  untracked: boolean
}

export function parseColabUsageOutput(stdout: string): ParsedColabUsage | null {
  const balanceMatch = /Current balance:\s*([0-9]+(?:\.[0-9]+)?)/i.exec(stdout)
  const rateMatch = /Usage rate:\s*([0-9]+(?:\.[0-9]+)?)/i.exec(stdout)
  const activeMatch = /Active assignments:\s*(\d+)/i.exec(stdout)
  if (!balanceMatch) return null
  return {
    balanceCu: Number(balanceMatch[1]),
    burnRateCuPerHour: rateMatch ? Number(rateMatch[1]) : 0,
    activeAssignments: activeMatch ? Number(activeMatch[1]) : 0
  }
}

function normalizeAccelerator(raw: string): ColabAccelerator {
  const upper = raw.trim().toUpperCase()
  if (upper === 'T4' || upper === 'L4' || upper === 'A100') return upper
  return 'CPU'
}

export function parseColabSessionsOutput(stdout: string): ParsedColabServerSession[] {
  const results: ParsedColabServerSession[] = []
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim()
    const match = /^\[([^\]]+)\]\s+(\S+)\s*\|\s*Hardware:\s*([^|]+)\|\s*Shape:\s*([^|]+)\|\s*Variant:\s*([^|]+)/i.exec(
      line
    )
    if (!match) continue
    const name = match[1].trim()
    results.push({
      name,
      endpoint: match[2].trim(),
      accelerator: normalizeAccelerator(match[3]),
      variant: match[5].trim(),
      untracked: name === '?'
    })
  }
  return results
}

export function classifyColabErrorOutput(output: string): ColabSessionErrorKind {
  const lower = output.toLowerCase()
  if (
    lower.includes('to authorize colab-cli') ||
    lower.includes('invalid_grant') ||
    lower.includes('token has been expired or revoked') ||
    lower.includes('401') ||
    lower.includes('unauthenticated')
  ) {
    return 'auth_expired'
  }
  if (
    lower.includes('too many') ||
    lower.includes('already-active-session') ||
    lower.includes('insufficient') ||
    lower.includes('compute units')
  ) {
    return 'quota_insufficient'
  }
  if (
    lower.includes('unavailable') ||
    lower.includes('capacity') ||
    lower.includes('cannot assign') ||
    lower.includes('resource_exhausted') ||
    lower.includes('resource exhausted') ||
    lower.includes('no backend')
  ) {
    return 'gpu_unavailable'
  }
  return 'command_failed'
}

export class ColabCliRuntime {
  private cachedStatus: ColabCliRuntimeStatus
  private probeInFlight: Promise<ColabCliRuntimeStatus> | null = null
  private installInFlight: Promise<ColabCliRuntimeStatus> | null = null

  constructor(
    private readonly colabRootDir: string,
    private readonly platform: NodeJS.Platform = process.platform
  ) {
    this.cachedStatus = {
      state: 'missing',
      version: null,
      pythonVersion: null,
      venvPath: this.venvDir
    }
  }

  get venvDir(): string {
    return join(this.colabRootDir, 'venv')
  }

  get venvPythonPath(): string {
    return this.platform === 'win32'
      ? join(this.venvDir, 'Scripts', 'python.exe')
      : join(this.venvDir, 'bin', 'python')
  }

  get status(): ColabCliRuntimeStatus {
    return this.cachedStatus
  }

  private async inspectInstallation(): Promise<ColabCliRuntimeStatus> {
    const base = { version: null, pythonVersion: null, venvPath: this.venvDir }
    if (!existsSync(this.venvPythonPath)) return { ...base, state: 'missing' }
    try {
      const { stdout } = await execFileAsync(this.venvPythonPath, [
        '-I', '-c',
        'from platform import python_version; from importlib.metadata import version; print(python_version(), version("google-colab-cli"), sep="|")'
      ], { timeout: 10_000 })
      const [pythonVersion, version] = stdout.trim().split('|')
      if (!pythonVersion || !version) throw new Error('无法读取 Colab CLI 或 Python 的版本。')
      return { state: 'ready', version, pythonVersion, venvPath: this.venvDir }
    } catch (error) {
      const detail = error instanceof Error && 'stderr' in error && typeof error.stderr === 'string'
        ? error.stderr.trim().split(/\r?\n/).at(-1)
        : undefined
      return { ...base, state: 'error', message: detail || (error instanceof Error ? error.message : String(error)) }
    }
  }

  probe(): Promise<ColabCliRuntimeStatus> {
    if (this.installInFlight) return Promise.resolve(this.cachedStatus)
    this.probeInFlight ??= this.inspectInstallation()
      .then((status) => {
        this.cachedStatus = status
        return status
      })
      .finally(() => { this.probeInFlight = null })
    return this.probeInFlight
  }

  async ensureInstalled(options?: {
    upgrade?: boolean
    onStatusChange?: (status: ColabCliRuntimeStatus) => void
  }): Promise<ColabCliRuntimeStatus> {
    if (this.installInFlight) return this.installInFlight
    const status = await this.probe()
    if (this.installInFlight) return this.installInFlight
    if (status.state === 'ready' && !options?.upgrade) return status
    this.installInFlight = this.performInstall(Boolean(options?.upgrade), options?.onStatusChange)
      .finally(() => { this.installInFlight = null })
    return this.installInFlight
  }

  private async performInstall(
    upgrade: boolean,
    onStatusChange?: (status: ColabCliRuntimeStatus) => void
  ): Promise<ColabCliRuntimeStatus> {
    this.cachedStatus = {
      state: 'installing',
      version: this.cachedStatus.version,
      pythonVersion: this.cachedStatus.pythonVersion,
      venvPath: this.venvDir
    }
    onStatusChange?.(this.cachedStatus)
    try {
      await mkdir(this.colabRootDir, { recursive: true, mode: 0o700 })
      const uvInstalled = await this.tryInstallWithUv(upgrade)
      if (!uvInstalled) {
        await this.installWithPython312(upgrade)
      }
      // Public probes report progress while the installer owns the environment.
      const verified = await this.inspectInstallation()
      if (verified.state === 'missing') {
        throw new Error(`Colab 虚拟环境中未找到 Python：${this.venvPythonPath}`)
      }
      this.cachedStatus = verified
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.cachedStatus = {
        state: 'error',
        version: null,
        pythonVersion: null,
        venvPath: this.venvDir,
        message
      }
    }
    onStatusChange?.(this.cachedStatus)
    return this.cachedStatus
  }

  private async tryInstallWithUv(upgrade: boolean): Promise<boolean> {
    try {
      await execFileAsync('uv', ['--version'], { timeout: 5_000 })
    } catch {
      return false
    }
    if (!existsSync(this.venvPythonPath)) {
      await execFileAsync('uv', ['venv', '--python', '3.12', this.venvDir], {
        timeout: 180_000
      })
    }
    const args = ['pip', 'install', '--python', this.venvPythonPath]
    if (upgrade) args.push('-U')
    args.push('google-colab-cli')
    await execFileAsync('uv', args, { timeout: 300_000 })
    return true
  }

  private async findCompatibleSystemPython(): Promise<{ cmd: string; prefixArgs: string[] }> {
    const candidates: Array<{ cmd: string; prefixArgs: string[] }> =
      this.platform === 'win32'
        ? [
            { cmd: 'py', prefixArgs: ['-3.13'] },
            { cmd: 'py', prefixArgs: ['-3.12'] },
            { cmd: 'python', prefixArgs: [] }
          ]
        : [
            { cmd: 'python3.13', prefixArgs: [] },
            { cmd: 'python3.12', prefixArgs: [] },
            { cmd: '/opt/homebrew/bin/python3.13', prefixArgs: [] },
            { cmd: '/opt/homebrew/bin/python3.12', prefixArgs: [] },
            { cmd: '/usr/local/bin/python3.13', prefixArgs: [] },
            { cmd: '/usr/local/bin/python3.12', prefixArgs: [] },
            { cmd: 'python3', prefixArgs: [] }
          ]

    for (const candidate of candidates) {
      try {
        const { stdout } = await execFileAsync(
          candidate.cmd,
          [
            ...candidate.prefixArgs,
            '-c',
            'import sys; print(1 if sys.version_info >= (3, 12) else 0)'
          ],
          { timeout: 5_000 }
        )
        if (stdout.trim() === '1') return candidate
      } catch {
        continue
      }
    }
    throw new Error(
      '未检测到 uv 或 Python 3.12+。请先安装 uv（https://docs.astral.sh/uv/）或 Python 3.12+，Kun 将自动创建独立运行环境。'
    )
  }

  private async installWithPython312(upgrade: boolean): Promise<void> {
    if (!existsSync(this.venvPythonPath)) {
      const py = await this.findCompatibleSystemPython()
      await execFileAsync(py.cmd, [...py.prefixArgs, '-m', 'venv', this.venvDir], {
        timeout: 120_000
      })
    }
    const pipArgs = ['-m', 'pip', 'install']
    if (upgrade) pipArgs.push('-U')
    pipArgs.push('google-colab-cli')
    await execFileAsync(this.venvPythonPath, pipArgs, { timeout: 300_000 })
  }

  async runCommand(params: {
    sessionsJsonPath: string
    args: string[]
    env: Record<string, string>
    stdinText?: string
    timeoutMs?: number
    maxOutputChars?: number
    signal?: AbortSignal
  }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const status = await this.ensureInstalled()
    if (status.state !== 'ready') {
      return {
        exitCode: 127,
        stdout: '',
        stderr: status.message || 'Colab CLI 运行环境尚未就绪。'
      }
    }
    if (params.signal?.aborted) return { exitCode: 1, stdout: '', stderr: 'Colab command canceled.' }
    return new Promise((resolve) => {
      const child = spawn(
        this.venvPythonPath,
        ['-m', 'colab_cli.cli', '--config', params.sessionsJsonPath, ...params.args],
        {
          env: params.env,
          stdio: ['pipe', 'pipe', 'pipe']
        }
      )
      let stdout = ''
      let stderr = ''
      const timer = params.timeoutMs
        ? setTimeout(() => {
            child.kill('SIGTERM')
          }, params.timeoutMs)
        : undefined
      const onAbort = (): void => {
        child.kill('SIGTERM')
      }
      params.signal?.addEventListener('abort', onAbort, { once: true })

      child.stdout.on('data', (chunk: Buffer) => {
        const remaining = (params.maxOutputChars ?? 512_000) - stdout.length
        if (remaining > 0) stdout += chunk.toString('utf8').slice(0, remaining)
      })
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < 512_000) stderr += chunk.toString('utf8')
      })
      child.stdin.on('error', () => { /* The CLI can exit before consuming stdin. */ })
      if (params.stdinText !== undefined) {
        child.stdin.write(params.stdinText)
      }
      child.stdin.end()

      child.once('error', (err) => {
        if (timer) clearTimeout(timer)
        params.signal?.removeEventListener('abort', onAbort)
        resolve({ exitCode: 1, stdout, stderr: `${stderr}\n${err.message}`.trim() })
      })
      child.once('close', (code) => {
        if (timer) clearTimeout(timer)
        params.signal?.removeEventListener('abort', onAbort)
        resolve({ exitCode: code ?? 1, stdout, stderr })
      })
    })
  }

  spawnStreamingCommand(params: {
    sessionsJsonPath: string
    args: string[]
    env: Record<string, string>
    stdinText?: string
  }): ChildProcess {
    const child = spawn(
      this.venvPythonPath,
      ['-m', 'colab_cli.cli', '--config', params.sessionsJsonPath, ...params.args],
      {
        env: params.env,
        stdio: ['pipe', 'pipe', 'pipe']
      }
    )
    if (params.stdinText !== undefined) {
      child.stdin?.write(params.stdinText)
    }
    child.stdin?.end()
    return child
  }
}

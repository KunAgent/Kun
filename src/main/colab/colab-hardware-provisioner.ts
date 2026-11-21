import {
  COLAB_ACCELERATOR_SPECS,
  type ColabAccelerator,
  type ColabSessionErrorKind
} from '../../shared/colab/colab-types'
import { classifyColabErrorOutput } from './colab-cli-runtime'

export const MAX_PROVISION_ATTEMPTS = 5

export type RunColabCliFn = (params: {
  sessionsJsonPath: string
  args: string[]
  env: Record<string, string>
  stdinText?: string
  timeoutMs?: number
  signal?: AbortSignal
}) => Promise<{ exitCode: number; stdout: string; stderr: string }>

export function clampProvisionAttempts(requested: number | undefined, hasMinVram: boolean): number {
  const fallback = hasMinVram ? 3 : 1
  if (typeof requested !== 'number' || !Number.isFinite(requested)) return fallback
  return Math.max(1, Math.min(MAX_PROVISION_ATTEMPTS, Math.round(requested)))
}

export function buildColabNewArgs(params: {
  sessionName: string
  accelerator: ColabAccelerator
  highMem?: boolean
}): string[] {
  const spec = COLAB_ACCELERATOR_SPECS[params.accelerator]
  const args = ['new', '-s', params.sessionName]
  if (spec.cliGpuFlag) args.push('--gpu', spec.cliGpuFlag)
  if (params.highMem) args.push('--high-mem')
  return args
}

export function classifyProvisionError(output: string): ColabSessionErrorKind {
  const lower = output.toLowerCase()
  if (
    lower.includes('backend rejected accelerator') ||
    lower.includes('not entitled') ||
    lower.includes('http 400') ||
    lower.includes('(400)')
  ) {
    return 'not_entitled'
  }
  return classifyColabErrorOutput(output)
}

export function isNonRetryableProvisionError(kind: ColabSessionErrorKind): boolean {
  return (
    kind === 'not_entitled' ||
    kind === 'auth_expired' ||
    kind === 'cli_unavailable' ||
    kind === 'quota_insufficient'
  )
}

const HARDWARE_PROBE_PYTHON = (includeGpu: boolean): string => `import subprocess
mt = 0
try:
    with open("/proc/meminfo") as f:
        for ln in f:
            if ln.startswith("MemTotal:"):
                mt = int(ln.split()[1])
                break
except Exception:
    pass
vram_mib = 0
${
  includeGpu
    ? `try:
    out = subprocess.check_output(
        ["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
        text=True,
        timeout=8,
    ).strip().splitlines()[0]
    vram_mib = int(float(out.strip()))
except Exception:
    pass`
    : ''
}
print(f"KUN_HW:{mt},{vram_mib}")
`

export function parseHardwareProbeOutput(stdout: string): {
  ramGb: number | null
  vramGb: number | null
} {
  const line = stdout.split(/\r?\n/).find((item) => item.startsWith('KUN_HW:'))
  if (!line) return { ramGb: null, vramGb: null }
  const [memKbRaw, vramMibRaw] = line.slice('KUN_HW:'.length).split(',')
  const memKb = Number(memKbRaw?.trim())
  const vramMib = Number(vramMibRaw?.trim())
  return {
    ramGb: Number.isFinite(memKb) && memKb > 0 ? Number((memKb / 1048576).toFixed(1)) : null,
    vramGb: Number.isFinite(vramMib) && vramMib > 0 ? Math.round(vramMib / 1024) : null
  }
}

export type ProvisionColabHardwareResult =
  | {
      ok: true
      sessionName: string
      ramGb: number | null
      vramGb: number | null
      attemptsUsed: number
    }
  | {
      ok: false
      aborted?: boolean
      errorKind?: ColabSessionErrorKind
      errorMessage?: string
    }

/**
 * Allocates a Colab VM with optional `--high-mem` and minimum GPU VRAM targeting.
 * Never reuses a session name across retries so a slower release cannot turn into
 * an unnamed `[?]` orphan, and always stops any VM allocated before cancellation
 * or rejected for insufficient VRAM.
 */
export async function provisionColabHardware(params: {
  baseSessionName: string
  accelerator: ColabAccelerator
  highMem?: boolean
  minVramGb?: number | null
  maxAttempts?: number
  onExhausted?: 'stop_and_fail' | 'keep_last'
  sessionsJsonPath: string
  env: Record<string, string>
  runCli: RunColabCliFn
  syncTokenBack: () => Promise<void>
  onAttempt?: (attempt: number, maxAttempts: number, sessionName: string) => void
  onLog?: (message: string) => void
  signal: AbortSignal
  retryDelayMs?: number
}): Promise<ProvisionColabHardwareResult> {
  const isGpu = params.accelerator !== 'CPU'
  const minVramGb = isGpu && params.minVramGb && params.minVramGb > 0 ? params.minVramGb : null
  const maxAttempts = clampProvisionAttempts(params.maxAttempts, minVramGb !== null)
  const onExhausted = params.onExhausted ?? 'stop_and_fail'
  const retryDelayMs = params.retryDelayMs ?? 2_500

  const assignEnv: Record<string, string> = {
    COLAB_CLI_ASSIGN_RETRIES: '1',
    COLAB_CLI_REQUEST_TIMEOUT: '90',
    ...params.env
  }

  const releaseVm = async (sessionName: string): Promise<void> => {
    await params
      .runCli({
        sessionsJsonPath: params.sessionsJsonPath,
        args: ['stop', '-s', sessionName],
        env: params.env,
        timeoutMs: 30_000
      })
      .catch(() => undefined)
  }

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      if (ms <= 0 || params.signal.aborted) {
        resolve()
        return
      }
      const timer = setTimeout(resolve, ms)
      params.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true }
      )
    })

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (params.signal.aborted) return { ok: false, aborted: true }
    const sessionName =
      attempt === 1 ? params.baseSessionName : `${params.baseSessionName}-r${attempt}`
    params.onAttempt?.(attempt, maxAttempts, sessionName)

    let newRes = await params.runCli({
      sessionsJsonPath: params.sessionsJsonPath,
      args: buildColabNewArgs({
        sessionName,
        accelerator: params.accelerator,
        highMem: params.highMem
      }),
      env: assignEnv,
      timeoutMs: 120_000,
      signal: params.signal
    })

    // Fall back cleanly if an older `google-colab-cli` lacks `--high-mem`.
    if (
      newRes.exitCode !== 0 &&
      params.highMem &&
      `${newRes.stdout}\n${newRes.stderr}`.includes('--high-mem')
    ) {
      params.onLog?.('[colab] Current CLI does not support --high-mem; retrying with standard shape.')
      newRes = await params.runCli({
        sessionsJsonPath: params.sessionsJsonPath,
        args: buildColabNewArgs({ sessionName, accelerator: params.accelerator, highMem: false }),
        env: assignEnv,
        timeoutMs: 120_000,
        signal: params.signal
      })
    }

    await params.syncTokenBack().catch(() => undefined)

    if (params.signal.aborted) {
      await releaseVm(sessionName)
      return { ok: false, aborted: true }
    }

    if (newRes.exitCode !== 0) {
      const combined = `${newRes.stdout}\n${newRes.stderr}`.trim()
      const errorKind = classifyProvisionError(combined)
      await releaseVm(sessionName)
      if (attempt < maxAttempts && !isNonRetryableProvisionError(errorKind)) {
        params.onLog?.(
          `[colab] Allocation attempt ${attempt}/${maxAttempts} failed (${errorKind}); retrying…`
        )
        await sleep(retryDelayMs)
        continue
      }
      return {
        ok: false,
        errorKind,
        errorMessage: combined.slice(0, 400) || `创建 Colab 会话失败（退出码 ${newRes.exitCode}）。`
      }
    }

    const probeRes = await params.runCli({
      sessionsJsonPath: params.sessionsJsonPath,
      args: ['exec', '-s', sessionName, '--timeout', '15'],
      env: params.env,
      stdinText: HARDWARE_PROBE_PYTHON(isGpu),
      timeoutMs: 20_000,
      signal: params.signal
    })

    if (params.signal.aborted) {
      await releaseVm(sessionName)
      return { ok: false, aborted: true }
    }

    const hw = parseHardwareProbeOutput(probeRes.stdout)
    if (minVramGb !== null && hw.vramGb !== null && hw.vramGb < minVramGb) {
      if (attempt === maxAttempts && onExhausted === 'keep_last') {
        params.onLog?.(
          `[colab] Attempt ${attempt}/${maxAttempts} allocated ${hw.vramGb} GB VRAM (< ${minVramGb} GB target); keeping last VM.`
        )
        return { ok: true, sessionName, ramGb: hw.ramGb, vramGb: hw.vramGb, attemptsUsed: attempt }
      }
      params.onLog?.(
        `[colab] Attempt ${attempt}/${maxAttempts} allocated ${hw.vramGb} GB VRAM (< ${minVramGb} GB target); releasing VM…`
      )
      await releaseVm(sessionName)
      if (attempt < maxAttempts) {
        await sleep(retryDelayMs)
        continue
      }
      return {
        ok: false,
        errorKind: 'gpu_unavailable',
        errorMessage: `连续 ${maxAttempts} 次分配到的显存（${hw.vramGb} GB）低于目标下限 ${minVramGb} GB，已自动释放实例停止计费。`
      }
    }

    return { ok: true, sessionName, ramGb: hw.ramGb, vramGb: hw.vramGb, attemptsUsed: attempt }
  }

  return { ok: false, errorKind: 'gpu_unavailable', errorMessage: '无法分配满足条件的运行时。' }
}

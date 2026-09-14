import { createHash } from 'node:crypto'
import { access, realpath, stat } from 'node:fs/promises'
import { delimiter, isAbsolute, join } from 'node:path'
import { constants } from 'node:fs'
import type { ChildProcessByStdio } from 'node:child_process'
import { spawnOwnedProcess, stopOwnedProcess } from '../process/owned-process.js'
import type { Readable } from 'node:stream'
import type { ExtensionPrincipal } from './extension-agent-service.js'
import {
  ExtensionMediaHandleService,
  type ResolvedMediaHandle
} from './extension-media-handle-service.js'
import { type ExtensionAudioSourceEvidence, ExtensionMediaProcessError, type MediaCapability, type MediaExecutableName, type MediaProbeMetadata, type RunResult } from './extension-media-process-service-contracts.js'

export async function inspectFfmpegFeatures(
  processRunner: typeof runBoundedProcess,
  executable: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  maxBytes: number
): Promise<NonNullable<MediaCapability['features']>> {
  try {
    const [encoders, filters, muxers] = await Promise.all([
      processRunner(executable, ['-hide_banner', '-encoders'], {
        env,
        timeoutMs,
        maxStdoutBytes: maxBytes,
        maxStderrBytes: maxBytes
      }),
      processRunner(executable, ['-hide_banner', '-filters'], {
        env,
        timeoutMs,
        maxStdoutBytes: maxBytes,
        maxStderrBytes: maxBytes
      }),
      processRunner(executable, ['-hide_banner', '-muxers'], {
        env,
        timeoutMs,
        maxStdoutBytes: maxBytes,
        maxStderrBytes: maxBytes
      })
    ])
    if (encoders.exitCode !== 0 || filters.exitCode !== 0 || muxers.exitCode !== 0) return []
    // FFmpeg variants do not consistently send capability inventories to the
    // same stream. In particular, Homebrew's full macOS build can print the
    // filter inventory on stderr even after a successful exit. Both streams
    // are independently bounded by the caller, so combine them only for the
    // local, token-based capability probe.
    const encoderText = capabilityInventoryText(encoders)
    const filterText = capabilityInventoryText(filters)
    const muxerText = capabilityInventoryText(muxers)
    const features: NonNullable<MediaCapability['features']> = []
    if (/^\s*[A-Z.]{6}\s+libx264\s/mu.test(encoderText)) features.push('libx264-encoder')
    if (/^\s*[A-Z.]{6}\s+libx265\s/mu.test(encoderText)) features.push('libx265-encoder')
    if (/^\s*[A-Z.]{6}\s+prores_ks\s/mu.test(encoderText)) features.push('prores-ks-encoder')
    if (/^\s*[A-Z.]{6}\s+ffv1\s/mu.test(encoderText)) features.push('ffv1-encoder')
    if (/^\s*[A-Z.]{6}\s+aac\s/mu.test(encoderText)) features.push('aac-encoder')
    if (/^\s*[A-Z.]{6}\s+flac\s/mu.test(encoderText)) features.push('flac-encoder')
    if (/^\s*[A-Z.]{6}\s+pcm_s24le\s/mu.test(encoderText)) features.push('pcm-s24-encoder')
    if (/^\s*[A-Z.]{6}\s+pcm_s16le\s/mu.test(encoderText)) features.push('pcm-s16-encoder')
    if (hasFfmpegFilter(filterText, 'drawtext')) features.push('drawtext-filter')
    if (hasFfmpegFilter(filterText, 'subtitles')) features.push('subtitles-filter')
    if (hasFfmpegFilter(filterText, 'eq')) features.push('eq-filter')
    if (hasFfmpegFilter(filterText, 'colorbalance')) features.push('colorbalance-filter')
    if (hasFfmpegFilter(filterText, 'boxblur')) features.push('boxblur-filter')
    if (hasFfmpegFilter(filterText, 'unsharp')) features.push('unsharp-filter')
    if (hasFfmpegFilter(filterText, 'vignette')) features.push('vignette-filter')
    if (hasFfmpegFilter(filterText, 'silencedetect')) features.push('silencedetect-filter')
    if (/^\s*[E.]\s+mp4(?:\s|,)/mu.test(muxerText)) features.push('mp4-muxer')
    if (/^\s*[E.]\s+mov(?:\s|,)/mu.test(muxerText)) features.push('mov-muxer')
    if (/^\s*[E.]\s+matroska(?:\s|,)/mu.test(muxerText)) features.push('matroska-muxer')
    if (/^\s*[E.]\s+s16le(?:\s|,)/mu.test(muxerText)) features.push('s16le-muxer')
    return features
  } catch {
    return []
  }
}

export function capabilityInventoryText(result: RunResult): string {
  return Buffer.concat([result.stdout, Buffer.from('\n'), result.stderr]).toString('utf8')
}

export function hasFfmpegFilter(inventory: string, name: string): boolean {
  // Filter flags are presentation metadata. Their width differs between
  // FFmpeg builds, so use the stable filter-name column instead.
  return new RegExp(`^\\s*(?:[A-Z.]+\\s+)?${name}(?:\\s|$)`, 'mu').test(inventory)
}

export type DiscoveredExecutable = { path: string; source: 'configured' | 'path' }

export async function discoverExecutable(
  name: MediaExecutableName,
  configuredPath: string | undefined,
  pathEnv: string,
  discoveryDirectories: readonly string[]
): Promise<DiscoveredExecutable | undefined> {
  if (configuredPath) {
    if (!isAbsolute(configuredPath)) return undefined
    const path = await executableRealpath(configuredPath)
    return path ? { path, source: 'configured' } : undefined
  }
  const names = process.platform === 'win32' ? [`${name}.exe`, name] : [name]
  const directories = [...new Set([
    ...discoveryDirectories.slice(0, 32),
    ...pathEnv.split(delimiter).filter(Boolean).slice(0, 128)
  ])]
  for (const directory of directories) {
    if (!isAbsolute(directory)) continue
    for (const candidate of names) {
      const path = await executableRealpath(join(directory, candidate))
      if (path) return { path, source: 'path' }
    }
  }
  return undefined
}

/**
 * Desktop launches do not necessarily inherit an interactive shell PATH.
 * Search only fixed, reviewed installation prefixes in addition to PATH; the
 * resolved executable is still canonicalized and checked before use.
 */
export function defaultMediaDiscoveryDirectories(
  platform: NodeJS.Platform = process.platform
): string[] {
  if (platform === 'darwin') {
    return [
      '/opt/homebrew/opt/ffmpeg-full/bin',
      '/usr/local/opt/ffmpeg-full/bin',
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/opt/local/bin'
    ]
  }
  if (platform === 'linux') return ['/usr/local/bin', '/usr/bin', '/snap/bin']
  return []
}

export async function executableRealpath(candidate: string): Promise<string | undefined> {
  try {
    const path = await realpath(candidate)
    const info = await stat(path)
    if (!info.isFile()) return undefined
    await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    return path
  } catch {
    return undefined
  }
}

export function scrubbedEnvironment(pathEnv: string): NodeJS.ProcessEnv {
  return {
    PATH: pathEnv,
    LANG: 'C',
    LC_ALL: 'C',
    ...(process.platform === 'win32' && process.env.SystemRoot
      ? { SystemRoot: process.env.SystemRoot }
      : {})
  }
}

export async function runBoundedProcess(
  executable: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv
    timeoutMs: number
    maxStdoutBytes: number
    maxStderrBytes: number
    signal?: AbortSignal
    onStdoutChunk?: (chunk: Buffer) => void
  }
): Promise<RunResult> {
  if (options.signal?.aborted) {
    throw new ExtensionMediaProcessError('process_cancelled', 'Media process was cancelled')
  }
  let child: ChildProcessByStdio<null, Readable, Readable>
  try {
    child = await spawnOwnedProcess(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env
    }) as ChildProcessByStdio<null, Readable, Readable>
  } catch {
    throw new ExtensionMediaProcessError('executable_unavailable', 'Media executable could not be started', true)
  }
  return await new Promise<RunResult>((resolvePromise, rejectPromise) => {
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    let terminationReason: 'timeout' | 'cancelled' | 'limit' | undefined

    const stop = (reason: typeof terminationReason) => {
      if (terminationReason) return
      terminationReason = reason
      void stopOwnedProcess(child, { graceMs: 500 }).catch(rejectPromise)
    }
    const deadline = setTimeout(() => stop('timeout'), options.timeoutMs)
    deadline.unref?.()
    const abort = () => stop('cancelled')
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()

    child.stdout.on('data', (value: Buffer | string) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      stdoutBytes += chunk.length
      if (stdoutBytes > options.maxStdoutBytes) {
        stop('limit')
        return
      }
      stdout.push(chunk)
      options.onStdoutChunk?.(chunk)
    })
    child.stderr.on('data', (value: Buffer | string) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      stderrBytes += chunk.length
      if (stderrBytes > options.maxStderrBytes) {
        stop('limit')
        return
      }
      stderr.push(chunk)
    })
    child.once('error', () => {
      cleanup()
      if (settled) return
      settled = true
      rejectPromise(new ExtensionMediaProcessError('executable_unavailable', 'Media executable could not be started', true))
    })
    child.once('close', (code) => {
      cleanup()
      if (settled) return
      settled = true
      if (terminationReason === 'timeout') {
        rejectPromise(new ExtensionMediaProcessError('process_timeout', 'Media process timed out', true))
        return
      }
      if (terminationReason === 'cancelled') {
        rejectPromise(new ExtensionMediaProcessError('process_cancelled', 'Media process was cancelled'))
        return
      }
      if (terminationReason === 'limit') {
        rejectPromise(new ExtensionMediaProcessError('output_limit', 'Media process output exceeded its limit'))
        return
      }
      resolvePromise({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), exitCode: code ?? -1 })
    })

    function cleanup() {
      clearTimeout(deadline)
      options.signal?.removeEventListener('abort', abort)
      child.stdout.destroy()
      child.stderr.destroy()
    }
  })
}

export function assertSafeAnalysisInput(input: ResolvedMediaHandle): void {
  if (input.absolutePath.includes('%')) {
    throw new ExtensionMediaProcessError(
      'invalid_analysis_output',
      'Audio input name uses unsupported pattern syntax'
    )
  }
}

export function sourceEvidence(input: ResolvedMediaHandle): ExtensionAudioSourceEvidence {
  if (!input.identity) {
    throw new ExtensionMediaProcessError(
      'invalid_analysis_output',
      'Audio source identity is unavailable'
    )
  }
  return {
    handleId: input.id,
    fingerprint: createHash('sha256')
      .update(
        `${input.identity.device ?? ''}\0${input.identity.inode ?? ''}\0${input.identity.size}\0${input.identity.mtimeMs}`
      )
      .digest('hex'),
    fingerprintAlgorithm: 'sha256-file-identity-v1'
  }
}

export function audioDurationMicros(probe: MediaProbeMetadata): number | undefined {
  const values = [
    probe.container.durationMicros,
    ...probe.streams.filter(({ kind }) => kind === 'audio').map(({ durationMicros }) => durationMicros)
  ].filter((value): value is number => Number.isSafeInteger(value) && Number(value) > 0)
  return values.length === 0 ? undefined : Math.max(...values)
}

export function visualDurationMicros(probe: MediaProbeMetadata): number | undefined {
  const values = [
    probe.container.durationMicros,
    ...probe.streams.filter(({ kind }) => kind === 'video').map(({ durationMicros }) => durationMicros)
  ].filter((value): value is number => Number.isSafeInteger(value) && Number(value) > 0)
  return values.length === 0 ? undefined : Math.max(...values)
}

export function boundedDecimal(value: number): string {
  if (!Number.isFinite(value)) {
    throw new ExtensionMediaProcessError(
      'invalid_analysis_output',
      'Audio analysis threshold is invalid'
    )
  }
  return Number(value.toFixed(6)).toString()
}

export function microsSeconds(value: number): string {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ExtensionMediaProcessError(
      'invalid_analysis_output',
      'Audio analysis duration is invalid'
    )
  }
  return (value / 1_000_000).toFixed(6)
}

export function microsSeekSeconds(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ExtensionMediaProcessError(
      'invalid_analysis_output',
      'Visual sample timestamp is invalid'
    )
  }
  return (value / 1_000_000).toFixed(6)
}

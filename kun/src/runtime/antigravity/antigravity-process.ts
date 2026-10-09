import type { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { sdkProcessBaseEnv } from '../agent-sdk/sdk-process-environment.js'
import { spawnOwnedProcess, stopOwnedProcess, type SpawnOwnedProcessOptions } from '../../process/owned-process.js'
import { harnessExecutableEnv } from '../../harness/harness-executable-env.js'
import { adaptAntigravityModelSelectionArgs } from './antigravity-model-selection.js'

const MAX_STDOUT_BYTES = 8 * 1024 * 1024
const MAX_STDERR_BYTES = 256 * 1024

type AntigravityProcessInput = {
  binaryPath: string
  env?: Record<string, string>
  args: string[]
  cwd: string
  signal: AbortSignal
  validateLaunch?: () => Promise<unknown>
  timeoutMs: number
  spawnFn?: typeof spawn
  /** Called with each complete stdout line the moment it arrives (`stream-json` events). */
  onStdoutLine?: (line: string) => void
}

export async function runAntigravityProcess(input: AntigravityProcessInput): Promise<string> {
  try {
    return await runAntigravityProcessOnce(input)
  } catch (error) {
    // `agy` rejects an unsupported --model/--effort pairing before it starts a
    // turn (no model request has run), so repairing the pairing and resending
    // once cannot duplicate work.
    const args = error instanceof Error && !input.signal.aborted
      ? adaptAntigravityModelSelectionArgs(input.args, error.message)
      : undefined
    if (!args) throw error
    return runAntigravityProcessOnce({ ...input, args })
  }
}

async function runAntigravityProcessOnce(input: AntigravityProcessInput): Promise<string> {
  const beforeLaunch = async (): Promise<void> => {
    input.signal.throwIfAborted()
    await input.validateLaunch?.()
    input.signal.throwIfAborted()
  }
  const options: SpawnOwnedProcessOptions = {
    beforeLaunch,
    cwd: input.cwd,
    // agy reaches Google services itself; an inherited proxy is part of its
    // network, unlike the shell tool's credential-free allow-list.
    env: { ...harnessExecutableEnv(sdkProcessBaseEnv()), ...input.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false
  }
  await beforeLaunch()
  const child = input.spawnFn
    ? input.spawnFn(input.binaryPath, input.args, options)
    : await spawnOwnedProcess(input.binaryPath, input.args, options)
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let lineBuffer = ''
    const emitLines = (text: string, final = false): void => {
      if (!input.onStdoutLine) return
      const lines = `${lineBuffer}${text}`.split('\n')
      lineBuffer = final ? '' : lines.pop() ?? ''
      for (const line of lines) {
        const complete = line.endsWith('\r') ? line.slice(0, -1) : line
        // An observer failing must never end the CLI turn.
        if (complete) try { input.onStdoutLine(complete) } catch { /* ignored */ }
      }
    }
    const stdoutDecoder = new StringDecoder('utf8')
    const stderrDecoder = new StringDecoder('utf8')
    let settled = false
    let timedOut = false
    const terminate = (): void => {
      if (input.spawnFn) child.kill()
      else void stopOwnedProcess(child).catch((error: Error) => done(error))
    }
    const onAbort = (): void => terminate()
    const done = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      input.signal.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve(stdout)
    }
    const timer = setTimeout(() => {
      timedOut = true
      terminate()
    }, input.timeoutMs)
    if (input.signal.aborted) terminate()
    else input.signal.addEventListener('abort', onAbort, { once: true })
    child.stdout?.on('data', (chunk: Buffer | string) => {
      if (settled) return
      // Child-process streams may split one UTF-8 character across multiple
      // data events. Decode incrementally so Chinese and other multibyte text
      // survives those boundaries intact.
      stdoutBytes += Buffer.byteLength(chunk)
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        terminate()
        done(new Error('Antigravity CLI response exceeded the output limit'))
        return
      }
      const text = stdoutDecoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      stdout += text
      emitLines(text)
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      if (settled) return
      stderr = `${stderr}${stderrDecoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))}`
        .slice(-MAX_STDERR_BYTES)
    })
    child.on('error', (error) => done(error))
    child.on('exit', (code) => {
      if (!input.spawnFn) void stopOwnedProcess(child, { graceMs: 0 }).catch(() => undefined)
      if (settled) return
      const tail = stdoutDecoder.end()
      stdout += tail
      emitLines(tail, true)
      stderr = `${stderr}${stderrDecoder.end()}`.slice(-MAX_STDERR_BYTES)
      if (input.signal.aborted) {
        done(new Error('Antigravity CLI turn was aborted'))
      } else if (timedOut) {
        done(new Error(`Antigravity CLI turn exceeded ${input.timeoutMs}ms wall time`))
      } else if (code !== 0) {
        done(new Error(stderr.trim() || `Antigravity CLI exited with code ${code}`))
      } else {
        done()
      }
    })
  })
}

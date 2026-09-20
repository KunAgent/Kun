import type { spawn, SpawnOptions } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { shellSpawnEnv } from '../../adapters/tool/builtin-tool-utils.js'
import { spawnOwnedProcess, stopOwnedProcess } from '../../process/owned-process.js'

const MAX_STDOUT_BYTES = 8 * 1024 * 1024
const MAX_STDERR_BYTES = 256 * 1024

export async function runAntigravityProcess(input: {
  binaryPath: string
  args: string[]
  cwd: string
  signal: AbortSignal
  timeoutMs: number
  spawnFn?: typeof spawn
}): Promise<string> {
  const options: SpawnOptions = {
    cwd: input.cwd,
    env: shellSpawnEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false
  }
  const child = input.spawnFn
    ? input.spawnFn(input.binaryPath, input.args, options)
    : await spawnOwnedProcess(input.binaryPath, input.args, options)
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
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
      stdout += stdoutDecoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
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
      stdout += stdoutDecoder.end()
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

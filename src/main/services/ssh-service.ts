import { spawn } from 'node:child_process'
import type {
  SshConnectionTestPayload,
  SshConnectionTestResult
} from '../../shared/ds-gui-api'

type ProcessResult =
  | {
      ok: true
      code: number | null
      signal: NodeJS.Signals | null
      stdout: string
      stderr: string
      timedOut: boolean
    }
  | {
      ok: false
      message: string
    }

export type SshProcessRunner = (
  command: string,
  args: string[],
  timeoutMs: number
) => Promise<ProcessResult>

const MAX_OUTPUT_BYTES = 8_000
const SSH_TIMEOUT_MS = 12_000

function compactOutput(value: string): string {
  return value.length > MAX_OUTPUT_BYTES ? value.slice(-MAX_OUTPUT_BYTES) : value
}

function hasUnsafeTargetPart(value: string): boolean {
  if (value.startsWith('-')) return true
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 32 || code === 127) return true
  }
  return false
}

function normalizeTarget(payload: SshConnectionTestPayload): string {
  const host = payload.host.trim()
  const user = payload.user?.trim() ?? ''
  if (!host) throw new Error('SSH host is required.')
  if (hasUnsafeTargetPart(host)) throw new Error('SSH host contains unsupported characters.')
  if (user) {
    if (hasUnsafeTargetPart(user) || user.includes('@')) {
      throw new Error('SSH user contains unsupported characters.')
    }
    return `${user}@${host}`
  }
  return host
}

function quoteRemoteShellPath(value: string): string {
  const escaped = value.replace(/'/g, "'\\''")
  return `'${escaped}'`
}

export function buildSshTestArgs(payload: SshConnectionTestPayload): string[] {
  const target = normalizeTarget(payload)
  const port = typeof payload.port === 'number' && Number.isFinite(payload.port)
    ? Math.round(payload.port)
    : 22
  if (port < 1 || port > 65_535) throw new Error('SSH port must be between 1 and 65535.')

  const remotePath = payload.remotePath?.trim() ?? ''
  const remoteCommand = remotePath ? `cd ${quoteRemoteShellPath(remotePath)} && pwd` : 'pwd'
  return [
    '-T',
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=8',
    '-p',
    String(port),
    target,
    remoteCommand
  ]
}

async function runProcess(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    const child = spawn(command, args, { windowsHide: true })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)

    const finish = (result: ProcessResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = compactOutput(stdout + chunk.toString('utf8'))
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = compactOutput(stderr + chunk.toString('utf8'))
    })
    child.on('error', (error) => {
      finish({ ok: false, message: error.message })
    })
    child.on('close', (code, signal) => {
      finish({
        ok: true,
        code,
        signal,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut
      })
    })
  })
}

function formatSshFailure(result: ProcessResult): string {
  if (!result.ok) {
    return /ENOENT|spawn ssh/i.test(result.message)
      ? 'SSH executable was not found.'
      : result.message
  }
  if (result.timedOut) return 'SSH connection timed out.'
  return result.stderr || result.stdout || `SSH exited with code ${result.code ?? 'unknown'}.`
}

export async function testSshConnection(
  payload: SshConnectionTestPayload,
  runner: SshProcessRunner = runProcess
): Promise<SshConnectionTestResult> {
  let args: string[]
  try {
    args = buildSshTestArgs(payload)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }

  const result = await runner('ssh', args, SSH_TIMEOUT_MS)
  if (!result.ok || result.timedOut || result.code !== 0) {
    return { ok: false, message: formatSshFailure(result) }
  }

  const cwd = result.stdout.split(/\r?\n/).filter(Boolean).at(-1)
  return {
    ok: true,
    message: cwd ? `SSH connection succeeded: ${cwd}` : 'SSH connection succeeded.'
  }
}

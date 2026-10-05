import { homedir } from 'node:os'
import { spawnOwnedProcess, stopOwnedProcess } from '../process/owned-process.js'
import { buildHarnessEnv } from './harness-env.js'
import { harnessExecutableEnv } from './harness-executable-env.js'
import type { NativeAgentNetworkPolicy } from '../contracts/native-agent-network.js'
import { redactApprovalSensitiveText } from '../domain/approval.js'

export async function runHarnessUpdater(input: {
  command: string; args: string[]; signal: AbortSignal
  network?: NativeAgentNetworkPolicy; output(text: string): void
}): Promise<void> {
  const env = buildHarnessEnv({ base: harnessExecutableEnv(), strip: Object.keys(process.env)
    .filter((key) => /^(KUN_|DEEPSEEK_|ANTHROPIC_|OPENAI_API_KEY$)/i.test(key)) })
  if (!Object.keys(env).some((key) => /^(https?|all)_proxy$/i.test(key) && env[key])) {
    if (input.network?.source === 'explicit-required') throw new Error('An explicit proxy is required for Agent updates')
    if (input.network?.source === 'system') Object.assign(env, { HTTPS_PROXY: input.network.proxyUrl, HTTP_PROXY: input.network.proxyUrl })
  }
  Object.assign(env, { CI: '1', NONINTERACTIVE: '1', FORCE_COLOR: '0' })
  let command = input.command, args = input.args
  if (process.platform === 'win32' && /(?:\.cmd|\.bat)$/.test(command)) {
    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
    args = ['-NoProfile', '-NonInteractive', '-Command', `& ${[command, ...args].map(quote).join(' ')}; exit $LASTEXITCODE`]
    command = 'powershell.exe'
  }
  input.signal.throwIfAborted()
  const child = await spawnOwnedProcess(command, args, { cwd: homedir(), env, stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true, beforeLaunch: async () => input.signal.throwIfAborted() })
  const abort = () => { void stopOwnedProcess(child).catch(() => undefined) }
  input.signal.addEventListener('abort', abort, { once: true })
  if (input.signal.aborted) abort()
  child.stdout?.on('data', (chunk) => input.output(redactApprovalSensitiveText(String(chunk))))
  child.stderr?.on('data', (chunk) => input.output(redactApprovalSensitiveText(String(chunk))))
  try {
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) })
    input.signal.throwIfAborted()
    if (code !== 0) throw new Error(`Agent updater exited with code ${code ?? 'unknown'}`)
  } finally { input.signal.removeEventListener('abort', abort); await stopOwnedProcess(child).catch(() => undefined) }
}

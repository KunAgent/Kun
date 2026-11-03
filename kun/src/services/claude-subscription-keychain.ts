import { execFile } from 'node:child_process'
import { userInfo } from 'node:os'
import { promisify } from 'node:util'

/** Matches the SDK's SF() account namespace, including its sanitization. */
export function claudeSubscriptionKeychainAccount(
  env: Record<string, string | undefined>, platform: NodeJS.Platform = process.platform,
  username: () => string = () => userInfo().username
): string {
  if (platform === 'win32') return 'claude-code-user'
  let account: string
  try { account = env.USER || username() } catch { return 'claude-code-user' }
  return /^[a-zA-Z0-9._-]+$/.test(account) ? account : 'claude-code-user'
}

type Execute = (file: string, args: string[], options: { encoding: 'utf8'; timeout: number; maxBuffer: number }) => Promise<{ stdout: string }>
export async function readClaudeSubscriptionKeychain(account: string, execute: Execute = promisify(execFile)): Promise<string> {
  try {
    const result = await execute('/usr/bin/security', ['find-generic-password', '-a', account, '-w', '-s', 'Claude Code-credentials'],
      { encoding: 'utf8', timeout: 2_000, maxBuffer: 256 * 1024 })
    return result.stdout.trim()
  } catch (error) {
    if ((error as { code?: unknown }).code === 44) return ''
    throw new Error('Native subscription credentials are unavailable')
  }
}

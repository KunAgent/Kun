import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { UploadAccess } from './runtime-file-upload'

const execFileAsync = promisify(execFile)
// get_session refreshes short-lived runtime proxy tokens, but never assigns a new VM.
const lookup = [
  'import json, sys',
  'from colab_cli.common import state',
  'state.config_path = sys.argv[1]',
  // An adopted assignment may have no local CLI session (its display name is synthetic).
  // Never resolve it by label, create an assignment, or attach a kernel to obtain stats.
  'if sys.argv[3]:',
  '    s = next((a.runtime_proxy_info for a in state.client.list_assignments() if a.endpoint == sys.argv[3]), None)',
  'else:',
  '    s = state.get_session(sys.argv[2], ignore_missing_session=True)',
  'if not s: sys.exit(1)',
  'print(json.dumps({"url": s.url, "token": s.token}))'
].join('\n')

export function colabUploadAccess(options: {
  pythonPath: string
  sessionsJsonPath: string
  sessionName: string
  endpoint?: string
  env: Record<string, string>
}): UploadAccess {
  let cached: { baseUrl: string; proxyToken: string; checkedAt: number } | undefined
  return async (signal) => {
    signal.throwIfAborted()
    if (cached && Date.now() - cached.checkedAt < 60_000) return cached
    try {
      const { stdout } = await execFileAsync(options.pythonPath, ['-c', lookup, options.sessionsJsonPath, options.sessionName, options.endpoint ?? ''], {
        env: options.env, signal, timeout: 30_000, maxBuffer: 64 * 1024, windowsHide: true
      })
      const { url, token } = JSON.parse(stdout.trim()) as { url: string; token: string }
      const base = new URL(url)
      if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || typeof token !== 'string' || !token) {
        throw new Error('Invalid runtime access.')
      }
      cached = { baseUrl: base.toString(), proxyToken: token, checkedAt: Date.now() }
      return cached
    } catch {
      // A CLI/HTTP exception can contain the full credential-bearing proxy URL.
      throw new Error('Could not access the connected Colab runtime. Reconnect and retry.')
    }
  }
}

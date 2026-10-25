import { spawn } from 'node:child_process'
import type { SecretEncryptor } from '../security/secret-store.js'
import { readGitHubAppConfig } from '../github-app/config.js'
import { GitHubAppService } from '../github-app/service.js'
import { GitHubReadMcp } from '../github-app/mcp.js'
import { createGitHubFetch } from '../github-app/network.js'

export async function createRuntimeGitHubApp(input: {
  dataDir: string; encryptor: SecretEncryptor; networkProxy: () => Promise<string>
}) {
  const fetchImpl = createGitHubFetch(input.networkProxy)
  const config = await readGitHubAppConfig().catch(() => undefined)
  const service = new GitHubAppService({ ...input, config, fetchImpl, openExternal: openGitHub })
  try { await service.initialize() }
  catch { return undefined }
  return { service, mcp: new GitHubReadMcp(fetchImpl) }
}

async function openGitHub(url: URL): Promise<void> {
  if (url.origin !== 'https://github.com' || url.username || url.password ||
      !(url.pathname === '/login/oauth/authorize' || /^\/apps\/[a-z0-9-]+\/installations\/new$/u.test(url.pathname))) {
    throw new Error('Unexpected GitHub browser destination')
  }
  const command = process.platform === 'darwin' ? '/usr/bin/open' : process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open'
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url.href] : [url.href]
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', windowsHide: true })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Browser launch timed out')) }, 10000)
    child.once('error', () => { clearTimeout(timer); reject(new Error('System browser is unavailable')) })
    child.once('exit', (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error('Browser launch failed')) })
  })
}

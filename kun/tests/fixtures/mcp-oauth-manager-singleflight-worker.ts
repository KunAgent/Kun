import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { auth } from '@modelcontextprotocol/client'
import { FileMcpOAuthProvider } from '../../src/adapters/tool/mcp-oauth-provider'
import { McpCapabilityConfig } from '../../src/contracts/capabilities'

/**
 * Child process for the two-runtime single-flight regression.
 *
 * The process is configured entirely from the environment it inherits
 * (`KUN_MANAGER_*`, `KUN_RUNTIME_INSTANCE_ID`, `KUN_RUNTIME_FLAVOR`), so the
 * credential file is read and written through the real Manager data plane and
 * the refresh transaction takes a real Manager resource lease. It then runs the
 * production SDK authorization path (`auth()` with the provider's coordinated
 * fetch) and reports the outcome as one JSON line on stdout.
 *
 * argv: <credentialPath> <issuer> <tokenEndpoint> <serverUrl> <readyPath> <goPath> <refreshReadyPath> <refreshGoPath>
 */
const [credentialPath, issuer, tokenEndpoint, serverUrl, readyPath, goPath, refreshReadyPath, refreshGoPath] = process.argv.slice(2)
if (!credentialPath || !issuer || !tokenEndpoint || !serverUrl || !readyPath || !goPath || !refreshReadyPath || !refreshGoPath) {
  throw new Error('worker arguments are missing')
}

const server = McpCapabilityConfig.parse({
  enabled: true,
  servers: {
    docs: {
      enabled: true,
      transport: 'streamable-http',
      url: 'https://mcp.example.com/mcp',
      trustScope: 'user',
      oauth: { enabled: true, expectedIssuer: issuer, callbackTimeoutMs: 1_000 }
    }
  },
  search: { enabled: false }
}).servers.docs

const provider = new FileMcpOAuthProvider('docs', server, credentialPath, () => undefined)

await writeFile(readyPath, 'ready')
const deadline = Date.now() + 30_000
while (!existsSync(goPath)) {
  if (Date.now() > deadline) throw new Error('barrier was not released')
  await new Promise((resolve) => setTimeout(resolve, 10))
}

let outcome: string
try {
  const fetchFn: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    if (request.method === 'POST' && new URLSearchParams(await request.clone().text()).get('grant_type') === 'refresh_token') {
      await writeFile(refreshReadyPath, 'ready')
      while (!existsSync(refreshGoPath)) {
        if (Date.now() > deadline) throw new Error('refresh barrier was not released')
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    }
    return provider.oauthFetch(request)
  }
  outcome = await auth(provider, { serverUrl: new URL(serverUrl), fetchFn })
} catch (error) {
  outcome = `error:${error instanceof Error ? error.message : String(error)}`
}

const tokens = await provider.tokens()
process.stdout.write(JSON.stringify({
  outcome,
  accessToken: tokens?.access_token,
  refreshToken: tokens?.refresh_token
}))

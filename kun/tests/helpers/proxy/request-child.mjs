// Node's type stripping executes the actual transport without a second build.
// The parent bounds this process externally, so a regex regression cannot hang Vitest.
import { proxyTransportRequest, cachedProxyAgentCountForTests, disposeProxyAgents } from '../../../src/adapters/model/proxy-transport.ts'

const options = JSON.parse(process.argv[2])
const responses = []
try {
  for (let index = 0; index < (options.repeat ?? 1); index++) {
    const response = await proxyTransportRequest({
      url: new URL(options.url),
      method: 'GET',
      headers: { 'x-proxy-compatibility': 'local-test' },
      proxyUrl: options.proxyUrl,
      body: { buffer: null, stream: null }
    })
    responses.push({ status: response.status, body: await response.text() })
  }
  console.log(JSON.stringify({ responses, cachedAgents: cachedProxyAgentCountForTests() }))
} catch (error) {
  console.log(JSON.stringify({ error: { message: error.message, code: error.code } }))
} finally {
  disposeProxyAgents()
}

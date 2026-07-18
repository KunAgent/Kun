import assert from 'node:assert/strict'
import { CURRENT_EXTENSION_API_VERSION } from '@kun/extension-api'
import { useExtensionClient } from '@kun/extension-react'
import { createExtensionTestHarness } from '@kun/extension-test'
import { activate, deactivate } from './dist/extension.js'

// The installed SDK is current v1.2 while this fixture's manifest intentionally
// remains v1.0, proving executable same-major backward negotiation.
assert.equal(CURRENT_EXTENSION_API_VERSION, '1.2.0')
assert.equal(typeof useExtensionClient, 'function')

const harness = createExtensionTestHarness({
  identity: {
    id: 'kun-release-fixtures.external-release',
    publisher: 'kun-release-fixtures',
    name: 'external-release',
    version: '1.0.0'
  },
  permissions: [
    'commands.register',
    'agent.run',
    'tools.register',
    'providers.register',
    'accounts.read'
  ]
})

harness.accounts.addAccount({
  id: 'release-account',
  providerId: 'external-stream',
  label: 'External release account',
  authenticationType: 'api-key',
  status: 'connected',
  metadata: {}
})

await harness.activate(activate, deactivate)

const run = await harness.client.commands.executeCommand('run-agent', 'exercise the public Agent API')
assert.equal(run.runId, 'run-1')
assert.equal(harness.agent.runs.size, 1)

assert.deepEqual(
  await harness.tools.invoke('tool-1', { value: 'packaged' }),
  { content: { echoed: 'packaged' } }
)

await harness.providers.invoke('provider-1', {
  operation: 'stream',
  request: {
    apiVersion: '1.0.0',
    requestId: 'external-request-1',
    binding: {
      providerId: 'external-stream',
      accountId: 'release-account',
      modelId: 'echo-1'
    },
    messages: [{ role: 'user', content: [{ type: 'text', text: 'stream' }] }]
  }
})
assert.deepEqual(
  harness.providers.takeStreamEvents('provider-1').map((event) => event.type),
  ['textDelta', 'completed']
)

await harness.dispose()
process.stdout.write('External packaged-SDK behavior OK: Agent command, tool, and provider stream executed.\n')

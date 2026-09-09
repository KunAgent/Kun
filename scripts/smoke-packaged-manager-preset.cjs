'use strict'

/** Exercise the installed Registry contract, not a source-only schema or version string. */
async function assertPackagedPresetMode(runtime, runtimeJson) {
  for (const presetMode of ['api', 'token-plan']) {
    const snapshot = await runtimeJson(runtime, '/v1/model-connections')
    const id = `startup-smoke-kimi-${presetMode}`
    await runtimeJson(runtime, '/v1/model-connections/connect', {
      method: 'POST', body: JSON.stringify({
        expectedRevision: snapshot.revision, id, name: 'Startup Kimi fixture',
        presetSource: 'kimi-code', presetMode, kind: 'http', authType: 'subscription',
        baseUrl: 'http://127.0.0.1:9', endpointFormat: 'chat_completions',
        useProxy: false, credential: 'isolated-smoke-fixture', models: ['kimi-test'],
        probe: false, select: false
      })
    })
    const reread = await runtimeJson(runtime, '/v1/model-connections')
    if (!reread.providers?.some((profile) => profile.id === id && profile.presetMode === presetMode)) {
      throw new Error(`Packaged Registry did not preserve ${presetMode}`)
    }
  }
}
module.exports = { assertPackagedPresetMode }

'use strict'

const {
  CdpConnection,
  isWorkbenchTarget,
  sendToWorkbenchSession,
  waitForCdpEndpoint,
  waitForTarget
} = require('./smoke-packaged-extension-desktop-cdp.cjs')
const {
  evaluationValue,
  pollUntil,
  processState
} = require('./smoke-packaged-extension-desktop-process.cjs')

// These probes run in the actual packaged workbench's renderer, not a mocked
// source preload. Keep them self-contained so CDP and the unit tests execute
// exactly the same assertions in a separate JavaScript context.
function preloadBridgeProbe() {
  if (document.readyState === 'loading') return null
  const bridge = window.kunGui
  if (!bridge || typeof bridge !== 'object') {
    throw new Error('Packaged preload did not expose window.kunGui')
  }
  if (typeof bridge.onProviderMutationFlushRequest !== 'function') {
    throw new Error('Packaged preload is missing onProviderMutationFlushRequest')
  }
  if (Object.prototype.hasOwnProperty.call(bridge, 'googleWorkspace')) {
    throw new Error('Packaged preload still exposes the retired Google Workspace bridge')
  }
  // Subscribe and immediately remove our inert listener; never emit a mutation
  // request or leave another acknowledgement handler installed in the app.
  const unsubscribe = bridge.onProviderMutationFlushRequest(async () => undefined)
  if (typeof unsubscribe !== 'function') {
    throw new Error('Packaged provider mutation subscription did not return an unsubscribe function')
  }
  unsubscribe()
  return { bridge: 'kunGui', providerMutationSubscription: true }
}

async function inspectPackagedWorkbench(input, expression, description, commandTimeoutMs = 15_000) {
  const readProcessState = () => processState(input.desktop.child)
  const endpoint = await waitForCdpEndpoint({
    port: input.debuggingPort,
    timeoutMs: input.timeoutMs,
    processState: readProcessState
  })
  const cdp = await CdpConnection.connect(
    endpoint.webSocketDebuggerUrl,
    globalThis.WebSocket,
    Math.min(input.timeoutMs, commandTimeoutMs)
  )
  try {
    await cdp.send('Target.setDiscoverTargets', { discover: true })
    const workbench = await waitForTarget(
      cdp, isWorkbenchTarget, description, input.timeoutMs, readProcessState
    )
    const session = { targetId: workbench.targetId, sessionId: undefined }
    return await pollUntil(async () => {
      const evaluated = await sendToWorkbenchSession({
        cdp,
        session,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
        timeoutMs: input.timeoutMs,
        processState: readProcessState,
        operation: description
      })
      // A loaded document with a broken bridge is a failure, not a startup
      // condition to retry until the generic quit/process timeout expires.
      return evaluationValue(evaluated, description)
    }, { timeoutMs: input.timeoutMs, description })
  } finally {
    cdp.close()
  }
}

async function assertPackagedPreloadBridge(input) {
  const result = await inspectPackagedWorkbench(
    input, `(${preloadBridgeProbe.toString()})()`, 'checking the packaged preload bridge'
  )
  process.stdout.write(`Packaged preload bridge OK: ${JSON.stringify(result)}\n`)
}

module.exports = {
  assertPackagedPreloadBridge,
  preloadBridgeProbe
}

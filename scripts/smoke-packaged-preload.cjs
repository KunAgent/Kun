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
const { version: googleWorkspaceVersion } = require('../resources/google-workspace/manifest.json')

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
  const methods = ['status', 'login', 'setup', 'logout', 'test', 'cancel', 'openAuthorization']
  for (const method of methods) {
    if (typeof bridge.googleWorkspace?.[method] !== 'function') {
      throw new Error(`Packaged preload is missing googleWorkspace.${method}`)
    }
  }
  // Subscribe and immediately remove our inert listener; never emit a mutation
  // request or leave another acknowledgement handler installed in the app.
  const unsubscribe = bridge.onProviderMutationFlushRequest(async () => undefined)
  if (typeof unsubscribe !== 'function') {
    throw new Error('Packaged provider mutation subscription did not return an unsubscribe function')
  }
  unsubscribe()
  return { bridge: 'kunGui', providerMutationSubscription: true, googleWorkspaceMethods: methods }
}

async function googleWorkspaceStatusProbe(expectedVersion) {
  const bridge = window.kunGui
  if (typeof bridge?.startup?.getState !== 'function') {
    throw new Error('Packaged preload is missing startup.getState')
  }
  const startup = await bridge.startup.getState()
  if (startup?.phase === 'recovery_required') {
    throw new Error('Packaged desktop requires recovery before the Google Workspace status round-trip')
  }
  if (startup?.phase !== 'ready') return null
  if (typeof bridge.googleWorkspace?.status !== 'function') {
    throw new Error('Packaged preload is missing googleWorkspace.status')
  }
  // Only call this in the freshly created, isolated smoke profile, after the
  // Runtime is running. Status runs local --version/auth status; it must never
  // log in, open a browser, test APIs, or use an existing user's Google account.
  const status = await bridge.googleWorkspace.status()
  if (status?.experimental !== true || status.binary?.available !== true ||
      status.binary.version !== expectedVersion) {
    throw new Error('Packaged Google Workspace status did not report the available pinned binary')
  }
  if (!['disconnected', 'setup_required'].includes(status.auth?.state) ||
      !Array.isArray(status.auth.scopes) || status.auth.scopes.length !== 0) {
    throw new Error('Packaged Google Workspace status was not disconnected in the fresh smoke profile')
  }
  if (status.operation !== undefined ||
      ['gmail', 'calendar', 'drive'].some((service) => status.services?.[service]?.state !== 'unknown')) {
    throw new Error('Packaged Google Workspace status unexpectedly reported account activity')
  }
  return { authState: status.auth.state, binaryVersion: status.binary.version }
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

async function assertPackagedGoogleWorkspaceStatus(input) {
  const result = await inspectPackagedWorkbench(
    input,
    `(${googleWorkspaceStatusProbe.toString()})(${JSON.stringify(googleWorkspaceVersion)})`,
    'checking the packaged Google Workspace status round-trip',
    45_000
  )
  process.stdout.write(`Packaged Google Workspace status OK: ${JSON.stringify(result)}\n`)
}

module.exports = {
  assertPackagedGoogleWorkspaceStatus,
  assertPackagedPreloadBridge,
  googleWorkspaceStatusProbe,
  preloadBridgeProbe
}

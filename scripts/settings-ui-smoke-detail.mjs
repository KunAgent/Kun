// The frozen-source Mac probe recovered blank initial frames at about 323/331ms.
// Use a 400ms checkpoint, then re-read bounds without scrolling or changing CSS.
// This is capture readiness, not a claim that transient on-screen paint is fixed.
export const SETTINGS_DETAIL_SETTLE_MS = 400

export async function captureReadySettingsDetail({ position, paintFrames, wait, read, capture, now }) {
  const started = now()
  const positionedDetail = await position()
  const positionedOffsetMs = now() - started
  await paintFrames()
  const waitStarted = now()
  await wait(SETTINGS_DETAIL_SETTLE_MS)
  const actualWaitMs = now() - waitStarted
  const sampleStartedOffsetMs = now() - started
  const detail = await read()
  const sampleCompletedOffsetMs = now() - started
  const captureStartedOffsetMs = now() - started
  // Retain the PNG even if the fresh sample is missing/clipped. Its caller
  // records evidence before applying the unchanged geometry assertions.
  const pixels = await capture()
  return { positionedDetail, detail, pixels, timing: {
    origin: 'Monotonic time immediately before initial detail positioning',
    requestedWaitMs: SETTINGS_DETAIL_SETTLE_MS, actualWaitMs, positionedOffsetMs,
    waitStartedOffsetMs: waitStarted - started, sampleStartedOffsetMs,
    sampleCompletedOffsetMs, captureStartedOffsetMs, captureCompletedOffsetMs: now() - started
  } }
}

export async function readGatewayClientAccessibility(cdp, elementId) {
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 })
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId,
    selector: `[id=${JSON.stringify(elementId)}]` })
  if (!nodeId) return null
  const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false })
  const node = nodes.find(node => !node.ignored && node.role?.value === 'combobox')
  return node ? { name: node.name?.value ?? '', role: node.role?.value ?? '',
    value: node.value?.value ?? '', properties: node.properties ?? [] } : null
}

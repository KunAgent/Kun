import type { DesktopCaptureBridge, CaptureCommand } from '../../../shared/remote-desktop'
const bridge = (window as unknown as { kunDesktopCapture: DesktopCaptureBridge }).kunDesktopCapture
let peer: RTCPeerConnection | undefined, stream: MediaStream | undefined
let channels = new Map<string, RTCDataChannel>(), deadline = performance.now() + 15000
let currentQuality = 'balanced'
let serial = Promise.resolve()
let senderReady = false, healthSequence = 0, healthPending: RTCPeerConnection | undefined
let healthTimestamp: number | undefined
let healthReportId: string | undefined
async function stop() {
  senderReady = false
  for (const track of stream?.getTracks() ?? []) track.stop()
  stream = undefined
  for (const channel of channels.values()) channel.close()
  channels.clear(); peer?.close(); peer = undefined
}
const counter = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
async function sampleHealth() {
  const current = peer, track = stream?.getVideoTracks()[0]
  if (!current || !track || !senderReady || healthPending === current) return
  const sender = current.getSenders().find(item => item.track === track)
  if (!sender) return
  healthPending = current
  const started = performance.now()
  try {
    const reports = await sender.getStats()
    if (peer !== current || !senderReady || performance.now() - started > 1000) return
    let source: Record<string, unknown> | undefined, outbound: Record<string, unknown> | undefined
    reports.forEach(report => {
      if (report.type === 'outbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')) outbound = report
    })
    if (typeof outbound?.mediaSourceId === 'string') source = reports.get(outbound.mediaSourceId)
    if (source?.type !== 'media-source') source = undefined
    const timestamp = outbound?.timestamp
    if (typeof outbound?.id !== 'string' || typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return
    if (healthReportId === outbound.id && healthTimestamp !== undefined && timestamp <= healthTimestamp) return
    healthTimestamp = timestamp; healthReportId = outbound.id
    bridge.event({ event: 'health', value: { sampleId: ++healthSequence, trackState: track.readyState, muted: track.muted,
      sourceFrames: counter(source?.frames), framesEncoded: counter(outbound?.framesEncoded), framesSent: counter(outbound?.framesSent) } })
  } catch { /* No synthetic health: Main and the phone expire the last real sample. */ }
  finally { if (healthPending === current) healthPending = undefined }
}
const profiles = { smooth: { width: 960, frameRate: 15, bitrate: 1500000 }, balanced: { width: 1280, frameRate: 30, bitrate: 4000000 }, sharp: { width: 1920, frameRate: 20, bitrate: 6000000 } }
async function quality(raw: unknown) {
  const profile = profiles[raw as keyof typeof profiles] ?? profiles.balanced
  await stream?.getVideoTracks()[0]?.applyConstraints({ width: { max: profile.width }, frameRate: { max: profile.frameRate } })
  const sender = peer?.getSenders().find(item => item.track?.kind === 'video')
  if (sender) { const p = sender.getParameters(); if (p.encodings?.length) { p.encodings[0].maxBitrate = profile.bitrate; await sender.setParameters(p) } }
}
async function execute(command: CaptureCommand) {
  const params = command.params
  switch (command.operation) {
    case 'start': {
      await stop(); deadline = performance.now() + 15000; healthSequence = 0; healthTimestamp = undefined; healthReportId = undefined
      peer = new RTCPeerConnection({ iceServers: params.iceServers as RTCIceServer[] })
      const current = peer
      current.onicecandidate = event => bridge.event({ event: 'ice', value: event.candidate ? { candidates: [event.candidate.toJSON()], complete: false } : { candidates: [], complete: true } })
      current.onconnectionstatechange = () => { if (['closed', 'failed'].includes(current.connectionState)) bridge.event({ event: 'closed' }) }
      for (const label of ['kun.desktop.control.v1', 'kun.desktop.input.v1', 'kun.desktop.pointer.v1']) {
        const channel = current.createDataChannel(label, label.endsWith('pointer.v1') ? { ordered: false, maxRetransmits: 0 } : { ordered: true })
        channels.set(label, channel)
        channel.onmessage = event => {
          if (typeof event.data !== 'string' || new TextEncoder().encode(event.data).length > 8192) { void stop(); bridge.event({ event: 'closed' }); return }
          bridge.event({ event: 'data', value: { label, raw: event.data } })
        }
      }
      // Main has already authorized the display. Main's display-media handler selects exactly it.
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { max: 30 } }, audio: false })
      if (peer !== current) { await stop(); throw Error('DESKTOP_START_CANCELLED') }
      const track = stream.getVideoTracks()[0]; track.enabled = false
      track.contentHint = 'detail'
      track.onended = () => bridge.event({ event: 'closed' })
      track.onmute = () => { if (peer === current && senderReady) bridge.event({ event: 'health', value: {
        sampleId: ++healthSequence, trackState: track.readyState, muted: true, sourceFrames: null, framesEncoded: null, framesSent: null
      } }) }
      const transceiver = current.addTransceiver('video', { direction: 'sendonly' })
      const codecs = RTCRtpSender.getCapabilities('video')?.codecs
      if (codecs?.some(codec => codec.mimeType.toLowerCase() === 'video/h264'))
        transceiver.setCodecPreferences([...codecs.filter(codec => codec.mimeType.toLowerCase() === 'video/h264'), ...codecs.filter(codec => codec.mimeType.toLowerCase() !== 'video/h264')])
      currentQuality = String(params.quality); await quality(currentQuality)
      const offer = await current.createOffer(); await current.setLocalDescription(offer)
      return { type: 'offer', sdp: offer.sdp }
    }
    case 'answer': await peer?.setRemoteDescription(params.answer as RTCSessionDescriptionInit); return
    case 'ice': for (const candidate of params.candidates as RTCIceCandidateInit[]) await peer?.addIceCandidate(candidate); return
    case 'send': {
      const data = params.data as Record<string, unknown>
      if (data.type === 'ready') {
        deadline = performance.now() + Math.min(6000, Math.max(0, Number(params.remainingMs ?? 0)))
        const track = stream?.getVideoTracks()[0]
        if (track) { track.enabled = true; await peer?.getTransceivers()[0]?.sender.replaceTrack(track); await quality(currentQuality); senderReady = true; void sampleHealth() }
      }
      if (data.type === 'probe') deadline = performance.now() + Math.min(6000, Math.max(0, Number(params.remainingMs ?? 0)))
      const channel = channels.get(String(params.label))
      if (channel?.readyState === 'open') channel.send(JSON.stringify(data))
      return
    }
    case 'quality': currentQuality = String(params.quality); await quality(currentQuality); return
    case 'stop': await stop(); return
  }
}
bridge.onCommand(command => {
  // Stop is deliberately outside the queue: a pending capture prompt/offer cannot delay cleanup.
  if (command.operation === 'stop') { void stop().then(() => bridge.reply({ id: command.id, value: true })); return }
  serial = serial.catch(() => {}).then(async () => {
    try { const value = await execute(command); bridge.reply({ id: command.id, value }) }
    catch { await stop(); bridge.reply({ id: command.id, error: 'DESKTOP_CAPTURE_FAILED' }) }
  })
})
setInterval(() => { if (peer && performance.now() > deadline) { void stop(); bridge.event({ event: 'closed' }) } }, 250)
setInterval(() => { void sampleHealth() }, 500)
bridge.event({ event: 'ready' })

import type { DesktopSession } from '@kun/remote-protocol'

export async function exercisePrivacy(fixture: any, video: HTMLVideoElement, session: DesktopSession) {
  const identity = { sessionId: session.sessionId, epoch: session.epoch }
  const change = async (enabled: boolean) => {
    const state = await fixture.invoke('desktop.session.privacy', { ...identity, enabled })
    if (state.enabled !== enabled) throw Error('Privacy command was not confirmed')
  }
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 2
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  async function remoteColor(color: 'red' | 'green') {
    const limit = performance.now() + 4000
    while (performance.now() < limit) {
      ctx.drawImage(video, video.videoWidth/2, video.videoHeight/2, 1, 1, 0, 0, 1, 1)
      const [r,g,b] = ctx.getImageData(0,0,1,1).data
      if (color === 'red' ? r > g+60 && r > b+60 : g > r+60 && g > b+60) return
      await new Promise(resolve => setTimeout(resolve,50))
    }
    throw Error('Expected ' + color + ' in the received WebRTC frames')
  }
  if ((await fixture.invoke('desktop.session.privacy', identity)).enabled !== false) throw Error('Privacy must start off')
  await change(true); await fixture.localColor('black'); await remoteColor('red')
  return async () => {
    await remoteColor('green'); await fixture.localColor('black')
    await change(false); await fixture.localColor('green')
    await change(true); await fixture.localColor('black'); await remoteColor('green')
  }
}

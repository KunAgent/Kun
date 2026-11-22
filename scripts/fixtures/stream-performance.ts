type SenderStats = {
  sourceFrames?: number; framesEncoded?: number; reason?: string; codec?: string; encodedWidth?: number; encodedHeight?: number
}
type Counters = { source?: number; encoded?: number; decoded?: number; presented: number }

export async function measureMotion(duration: number, video: HTMLVideoElement, frames: () => number,
  state: () => {phase:string;session?:{epoch:number}}, receiver: () => Promise<{framesDecoded:number|null}|null> | undefined,
  sender: () => Promise<SenderStats|null>) {
  const start = performance.now(), firstFrame = frames()
  let samples = 0, fullHdSamples = 0, negotiatingSamples = 0, epochs = 1, priorEpoch = state().session?.epoch
  const totals = { source:0, encoded:0, decoded:0, presented:0 }
  let fullHdFrames = 0
  const observations: unknown[] = []
  let last: SenderStats | null = null
  async function read(): Promise<Counters> {
    const rx = await receiver()?.catch(() => null)
    last = await sender().catch(() => null)
    const played = video.getVideoPlaybackQuality()
    return { source:last?.sourceFrames, encoded:last?.framesEncoded, decoded:rx?.framesDecoded ?? undefined,
      presented:played.totalVideoFrames-played.droppedVideoFrames }
  }
  let previous = await read()
  while (performance.now() - start < duration*1000) {
    await new Promise(resolve=>setTimeout(resolve,1000))
    const status = state()
    if (!['viewing','negotiating'].includes(status.phase)) throw Error('Motion stream ended during measurement: '+status.phase)
    if (status.phase==='negotiating') negotiatingSamples++
    const current = await read(), epoch = status.session?.epoch, changed = epoch !== undefined && epoch !== priorEpoch
    if (changed) { epochs++; priorEpoch = epoch }
    for (const name of Object.keys(totals) as (keyof Counters)[]) {
      const value = current[name], prior = previous[name]
      if (value === undefined) continue
      if (prior !== undefined) {
        const delta = (changed && name !== 'presented' || value < prior) ? value : value-prior
        totals[name] += delta
        if (name === 'presented' && status.phase === 'viewing' && video.videoWidth === 1920 && video.videoHeight === 1080) fullHdFrames += delta
      }
    }
    previous = current
    samples++
    if (status.phase==='viewing' && video.videoWidth===1920 && video.videoHeight===1080) fullHdSamples++
    if (samples===1 || samples===5 || samples%30===0) observations.push(last)
  }
  const seconds = (performance.now()-start)/1000
  return {seconds,width:video.videoWidth,height:video.videoHeight,callbackFps:(frames()-firstFrame)/seconds,
    renderedFps:totals.presented/seconds,fullHdRenderedFps:fullHdFrames/seconds,decodedFps:totals.decoded/seconds,sourceFps:totals.source/seconds,
    encodedFps:totals.encoded/seconds,fullHdSamples,samples,negotiatingSamples,epochs,last,observations}
}

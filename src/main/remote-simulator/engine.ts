import { nativeImage } from 'electron'
import { SIMULATOR_LIMITS } from '@kun/remote-protocol'
import { RemoteSimulatorService, type SimulatorAuthority } from './service'
import { XcodeSimulatorBackend } from './adapter'
const engines = new Map<RemoteSimulatorService, ReturnType<typeof setInterval>>()

export function createSimulatorEngine(authorize: (origin: { kind: 'code' | 'agent'; id: string }, authority: SimulatorAuthority) => Promise<unknown>) {
  const backend = new XcodeSimulatorBackend(bytes => {
    let image = nativeImage.createFromBuffer(bytes)
    if (image.isEmpty()) throw new Error('SIMULATOR_INVALID_FRAME')
    if (image.getSize().width > SIMULATOR_LIMITS.imageWidth) image = image.resize({ width: SIMULATOR_LIMITS.imageWidth })
    const size = image.getSize()
    return { image: 'data:image/jpeg;base64,' + image.toJPEG(45).toString('base64'), width: size.width, height: size.height }
  })
  const service = new RemoteSimulatorService(backend, authorize)
  const timer = setInterval(() => { void service.sweep().catch(() => {}) }, 2000)
  timer.unref()
  engines.set(service, timer)
  return service
}

export async function stopBuiltinSimulatorEngines() {
  const results = await Promise.allSettled([...engines].map(async ([service, timer]) => {
    clearInterval(timer)
    await service.stopAll()
    engines.delete(service)
  }))
  const errors = results.filter(result => result.status === 'rejected')
  if (errors.length) throw new Error('SIMULATOR_CLOSE_UNCONFIRMED')
}
